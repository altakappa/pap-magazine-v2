'use strict';
/**
 * 화보 공개 순간 크리에이터에게 "공유용 링크" 메일 (2026-09-25, 도메니코 "전부 적용" — IG→웹 5번).
 *
 * 왜: 게재된 크리에이터가 자기 팔로워에게 웹 링크를 공유하면, 우리 팔로워가 아닌 새 사람이 웹으로 온다.
 * 승인 메일의 "게재 링크 킷"은 승인 때(보통 공개 전) 관리자가 체크해야만 가서, 공개된 순간엔 아무 것도 안 갔다.
 *
 * 언제: 실제로 보이게 되는 순간 한 번.
 *   · 관리자가 공개로 바꿨고 예약 시각이 없거나 지났으면 → 그 자리에서 (api/editorials/[id].js)
 *   · 예약 공개면 → 예약 시각이 지나 cron 이 공개 처리할 때 (api/cron/release-due-scheduled.js)
 * 한 번만: editorials.live_email_sent_at 이 비어 있을 때만 "먼저 찍고" 보낸다(동시 실행에도 한 통).
 * 서브미션에서 온 화보(source_submission_id)만. 실패해도 공개는 막지 않는다.
 */
const SITE = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

function shareUrl(slug, lang) {
  const pre = !lang || lang === 'ko' ? '' : '/' + lang;
  return SITE + pre + '/editorial/' + encodeURIComponent(slug)
    + '?utm_source=creator_share&utm_medium=social&utm_campaign=' + encodeURIComponent('ed-' + String(slug).slice(0, 40));
}

function isLiveNow(row, nowMs) {
  if (!row || row.status !== 'published') return false;
  if (!row.scheduled_publish_at) return true;
  const t = Date.parse(row.scheduled_publish_at);
  return !Number.isFinite(t) || t <= (nowMs || Date.now());
}

async function sendEditorialLiveMail(row, deps) {
  const { db, sendEmail, templates, resolveEmailLang } = deps;
  try {
    if (!row || !row.id || !row.source_submission_id || !row.slug) return { skipped: 'no_submission' };
    if (!isLiveNow(row, deps.now)) return { skipped: 'not_live' };
    // 먼저 찍는다 — 비어 있을 때만 바뀌므로 두 곳에서 동시에 불러도 한 곳만 통과한다.
    const stamp = new Date().toISOString();
    const { data: claimed, error: cErr } = await db.from('editorials')
      .update({ live_email_sent_at: stamp }).eq('id', row.id).is('live_email_sent_at', null).select('id');
    if (cErr) throw cErr;
    if (!claimed || !claimed.length) return { skipped: 'already_sent' };
    const { data: sub } = await db.from('submissions').select('user_id').eq('id', row.source_submission_id).maybeSingle();
    if (!sub || !sub.user_id) return { skipped: 'no_user' };
    const { data: p } = await db.from('profiles')
      .select('email, display_name, name, language, email_language, country').eq('id', sub.user_id).maybeSingle();
    if (!p || !p.email) return { skipped: 'no_email' };
    const lang = resolveEmailLang(p);
    const tpl = templates.editorialLive({ name: p.display_name || p.name || '' }, { title: row.title || '', url: shareUrl(row.slug, lang) }, lang);
    const r = await sendEmail(p.email, tpl);
    if (!(r && r.sent)) {
      // 못 보냈으면 도장을 되돌려 다음 기회(재저장·다음 cron)에 다시 시도하게 한다.
      await db.from('editorials').update({ live_email_sent_at: null }).eq('id', row.id).eq('live_email_sent_at', stamp);
      return { sent: false, error: r && r.error };
    }
    return { sent: true };
  } catch (e) {
    console.warn('[editorialLive] 공개 알림 실패 (공개는 그대로):', (e && e.message) || e);
    return { sent: false, error: (e && e.message) || String(e) };
  }
}

module.exports = { sendEditorialLiveMail, shareUrl, isLiveNow };
