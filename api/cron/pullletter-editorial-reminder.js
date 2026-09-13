/**
 * GET /api/cron/pullletter-editorial-reminder
 *
 * 2026-09-13 도메니코 — "발급 후 4주가 지나도 제출이 없으면 알림. 그리고 제출을 하지 않으면 추가 풀레터 발급 불가."
 *
 * 매일 한 번 돈다. 발급된 풀레터(issued/approved/accepted + PDF) 가운데
 *   · 완성 에디토리얼이 아직 연결되지 않았고(submission_id null)
 *   · 발급일(issued_at, 없으면 reviewed_at/created_at)로부터 REMIND_AFTER_DAYS(28)일이 지났고
 *   · 아직 독촉을 안 보낸(editorial_reminder_sent_at null)
 * 건을 골라 회원에게 메일(회원 언어) 1통 + 운영자 텔레그램 요약을 보내고 editorial_reminder_sent_at 을 찍는다.
 * 한 풀레터에 한 번만. "추가 발급 불가"는 api/pullletters/index.js POST 가 막는다(409 pending_editorial).
 *
 * Security: Vercel cron 은 Bearer <CRON_SECRET>. 다른 크론과 같은 게이트.
 */
'use strict';
const { safeEqual } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { withCronGuard, reportProduction } = require('../_lib/cronGuard');
const { sendEmail, templates } = require('../_lib/email');
const { resolveEmailLang } = require('../_lib/emailLocale');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

const CRON_NAME = 'pullletter-editorial-reminder';
const REMIND_AFTER_DAYS = 28;   // 4주
const MAX_PER_RUN = 50;
const ISSUED_STATUSES = ['issued', 'approved', 'accepted'];

/** 발급 기준 시각 — issued_at 우선, 없으면 reviewed_at, 그것도 없으면 created_at. */
function issuedAtOf(pl) {
  return pl.issued_at || pl.reviewed_at || pl.created_at || null;
}

/** 독촉 대상인가 (순수 함수 — 테스트가 직접 돌린다). */
function isDue(pl, now) {
  if (!pl) return false;
  if (ISSUED_STATUSES.indexOf(String(pl.status || '').toLowerCase()) === -1) return false;
  if (!pl.pull_letter_url) return false;
  if (pl.submission_id) return false;
  if (pl.editorial_reminder_sent_at) return false;
  const t = new Date(issuedAtOf(pl) || 0).getTime();
  if (!isFinite(t) || !t) return false;
  return (now || Date.now()) - t >= REMIND_AFTER_DAYS * 86400000;
}

module.exports = withCronGuard(CRON_NAME, async function handler(req, res) {
  if (handleCors(req, res)) return;
  res.locals = res.locals || {};

  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) return res.status(500).json({ message: 'CRON_SECRET not configured' });
  if (!safeEqual(got, expected)) return res.status(401).json({ message: 'Unauthorized' });

  const cutoff = new Date(Date.now() - REMIND_AFTER_DAYS * 86400000).toISOString();
  const stats = { scanned: 0, due: 0, sent: 0, errors: [] };
  const lines = [];
  try {
    const { data: rows, error } = await supabaseAdmin
      .from('pullletters')
      .select('id, user_id, title, status, pull_letter_url, submission_id, issued_at, reviewed_at, created_at, editorial_reminder_sent_at')
      .in('status', ISSUED_STATUSES)
      .is('submission_id', null)
      .is('editorial_reminder_sent_at', null)
      .not('pull_letter_url', 'is', null)
      .lte('created_at', cutoff)     // 대략 거르고(인덱스 친화), 정확한 판정은 isDue 가 issued_at 으로 한다
      .order('created_at', { ascending: true })
      .limit(MAX_PER_RUN);
    if (error) throw error;
    stats.scanned = (rows || []).length;
    const now = Date.now();
    for (const pl of (rows || [])) {
      if (!isDue(pl, now)) continue;
      stats.due += 1;
      try {
        const { data: profile } = await supabaseAdmin
          .from('profiles').select('email, name, email_language, language, country').eq('id', pl.user_id).maybeSingle();
        if (profile && profile.email) {
          const lang = resolveEmailLang(profile);
          await sendEmail(profile.email, templates.pullletterEditorialReminder({ name: profile.name || '' }, lang));   // ★ await
        }
        await supabaseAdmin.from('pullletters').update({ editorial_reminder_sent_at: new Date().toISOString() }).eq('id', pl.id);
        stats.sent += 1;
        lines.push('· ' + String(pl.title || pl.id).slice(0, 60) + ' — ' + ((profile && profile.email) || pl.user_id) + ' (발급 ' + String(issuedAtOf(pl) || '').slice(0, 10) + ')');
      } catch (e) {
        stats.errors.push(pl.id + ': ' + ((e && e.message) || e));
      }
    }
    if (stats.sent || stats.errors.length) {
      await sendTextToTelegramSafe('⏰ 풀레터 발급 4주 경과 · 완성 에디토리얼 미제출 ' + stats.sent + '건 독촉\n' + lines.join('\n')
        + (stats.errors.length ? ('\n오류 ' + stats.errors.length + '건: ' + stats.errors.join(' | ').slice(0, 300)) : '')
        + '\n※ 제출 전까지 새 풀레터 요청은 막혀 있습니다.');
    }
    const note = 'due=' + stats.due + ' sent=' + stats.sent + (stats.errors.length ? (' errors=' + stats.errors.length) : '');
    reportProduction(res, { produced: stats.sent, remaining: Math.max(0, stats.due - stats.sent), note });
    return res.status(200).json({ ok: true, stats });
  } catch (err) {
    console.error('[cron/' + CRON_NAME + '] failed:', err && err.message);
    return res.status(500).json({ message: 'Reminder sweep failed', error: err && err.message, stats });
  }
});
module.exports.isDue = isDue;
module.exports.REMIND_AFTER_DAYS = REMIND_AFTER_DAYS;
