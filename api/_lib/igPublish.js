/**
 * PAP Magazine — 인스타그램 게시 (2026-08-23 신설)
 *
 * 도메니코(2026-08-23): "게시 기능을 만들어줘."
 *
 * ── 절대 규칙은 그대로다 ─────────────────────────────────────
 * 발행은 도메니코가 명령할 때만 한다. 이 파일은 **명령을 받은 뒤에 부르는 도구**이고,
 * 스스로 게시하는 경로는 어디에도 없다. 브리프를 만드는 크론은 이 파일을
 * 부르지 않는다 — 텔레그램으로 "올려" 가 들어왔을 때만 부른다.
 *
 * ── 자격증명 ─────────────────────────────────────────────────
 * 이미 쓰고 있는 IG_USER_ID / IG_ACCESS_TOKEN 을 그대로 쓴다(graph.facebook.com).
 * 새 토큰을 만들지 않는 이유: 같은 계정(@pap_magazine)이고, business_discovery ·
 * 미디어 조회 · 댓글 숨기기가 이미 이 토큰으로 돌고 있다.
 * ⚠️ 다만 **게시에는 instagram_content_publish 권한이 따로 필요**하다. 이 권한이
 *    없으면 Meta 가 (#200) 계열 오류를 준다. 그때는 앱 권한을 추가해야 하고
 *    그건 도메니코만 할 수 있다 — 오류 메시지를 그대로 사람에게 전달한다.
 *
 * ── 컨테이너 방식 ────────────────────────────────────────────
 * 인스타 게시는 2단계다: 컨테이너 생성 → media_publish.
 * 컨테이너는 **공개 HTTPS URL** 을 요구한다(바이트 업로드 불가). 그래서 디자인
 * 커버·영상은 Supabase Storage 공개 버킷에 올려 URL 로 넘긴다.
 * 릴스는 인코딩 때문에 컨테이너가 바로 준비되지 않는다 → status_code 폴링.
 */

'use strict';

const IG_API = 'https://graph.facebook.com/v25.0';

function sanitize(v) { return String(v == null ? '' : v).replace(/[\s"'`]/g, ''); }

function creds() {
  const userId = sanitize(process.env.IG_USER_ID);
  const token = sanitize(process.env.IG_ACCESS_TOKEN);
  if (!userId || !token) throw new Error('IG_USER_ID / IG_ACCESS_TOKEN 미설정');
  return { userId, token };
}

/** Graph 오류를 사람이 읽을 수 있게. 토큰은 절대 싣지 않는다. */
function graphError(prefix, status, json) {
  const e = (json && json.error) || {};
  const parts = [prefix, '(' + status + ')'];
  if (e.message) parts.push(e.message);
  if (e.error_user_msg) parts.push('· ' + e.error_user_msg);
  if (e.code) parts.push('[code ' + e.code + (e.error_subcode ? '/' + e.error_subcode : '') + ']');
  return new Error(parts.join(' ').slice(0, 400));
}

async function post(pathname, params) {
  const { token } = creds();
  const body = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(IG_API + '/' + pathname, {
    method: 'POST', body, signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw graphError('Graph POST ' + pathname, r.status, j);
  return j;
}

async function get(pathname, fields) {
  const { token } = creds();
  const qs = new URLSearchParams({ fields: fields || 'id', access_token: token });
  const r = await fetch(IG_API + '/' + pathname + '?' + qs, { signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw graphError('Graph GET ' + pathname, r.status, j);
  return j;
}

/* 버퍼를 공개 URL 로. 컨테이너가 바이트를 못 받으므로 반드시 거쳐야 한다. */
async function uploadPublic(buffer, storagePath, contentType) {
  const { supabaseAdmin } = require('./supabase');
  const { error } = await supabaseAdmin.storage.from('media')
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (error) throw new Error('Storage 업로드 실패: ' + error.message);
  const { data } = supabaseAdmin.storage.from('media').getPublicUrl(storagePath);
  if (!data || !data.publicUrl) throw new Error('Storage publicUrl 없음');
  return data.publicUrl;
}

/* 컨테이너가 준비될 때까지 기다린다.
   사진은 대개 즉시, 릴스는 인코딩 때문에 수십 초가 걸린다.
   ERROR 면 즉시 던진다 — 계속 기다려도 달라지지 않는다. */
async function waitReady(creationId, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 150000;
  const stepMs = (opts && opts.stepMs) || 3000;
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const s = await get(creationId, 'status_code,status');
    last = s.status_code || '';
    if (last === 'FINISHED') return true;
    if (last === 'ERROR' || last === 'EXPIRED') {
      throw new Error('컨테이너 처리 실패(' + last + '): ' + String(s.status || '').slice(0, 200));
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error('컨테이너 준비 시간 초과(' + Math.round(timeoutMs / 1000) + '초, 마지막 상태 ' + (last || '?') + ')');
}

async function publishContainer(creationId) {
  const { userId } = creds();
  const res = await post(userId + '/media_publish', { creation_id: creationId });
  if (!res || !res.id) throw new Error('media_publish 응답에 id 가 없다');
  return res.id;
}

/** 사진 1장 또는 캐러셀. imageUrls 는 공개 HTTPS. */
async function publishPhotos(imageUrls, caption) {
  const { userId } = creds();
  const urls = (imageUrls || []).filter(Boolean).slice(0, 10);
  if (!urls.length) throw new Error('게시할 이미지가 없다');

  let creationId;
  if (urls.length === 1) {
    creationId = (await post(userId + '/media', { image_url: urls[0], caption: caption || '' })).id;
  } else {
    const children = [];
    for (const u of urls) {
      children.push((await post(userId + '/media', { image_url: u, is_carousel_item: 'true' })).id);
    }
    creationId = (await post(userId + '/media', {
      media_type: 'CAROUSEL', children: children.join(','), caption: caption || '',
    })).id;
  }
  await waitReady(creationId, { timeoutMs: 90000 });
  return publishContainer(creationId);
}

/** 릴스. videoUrl·coverUrl 은 공개 HTTPS. */
async function publishReel(videoUrl, caption, coverUrl) {
  const { userId } = creds();
  if (!videoUrl) throw new Error('게시할 영상이 없다');
  const params = { media_type: 'REELS', video_url: videoUrl, caption: caption || '' };
  /* 커버를 지정하면 릴스 표지가 PAP 디자인이 된다 — 도메니코가 원한 그림이다.
     share_to_feed 는 릴스를 피드에도 노출시킨다(기본 동작을 명시적으로 못박는다). */
  if (coverUrl) params.cover_url = coverUrl;
  params.share_to_feed = 'true';
  const creationId = (await post(userId + '/media', params)).id;
  await waitReady(creationId, { timeoutMs: 180000 });
  return publishContainer(creationId);
}

/** 게시물에 댓글. 실패해도 게시 자체는 이미 끝났으므로 호출부가 삼키지 말고 알린다. */
async function addComment(mediaId, message) {
  if (!message) return null;
  const res = await post(mediaId + '/comments', { message });
  return (res && res.id) || null;
}

/** 댓글에 대댓글. */
async function replyToComment(commentId, message) {
  if (!commentId || !message) return null;
  const res = await post(commentId + '/replies', { message });
  return (res && res.id) || null;
}

async function permalinkOf(mediaId) {
  try {
    const j = await get(mediaId, 'permalink');
    return (j && j.permalink) || '';
  } catch (_e) {
    return '';
  }
}

function isConfigured() {
  return !!(sanitize(process.env.IG_USER_ID) && sanitize(process.env.IG_ACCESS_TOKEN));
}

module.exports = {
  isConfigured, uploadPublic,
  publishPhotos, publishReel, publishContainer, waitReady,
  addComment, replyToComment, permalinkOf,
  _internals: { post, get, graphError, sanitize },
};
