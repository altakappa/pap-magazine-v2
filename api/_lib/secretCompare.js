/**
 * 시크릿 비교 공용 헬퍼 — 2026-09-04 보안감사 (2군 E)
 *
 * 왜: 크론·웹훅·인덱스나우 55곳이 `auth === 'Bearer ' + process.env.CRON_SECRET` 처럼
 * 일반 문자열 비교를 하고 있었다. V8 의 === 는 첫 글자가 다르면 바로 끝나므로 이론상
 * 응답 시간으로 시크릿을 한 글자씩 맞춰갈 수 있다(타이밍 공격). 네트워크 지터 때문에
 * 실전 난도는 높지만, 고치는 비용이 0 에 가까우니 고친다. 웹훅(paddle·portone)은
 * 이미 timingSafeEqual 을 쓰고 있었다 — 이제 전부 같은 방식이다.
 *
 * 규칙: 시크릿이 비어 있으면 **무조건 false** (fail-closed). "env 를 잊으면 열린다" 는
 * 사고를 이 층에서 한 번 더 막는다.
 */
'use strict';
const crypto = require('crypto');

function safeEqual(a, b) {
  if (a == null || b == null) return false;
  const A = Buffer.from(String(a), 'utf8');
  const B = Buffer.from(String(b), 'utf8');
  if (!A.length || !B.length || A.length !== B.length) return false; // 길이만 새는 건 허용 범위
  return crypto.timingSafeEqual(A, B);
}

/** `Authorization: Bearer <secret>` 검사. secret 이 비어 있으면 false. */
function bearerOk(authHeader, secret) {
  if (!secret) return false;
  const h = String(authHeader || '');
  if (!h.startsWith('Bearer ')) return false;
  return safeEqual(h.slice(7), secret);
}

module.exports = { safeEqual, bearerOk };
