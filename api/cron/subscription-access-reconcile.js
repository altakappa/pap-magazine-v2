/**
 * GET /api/cron/subscription-access-reconcile
 *
 * ■ 왜 생겼나 (2026-11-24)
 * 도메니코: "돈이 안 들어왔는데 왜 등급을 유지해? 돈이 들어오면 다시 복구하면 되잖아."
 * 맞는 정책인데, 그 "복구" 쪽이 우리 시스템에 **없었다**.
 *
 * 등급을 **빼앗는** 쪽에는 pull 기반 안전망이 있다 — subscription-expiry-sweep.
 * 웹훅이 유실돼도 만료된 구독을 매일 잡아 내린다.
 * 등급을 **주는** 쪽에는 그게 없었다. 활성화는 오직 BILLING.SUBSCRIPTION.* 웹훅
 * 한 번에 달려 있었고, 그 한 번이 유실되면 영원히 복구되지 않았다.
 *
 * 실제 피해(발견 당일): difanation@gmail.com 이 10/12 에 premium_monthly 로 가입해
 * 11/12 에 갱신까지 됐는데(subscriptions = active · 12/12 까지 결제됨), profiles 는
 * 가입일 이후 한 번도 바뀌지 않아 free/inactive 였다. **6주 동안 프리미엄 요금을
 * 내면서 무료 회원으로 쓰고 있었다.** 본인이 말하지 않아 아무도 몰랐다.
 *
 * 재시도 경로도 같은 구멍으로 샌다: 갱신 결제가 실패했다가 PayPal 재시도로 성사되면
 * PAYMENT.SALE.COMPLETED 만 온다(구독이 내내 ACTIVE 였으니 ACTIVATED 는 오지 않는다).
 * 그 핸들러는 subscriptions 만 고치고 profiles 는 건드리지 않는다 — 의도된 분업이지만,
 * 그 사이 만료 스윕이 profiles 를 free 로 내려 두었다면 되돌릴 주체가 없다.
 *
 * ■ 무엇을 하나
 * "결제가 살아 있는데 등급이 없는 사람" 을 찾아 등급만 맞춘다.
 *
 * ■ 방향은 한쪽뿐이다 — 이게 이 크론의 안전장치다
 * 올리기만 한다. 절대 내리지 않는다. 내리는 일은 expiry-sweep 혼자 한다.
 * 두 크론이 같은 칸을 양방향으로 쓰면 서로의 판단을 되돌리며 깜빡인다
 * (유료→무료→유료…). 그래서 한 크론은 올리기만, 다른 크론은 내리기만 한다.
 *
 * ■ 기본이 '자동'인 이유 (expiry-sweep 은 기본이 '보고만' 이다)
 * 혜택을 **회수**하는 것은 사람 판단이 필요하다. 그러나 **이미 받은 돈만큼의 접근권을
 * 돌려주는 것**은 판단거리가 아니라 오류 수정이다. 지연 자체가 피해다(6주).
 * 그래도 끌 수 있게 env 는 남긴다: SUBSCRIPTION_RECONCILE=off
 */

const { safeEqual } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { withCronGuard } = require('../_lib/cronGuard');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

const MAX_PER_RUN = 500;
const ENABLED = String(process.env.SUBSCRIPTION_RECONCILE || 'on').toLowerCase() !== 'off';

/* 결제가 살아 있다고 볼 상태. expiry-sweep 과 달리 canceled 도 포함한다 —
   해지해도 **결제한 기간까지는** 접근권이 유지되는 게 우리 규칙이고
   (paypal-webhook handleTermination), 그 기간은 아직 안 끝났기 때문이다. */
const LIVE_STATUS = ['active', 'trialing', 'canceled'];

/** subscriptions.plan → profiles.subscription_plan (게이트가 쓰는 기본 등급) */
function baseTier(plan) {
  const p = String(plan || '');
  if (/^premium/i.test(p)) return 'premium';
  if (/^standard/i.test(p)) return 'standard';
  return null;
}

/* 등급의 높낮이. 올리기만 한다는 규칙을 코드로 강제한다. */
const RANK = { free: 0, standard: 1, premium: 2 };
function rank(t) { return RANK[String(t || 'free')] || 0; }

async function handler(req, res) {
  if (handleCors(req, res)) return;

  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) {
    console.error('[cron/access-reconcile] CRON_SECRET env not set');
    return res.status(500).json({ message: 'CRON_SECRET not configured' });
  }
  if (!safeEqual(got, expected)) return res.status(401).json({ message: 'Unauthorized' });

  res.locals = res.locals || {};
  const stats = { scanned: 0, fixed: 0, reported: 0, enabled: ENABLED, errors: [] };

  /* 결제 기간이 아직 남은 구독만 본다. 기간이 끝난 건 expiry-sweep 의 몫이다. */
  const { data: rows, error: scanErr } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id, plan, status, current_period_end')
    .in('status', LIVE_STATUS)
    .gt('current_period_end', new Date().toISOString())
    .order('current_period_end', { ascending: true })
    .limit(MAX_PER_RUN);
  if (scanErr) throw scanErr;   // withCronGuard 가 기록 + 실패 알림

  stats.scanned = (rows || []).length;
  const fixed = [];

  for (const row of (rows || [])) {
    const want = baseTier(row.plan);
    if (!want) continue;                       // 모르는 플랜은 건드리지 않는다

    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('role, subscription_plan, subscription_status, email')
      .eq('id', row.user_id).maybeSingle();
    if (!prof) continue;
    if (prof.role === 'admin' || prof.role === 'staff') continue;   // 수동 증정 등급

    const have = String(prof.subscription_plan || 'free');
    const statusOk = String(prof.subscription_status || '') === 'active';
    /* 올릴 일이 있을 때만 움직인다. 같거나 더 높으면 그대로 둔다 —
       더 높은 경우는 사람이 손으로 올려 준 것일 수 있다. */
    if (rank(have) >= rank(want) && statusOk) continue;

    fixed.push({
      user_id: row.user_id, email: prof.email, plan: row.plan,
      from: have + '/' + (prof.subscription_status || '-'), to: want,
      period_end: row.current_period_end,
    });

    if (!ENABLED) { stats.reported += 1; continue; }

    const patch = { subscription_status: 'active', updated_at: new Date().toISOString() };
    if (rank(want) > rank(have)) patch.subscription_plan = want;   // 내리지 않는다
    const { error: uErr } = await supabaseAdmin.from('profiles').update(patch).eq('id', row.user_id);
    if (uErr) stats.errors.push({ user_id: row.user_id, message: uErr.message });
    else stats.fixed += 1;
  }

  /* 한 건이라도 고쳤다면 웹훅이 샜다는 뜻이다 — 조용히 고치고 넘어가면
     원인은 그대로 남는다. 그래서 고친 사실 자체를 알린다. */
  if (fixed.length) {
    const head = ENABLED
      ? `🔼 결제는 살아 있는데 등급이 없던 회원 ${stats.fixed}건 복구`
      : `⚠️ 결제는 살아 있는데 등급이 없는 회원 ${fixed.length}건 (자동복구 OFF)`;
    const lines = fixed.slice(0, 20).map((f) =>
      `· ${f.email || f.user_id} · ${f.plan} · ${f.from} → ${f.to} · 결제기간 ~${String(f.period_end).slice(0, 10)}`);
    await sendTextToTelegramSafe(
      head + '\n' + lines.join('\n')
      + (fixed.length > 20 ? `\n… 외 ${fixed.length - 20}건` : '')
      + '\n\n이 알림이 뜬다는 것은 활성화 웹훅이 유실됐다는 뜻입니다 — 반복되면 웹훅 쪽을 봐야 합니다.'
    );
  }

  res.locals.cronNote = `scanned=${stats.scanned} mismatched=${fixed.length} fixed=${stats.fixed} auto=${ENABLED}`;
  return res.status(200).json({ message: 'Access reconcile complete', ...stats });
}

module.exports = withCronGuard('subscription-access-reconcile', handler);
