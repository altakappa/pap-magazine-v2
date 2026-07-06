/**
 * PAP Magazine — X(트위터) 자동 게시 공유 라이브러리
 *
 * 새 기사가 웹사이트에 발행되는 순간 트윗한다 (틱톡과 같은 "웹사이트 →
 * 채널 자동 배포" 패턴). 링크를 포함하면 X 가 기사 SSR 페이지의
 * twitter:card(summary_large_image)로 대형 이미지 카드를 자동 생성하므로
 * 미디어 업로드 없이 텍스트+링크 트윗으로 충분하다.
 *
 * 인증: OAuth 1.0a 사용자 컨텍스트 (환경변수 4개 — 없으면 조용히 스킵)
 *   X_API_KEY / X_API_SECRET             (앱 Consumer Keys)
 *   X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET (계정 Access Token, Read+Write)
 *
 * 무료 티어 한도: 월 500 트윗 — 하루 3~5건 기사면 여유.
 * 페퍼릿용 별도 계정은 X_PEPPERIT_* 환경변수로 추후 확장 예정.
 */

const crypto = require('crypto');

function pctEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function isConfigured() {
  return !!(process.env.X_API_KEY && process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET);
}

// OAuth 1.0a HMAC-SHA1 서명 — JSON 바디 요청은 oauth 파라미터만 서명에 포함.
function oauthHeader(method, url) {
  const oauth = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: process.env.X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };
  const paramStr = Object.keys(oauth).sort()
    .map((k) => pctEncode(k) + '=' + pctEncode(oauth[k])).join('&');
  const base = [method.toUpperCase(), pctEncode(url), pctEncode(paramStr)].join('&');
  const signingKey = pctEncode(process.env.X_API_SECRET) + '&' + pctEncode(process.env.X_ACCESS_TOKEN_SECRET);
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort()
    .map((k) => pctEncode(k) + '="' + pctEncode(oauth[k]) + '"').join(', ');
}

/**
 * 트윗 게시. 실패해도 throw 하지 않고 {ok:false} 반환 (best-effort).
 * @param {string} text
 */
async function postTweet(text) {
  if (!isConfigured()) return { ok: false, skipped: 'X env 미설정' };
  try {
    const url = 'https://api.twitter.com/2/tweets';
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': oauthHeader('POST', url),
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

// X 가중 길이: CJK 2, 라틴 1, URL 은 항상 23.
function weightedLen(s) {
  let n = 0;
  for (const ch of String(s)) n += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-￯]/.test(ch) ? 2 : 1;
  return n;
}

/**
 * 기사 → 트윗 텍스트 구성: 제목 훅 + 링크 + 해시태그 (280 가중자 내).
 * @param {{title:string, url:string, tags?:string[]}} art
 */
function buildArticleTweet(art) {
  let title = String(art.title || '').trim();
  // 제목이 길면 가중 90자 내로 절단
  while (weightedLen(title) > 90 && title.length > 10) title = title.slice(0, title.length - 4).trim() + '…';
  const tags = [];
  (art.tags || []).forEach((t) => {
    const clean = String(t).replace(/[^A-Za-z0-9가-힣_]/g, '');
    const tag = '#' + clean.toUpperCase();
    if (clean.length >= 2 && clean.length <= 20 && tags.length < 3 && !tags.includes(tag)) tags.push(tag);
  });
  if (!tags.includes('#KPOP') && tags.length < 3) tags.push('#KPOP');
  tags.push('#PAPMAGAZINE');
  return title + '\n\n' + art.url + '\n\n' + tags.join(' ');
}

module.exports = { postTweet, buildArticleTweet, isConfigured };
