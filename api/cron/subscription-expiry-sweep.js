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
  if (got !== expected) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  res.locals = res.locals || {};

  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const stats = { scanned: 0, downgraded: 0, reported: 0, autodowngrade: AUTODOWNGRADE, errors: [] };

  // 1) 만료됐는데 아직 활성으로 남은 구독.
  const { data: rows, error: scanErr } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id, plan, status, current_period_end')
    .lt('current_period_end', cutoff)
    .in('status', ['active', 'trialing', 'past_due', 'payment_failed'])
    .order('current_period_end', { ascending: true })
    .limit(MAX_PER_RUN);

  if (scanErr) throw scanErr; // withCronGuard 가 cron_runs 기록 + 실패 알림

  stats.scanned = (rows || []).length;

  const flagged = [];
  for (const row of (rows || [])) {
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
        await supabaseAdmin.from('subscriptions')
          .update({ status: 'expired', updated_at: new Date().toISOString() })
          .eq('user_id', row.user_id);
        stats.downgraded += 1;
      }
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
      `· ${f.email || f.user_id} · ${f.plan} · 만료 ${String(f.current_period_end).slice(0, 10)}`);
    sendTextToTelegramSafe(
      head + '\n' + lines.join('\n')
      + (flagged.length > 20 ? `\n… 외 ${flagged.length - 20}건` : '')
      + (AUTODOWNGRADE ? '' : '\n\n자동강등을 켜려면 Vercel env SUBSCRIPTION_EXPIRY_AUTODOWNGRADE=on')
    );
  }

  res.locals.cronNote = `scanned=${stats.scanned} flagged=${flagged.length} downgraded=${stats.downgraded} auto=${AUTODOWNGRADE}`;
  return res.status(200).json({ message: 'Expiry sweep complete', cutoff, grace_days: GRACE_DAYS, ...stats });
}

module.exports = withCronGuard('subscription-expiry-sweep', handler);
