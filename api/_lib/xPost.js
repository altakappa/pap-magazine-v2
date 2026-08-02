/**
 * PAP Magazine — X(트위터) 자동 게시 공유 라이브러리
 *
 * 새 기사가 웹사이트에 발행되는 순간 트윗한다 (틱톡과 같은 "웹사이트 →
 * 채널 자동 배포" 패턴). 링크를 포함하면 X 가 기사 SSR 페이지의
 * twitter:card(summary_large_image)로 대형 이미지 카드를 자동 생성하므로
 * 미디어 업로드 없이 텍스트+링크 트윗으로 충분하다.
 *
 * 인증: OAuth 1.0a 사용자 컨텍스트 (환경변수 — 없으면 조용히 스킵)
 *   X_API_KEY / X_API_SECRET                       (앱 Consumer Keys — 두 계정 공용)
 *   X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET          (@papmagazine_ Access Token)
 *   X_PEPPERIT_ACCESS_TOKEN / X_PEPPERIT_ACCESS_TOKEN_SECRET (@pepperitmag)
 *
 * 페퍼릿 토큰은 같은 앱을 3-legged OAuth(PIN 방식)로 @pepperitmag 계정에
 * 승인시켜 발급한다 → /api/admin/x-pepperit-auth (별도 개발자 계정·과금 불필요).
 */

const crypto = require('crypto');

function pctEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function isConfigured() {
  return !!(process.env.X_API_KEY && process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET);
}

function isPepperitConfigured() {
  return !!(process.env.X_API_KEY && process.env.X_API_SECRET &&
    process.env.X_PEPPERIT_ACCESS_TOKEN && process.env.X_PEPPERIT_ACCESS_TOKEN_SECRET);
}

/**
 * OAuth 1.0a HMAC-SHA1 서명 헤더.
 * @param {string} method
 * @param {string} url
 * @param {object} [opts]
 *   opts.token / opts.tokenSecret — 사용자 토큰 (기본: PAP env)
 *   opts.extra — 서명에 포함할 추가 oauth_* 파라미터 (request_token/access_token 용)
 * JSON 바디 요청은 oauth 파라미터만 서명에 포함 (스펙: 폼바디가 아니면 제외).
 */
function oauthHeader(method, url, opts) {
  const o = opts || {};
  const token = o.token !== undefined ? o.token : process.env.X_ACCESS_TOKEN;
  const tokenSecret = o.tokenSecret !== undefined ? o.tokenSecret : process.env.X_ACCESS_TOKEN_SECRET;
  const oauth = Object.assign({
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  }, o.extra || {});
  if (token) oauth.oauth_token = token;
  const paramStr = Object.keys(oauth).sort()
    .map((k) => pctEncode(k) + '=' + pctEncode(oauth[k])).join('&');
  const base = [method.toUpperCase(), pctEncode(url), pctEncode(paramStr)].join('&');
  const signingKey = pctEncode(process.env.X_API_SECRET) + '&' + pctEncode(tokenSecret || '');
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort()
    .map((k) => pctEncode(k) + '="' + pctEncode(oauth[k]) + '"').join(', ');
}

/**
 * 트윗 게시. 실패해도 throw 하지 않고 {ok:false} 반환 (best-effort).
 * @param {string} text
 * @param {{token:string, tokenSecret:string, mediaIds?:string[]}} [creds] — 생략 시 PAP 계정
 *   creds.mediaIds — uploadMedia() 로 받은 media_id 배열(최대 4). 있으면 미디어 트윗.
 */
async function postTweet(text, creds) {
  const c = creds || {};
  const configured = c.token ? !!(process.env.X_API_KEY && process.env.X_API_SECRET) : isConfigured();
  if (!configured) return { ok: false, skipped: 'X env 미설정' };
  try {
    const url = 'https://api.twitter.com/2/tweets';
    const payload = { text: String(text).slice(0, 3000) };
    // 미디어 첨부(선택). X 는 한 트윗에 이미지 최대 4개 또는 영상 1개만 허용하며
    // 영상+이미지 혼합은 불가 — 이 제약은 호출부(selectArticleMedia)에서 강제한다.
    const mediaIds = Array.isArray(c.mediaIds) ? c.mediaIds.filter(Boolean).slice(0, 4) : [];
    if (mediaIds.length) payload.media = { media_ids: mediaIds };
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': oauthHeader('POST', url, c.token ? { token: c.token, tokenSecret: c.tokenSecret } : undefined),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, detail: JSON.stringify(j).slice(0, 200) };
    return { ok: true, id: j.data && j.data.id };
  } catch (e) {
    return { ok: false, detail: String(e && e.message || e).slice(0, 150) };
  }
}

/** @pepperitmag 계정으로 트윗 (X_PEPPERIT_* 미설정 시 조용히 스킵). */
async function postPepperitTweet(text) {
  if (!isPepperitConfigured()) return { ok: false, skipped: 'X_PEPPERIT env 미설정' };
  return postTweet(text, {
    token: process.env.X_PEPPERIT_ACCESS_TOKEN,
    tokenSecret: process.env.X_PEPPERIT_ACCESS_TOKEN_SECRET,
  });
}

// X 가중 길이: CJK 2, 라틴 1, URL 은 항상 23.
function weightedLen(s) {
  let n = 0;
  for (const ch of String(s)) n += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-￯]/.test(ch) ? 2 : 1;
  return n;
}

// X 는 URL 을 t.co 로 감싸 항상 23자로 계산한다 — 길이 판정 시 실제 URL 대신
// 이 placeholder 를 넣어 측정한다 (UTM 이 붙어도 길이 판정이 왜곡되지 않게).
const URL_PLACEHOLDER = 'x'.repeat(23);

/**
 * 유입 계측용 UTM 부착 (2026-07-16 케이팝 참여 개선).
 * 로드맵의 X 자동게시 중단 사유가 "성과 미측정"이었다 — utm_source 가 붙으면
 * SSR 이 social_inclicks 에 기록해 X 유입을 셀 수 있다 (socialInclick.js).
 */
function withUtm(url, source, campaign) {
  try {
    const u = new URL(String(url));
    u.searchParams.set('utm_source', source);
    u.searchParams.set('utm_medium', 'social');
    if (campaign) u.searchParams.set('utm_campaign', campaign);
    return u.toString();
  } catch (_) { return url; }
}

function _clampTitle(title) {
  let t = String(title || '').trim();
  while (weightedLen(t) > 90 && t.length > 10) t = t.slice(0, t.length - 4).trim() + '…';
  return t;
}

function _cleanTags(tags, max) {
  const out = [];
  (tags || []).forEach((t) => {
    const clean = String(t).replace(/[^A-Za-z0-9가-힣_]/g, '');
    const tag = '#' + clean.toUpperCase();
    if (clean.length >= 2 && clean.length <= 20 && out.length < max && !out.includes(tag)) out.push(tag);
  });
  return out;
}

// 본문(body_ko, HTML)에서 첫 문장을 훅으로 추출. 태그·엔티티 제거 후 첫
// 종결부호(. ! ? …)까지. 너무 길거나 없으면 '' 반환(제목만 사용).
function _firstSentence(html) {
  const text = String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const m = text.match(/^[\s\S]{12,140}?[.!?…]/);
  const s = (m ? m[0] : text).trim();
  return weightedLen(s) > 130 ? '' : s;
}

/**
 * PAP 기사 → 트윗 텍스트: 제목 훅 + (본문 첫 문장) + 링크 + 해시태그 2~3개.
 * 2026-07-16 참여개선 — 강제 #KPOP 제거(패션·뷰티엔 부적절, 기사 실제
 * 태그만 최대 2개 + #PAPMAGAZINE), 본문 첫 문장을 리드로 추가(280 가중자 내).
 * @param {{title:string, url:string, tags?:string[], body?:string}} art
 */
/**
 * 대화형 트윗 (2026-07-21, 도메니코 요청). 기사에 "사람들이 이미 얘기하는
 * 거리"가 있을 때만 기사 소개 대신 말을 거는 글을 쓴다. 글감이 없으면
 * null 이 돌아오고 호출부는 buildArticleTweet 로 간다.
 * 비동기 — Claude 를 부르므로 기존 동기 빌더와 분리해 둔다.
 */
async function buildConversationalTweet(art) {
  const { generateConversationalPost, stripDashes } = require('./socialHook');
  const hook = await generateConversationalPost(art, 'x');
  if (!hook) return null;
  const link = withUtm(art.url, 'x', 'pap_auto');
  const tagLine = '#PAPMAGAZINE';
  // 2026-07-21 도메니코 지시 — 줄표는 AI 티가 나니 항상 뺀다. 프롬프트로도
  // 금지하지만 프롬프트는 확률이라 새서, 게시 직전에 기계적으로 한 번 더 거른다.
  // 길이 판정 전에 걸러야 한다. 나중에 걸면 제거로 줄어든 길이가 반영되지 않아
  // 280자를 넘는다고 잘못 판단하고 멀쩡한 트윗을 버린다.
  const body = stripDashes(hook.text);
  const measured = body + '\n\n' + URL_PLACEHOLDER + '\n\n' + tagLine;
  if (weightedLen(measured) > 280) return null; // 넘치면 기존 방식으로
  return { text: body + '\n\n' + link + '\n\n' + tagLine, angle: hook.angle, score: hook.score };
}

function buildArticleTweet(art) {
  const title = _clampTitle(art.title);
  const tags = _cleanTags(art.tags, 2);   // 실제 태그 최대 2개
  tags.push('#PAPMAGAZINE');              // + 브랜드 태그 → 총 2~3개
  const tagLine = tags.join(' ');
  const link = withUtm(art.url, 'x', 'pap_auto'); // 유입 계측 (2026-07-16)
  const hook = _firstSentence(art.body);
  if (hook && hook !== title) {
    // 길이 판정은 URL=23자 규칙으로 (UTM 길이는 t.co 로 감싸져 무관)
    const measured = title + '\n\n' + hook + '\n\n' + URL_PLACEHOLDER + '\n\n' + tagLine;
    if (weightedLen(measured) <= 280) return title + '\n\n' + hook + '\n\n' + link + '\n\n' + tagLine;
  }
  return title + '\n\n' + link + '\n\n' + tagLine;
}

/**
 * 페퍼릿 기사 → 트윗 텍스트. 아이돌·그룹명 태그가 검색 유입의 핵심이므로
 * 기사 태그를 최대 4개까지 우선 배치 (한글 해시태그도 X 검색에 걸린다).
 * @param {{title:string, url:string, tags?:string[], category?:string}} art
 */
function buildPepperitTweet(art) {
  const tags = _cleanTags(art.tags, 4);
  if (!tags.includes('#KPOP') && tags.length < 4) tags.push('#KPOP');
  tags.push('#PEPPERIT');
  const link = withUtm(art.url, 'x', 'pepperit_auto'); // 유입 계측 (2026-07-16)
  return _clampTitle(art.title) + '\n\n' + link + '\n\n' + tags.join(' ');
}

/**
 * 3-legged OAuth (PIN/oob 방식) — @pepperitmag 토큰 발급용.
 * requestToken(): { oauth_token, oauth_token_secret, authorizeUrl }
 * accessToken(oauthToken, oauthTokenSecret, pin): { oauth_token, oauth_token_secret, screen_name }
 */
async function requestToken() {
  const url = 'https://api.twitter.com/oauth/request_token';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': oauthHeader('POST', url, { token: null, tokenSecret: '', extra: { oauth_callback: 'oob' } }) },
    signal: AbortSignal.timeout(15000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error('request_token ' + r.status + ': ' + body.slice(0, 200));
  const p = new URLSearchParams(body);
  return {
    oauth_token: p.get('oauth_token'),
    oauth_token_secret: p.get('oauth_token_secret'),
    authorizeUrl: 'https://api.twitter.com/oauth/authorize?oauth_token=' + p.get('oauth_token'),
  };
}

async function accessToken(oauthToken, oauthTokenSecret, pin) {
  const url = 'https://api.twitter.com/oauth/access_token';
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': oauthHeader('POST', url, {
        token: oauthToken, tokenSecret: oauthTokenSecret,
        extra: { oauth_verifier: String(pin).trim() },
      }),
    },
    signal: AbortSignal.timeout(15000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error('access_token ' + r.status + ': ' + body.slice(0, 200));
  const p = new URLSearchParams(body);
  return {
    oauth_token: p.get('oauth_token'),
    oauth_token_secret: p.get('oauth_token_secret'),
    screen_name: p.get('screen_name'),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 네이티브 미디어 업로드 (2026-07-30, 도메니코 지시 — X 게시에 영상·이미지 첨부)
//
// 지금까지 트윗은 텍스트+링크만 보냈고 사진은 기사 SSR 의 twitter:card 로만
// 떴다. 여기서 X media/upload(v1.1)로 실제 파일을 올려 media_id 를 받은 뒤
// postTweet({mediaIds}) 로 붙인다. 서버는 Supabase 스토리지·X 에 직접 닿으므로
// (샌드박스 프록시·브라우저 10MB 상한 없음) 영상도 청크 업로드로 처리한다.
//
// 서명 주의: multipart/form-data 바디는 OAuth1 서명 base string 에 포함되지 않아
// (RFC5849 §3.4.1.3 — x-www-form-urlencoded 만 포함) 기존 oauthHeader(oauth 파라미터만
// 서명)를 그대로 재사용할 수 있다. 쿼리로 command 를 싣는 GET STATUS 만 쿼리를
// 서명에 포함하는 별도 헬퍼(_oauthGetHeader)를 쓴다.
// ─────────────────────────────────────────────────────────────────────────

const MEDIA_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';
const MEDIA_CHUNK = 4 * 1024 * 1024; // 4MB (X APPEND 상한 5MB 이내)

/** GET 요청용 OAuth1 헤더 — 쿼리 파라미터를 서명 base 에 포함(STATUS 전용). */
function _oauthGetHeader(baseUrl, query, opts) {
  const o = opts || {};
  const token = o.token !== undefined ? o.token : process.env.X_ACCESS_TOKEN;
  const tokenSecret = o.tokenSecret !== undefined ? o.tokenSecret : process.env.X_ACCESS_TOKEN_SECRET;
  const oauth = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  };
  if (token) oauth.oauth_token = token;
  const allParams = Object.assign({}, query || {}, oauth);
  const paramStr = Object.keys(allParams).sort()
    .map((k) => pctEncode(k) + '=' + pctEncode(allParams[k])).join('&');
  const base = ['GET', pctEncode(baseUrl), pctEncode(paramStr)].join('&');
  const signingKey = pctEncode(process.env.X_API_SECRET) + '&' + pctEncode(tokenSecret || '');
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort()
    .map((k) => pctEncode(k) + '="' + pctEncode(oauth[k]) + '"').join(', ');
}

/** multipart/form-data 바디 조립. fields: [{name,value} | {name,filename,contentType,data:Buffer}]. */
function _multipart(fields) {
  const boundary = '----papx' + crypto.randomBytes(12).toString('hex');
  const parts = [];
  for (const f of fields) {
    let head = '--' + boundary + '\r\nContent-Disposition: form-data; name="' + f.name + '"';
    if (f.filename !== undefined) head += '; filename="' + f.filename + '"';
    head += '\r\n';
    if (f.contentType) head += 'Content-Type: ' + f.contentType + '\r\n';
    head += '\r\n';
    parts.push(Buffer.from(head, 'utf8'));
    parts.push(Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.value), 'utf8'));
    parts.push(Buffer.from('\r\n', 'utf8'));
  }
  parts.push(Buffer.from('--' + boundary + '--\r\n', 'utf8'));
  return { body: Buffer.concat(parts), boundary };
}

async function _mediaPost(fields, creds) {
  const c = creds || {};
  const { body, boundary } = _multipart(fields);
  const r = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: {
      'Authorization': oauthHeader('POST', MEDIA_UPLOAD_URL, c.token ? { token: c.token, tokenSecret: c.tokenSecret } : undefined),
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
    },
    body,
    signal: AbortSignal.timeout(60000),
  });
  const txt = await r.text();
  let j = {}; try { j = txt ? JSON.parse(txt) : {}; } catch (_) { /* 204 APPEND 는 바디 없음 */ }
  return { ok: r.ok, status: r.status, json: j, raw: txt };
}

/**
 * 바이트 버퍼를 X 에 업로드하고 media_id 를 반환. 이미지=단발 업로드,
 * 영상=INIT/APPEND/FINALIZE + STATUS 폴링. 실패 시 {ok:false} (throw 안 함).
 * @param {Buffer} bytes
 * @param {string} mimeType  예: image/jpeg, video/mp4
 * @param {{token?:string, tokenSecret?:string}} [creds]
 */
async function uploadMedia(bytes, mimeType, creds) {
  const c = creds || {};
  const configured = c.token ? !!(process.env.X_API_KEY && process.env.X_API_SECRET) : isConfigured();
  if (!configured) return { ok: false, skipped: 'X env 미설정' };
  const mt = String(mimeType || '').toLowerCase();
  const isVideo = mt.startsWith('video/');
  try {
    if (!isVideo) {
      // 이미지: 단발 업로드
      const res = await _mediaPost([
        { name: 'media_category', value: 'tweet_image' },
        { name: 'media', filename: 'image', contentType: mt || 'image/jpeg', data: bytes },
      ], c);
      const id = res.json && (res.json.media_id_string || res.json.media_id);
      if (!res.ok || !id) return { ok: false, status: res.status, detail: (res.raw || '').slice(0, 200) };
      return { ok: true, media_id: String(id) };
    }
    // 영상: INIT
    const init = await _mediaPost([
      { name: 'command', value: 'INIT' },
      { name: 'total_bytes', value: String(bytes.length) },
      { name: 'media_type', value: mt || 'video/mp4' },
      { name: 'media_category', value: 'tweet_video' },
    ], c);
    const mediaId = init.json && (init.json.media_id_string || init.json.media_id);
    if (!init.ok || !mediaId) return { ok: false, status: init.status, detail: 'INIT ' + (init.raw || '').slice(0, 150) };
    // APPEND (청크)
    let seg = 0;
    for (let off = 0; off < bytes.length; off += MEDIA_CHUNK, seg++) {
      const chunk = bytes.subarray(off, Math.min(off + MEDIA_CHUNK, bytes.length));
      const ap = await _mediaPost([
        { name: 'command', value: 'APPEND' },
        { name: 'media_id', value: String(mediaId) },
        { name: 'segment_index', value: String(seg) },
        { name: 'media', filename: 'chunk', contentType: 'application/octet-stream', data: chunk },
      ], c);
      if (!ap.ok) return { ok: false, status: ap.status, detail: 'APPEND ' + seg + ' ' + (ap.raw || '').slice(0, 120) };
    }
    // FINALIZE
    const fin = await _mediaPost([
      { name: 'command', value: 'FINALIZE' },
      { name: 'media_id', value: String(mediaId) },
    ], c);
    if (!fin.ok) return { ok: false, status: fin.status, detail: 'FINALIZE ' + (fin.raw || '').slice(0, 120) };
    // 인코딩 대기(STATUS 폴링) — processing_info 가 있으면 succeeded 까지
    let info = fin.json && fin.json.processing_info;
    let tries = 0;
    while (info && (info.state === 'pending' || info.state === 'in_progress') && tries < 20) {
      const waitS = Math.min(Math.max(Number(info.check_after_secs) || 3, 1), 10);
      await new Promise((r) => setTimeout(r, waitS * 1000));
      const q = { command: 'STATUS', media_id: String(mediaId) };
      const sr = await fetch(MEDIA_UPLOAD_URL + '?command=STATUS&media_id=' + encodeURIComponent(String(mediaId)), {
        method: 'GET',
        headers: { 'Authorization': _oauthGetHeader(MEDIA_UPLOAD_URL, q, c.token ? { token: c.token, tokenSecret: c.tokenSecret } : undefined) },
        signal: AbortSignal.timeout(15000),
      });
      const sj = await sr.json().catch(() => ({}));
      info = sj.processing_info;
      tries++;
    }
    if (info && info.state === 'failed') return { ok: false, detail: 'video processing failed' };
    return { ok: true, media_id: String(mediaId) };
  } catch (e) {
    return { ok: false, detail: String(e && e.message || e).slice(0, 150) };
  }
}

/** URL 에서 미디어를 받아 업로드(서버는 Supabase 스토리지에 직접 접근 가능). */
async function uploadMediaFromUrl(url, creds) {
  try {
    const r = await fetch(String(url), { signal: AbortSignal.timeout(60000) });
    if (!r.ok) return { ok: false, detail: 'fetch ' + r.status };
    let mime = r.headers.get('content-type') || '';
    if (!mime || mime === 'application/octet-stream') {
      if (/\.mp4($|\?)/i.test(url)) mime = 'video/mp4';
      else if (/\.png($|\?)/i.test(url)) mime = 'image/png';
      else if (/\.webp($|\?)/i.test(url)) mime = 'image/webp';
      else mime = 'image/jpeg';
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return uploadMedia(buf, mime, creds);
  } catch (e) {
    return { ok: false, detail: String(e && e.message || e).slice(0, 150) };
  }
}

/**
 * 소스 기준 미디어 선택(도메니코 2026-07-30 정책). 영상 소스 글은 영상 1개,
 * 이미지/캐러셀 글은 이미지 최대 4장. X 는 영상+이미지 혼합 불가·이미지 4장 상한.
 * @returns {{kind:'video'|'image'|'none', urls:string[]}}
 */
function selectArticleMedia(article) {
  const a = article || {};
  const videos = Array.isArray(a.videos) ? a.videos.filter(Boolean) : [];
  const gallery = Array.isArray(a.gallery) ? a.gallery.filter(Boolean) : [];
  const src = String(a.source_media_type || '').toUpperCase();
  if (src === 'VIDEO' && videos.length) return { kind: 'video', urls: [videos[0]] };
  if (gallery.length) return { kind: 'image', urls: gallery.slice(0, 4) };
  if (videos.length) return { kind: 'video', urls: [videos[0]] };
  return { kind: 'none', urls: [] };
}

/**
 * 기사 미디어를 X 에 올려 media_ids 를 반환(호출부는 이 값을 postTweet 에 넘긴다).
 * 이미지 여러 장은 순서대로 업로드. 하나라도 실패하면 성공분만 반환하고 detail 에 기록.
 */
async function uploadArticleMedia(article, creds) {
  const sel = selectArticleMedia(article);
  if (sel.kind === 'none') return { ok: true, kind: 'none', mediaIds: [] };
  const ids = [];
  for (const u of sel.urls) {
    const up = await uploadMediaFromUrl(u, creds);
    if (up.ok && up.media_id) ids.push(up.media_id);
    else if (sel.kind === 'video') return { ok: false, kind: 'video', mediaIds: [], detail: up.detail || up.skipped };
    // 이미지는 일부 실패해도 성공분으로 진행
  }
  return { ok: ids.length > 0, kind: sel.kind, mediaIds: ids };
}

module.exports = {
  buildConversationalTweet,
  postTweet, postPepperitTweet, buildArticleTweet, buildPepperitTweet,
  isConfigured, isPepperitConfigured, requestToken, accessToken,
  uploadMedia, uploadMediaFromUrl, selectArticleMedia, uploadArticleMedia,
};
