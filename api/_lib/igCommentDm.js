'use strict';
/**
 * 인스타 댓글 → DM 으로 웹 링크 (2026-09-25, 도메니코 "전부 적용" — IG→웹 1번).
 *
 * 캡션에 "댓글에 CREDITS 남기면 전체 크레딧·컷 링크를 DM으로" 라고 쓰면, 그 단어가 든 댓글을 단 사람에게
 * 인스타그램 공식 기능(댓글 비공개 답장, 댓글 1개당 1번, 7일 안)으로 그 게시물의 웹 페이지 링크를 보낸다.
 *
 * 기본은 꺼져 있다. 켜려면 (도메니코):
 *   1) Meta 앱에 instagram_manage_messages 권한 추가·심사 → 토큰 재발급 (IG_ACCESS_TOKEN)
 *   2) Vercel env IG_DM_ENABLED=1
 * 권한이 없으면 Meta 가 거절하고, 그 사유를 기록한 뒤 이번 회차는 멈춘다(계속 두드리지 않는다).
 *
 * 규칙: 스팸 후보(점수 기준 이상)에는 보내지 않는다 · 한 댓글에 한 번(ig_comment_dms 표) ·
 *       7일 지난 댓글 제외(인스타 규칙) · 한 회차 최대 IG_DM_MAX_PER_RUN(기본 20).
 * 링크: 게시물 ↔ 사이트 글 연결(articles.source_instagram_post_id/url, editorials.source_instagram_url)이 있으면
 *       그 글, 없으면 /ig 페이지. 댓글 글자로 언어를 짐작해 그 언어 주소·문구로 보낸다.
 */
const API = 'https://graph.facebook.com/v21.0';
const SITE = process.env.SITE_URL || 'https://www.pap-magazine.com';
const WINDOW_MS = 7 * 24 * 3600 * 1000;

const DEFAULT_KEYWORDS = ['credits', 'credit', 'link', 'links', '크레딧', '링크', 'クレジット', 'リンク', '链接', 'ссылка', 'crediti', 'crédits', 'créditos', 'enlace', 'lien'];
function keywords() {
  const extra = String(process.env.IG_DM_KEYWORDS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return extra.length ? extra : DEFAULT_KEYWORDS;
}
function matchKeyword(text, list) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[.,!?¡¿:;"'()\[\]{}]/g, ' ') + ' ';
  return (list || keywords()).some((k) => (/^[a-z]/.test(k) ? t.includes(' ' + k + ' ') || t.includes(' ' + k + '\n') : t.includes(k)));
}

/** 댓글 글자로 언어 짐작 (확실한 글자만): 한글 ko · 가나 ja · 한자만 zh · 키릴 ru · 그 밖 en */
function guessLang(text) {
  const s = String(text || '');
  if (/[가-힣]/.test(s)) return 'ko';
  if (/[぀-ヿ]/.test(s)) return 'ja';
  if (/[一-鿿]/.test(s)) return 'zh';
  if (/[Ѐ-ӿ]/.test(s)) return 'ru';
  return 'en';
}
const DM_TEXT = {
  ko: '댓글 고마워요. 전체 컷과 크레딧은 여기서 볼 수 있어요: {url}',
  en: 'Thanks for your comment. See every image and the full credits here: {url}',
  ja: 'コメントありがとうございます。すべてのカットとクレジットはこちら: {url}',
  zh: '谢谢你的留言。全部照片和完整署名请看这里:{url}',
  ru: 'Спасибо за комментарий. Все кадры и полные кредиты здесь: {url}',
};

function normPermalink(u) {
  const s = String(u || '').trim().toLowerCase().split('?')[0].replace(/\/+$/, '');
  const m = s.match(/instagram\.com\/(?:[^/]+\/)?(p|reel|tv)\/([a-z0-9_-]+)/);
  return m ? m[2] : '';
}

/** IG 게시물 → 사이트 글 주소 (없으면 /ig). lang 에 맞는 주소 앞말. */
async function targetUrl(db, media, lang) {
  const pre = lang === 'ko' ? '' : '/' + lang;
  const utm = 'utm_source=ig_dm&utm_medium=social&utm_campaign=' + encodeURIComponent('dm-' + String(media && media.id || '').slice(-10));
  const code = normPermalink(media && media.permalink);
  try {
    if (media && media.id) {
      const { data: a } = await db.from('articles').select('slug').eq('status', 'published').eq('source_instagram_post_id', String(media.id)).limit(1);
      if (a && a[0] && a[0].slug) return SITE + pre + '/article/' + encodeURIComponent(a[0].slug) + '?' + utm;
    }
    if (code) {
      const { data: e } = await db.from('editorials').select('slug').eq('status', 'published').ilike('source_instagram_url', '%/' + code + '%').limit(1);
      if (e && e[0] && e[0].slug) return SITE + pre + '/editorial/' + encodeURIComponent(e[0].slug) + '?' + utm;
      const { data: a2 } = await db.from('articles').select('slug').eq('status', 'published').ilike('source_instagram_url', '%/' + code + '%').limit(1);
      if (a2 && a2[0] && a2[0].slug) return SITE + pre + '/article/' + encodeURIComponent(a2[0].slug) + '?' + utm;
    }
  } catch (_) { /* 연결 실패 → /ig */ }
  return SITE + '/ig?lang=' + lang + '&' + utm;
}

async function sendPrivateReply(commentId, text, opts) {
  const o = opts || {};
  const sender = String(o.senderId || process.env.IG_DM_SENDER_ID || process.env.IG_USER_ID || '').trim();
  const token = String(o.token || process.env.IG_ACCESS_TOKEN || '').trim();
  if (!sender || !token) return { ok: false, error: 'IG 자격증명 없음' };
  const r = await (o.fetch || fetch)(API + '/' + encodeURIComponent(sender) + '/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ recipient: { comment_id: String(commentId) }, message: { text } }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await r.json().catch(() => ({}));
  if (r.ok && !body.error) return { ok: true, id: body.message_id || null };
  const err = body.error || {};
  const permission = r.status === 403 || err.code === 10 || err.code === 200 || /permission/i.test(String(err.message || ''));
  return { ok: false, permission, error: String(err.message || ('HTTP ' + r.status)).split(token).join('[TOKEN]').slice(0, 300) };
}

/**
 * rows: ig-comment-scan 이 모은 댓글 [{comment_id, media_id, permalink, text, username, score, posted_at}]
 * media: 그 회차 게시물 목록 (id → permalink)
 */
async function runCommentDms({ db, rows, media, threshold, now, send }) {
  if (process.env.IG_DM_ENABLED !== '1') return { enabled: false };
  const max = Number(process.env.IG_DM_MAX_PER_RUN || 20);
  const t = now || Date.now();
  const list = keywords();
  const cand = (rows || []).filter((r) => r && r.comment_id && !r.is_reply
    && (r.score || 0) < threshold
    && matchKeyword(r.text, list)
    && (!r.posted_at || t - Date.parse(r.posted_at) <= WINDOW_MS));
  if (!cand.length) return { enabled: true, sent: 0, candidates: 0 };
  const { data: done } = await db.from('ig_comment_dms').select('comment_id').in('comment_id', cand.map((c) => c.comment_id));
  const doneSet = new Set((done || []).map((d) => d.comment_id));
  const byId = new Map((media || []).map((m) => [m.id, m]));
  let sent = 0, failed = 0, stopped = null;
  for (const c of cand) {
    if (sent >= max) break;
    if (doneSet.has(c.comment_id)) continue;
    const lang = guessLang(c.text);
    const url = await targetUrl(db, byId.get(c.media_id) || { id: c.media_id, permalink: c.permalink }, lang);
    const text = (DM_TEXT[lang] || DM_TEXT.en).replace('{url}', url);
    const r = await (send || sendPrivateReply)(c.comment_id, text);
    await db.from('ig_comment_dms').insert({
      comment_id: c.comment_id, media_id: c.media_id || null, username: c.username || null, lang,
      status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error, url,
    });
    if (r.ok) sent++; else failed++;
    if (!r.ok && r.permission) { stopped = 'permission: ' + r.error; break; }   // 권한 문제면 더 두드리지 않는다
  }
  return { enabled: true, sent, failed, candidates: cand.length, stopped };
}

module.exports = { runCommentDms, matchKeyword, guessLang, targetUrl, sendPrivateReply, normPermalink, DM_TEXT, DEFAULT_KEYWORDS };
