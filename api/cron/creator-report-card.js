/**
 * GET /api/cron/creator-report-card
 *
 * 2026-09-24 도메니코 "세 조각 설정해줘" ② — 게재 2~3주 뒤 화보 성적표.
 *
 * [왜] 첫 제출 60일 이상 지난 크리에이터 51명 중 재제출 3명(6%). 승인된 크리에이터
 *   85명 중 63명은 승인 뒤 PAP 메일을 한 통도 못 받았다. 그런데 그들 화보의
 *   인스타 도달은 2천~2만 4천이다(ig_post_latest.editorial_id). 본인이 이 숫자를 모른다.
 *   미용실의 "다듬으러 오세요" 문자 자리다. 숫자 + 다음 화보 권유 + 풀레터 한 줄.
 *
 * [대상] editorials 중 크리에이터 제출분(source_submission_id), 게재 14~45일,
 *   아직 안 보낸 것(report_card_sent_at null), 재시도 3회 미만. 규칙은 _lib/creatorReport.js.
 *   받는 사람은 제출자 본인(submissions.user_id → profiles.email) 한 명.
 *
 * [발송 스위치] site_settings key='creator_report_card' 의 value.send === true 일 때만 보낸다.
 *   행이 없거나 false 면 '미리보기': 누구에게 무엇이 갈지 세기만 하고 아무것도 기록하지 않는다.
 *   메일 전송은 도메니코 결정(볼트 작업 규칙)이라 기본은 꺼짐이다.
 *
 * [관리자 미리보기] 관리자 토큰으로 GET ?render=<editorial_id>[&lang=ko] → 실제 메일 HTML.
 *
 * [SMTP 421] 주간 뉴스가 한꺼번에 쏘다 13~46% 가 421 로 죽는다. 여기서는 한 통씩,
 *   사이에 1.5초를 두고, 일시 오류면 5초 뒤 1회 재시도한다. 그래도 실패하면 attempts+1,
 *   다음 날 다시 시도, 3번째 실패에서 포기.
 */
'use strict';
const { safeEqual } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { withCronGuard, reportProduction } = require('../_lib/cronGuard');
const { sendEmail, templates } = require('../_lib/email');
const { resolveEmailLang } = require('../_lib/emailLocale');
const { sendTextToTelegramSafe } = require('../_lib/telegram');
const { requireAdmin } = require('../_lib/auth');
const R = require('../_lib/creatorReport');

const CRON_NAME = 'creator-report-card';
const MAX_PER_RUN = 20;
const TIME_BUDGET_MS = 85000;   // 함수 상한 120초(vercel.json api/**) 안에서 여유를 두고 멈춘다. 남은 건 내일.
const GAP_MS = 1500;
const TRANSIENT_RE = /\b421\b|4\.[0-9]\.[0-9]|try again|temporar/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendSwitchOn() {
  try {
    const { data } = await supabaseAdmin.from('site_settings').select('value').eq('key', 'creator_report_card').maybeSingle();
    return !!(data && data.value && data.value.send === true);
  } catch (_) { return false; }
}

/** 한 화보의 메일 재료를 모은다. 없으면 { skip: 사유 }. */
async function buildOne(ed, now, langOverride) {
  const { data: sub } = await supabaseAdmin.from('submissions').select('user_id').eq('id', ed.source_submission_id).maybeSingle();
  if (!sub || !sub.user_id) return { skip: 'no_submitter' };
  const { data: profile } = await supabaseAdmin.from('profiles')
    .select('email, name, display_name, email_language, language, country').eq('id', sub.user_id).maybeSingle();
  if (!profile || !profile.email) return { skip: 'no_email' };
  const { data: igRows } = await supabaseAdmin.from('ig_post_latest')
    .select('reach, like_count, saved, shares, captured_at').eq('editorial_id', ed.id);
  const ig = R.pickIgMetrics(igRows);
  if (!R.worthSending(ig, ed.view_count)) return { skip: 'skipped_low' };
  const lang = langOverride || resolveEmailLang(profile);
  const built = templates.creatorReportCard({
    name: profile.name || profile.display_name || '',
    title: ed.title, slug: ed.slug,
    days: R.daysSince(ed.published_date, now),
    date: (ig && ig.capturedAt) || new Date(now).toISOString(),
    ig, web: ed.view_count || 0,
  }, lang);
  return { email: profile.email, lang, built, ig };
}

module.exports = withCronGuard(CRON_NAME, async function handler(req, res) {
  if (handleCors(req, res)) return;
  res.locals = res.locals || {};

  // 관리자 미리보기: 실제 메일 HTML 을 그대로 돌려준다 (발송·기록 없음).
  if (req.query && req.query.render) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { data: ed } = await supabaseAdmin.from('editorials')
      .select('id, title, slug, status, published_date, view_count, source_submission_id').eq('id', String(req.query.render)).maybeSingle();
    if (!ed) return res.status(404).json({ message: 'editorial not found' });
    const one = await buildOne(ed, Date.now(), req.query.lang ? String(req.query.lang) : null);
    if (one.skip) return res.status(200).json({ skip: one.skip });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(one.built.html);
  }

  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) return res.status(500).json({ message: 'CRON_SECRET not configured' });
  if (!safeEqual(got, expected)) return res.status(401).json({ message: 'Unauthorized' });

  const now = Date.now();
  const sendOn = await sendSwitchOn();
  const fromDate = new Date(now - R.REPORT_MAX_DAYS * 86400000).toISOString().slice(0, 10);
  const toDate = new Date(now - R.REPORT_MIN_DAYS * 86400000).toISOString().slice(0, 10);
  const stats = { mode: sendOn ? 'send' : 'preview', scanned: 0, due: 0, sent: 0, skipped: 0, failed: 0 };
  const lines = [];
  try {
    const { data: rows, error } = await supabaseAdmin.from('editorials')
      .select('id, title, slug, status, published_date, view_count, source_submission_id, report_card_sent_at, report_card_attempts')
      .eq('status', 'published').not('source_submission_id', 'is', null).is('report_card_sent_at', null)
      .gte('published_date', fromDate).lte('published_date', toDate)
      .order('published_date', { ascending: true }).limit(MAX_PER_RUN);
    if (error) throw error;
    stats.scanned = (rows || []).length;

    for (const ed of (rows || [])) {
      if (Date.now() - now > TIME_BUDGET_MS) { stats.budgetStop = true; break; }
      if (!R.isReportDue(ed, now)) continue;
      stats.due += 1;
      const one = await buildOne(ed, now, null);
      if (one.skip) {
        stats.skipped += 1;
        // 받을 사람이 없는 건 영구 제외. 숫자가 아직 작은 건(skipped_low) 기록하지 않는다:
        // 인스타 수집이 늦게 붙을 수 있으니 45일 창 안에서 매일 다시 본다.
        if (sendOn && one.skip !== 'skipped_low') {
          await supabaseAdmin.from('editorials').update({ report_card_sent_at: new Date().toISOString(), report_card_status: one.skip }).eq('id', ed.id);
        }
        continue;
      }
      if (!sendOn) {
        lines.push('· ' + String(ed.title || ed.id).slice(0, 50) + ' → ' + one.email + ' (도달 ' + ((one.ig && one.ig.reach) || 0) + ')');
        continue;
      }
      let result = await sendEmail(one.email, one.built);   // ★ await
      if (!(result && result.sent === true) && TRANSIENT_RE.test(String((result && result.error) || ''))) {
        await sleep(5000);
        result = await sendEmail(one.email, one.built);
      }
      if (result && result.sent === true) {
        stats.sent += 1;
        await supabaseAdmin.from('editorials').update({ report_card_sent_at: new Date().toISOString(), report_card_status: 'sent' }).eq('id', ed.id);
        lines.push('· ' + String(ed.title || ed.id).slice(0, 50) + ' → ' + one.email + ' (도달 ' + ((one.ig && one.ig.reach) || 0) + ')');
      } else {
        stats.failed += 1;
        const reason = String((result && result.error) || 'unknown').slice(0, 200);
        await supabaseAdmin.from('editorials').update({
          report_card_status: 'failed: ' + reason,
          report_card_attempts: (ed.report_card_attempts || 0) + 1,
        }).eq('id', ed.id);
      }
      await sleep(GAP_MS);
    }

    if (sendOn && (stats.sent || stats.failed)) {
      await sendTextToTelegramSafe('📊 화보 성적표 ' + stats.sent + '통 발송' + (stats.failed ? (' · 실패 ' + stats.failed) : '') + '\n' + lines.join('\n').slice(0, 1500));
    }
    const note = (sendOn ? '발송' : '미리보기(발송 꺼짐)') + ' · 대상 ' + stats.due + ' · 보냄 ' + stats.sent
      + ' · 건너뜀 ' + stats.skipped + (stats.failed ? (' · 실패 ' + stats.failed) : '')
      + (!sendOn && lines.length ? ' | ' + lines.slice(0, 5).join(' ').slice(0, 300) : '');
    res.locals.cronNote = note;
    reportProduction(res, { produced: stats.sent, remaining: Math.max(0, stats.due - stats.sent - stats.skipped), note });
    return res.status(200).json({ ok: true, stats, preview: sendOn ? undefined : lines });
  } catch (err) {
    console.error('[cron/' + CRON_NAME + '] failed:', err && err.message);
    return res.status(500).json({ message: 'report card sweep failed', error: err && err.message, stats });
  }
});
module.exports.buildOne = buildOne;
