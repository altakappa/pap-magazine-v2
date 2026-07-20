/**
 * POST /api/paddle-webhook — Paddle Billing 웹훅 처리 (해외 결제 레일)
 *
 * 결제 이원화 구조:
 *   국내  → PortOne V2 (portone-webhook.js)
 *   해외  → Paddle Billing (이 파일) — MoR 이라 VAT/세금은 Paddle 이 처리
 *
 * 처리 이벤트:
 *   subscription.created    — 구독 생성 (체크아웃 완료)
 *   subscription.updated    — 갱신/변경/예약취소/past_due 등 상태 변화
 *   subscription.canceled   — 구독 해지 확정
 *   subscription.paused     — 일시정지 (inactive 처리)
 *   subscription.resumed    — 재개
 *   transaction.completed   — 구독 결제: 로그용(상태 반영은 subscription.* 담당).
 *                             일회성 서브미션 기본료(custom_data.kind='submission_fee'):
 *                             해당 submission을 payment_status='paid'로만 전환(발행 X).
 *                             → api/_lib/submissionPayment.js (멱등: paddle_transaction_id)
 *
 * 유저 매핑:
 *   1순위 custom_data.user_id  (체크아웃 시 pap-api.js 가 심음)
 *   2순위 Paddle customer email → profiles.email 조회
 *   (둘 다 실패 시 loud log — 관리자 수동 정합용)
 *
 * 서명 검증: Paddle-Signature 헤더 "ts=…;h1=…"
 *   HMAC-SHA256(secret, `${ts}:${rawBody}`) === h1, ts 는 5분 내만 허용.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { sendEmail, templates } = require('./_lib/email');
const { resolveEmailLang } = require('./_lib/emailLocale');
const { handleSubmissionFeeTransaction, isSubmissionFeeEvent } = require('./_lib/submissionPayment');
const crypto = require('crypto');

const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET;
const { sendTextToTelegramSafe } = require('./_lib/telegram');
const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const PADDLE_API_BASE = process.env.PADDLE_ENV === 'production'
  ? 'https://api.paddle.com'
  : 'https://sandbox-api.paddle.com';

// Raw body 필요 (서명 검증)
module.exports.config = {
  api: { bodyParser: false },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifyPaddleSignature(rawBody, header) {
  if (!header || !PADDLE_WEBHOOK_SECRET) return false;
  const parts = {};
  String(header).split(';').forEach(kv => {
    const i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  if (!parts.ts || !parts.h1) return false;
  // Replay guard — 5분 이상 지난 이벤트 거부
  const ts = parseInt(parts.ts, 10);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = crypto
    .createHmac('sha256', PADDLE_WEBHOOK_SECRET)
    .update(`${parts.ts}:${rawBody.toString('utf8')}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.h1));
  } catch (_) {
    return false;
  }
}

// Paddle price ID → plan key (custom_data.plan_key 가 없을 때 fallback)
function planFromPriceId(priceId) {
  const map = {
    [process.env.PADDLE_PRICE_STD_M]: 'standard_monthly',
    [process.env.PADDLE_PRICE_STD_Y]: 'standard_yearly',
    [process.env.PADDLE_PRICE_PREM_M]: 'premium_monthly',
    [process.env.PADDLE_PRICE_PREM_Y]: 'premium_yearly',
  };
  return map[priceId] || null;
}

// Paddle API 호출 (customer email 조회용)
async function paddleGet(path) {
  const res = await fetch(`${PADDLE_API_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${PADDLE_API_KEY}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Paddle ${res.status}: ${(json.error && json.error.detail) || 'API error'}`);
  return json.data;
}

// 구독 이벤트 → user_id 해석
//
// 2026-07-20 감사 교정: custom_data.user_id 는 클라이언트(localStorage)가 심는 값이라
// 위조 가능하다. 결제자의 실제 이메일(Paddle customer, 원장 기반)로 해석한 유저와
// 대조해, 불일치하면 이메일 쪽을 신뢰하고 loud 알림을 남긴다(타 계정 구독행
// 덮어쓰기·오배정 방지). 이메일 조회는 대소문자 무관(ilike)으로 통일한다.
async function resolveUserId(sub) {
  const custom = sub.custom_data || {};
  const claimedId = custom.user_id || null;

  // 결제 customer email → profiles (위조 어려움)
  let emailUserId = null;
  if (sub.customer_id && PADDLE_API_KEY) {
    try {
      const customer = await paddleGet(`/customers/${sub.customer_id}`);
      if (customer && customer.email) {
        const { data: profile } = await supabaseAdmin
          .from('profiles').select('id').ilike('email', customer.email).maybeSingle();
        if (profile) emailUserId = profile.id;
      }
    } catch (e) {
      console.warn('[paddle-webhook] customer lookup failed:', e.message);
    }
  }

  if (claimedId && emailUserId && claimedId !== emailUserId) {
    console.error('[paddle-webhook] user_id MISMATCH — custom:', claimedId, 'email-resolved:', emailUserId, 'sub:', sub.id);
    sendTextToTelegramSafe('🚨 Paddle 구독 user_id 불일치 — 결제자 이메일 기준으로 배정. custom=' + claimedId + ' email=' + emailUserId + ' sub=' + sub.id);
    return emailUserId;
  }
  if (claimedId) {
    // claimed 만 있는 경우 실존 프로필인지 최소 확인 후 채택.
    const { data: p } = await supabaseAdmin.from('profiles').select('id').eq('id', claimedId).maybeSingle();
    if (p) return claimedId;
    console.warn('[paddle-webhook] custom.user_id not a real profile:', claimedId, '→ email-resolved fallback');
  }
  return emailUserId;
}

// Paddle 구독 상태 → 내부 상태
function mapStatus(paddleStatus) {
  switch (paddleStatus) {
    case 'active':
    case 'trialing': return 'active';
    case 'past_due': return 'past_due';
    case 'paused':   return 'paused';
    case 'canceled': return 'canceled';
    default:         return paddleStatus || 'active';
  }
}

async function upsertSubscription(sub, userId) {
  const item = (sub.items && sub.items[0]) || {};
  const priceId = item.price && item.price.id;
  const custom = sub.custom_data || {};
  // 2026-07-20 감사 교정: 등급은 Paddle이 실제 청구한 검증된 price ID로만 결정한다.
  // 기존엔 custom_data.plan_key(클라이언트가 심음)를 우선 신뢰해, 저가 price로 결제하고
  // plan_key만 상위로 조작하면 상위 등급을 취득할 수 있었다. price 매핑이 없을 때만
  // plan_key로 폴백하고, 둘이 어긋나면 price를 신뢰하며 알림을 남긴다.
  const priceIdPlan = planFromPriceId(priceId);
  const plan = priceIdPlan || custom.plan_key || 'unknown';
  if (custom.plan_key && priceIdPlan && custom.plan_key !== priceIdPlan) {
    console.warn('[paddle-webhook] plan_key != price-derived plan — trusting price. plan_key:', custom.plan_key, 'price:', priceIdPlan, 'sub:', sub.id);
    sendTextToTelegramSafe('⚠️ Paddle 결제 무결성 경고 — 요청 plan_key(' + custom.plan_key + ')와 실제 결제 price(' + priceIdPlan + ') 불일치. 실제 price로 처리함. sub=' + sub.id);
  }
  const interval = item.price && item.price.billing_cycle && item.price.billing_cycle.interval;
  const period = sub.current_billing_period || {};
  const status = mapStatus(sub.status);

  const { error } = await supabaseAdmin.from('subscriptions').upsert({
    user_id: userId,
    paddle_customer_id: sub.customer_id,
    paddle_subscription_id: sub.id,
    plan,
    billing_cycle: interval === 'year' ? 'yearly' : 'monthly',
    status,
    current_period_start: period.starts_at || null,
    current_period_end: period.ends_at || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  // 2026-07-20 감사 교정: 저장 실패를 삼키고 200을 반환하면 Paddle이 재시도하지 않아
  // 유료 구독이 영구 유실된다. 일시적 DB 오류는 throw 하여 핸들러가 500을 반환하고,
  // Paddle의 지수 백오프 재시도를 유도한다(멱등 upsert이므로 재시도 안전).
  if (error) {
    console.error('[paddle-webhook] subscription upsert failed:', error.message);
    throw new Error('subscription upsert failed: ' + error.message);
  }

  // 2026-07-11 — plan_key('premium_monthly' 등)를 그대로 profiles에 쓰면
  // 모든 등급 게이트(subscription_plan==='premium' 등가 비교: 풀레터 403,
  // 매거진/에디토리얼 열람, 프론트 checkAccess)가 실결제 회원을 막아버린다.
  // profiles에는 기본 등급만 저장하고 원본 키는 subscriptions.plan에 보존한다.
  const basePlan = /^premium/i.test(plan) ? 'premium'
    : /^standard/i.test(plan) ? 'standard' : null;
  const profileUpdate = {
    subscription_status: status === 'active' ? 'active' : 'inactive',
  };
  if (basePlan) profileUpdate.subscription_plan = basePlan;
  const { error: profErr } = await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', userId);
  if (profErr) {
    // 게이트가 읽는 것은 profiles 이므로 이 실패도 재시도 가치가 있다 → throw→500.
    console.error('[paddle-webhook] profile update failed:', profErr.message);
    throw new Error('profile update failed: ' + profErr.message);
  }

  return { plan, status };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!PADDLE_WEBHOOK_SECRET) {
    console.error('[paddle-webhook] PADDLE_WEBHOOK_SECRET not set');
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  const rawBody = await getRawBody(req);
  if (!verifyPaddleSignature(rawBody, req.headers['paddle-signature'])) {
    console.error('[paddle-webhook] signature verification failed');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (_) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  try {
    const type = event.event_type;
    const data = event.data || {};

    switch (type) {
      case 'subscription.created': {
        const userId = await resolveUserId(data);
        if (!userId) {
          console.error('[paddle-webhook] subscription.created — user unresolved. sub:', data.id, 'customer:', data.customer_id);
          // 검증 통과한 실이벤트인데 회원 매핑 실패 = "결제됐는데 미반영" 위험 → 즉시 알림.
          sendTextToTelegramSafe('🚨 Paddle 구독 생성됐으나 회원 매핑 실패 — 수동 정합 필요. sub=' + data.id + ' customer=' + data.customer_id);
          break; // 200 반환 (재시도해도 해결 안 됨) — 로그·알림 기반 수동 정합
        }
        const { plan } = await upsertSubscription(data, userId);
        if (plan === 'unknown') {
          sendTextToTelegramSafe('⚠️ Paddle 구독 plan=unknown — price ID/plan_key 매핑 확인 필요. sub=' + data.id + ' user=' + userId);
        }
        // 확인 메일 (실패해도 무시)
        const { data: profile } = await supabaseAdmin
          .from('profiles').select('email, name, email_language, language, country').eq('id', userId).single();
        if (profile && templates.subscriptionConfirmed) {
          sendEmail(profile.email, templates.subscriptionConfirmed({ name: profile.name }, plan, resolveEmailLang(profile))).catch(() => {});
        }
        // 유료 구독 발생 → 도메니코 텔레그램 즉시 알림 (2026-07-10 요청, 실패 무해)
        {
          const _item = (data.items && data.items[0]) || {};
          const _up = (_item.price && _item.price.unit_price) || {};
          const _amt = _up.amount ? (_up.currency_code === 'KRW' ? '₩' + Number(_up.amount).toLocaleString('ko-KR') : _up.amount + ' ' + (_up.currency_code || '')) : '';
          sendTextToTelegramSafe(
            '🎉 새 유료 구독자!\n'
            + '플랜: ' + String(plan).toUpperCase().replace('_', ' ') + (_amt ? (' · ' + _amt) : '') + '\n'
            + '회원: ' + ((profile && (profile.name || profile.email)) || '알 수 없음') + ((profile && profile.name && profile.email) ? (' (' + profile.email + ')') : '') + '\n'
            + '구독 ID: ' + data.id
          );
        }
        console.log('[paddle-webhook] subscription created:', data.id, '→ user', userId);
        break;
      }

      case 'subscription.updated':
      case 'subscription.resumed':
      case 'subscription.past_due': {
        const userId = await resolveUserId(data);
        if (!userId) {
          // 이미 저장된 행에서 역조회 (custom_data 유실 대비)
          const { data: row } = await supabaseAdmin
            .from('subscriptions').select('user_id')
            .eq('paddle_subscription_id', data.id).maybeSingle();
          if (!row) { console.warn('[paddle-webhook]', type, '— unknown sub', data.id); break; }
          await upsertSubscription(data, row.user_id);
          break;
        }
        await upsertSubscription(data, userId);
        break;
      }

      case 'subscription.canceled':
      case 'subscription.paused': {
        const { data: row } = await supabaseAdmin
          .from('subscriptions').select('user_id')
          .eq('paddle_subscription_id', data.id).maybeSingle();
        if (!row) { console.warn('[paddle-webhook]', type, '— unknown sub', data.id); break; }
        await supabaseAdmin.from('subscriptions').update({
          status: type === 'subscription.canceled' ? 'canceled' : 'paused',
          updated_at: new Date().toISOString(),
        }).eq('paddle_subscription_id', data.id);
        // 해지/일시정지 확정 시 등급도 free로 하향 — 게이트는 subscription_plan만
        // 보므로 status만 바꾸면 해지 회원이 영구히 premium 접근을 유지하게 된다.
        // (resumed/updated 재활성 시 upsertSubscription이 등급을 복원한다)
        await supabaseAdmin.from('profiles').update({
          subscription_status: 'inactive',
          subscription_plan: 'free',
        }).eq('id', row.user_id);
        console.log('[paddle-webhook]', type, data.id, '→ user', row.user_id);
        break;
      }

      case 'transaction.completed': {
        // ── 서브미션 일회성 기본료 (kind:'submission_fee') ──────────────
        // 구독과 완전 분리: custom_data.kind + submission_id 로만 진입한다.
        // payment_status 만 건드리고 발행/status(approved)는 절대 손대지 않는다
        // (draft-only). 멱등: 같은 paddle_transaction_id 재수신은 스킵.
        if (isSubmissionFeeEvent(data)) {
          const r = await handleSubmissionFeeTransaction(data, supabaseAdmin);
          switch (r.outcome) {
            case 'paid':
              console.log('[paddle-webhook] submission fee paid:', r.submissionId, 'tx:', r.txId, 'amount(cents):', r.paidAmount, 'storedType:', r.storedType || '-');
              if (r.underpaid) {
                // 실제 결제액 < 저장 유형 기대액 — 과소결제. 결제는 발생했으므로
                // paid로 기록하되, 도메니코가 발행(수동) 전 반드시 검토하도록 loud log.
                console.warn('[paddle-webhook] submission fee UNDERPAID — sub:', r.submissionId, 'tx:', r.txId, 'paid(cents):', r.paidAmount, 'expected(cents):', r.expectedAmount, 'storedType:', r.storedType);
              }
              if (r.userMismatch) {
                console.warn('[paddle-webhook] submission fee USER MISMATCH — custom_data.user_id != submission.user_id, sub:', r.submissionId, 'tx:', r.txId);
              }
              break;
            case 'duplicate':
              console.log('[paddle-webhook] submission fee duplicate (idempotent skip):', r.submissionId, 'tx:', r.txId);
              break;
            case 'unresolved':
              // 200 반환 + loud log — 재시도해도 해결 안 됨(수동 정합). 재시도 루프 방지.
              console.error('[paddle-webhook] submission fee UNRESOLVED —', r.reason, 'submission:', r.submissionId, 'tx:', r.txId);
              break;
            case 'already_paid_other_tx':
              console.error('[paddle-webhook] submission fee already paid by DIFFERENT tx — sub:', r.submissionId, 'existing:', r.existingTx, 'new:', r.txId);
              break;
            case 'error':
              console.error('[paddle-webhook] submission fee update failed:', r.error, 'sub:', r.submissionId, 'tx:', r.txId);
              break;
            default:
              console.warn('[paddle-webhook] submission fee unexpected outcome:', r.outcome, r.submissionId);
          }
          break;
        }
        // ── 구독 결제 로그 (기존 동작 보존) ──────────────────────────────
        // 상태 반영은 subscription.updated 가 담당 — 여기선 결제 로그만.
        console.log('[paddle-webhook] transaction completed:', data.id, 'sub:', data.subscription_id || '-');
        break;
      }

      case 'transaction.payment_failed': {
        console.warn('[paddle-webhook] payment failed — sub:', data.subscription_id || '-', 'customer:', data.customer_id || '-');
        break;
      }

      default:
        console.log('[paddle-webhook] unhandled event:', type);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[paddle-webhook] processing error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};
