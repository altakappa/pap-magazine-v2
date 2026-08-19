'use strict';
/**
 * IG 댓글 수집 + 숨기기 (Graph API 얇은 래퍼)
 *
 * 읽기와 쓰기가 서로 다른 권한에 걸려 있다는 걸 2026-08-19 에 배웠다.
 * 자기 미디어 댓글 읽기는 instagram_basic 으로도 되지만, 숨기기는
 * instagram_manage_comments 가 있어야 한다. 그 사실을 코드가 알고
 * 오류를 구분해 말하게 한다 — '실패'만 남으면 사흘을 눈멀고 보낸다.
 */
const { sanitizeCredential } = require('./instagramImport');

const API = 'https://graph.facebook.com/v21.0';
const T = 15000;

function creds(opts) {
  const userId = sanitizeCredential((opts && opts.userId) || process.env.IG_USER_ID);
  const token = sanitizeCredential((opts && opts.token) || process.env.IG_ACCESS_TOKEN);
  if (!userId || !token) throw new Error('IG_USER_ID/IG_ACCESS_TOKEN 미설정');
  return { userId, token };
}

/** 토큰이 오류 문구에 섞여 나올 수 있다. 한 번 더 지운다. */
function scrub(text, token) {
  let s = String(text == null ? '' : text);
  if (token) s = s.split(token).join('[TOKEN]');
  return s.slice(0, 300);
}

/** 권한 부족(#10/#200/403)과 그 밖의 실패를 구분한다 */
function isPermissionError(status, code) {
  return status === 403 || code === 10 || code === 200;
}

async function call(url, init) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(T) }, init || {}));
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

/** 최근 게시물 (댓글 수 포함) */
async function listRecentMedia(limit, opts) {
  const { userId, token } = creds(opts);
  const n = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const url = `${API}/${userId}/media?fields=id,permalink,timestamp,comments_count&limit=${n}`
    + `&access_token=${encodeURIComponent(token)}`;
  const r = await call(url);
  if (!r.ok) {
    const e = (r.body && r.body.error) || {};
    throw new Error('미디어 조회 실패 ' + r.status + ' code=' + e.code + ': ' + scrub(e.message, token));
  }
  return (r.body && r.body.data) || [];
}

/**
 * 한 게시물의 댓글 + 답글.
 * 답글을 빼면 IG 표기 수와 어긋난다 — 2026-08-19 에 13/21 로 어긋나는 걸 보고 알았다.
 */
const COMMENT_FIELDS = 'id,text,username,timestamp,hidden,from{id,username},'
  + 'replies{id,text,username,timestamp,hidden,from{id,username}}';

async function listComments(mediaId, opts) {
  const { token } = creds(opts);
  const url = `${API}/${mediaId}/comments?fields=${encodeURIComponent(COMMENT_FIELDS)}`
    + `&limit=50&access_token=${encodeURIComponent(token)}`;
  const r = await call(url);
  if (!r.ok) {
    const e = (r.body && r.body.error) || {};
    const err = new Error('댓글 조회 실패 ' + r.status + ' code=' + e.code + ': ' + scrub(e.message, token));
    err.permission = isPermissionError(r.status, e.code);
    throw err;
  }
  const out = [];
  for (const c of (r.body && r.body.data) || []) {
    out.push({
      id: c.id, text: c.text || '', hidden: !!c.hidden, isReply: false,
      username: c.username || (c.from && c.from.username) || null,
      timestamp: c.timestamp || null,
    });
    for (const rp of ((c.replies && c.replies.data) || [])) {
      out.push({
        id: rp.id, text: rp.text || '', hidden: !!rp.hidden, isReply: true,
        username: rp.username || (rp.from && rp.from.username) || null,
        timestamp: rp.timestamp || null,
      });
    }
  }
  return out;
}

/** 댓글 1건 재조회 (숨기기 전후 확인용) */
async function getComment(commentId, opts) {
  const { token } = creds(opts);
  const url = `${API}/${commentId}?fields=id,text,hidden,timestamp&access_token=${encodeURIComponent(token)}`;
  const r = await call(url);
  if (!r.ok) {
    const e = (r.body && r.body.error) || {};
    const err = new Error('댓글 재조회 실패 ' + r.status + ' code=' + e.code + ': ' + scrub(e.message, token));
    err.gone = r.status === 400 && !isPermissionError(r.status, e.code);
    err.permission = isPermissionError(r.status, e.code);
    throw err;
  }
  return r.body;
}

/**
 * 숨기기 / 되돌리기. 삭제는 이 파일에 없다 (절대 규칙).
 * 응답만 믿지 않고 재조회로 확인한다 — 2026-08-07 유튜브 사고의 교훈.
 * 그때는 응답이 멀쩡한데 실제로는 249개국 차단이었다.
 */
async function setHidden(commentId, hidden, opts) {
  const { token } = creds(opts);
  const url = `${API}/${commentId}?hide=${hidden ? 'true' : 'false'}`
    + `&access_token=${encodeURIComponent(token)}`;
  const r = await call(url, { method: 'POST' });
  if (!r.ok) {
    const e = (r.body && r.body.error) || {};
    const err = new Error('숨기기 실패 ' + r.status + ' code=' + e.code + ': ' + scrub(e.message, token));
    err.permission = isPermissionError(r.status, e.code);
    throw err;
  }
  const after = await getComment(commentId, opts).catch(() => null);
  const verified = after ? after.hidden === hidden : null;
  return { ok: true, verified, after };
}

module.exports = {
  listRecentMedia, listComments, getComment, setHidden,
  isPermissionError, scrub, COMMENT_FIELDS,
};
