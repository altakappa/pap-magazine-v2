/**
 * Meta(Threads/Facebook) 콜백의 signed_request 검증 — 2026-09-04 보안감사 신설
 *
 * Meta 는 데이터 삭제 콜백·앱 제거 콜백을 부를 때 `signed_request` 를 보낸다.
 *   형식: <base64url(HMAC-SHA256 서명)>.<base64url(JSON payload)>
 *   서명: HMAC-SHA256(payload 부분 문자열, APP_SECRET)
 *
 * 예전 api/threads/delete.js · uninstall.js 는 이걸 확인하지 않았다. 누구나 GET/POST 한 번으로
 * threads_auth.access_token 을 지워 Threads 자동 발행을 멈출 수 있었다(DoS).
 *
 * 계약: verify() 가 null 을 돌려주면 **DB 를 건드리지 말 것.**
 * 시크릿이 없으면 검증 자체가 불가능하므로 실패로 본다(fail-closed).
 */
'use strict';
const crypto = require('crypto');

function b64urlDecode(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function extractSignedRequest(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (_) { body = Object.fromEntries(new URLSearchParams(body)); }
  }
  body = body || {};
  return body.signed_request || (req.query && req.query.signed_request) || '';
}

/**
 * @returns {{ok:true, payload:object} | {ok:false, reason:string, status:number}}
 */
function verifySignedRequest(req, appSecret) {
  if (!appSecret) return { ok: false, reason: 'APP_SECRET not configured', status: 503 };
  const sr = extractSignedRequest(req);
  if (!sr || sr.indexOf('.') < 0) return { ok: false, reason: 'signed_request missing', status: 400 };
  const [sigPart, payloadPart] = sr.split('.', 2);
  let sig, expected;
  try {
    sig = b64urlDecode(sigPart);
    expected = crypto.createHmac('sha256', appSecret).update(payloadPart).digest();
  } catch (_) { return { ok: false, reason: 'malformed', status: 400 }; }
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) {
    return { ok: false, reason: 'bad signature', status: 400 };
  }
  let payload = null;
  try { payload = JSON.parse(b64urlDecode(payloadPart).toString('utf8')); }
  catch (_) { return { ok: false, reason: 'payload not json', status: 400 }; }
  const alg = String((payload && payload.algorithm) || '').toUpperCase();
  if (alg && alg !== 'HMAC-SHA256') return { ok: false, reason: 'unexpected algorithm', status: 400 };
  return { ok: true, payload };
}

module.exports = { verifySignedRequest, extractSignedRequest };
