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
const { hasPriorSubscription } = require('./_lib/trialWindow');
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
    // 2026-08-03 시윤 3단계 — 체험 없는(재구독용) price 도 같은 플랜으로 매핑한다.
    // 빠뜨리면 재구독 결제가 plan='unknown' 으로 저장돼 등급이 안 올라간다.
    [process.env.PADDLE_PRICE_STD_M_NOTRIAL]: 'standard_monthly',
    [process.env.PADDLE_PRICE_STD_Y_NOTRIAL]: 'standard_yearly',
    [process.env.PADDLE_PRICE_PREM_M_NOTRIAL]: 'premium_monthly',
    [process.env.PADDLE_PRICE_PREM_Y_NOTRIAL]: 'premium_yearly',
  };
  // env 미설정이면 키가 'undefined' 문자열이 되므로 그 칸은 무시한다.
  delete map['undefined'];
  delete map[''];
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
    await sendTextToTelegramSafe('🚨 Paddle 구독 user_id 불일치 — 결제자 이메일 기준으로 배정. custom=' + claimedId + ' email=' + emailUserId + ' sub=' + sub.id);
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
    await sendTextToTelegramSafe('⚠️ Paddle 결제 무결성 경고 — 요청 plan_key(' + custom.plan_key + ')와 실제 결제 price(' + priceIdPlan + ') 불일치. 실제 price로 처리함. sub=' + sub.id);
  }
  const interval = item.price && item.price.billing_cycle && item.price.billing_cycle.interval;
  const period = sub.current_billing_period || {};
  const status = mapStatus(sub.status);

  // 🔴 2026-08-12 — 접근권 종료일은 "절대 앞당기지 않는다".
  //
  // 실제로 일어난 일: 2026-08-10 11:01 UTC 에 Paddle 폐쇄 사과로 유료 5명의
  // current_period_end 를 손으로 1개월 늘렸다. 그런데 11:22~11:26 UTC 에 Paddle 이
  // subscription.updated 를 보냈고, 이 upsert 가 Paddle 이 아는 원래 종료일로
  // 4명을 되돌렸다(Gianna 만 웹훅이 안 와서 살아남았다). 메일로 이미 약속한
  // 무료 1개월이 DB 에서 조용히 사라진 상태로 이틀이 지났다.
  //
  // 결제사는 "우리가 청구한 기간"만 안다. 사과·보상·수동 연장처럼 결제와 무관하게
  // 늘린 접근권은 결제사가 알 방법이 없으므로, 결제사 값으로 덮으면 항상 손해가
  // 우리 쪽으로 온다. 그래서 더 나중 날짜가 이기게 한다.
  //
  // 반대 방향(결제사가 더 뒤 날짜를 주는 정상 갱신)은 그대로 반영된다.
  const incomingEnd = period.ends_at || null;
  let nextEnd = incomingEnd;
  const { data: prevRow } = await supabaseAdmin
    .from('subscriptions')
    .select('current_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  const prevEnd = prevRow && prevRow.current_period_end;
  if (prevEnd && (!incomingEnd || new Date(prevEnd).getTime() > new Date(incomingEnd).getTime())) {
    nextEnd = prevEnd;
    console.log('[paddle-webhook] 접근권 종료일 유지 —', sub.id, 'DB:', prevEnd, '> 웹훅:', incomingEnd);
  }

  const { error } = await supabaseAdmin.from('subscriptions').upsert({
    user_id: userId,
    paddle_customer_id: sub.customer_id,
    paddle_subscription_id: sub.id,
    plan,
    billing_cycle: interval === 'year' ? 'yearly' : 'monthly',
    status,
    current_period_start: period.starts_at || null,
    current_period_end: nextEnd,
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
          await sendTextToTelegramSafe('🚨 Paddle 구독 생성됐으나 회원 매핑 실패 — 수동 정합 필요. sub=' + data.id + ' customer=' + data.customer_id);
          break; // 200 반환 (재시도해도 해결 안 됨) — 로그·알림 기반 수동 정합
        }
        // 2026-08-03 시윤 3단계 — 재체험 감시(사후 탐지).
        // upsert 는 user_id 충돌 시 기존 행을 덮으므로 '이전에 구독 이력이 있었나'는
        // 반드시 upsert 전에 물어봐야 한다. 체험 상태로 새 구독이 들어왔는데 이력이
        // 있으면, 프론트 가드가 뚫렸거나 price 설정이 빠진 것 -> 즉시 알림.
        let _hadPrior = false;
        try { _hadPrior = await hasPriorSubscription(supabaseAdmin, userId); } catch (_) {}

        const { plan } = await upsertSubscription(data, userId);
        if (_hadPrior && data.status === 'trialing') {
          await sendTextToTelegramSafe('⚠️ 재체험 감지 — 과거 구독 이력이 있는 회원이 또 무료체험으로 재구독했습니다. NOTRIAL price 설정 확인 필요. sub=' + data.id + ' user=' + userId);
        }
        if (plan === 'unknown') {
          await sendTextToTelegramSafe('⚠️ Paddle 구독 plan=unknown — price ID/plan_key 매핑 확인 필요. sub=' + data.id + ' user=' + userId);
        }
        // 확인 메일 (실패해도 무시)
        const { data: profile } = await supabaseAdmin
          .from('profiles').select('email, name, email_language, language, country').eq('id', userId).single();
        if (profile && templates.subscriptionConfirmed) {
          try { await sendEmail(profile.email, templates.subscriptionConfirmed({ name: profile.name }, plan, resolveEmailLang(profile))); }
          catch (_e) { console.error('[paddle-webhook] 구독 메일 실패:', (_e && _e.message) || _e); }
        }
        // 유료 구독 발생 → 도메니코 텔레그램 즉시 알림 (2026-07-10 요청, 실패 무해)
        {
          const _item = (data.items && data.items[0]) || {};
          const _up = (_item.price && _item.price.unit_price) || {};
          const _amt = _up.amount ? (_up.currency_code === 'KRW' ? '₩' + Number(_up.amount).toLocaleString('ko-KR') : _up.amount + ' ' + (_up.currency_code || '')) : '';
          await sendTextToTelegramSafe(
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
          .from('subscriptions').select('user_id, current_period_end')
          .eq('paddle_subscription_id', data.id).maybeSingle();
        if (!row) { console.warn('[paddle-webhook]', type, '— unknown sub', data.id); break; }
        await supabaseAdmin.from('subscriptions').update({
          status: type === 'subscription.canceled' ? 'canceled' : 'paused',
          updated_at: new Date().toISOString(),
        }).eq('paddle_subscription_id', data.id);

        // ⚠️ 2026-08-10 — 해지했다고 접근권을 그 자리에서 끊지 않는다.
        //    api/paypal-webhook.js handleTermination 과 같은 규칙이다.
        //    약관(refund.html)·마이페이지 확인창 모두 "이미 결제한 기간이 끝날
        //    때까지 이용 가능" 이라고 약속했는데 코드만 즉시 강등하고 있었다.
        //
        //    🔴 이 경로가 특히 위험한 이유: Paddle 계정이 2026-08-14 폐쇄되면
        //    살아 있는 구독 전건에 subscription.canceled 가 한꺼번에 날아온다.
        //    그때 즉시 강등하면 8/31~9/8 까지 결제를 마친 유료 회원 4명의
        //    접근권을 우리가 스스로 빼앗는다. 돈은 이미 받았고 환불도 안 한다.
        //
        //    남은 기간이 지난 뒤의 강등은 만료 스윕이 맡는다
        //    (api/cron/subscription-expiry-sweep.js — status 필터에 'canceled' 포함).
        const periodEnd = row.current_period_end
          || (((data.current_billing_period || {}).ends_at) || null);
        if (periodEnd && new Date(periodEnd).getTime() > Date.now()) {
          console.log('[paddle-webhook]', type, data.id,
            '— 결제한 기간이 남아 접근권 유지. user:', row.user_id, 'until:', periodEnd);
          break;
        }

        // 기간이 끝났거나 알 수 없음 → 강등. 게이트는 subscription_plan 만 보므로
        // status 만 바꾸면 해지 회원이 영구히 premium 접근을 유지하게 된다.
        // (resumed/updated 재활성 시 upsertSubscription 이 등급을 복원한다)
        await supabaseAdmin.from('profiles').update({
          subscription_status: 'inactive',
          subscription_plan: 'free',
        }).eq('id', row.user_id);
        console.log('[paddle-webhook]', type, data.id, '→ 강등 user', row.user_id);
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
        // ── 서브미션 부가서비스 (kind:'submission_addon') — 2026-07-20 ────
        // PayPal→Paddle 전환분. DB 스키마 변경 없이 우선 loud log로 기록
        // (도메니코가 Vercel 로그·Paddle 대시보드에서 대조). 발행·상태는 불변.
        {
          const _cd = data && data.custom_data;
          if (_cd && _cd.kind === 'submission_addon') {
            console.log('[paddle-webhook] submission ADDON paid — sub:', _cd.submission_id || '-', 'addon:', _cd.addon || '-', 'tx:', data.id, 'user:', _cd.user_id || '-');
            break;
          }
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
