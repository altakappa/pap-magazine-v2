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
 * @param {{token:string, tokenSecret:string}} [creds] — 생략 시 PAP 계정
 */
async function postTweet(text, creds) {
  const c = creds || {};
  const configured = c.token ? !!(process.env.X_API_KEY && process.env.X_API_SECRET) : isConfigured();
  if (!configured) return { ok: false, skipped: 'X env 미설정' };
  try {
    const url = 'https://api.twitter.com/2/tweets';
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': oauthHeader('POST', url, c.token ? { token: c.token, tokenSecret: c.tokenSecret } : undefined),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: String(text).slice(0, 3000) }),
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

/**
 * PAP 기사 → 트윗 텍스트: 제목 훅 + 링크 + 해시태그 (280 가중자 내).
 * @param {{title:string, url:string, tags?:string[]}} art
 */
function buildArticleTweet(art) {
  const tags = _cleanTags(art.tags, 3);
  if (!tags.includes('#KPOP') && tags.length < 3) tags.push('#KPOP');
  tags.push('#PAPMAGAZINE');
  return _clampTitle(art.title) + '\n\n' + art.url + '\n\n' + tags.join(' ');
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
  return _clampTitle(art.title) + '\n\n' + art.url + '\n\n' + tags.join(' ');
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

module.exports = {
  postTweet, postPepperitTweet, buildArticleTweet, buildPepperitTweet,
  isConfigured, isPepperitConfigured, requestToken, accessToken,
};
