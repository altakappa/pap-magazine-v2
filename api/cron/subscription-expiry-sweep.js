/**
 * GET /api/cron/subscription-expiry-sweep
 *
 * 2026-07-20 감사 후속 — 만료·해지 강등의 "웹훅 도착 의존" 단일 실패점을 보완하는
 * pull 기반 안전망(백스톱). 갱신 웹훅이 유실·거부되어도 만료된 구독을 주기적으로
 * 잡아낸다.
 *
 * 동작:
 *   1) current_period_end 가 (now - GRACE) 이전인데 여전히 active/trialing/past_due/
 *      payment_failed 인 구독을 스캔 (= 갱신됐어야 하는데 안 된 것).
 *   2) 스태프/어드민(수동 증정 등급)과 subscriptions 행이 없는 profiles 는 건드리지 않음.
 *   3) 기본은 '탐지·보고'만 (cron_runs note + 텔레그램 알림) — 등급 강등(혜택 회수)은
 *      사람 확인 원칙(거버넌스)에 따라 자동 실행하지 않는다.
 *   4) env SUBSCRIPTION_EXPIRY_AUTODOWNGRADE === 'on' 일 때만 실제 강등(profiles→free,
 *      subscriptions.status='expired')을 수행한다.
 *
 * Security: Vercel cron 은 Bearer <CRON_SECRET> 서명. purge-rejected 와 동일 게이트.
 */

const { safeEqual } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { withCronGuard } = require('../_lib/cronGuard');
const { downgradeToFree } = require('../_lib/subscriptionAccess');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

// 갱신 처리/웹훅 지연을 감안한 유예. 이 기간이 지나도 미갱신이면 만료로 간주.
const GRACE_DAYS = 2;
const MAX_PER_RUN = 500;
const AUTODOWNGRADE = String(process.env.SUBSCRIPTION_EXPIRY_AUTODOWNGRADE || '').toLowerCase() === 'on';

async function handler(req, res) {
  if (handleCors(req, res)) return;

  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) {
    console.error('[cron/expiry-sweep] CRON_SECRET env not set');
    return res.status(500).json({ message: 'CRON_SECRET not configured' });
  }
  if (!safeEqual(got, expected)) { // 2026-09-04 timing-safe
    return res.status(401).json({ message: 'Unauthorized' });
  }

  res.locals = res.locals || {};

  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const stats = { scanned: 0, downgraded: 0, reported: 0, autodowngrade: AUTODOWNGRADE, errors: [] };

  // 1) 만료됐는데 아직 활성으로 남은 구독.
  const { data: rows, error: scanErr } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id, plan, status, current_period_end, pending_plan, pending_start_at')
    .lt('current_period_end', cutoff)
    // 2026-08-10 'canceled' 추가 — 해지해도 결제한 기간까지는 접근권을 유지하도록
    // 웹훅을 고쳤다(api/paypal-webhook.js handleTermination). 그러면 남은 기간이
    // 지난 뒤 내려주는 주체가 필요한데, 그게 이 스윕이다. 여기에 'canceled' 가
    // 빠져 있으면 해지자가 영원히 유료 등급으로 남는다.
    // 2026-10-01 'paused' 추가 — 쉬어가기(PayPal suspend)도 결제한 기간이 끝나면 내려야 한다.
    .in('status', ['active', 'trialing', 'past_due', 'payment_failed', 'canceled', 'paused'])
    .order('current_period_end', { ascending: true })
    .limit(MAX_PER_RUN);

  if (scanErr) throw scanErr; // withCronGuard 가 cron_runs 기록 + 실패 알림

  stats.scanned = (rows || []).length;

  const flagged = [];
  for (const row of (rows || [])) {
    /* 2026-11-14 — 플랜 변경 예약이 아직 시작되지 않았으면 건드리지 않는다.
       해지 상태에서도 종료일 시작으로 플랜을 바꿀 수 있게 되면서(planSwitch), 이 행은
       "기간은 끝났지만 새 플랜이 곧 시작" 인 상태로 잠깐 머문다. 그때 강등하면 첫 결제
       웹훅이 도착하기 전까지 유료 회원을 무료로 떨어뜨린다. 시작일이 지난 예약은
       (= 결제가 끝내 안 됨) 평소대로 강등 대상이다. */
    const pendStart = row.pending_start_at ? new Date(row.pending_start_at).getTime() : NaN;
    if (row.pending_plan && Number.isFinite(pendStart) && pendStart >= new Date(cutoff).getTime()) {
      continue;
    }
    // 대상 유저의 role 확인 — 스태프/어드민(수동 증정 등급)은 만료 강등 대상 아님.
    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('role, subscription_plan, subscription_status, email')
      .eq('id', row.user_id)
      .maybeSingle();
    if (!prof) continue;
    if (prof.role === 'admin' || prof.role === 'staff') continue;
    // 이미 free/inactive 로 정리된 유저는 스킵.
    if (String(prof.subscription_plan || 'free') === 'free') continue;

    flagged.push({
      user_id: row.user_id,
      email: prof.email,
      plan: row.plan,
      status: row.status,
      current_period_end: row.current_period_end,
    });

    if (AUTODOWNGRADE) {
      const { error: dErr } = await downgradeToFree(supabaseAdmin, row.user_id);
      if (dErr) {
        stats.errors.push({ user_id: row.user_id, message: dErr.message });
      } else {
        // 2026-10-01 쉬어가기(paused)는 status 를 그대로 둔다 — 등급만 free 로 내리고,
        // 마이페이지 '구독 다시 시작' 버튼이 계속 보이게(PayPal 쪽 구독은 SUSPENDED 로 살아 있다).
        if (String(row.status) !== 'paused') {
          await supabaseAdmin.from('subscriptions')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('user_id', row.user_id);
        }
        stats.downgraded += 1;
      }
    } else {
      stats.reported += 1;
    }
  }

  /* 2026-11-27 — 결제 기간이 아예 없는 행(current_period_end IS NULL).
     위 스캔은 .lt('current_period_end', cutoff) 라서 NULL 을 집지 못한다. 가입만
     하고 결제가 끝내 들어오지 않은 회원(PayPal 이 PENDING 에서 멈춘 경우 등)은
     profiles.subscription_plan 이 premium/standard 로 남은 채 두 스윕 모두에
     한 번도 보이지 않았다 — 실측 4명(2026-07~08 가입, 결제 0건, 구독 ID 없음).
     게이트가 subscription_status 를 함께 보므로 접근권이 샌 것은 아니지만 등급
     필드가 사실과 달랐다. 돈이 들어온 증거가 없으면 등급도 없어야 한다.
     'pending' 은 일부러 뺀다 — 체크아웃 중인 회원을 내리면 안 된다. */
  const { data: orphans, error: orphErr } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id, plan, status')
    .is('current_period_end', null)
    .in('status', ['canceled', 'expired', 'past_due', 'payment_failed'])
    .limit(MAX_PER_RUN);
  if (orphErr) throw orphErr;

  for (const row of (orphans || [])) {
    stats.scanned += 1;
    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('role, subscription_plan, subscription_status, email')
      .eq('id', row.user_id)
      .maybeSingle();
    if (!prof) continue;
    if (prof.role === 'admin' || prof.role === 'staff') continue;   // 수동 증정 등급
    if (String(prof.subscription_plan || 'free') === 'free') continue;

    flagged.push({
      user_id: row.user_id,
      email: prof.email,
      plan: row.plan,
      status: row.status,
      current_period_end: null,
    });

    if (AUTODOWNGRADE) {
      // 구독 행의 status 는 이미 종료 상태다 — 등급만 내린다.
      const { error: dErr } = await downgradeToFree(supabaseAdmin, row.user_id);
      if (dErr) stats.errors.push({ user_id: row.user_id, message: dErr.message });
      else stats.downgraded += 1;
    } else {
      stats.reported += 1;
    }
  }

  // 알림 — 만료 대상이 있으면 도메니코에게 알린다(자동강등이든 보고든).
  if (flagged.length) {
    const head = AUTODOWNGRADE
      ? `⏬ 구독 만료 자동강등 ${stats.downgraded}건`
      : `⚠️ 만료됐는데 활성인 구독 ${flagged.length}건 (자동강등 OFF — 확인 필요)`;
    const lines = flagged.slice(0, 20).map(f =>
      `· ${f.email || f.user_id} · ${f.plan} · `
      + (f.current_period_end ? `만료 ${String(f.current_period_end).slice(0, 10)}` : '결제 기록 없음'));
    await sendTextToTelegramSafe(
      head + '\n' + lines.join('\n')
      + (flagged.length > 20 ? `\n… 외 ${flagged.length - 20}건` : '')
      + (AUTODOWNGRADE ? '' : '\n\n자동강등을 켜려면 Vercel env SUBSCRIPTION_EXPIRY_AUTODOWNGRADE=on')
    );
  }

  res.locals.cronNote = `scanned=${stats.scanned} flagged=${flagged.length} downgraded=${stats.downgraded} auto=${AUTODOWNGRADE}`;
  return res.status(200).json({ message: 'Expiry sweep complete', cutoff, grace_days: GRACE_DAYS, ...stats });
}

module.exports = withCronGuard('subscription-expiry-sweep', handler);
