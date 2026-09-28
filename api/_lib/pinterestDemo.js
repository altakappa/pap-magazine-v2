/**
 * 핀터레스트 Standard 승급 재심사용 데모 (2026-09-28 도메니코 "응").
 *
 * 왜: 8/14 영상이 거절됐다. 사유는 "API usage is not visible in the video demo".
 * 핀은 만들었지만 터미널 글자로만 보였고, 만든 핀을 핀터레스트에서 여는 장면이 없었다.
 * 이번에는 어드민 화면(frontend/pinterest-demo.html)의 버튼 3개로
 *   ① OAuth 전체 흐름  ② POST /v5/pins 요청·응답  ③ 핀터레스트에서 그 핀 열기
 * 를 한 번에 녹화한다.
 *
 * 원칙
 * - 핀 생성은 샌드박스(api-sandbox.pinterest.com)에서만 한다. Trial 등급은 실서버 핀 생성이
 *   403 code 29 로 막히고, 담당자(Eloise)가 샌드박스 시연을 허용했다.
 * - 토큰은 화면에도 응답에도 절대 내보내지 않는다. 비밀값 입력은 도메니코 직접.
 * - 실서비스 발행(pinterest-pin 크론, PINTEREST_PUBLISH_PAUSED)은 건드리지 않는다.
 */
'use strict';
const crypto = require('crypto');

const APP_ID_DEFAULT = '1587332';
const SITE = 'https://www.pap-magazine.com';
const REDIRECT_URI = SITE + '/pinterest-demo';
const SCOPES = ['boards:read', 'boards:write', 'pins:read', 'pins:write', 'user_accounts:read'];
const PROD_API = 'https://api.pinterest.com/v5';
const SANDBOX_API = 'https://api-sandbox.pinterest.com/v5';
const DEMO_BOARD_NAME = 'PAP MAGAZINE Editorial';
const STATE_TTL_MS = 10 * 60 * 1000;

function cleanCred(v) {
  return String(v || '').replace(/[\r\n\t]/g, '').trim().replace(/^["']+|["']+$/g, '').trim();
}

function appId(env) { return cleanCred((env || process.env).PINTEREST_APP_ID) || APP_ID_DEFAULT; }

/* state = <시각>.<HMAC> — 우리가 만든 승인 요청에서 돌아온 것인지, 10분 안인지 확인한다. */
function signState(secret, now) {
  const ts = String(now || Date.now());
  const mac = crypto.createHmac('sha256', String(secret || '')).update('pinterest-demo:' + ts).digest('hex').slice(0, 32);
  return ts + '.' + mac;
}

function verifyState(state, secret, now) {
  const m = String(state || '').match(/^(\d{10,16})\.([0-9a-f]{32})$/);
  if (!m || !secret) return false;
  const age = (now || Date.now()) - Number(m[1]);
  if (!(age >= 0 && age <= STATE_TTL_MS)) return false;
  const expect = signState(secret, m[1]).split('.')[1];
  const a = Buffer.from(expect), b = Buffer.from(m[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authorizeUrl(state, env) {
  const p = new URLSearchParams({
    client_id: appId(env),
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(','),
    state,
  });
  return 'https://www.pinterest.com/oauth/?' + p.toString();
}

/* 에디토리얼 한 건 → 핀 요청 본문. 링크는 원문 기사(심사자가 PAP 사이트로 넘어가는 걸 보게). */
function buildPinPayload(ed, boardId, image) {
  const url = SITE + '/editorial/' + encodeURIComponent(ed.slug);
  return {
    board_id: String(boardId),
    title: String(ed.title || 'PAP MAGAZINE Editorial').slice(0, 100),
    description: [ed.title, ed.issue ? 'PAP MAGAZINE · ' + ed.issue : 'PAP MAGAZINE', 'Fashion editorial, full story:', url]
      .filter(Boolean).join('\n').slice(0, 780),
    link: url,
    alt_text: String(ed.title || '').slice(0, 500),
    media_source: { source_type: 'image_base64', content_type: image.contentType, data: image.base64 },
  };
}

/* 화면에 보여줄 요청 본문: 이미지 base64 는 길이만 남긴다. */
function redactPayload(payload) {
  const out = JSON.parse(JSON.stringify(payload));
  if (out.media_source && out.media_source.data) {
    out.media_source.data = '<base64 image, ' + Math.round(out.media_source.data.length * 3 / 4 / 1024) + ' KB>';
  }
  return out;
}

function pinUrl(id) { return 'https://www.pinterest.com/pin/' + encodeURIComponent(String(id)) + '/'; }

module.exports = {
  APP_ID_DEFAULT, SITE, REDIRECT_URI, SCOPES, PROD_API, SANDBOX_API, DEMO_BOARD_NAME, STATE_TTL_MS,
  cleanCred, appId, signState, verifyState, authorizeUrl, buildPinPayload, redactPayload, pinUrl,
};
