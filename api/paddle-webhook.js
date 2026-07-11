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
 *   transaction.completed   — 결제 완료 (로그용 — 상태 반영은 subscription.* 이 담당)
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
async function resolveUserId(sub) {
  const custom = sub.custom_data || {};
  if (custom.user_id) return custom.user_id;
  // Fallback: customer email → profiles
  if (sub.customer_id && PADDLE_API_KEY) {
    try {
      const customer = await paddleGet(`/customers/${sub.customer_id}`);
      if (customer && customer.email) {
        const { data: profile } = await supabaseAdmin
          .from('profiles').select('id').eq('email', customer.email).maybeSingle();
        if (profile) return profile.id;
      }
    } catch (e) {
      console.warn('[paddle-webhook] customer lookup failed:', e.message);
    }
  }
  return null;
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
  const plan = custom.plan_key || planFromPriceId(priceId) || 'unknown';
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
  if (error) console.error('[paddle-webhook] subscription upsert failed:', error.message);

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
  await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', userId);

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
          break; // 200 반환 (재시도해도 해결 안 됨) — 로그 기반 수동 정합
        }
        const { plan } = await upsertSubscription(data, userId);
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
