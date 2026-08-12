/**
 * GET /api/cron/trial-ending-reminder
 *
 * 2026-08-03 시윤 4단계 — 무료체험 종료 3일 전 안내 메일.
 *
 * 왜 만드나:
 *   무료 7일 체험 중에 풀레터·서브미션 피드백만 받아가고 결제 직전에 해지하는
 *   패턴을 막는 대책의 마지막 조각. 1~2단계(발급 보류)가 "받아가는 것"을 막는다면,
 *   이 메일은 "모르는 사이에 결제됐다"는 반대편 불만(=환불·분쟁)을 막는다.
 *   결제 3일 전에 미리 알려주는 쪽이 신뢰에도, 분쟁 비용에도 유리하다.
 *
 * 동작:
 *   1) status='active' 이면서 기간 길이가 10일 미만인 구독 = 무료체험 (trialWindow 규칙).
 *   2) 그중 KST 달력 기준 첫 결제까지 정확히 REMIND_DAYS(기본 3)일 남은 회원만 고른다.
 *   3) 스태프/어드민은 제외. 이메일이 없는 계정도 제외.
 *   4) 기본은 '드라이런' — 대상만 집계해 텔레그램으로 보고한다.
 *      env TRIAL_REMINDER_SEND === 'on' 일 때만 실제 메일을 보낸다.
 *      (거버넌스: 회원 대상 자동 발송은 도메니코가 스위치를 켠 뒤에 시작한다.)
 *
 * 중복 발송 방지:
 *   subscriptions 에 '보냈음' 플래그 컬럼이 없다(스키마 변경 없이 만든다).
 *   대신 (1) D-3 는 KST 달력 기준이라 한 회원당 하루만 매칭되고,
 *        (2) 같은 KST 날짜에 이미 성공한 실행이 있으면 즉시 스킵한다.
 *   -> 하루 여러 번 돌아도 회원당 최대 1통.
 *
 * Security: Vercel cron 은 Bearer <CRON_SECRET> 서명. expiry-sweep 과 동일 게이트.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { withCronGuard } = require('../_lib/cronGuard');
const { sendEmail, templates } = require('../_lib/email');
const { resolveEmailLang } = require('../_lib/emailLocale');
const { sendTextToTelegramSafe } = require('../_lib/telegram');
const { classifyPeriod, todayKstDayNo, kstDateStr } = require('../_lib/trialWindow');

const CRON_NAME = 'trial-ending-reminder';
const REMIND_DAYS = Math.max(1, Number(process.env.TRIAL_REMINDER_DAYS || 3) || 3);
const SEND_ENABLED = String(process.env.TRIAL_REMINDER_SEND || '').toLowerCase() === 'on';
const MAX_PER_RUN = 300;

// 오늘(KST) 이미 성공적으로 돌았는가? — 같은 날 두 번째 실행을 막는 잠금.
async function _alreadyRanTodayKst() {
  const todayNo = todayKstDayNo();
  const { data } = await supabaseAdmin
    .from('cron_runs')
    .select('ran_at, ok, note')
    .eq('cron_name', CRON_NAME)
    .eq('ok', true)
    .order('ran_at', { ascending: false })
    .limit(10);
  for (const r of (data || [])) {
    // 스킵으로 끝난 실행은 '돌았다'로 치지 않는다 — 실제 스캔이 있었던
    // 실행만 잠금 근거로 삼는 편이 안전하다.
    if (String(r.note || '').indexOf('skipped=') === 0) continue;
    const d = new Date(r.ran_at).getTime();
    if (!isFinite(d)) continue;
    if (Math.floor((d + 9 * 60 * 60 * 1000) / 86400000) === todayNo) return true;
  }
  return false;
}

async function handler(req, res) {
  if (handleCors(req, res)) return;

  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) {
    console.error('[cron/trial-reminder] CRON_SECRET env not set');
    return res.status(500).json({ message: 'CRON_SECRET not configured' });
  }
  if (got !== expected) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  res.locals = res.locals || {};

  if (await _alreadyRanTodayKst()) {
    res.locals.cronNote = 'skipped=already_ran_today_kst';
    return res.status(200).json({ message: 'Already ran today (KST) - skipped', skipped: true });
  }

  const stats = { scanned: 0, matched: 0, sent: 0, failed: 0, dryRun: !SEND_ENABLED, remindDays: REMIND_DAYS };

  // 1) 아직 살아 있는 구독만 훑는다. 체험 판별은 기간 길이(<10일)로 한다 —
  //    DB 에 trial_end 컬럼이 없기 때문(trialWindow.js 와 동일한 규칙).
  const { data: rows, error: scanErr } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id, plan, status, current_period_start, current_period_end')
    .eq('status', 'active')
    .not('current_period_end', 'is', null)
    .gte('current_period_end', new Date().toISOString())
    .order('current_period_end', { ascending: true })
    .limit(MAX_PER_RUN);

  if (scanErr) throw scanErr; // withCronGuard 가 cron_runs 기록 + 실패 알림

  stats.scanned = (rows || []).length;

  const targets = [];
  for (const row of (rows || [])) {
    const info = classifyPeriod(row);
    if (!info || !info.isTrial) continue;
    if (info.daysToCharge !== REMIND_DAYS) continue;

    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('id, email, name, role, language, email_language')
      .eq('id', row.user_id)
      .maybeSingle();
    if (!prof || !prof.email) continue;
    if (prof.role === 'admin' || prof.role === 'staff') continue;

    targets.push({ profile: prof, plan: row.plan, info });
  }

  stats.matched = targets.length;

  if (SEND_ENABLED) {
    for (const t of targets) {
      const lang = resolveEmailLang(t.profile);
      const tpl = templates.trialEndingSoon(
        { name: t.profile.name, language: lang },
        { plan: t.plan, chargeDateKst: t.info.chargeDateKst, days: REMIND_DAYS, lang }
      );
      const r = await sendEmail(t.profile.email, tpl);
      if (r && r.sent) stats.sent += 1;
      else stats.failed += 1;
    }
  }

  if (targets.length) {
    const head = SEND_ENABLED
      ? `📩 무료체험 D-${REMIND_DAYS} 안내메일 ${stats.sent}건 발송 (실패 ${stats.failed})`
      : `🔍 무료체험 D-${REMIND_DAYS} 대상 ${targets.length}명 (발송 OFF — 드라이런)`;
    const lines = targets.slice(0, 20).map(t =>
      `· ${t.profile.email} · ${t.plan} · 첫 결제 ${t.info.chargeDateKst || '?'}(KST)`);
    await sendTextToTelegramSafe(
      head + '\n' + lines.join('\n')
      + (targets.length > 20 ? `\n… 외 ${targets.length - 20}명` : '')
      + (SEND_ENABLED ? '' : '\n\n실제 발송을 켜려면 Vercel env TRIAL_REMINDER_SEND=on')
    );
  }

  res.locals.cronNote =
    `today=${kstDateStr(new Date().toISOString())} scanned=${stats.scanned} matched=${stats.matched} sent=${stats.sent} failed=${stats.failed} send=${SEND_ENABLED}`;
  return res.status(200).json({ message: 'Trial-ending reminder complete', ...stats });
}

module.exports = withCronGuard(CRON_NAME, handler);
