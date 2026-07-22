/**
 * Paddle 웹훅 서명 검증 테스트 (2026-07-21 보안 감사)
 * ═══════════════════════════════════════════════════════════════════
 * QA(🚨 보안): 서버가 결제 완료를 안전하게 검증하는가. 4개 항목 중 웹훅
 * 서명 검증만 회귀 테스트가 없어 여기서 채운다.
 *   ② 금액 재계산·과소결제 → tests/submission-payment.test.js 가 커버
 *   ③ 이메일/소유자 불일치  → 같은 파일 + 아래 소스 검사
 *   ④ 리다이렉트 재검증      → 아래 소스 검사(발행은 webhook 만이 확정)
 *
 * ── 왜 서명 검증이 핵심인가 ─────────────────────────────────────────
 * 서명을 안 보면 누구나 transaction.completed 를 위조해 POST 하는 것만으로
 * "결제 완료"를 심을 수 있다. Paddle 은 Paddle-Signature: ts=…;h1=… 헤더로
 * HMAC-SHA256(secret, `${ts}:${rawBody}`) 를 보낸다. 서버는 이걸 재계산해
 * 일치할 때만, 그리고 ts 가 5분 내일 때만(리플레이 차단) 처리해야 한다.
 *
 * ── 이 테스트가 지키는 것 (verifyPaddleSignature 를 실제로 실행) ──────
 *  1. 올바른 서명 + 최신 ts → 통과
 *  2. 위조 서명 → 거부
 *  3. 오래된 ts(5분 초과) → 거부 (리플레이 방지)
 *  4. secret 이 다르면 거부
 *  5. 헤더 없음/형식 불량 → 거부
 *  6. timingSafeEqual 로 상수시간 비교(타이밍 공격 방지)
 *  7. rawBody(파싱 전 원문)로 검증 — JSON.parse 후 재직렬화한 값이 아님
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const src = fs.readFileSync(path.join(ROOT, 'api/paddle-webhook.js'), 'utf8');

/* verifyPaddleSignature 는 모듈 스코프의 PADDLE_WEBHOOK_SECRET 을 참조하므로
   함수만 떼어내 실행 가능한 형태로 감싼다. secret 을 주입할 수 있게 만든다. */
function extractFn(s, name) {
  const i = s.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0;
  for (let k = s.indexOf('{', i); k < s.length; k++) {
    if (s[k] === '{') d++;
    else if (s[k] === '}') { d--; if (d === 0) return s.slice(i, k + 1); }
  }
  return '';
}
const fnSrc = extractFn(src, 'verifyPaddleSignature');

console.log('\n=== 0. 함수 추출 ===');
t('verifyPaddleSignature 를 찾았다', fnSrc.length > 0);

// crypto + 주입한 secret 을 클로저로 묶어 실행 가능한 함수를 만든다.
function makeVerifier(secret) {
  // eslint-disable-next-line no-new-func
  return new Function('crypto', 'PADDLE_WEBHOOK_SECRET',
    fnSrc + '; return verifyPaddleSignature;')(crypto, secret);
}
const SECRET = 'pdl_ntfset_test_secret';
const verify = makeVerifier(SECRET);

function signedHeader(rawBody, secret, ts) {
  const t2 = ts != null ? ts : Math.floor(Date.now() / 1000);
  const h1 = crypto.createHmac('sha256', secret)
    .update(`${t2}:${rawBody}`).digest('hex');
  return `ts=${t2};h1=${h1}`;
}

const body = JSON.stringify({ event_type: 'transaction.completed', data: { id: 'txn_1' } });
const rawBody = Buffer.from(body, 'utf8');

console.log('\n=== 1. 올바른 서명은 통과 ===');
t('유효 서명 + 최신 ts → true',
  verify(rawBody, signedHeader(body, SECRET)) === true);

console.log('\n=== 2. 위조·오류는 거부 ===');
t('위조 h1 → false',
  verify(rawBody, 'ts=' + Math.floor(Date.now() / 1000) + ';h1=deadbeef') === false);
t('다른 secret 으로 서명 → false',
  verify(rawBody, signedHeader(body, 'attacker_secret')) === false,
  '공격자가 secret 없이 서명하면 통과하면 안 된다');
t('본문 변조(서명은 원본 기준) → false',
  verify(Buffer.from(body + 'x'), signedHeader(body, SECRET)) === false,
  'rawBody 를 바꾸면 HMAC 이 달라져야 한다');
t('헤더 없음 → false', verify(rawBody, null) === false);
t('형식 불량 헤더 → false', verify(rawBody, 'garbage') === false);
t('h1 누락 → false',
  verify(rawBody, 'ts=' + Math.floor(Date.now() / 1000)) === false);

console.log('\n=== 3. 리플레이 방지 (오래된 ts 거부) ===');
const oldTs = Math.floor(Date.now() / 1000) - 600; // 10분 전
t('10분 지난 ts → false (서명 자체는 유효해도)',
  verify(rawBody, signedHeader(body, SECRET, oldTs)) === false,
  '5분 초과 이벤트는 리플레이로 간주해 거부해야 한다');
const okTs = Math.floor(Date.now() / 1000) - 60; // 1분 전 — 허용
t('1분 전 ts → true (창 안)',
  verify(rawBody, signedHeader(body, SECRET, okTs)) === true);

console.log('\n=== 4. 소스 레벨 안전장치 (나머지 3개 항목) ===');
t('secret 미설정이면 웹훅을 거부한다',
  /if \(!PADDLE_WEBHOOK_SECRET\)[\s\S]{0,120}return/.test(src),
  'secret 없이 통과하면 서명 검증이 무력화된다');
t('서명 실패 시 400 으로 즉시 반환',
  /if \(!verifyPaddleSignature\([\s\S]{0,200}status\(400\)/.test(src));
t('상수시간 비교(timingSafeEqual)를 쓴다',
  /crypto\.timingSafeEqual/.test(fnSrc),
  '문자열 === 비교는 타이밍 공격에 노출된다');
t('파싱 전 rawBody 로 검증한다',
  /verifyPaddleSignature\(rawBody/.test(src) &&
  src.indexOf('verifyPaddleSignature(rawBody') < src.indexOf('JSON.parse(rawBody'),
  'JSON.parse 후 재직렬화한 값으로 검증하면 서명이 안 맞는다');

/* ③ 이메일/소유자: 결제자가 로그인 계정과 달라도, 소유자 매칭은 custom_data 의
   user_id 로 loud-log 하되 결제 자체는 막지 않는다(돈은 오갔으므로). 발행이
   수동 게이트라 안전하다. ④ 리다이렉트: 발행 확정은 webhook 만 한다. */
const payLib = fs.readFileSync(path.join(ROOT, 'api/_lib/submissionPayment.js'), 'utf8');
t('③ 소유자 불일치를 감지해 신호를 남긴다 (userMismatch)',
  /userMismatch/.test(payLib) && /cd\.user_id[\s\S]{0,80}sub\.user_id/.test(payLib));
t('④ 발행은 결제와 분리 — webhook 이 payment_status 만 건드린다(draft-only)',
  /publication is 100% manual \(draft-only\)/.test(payLib) &&
  !/status:\s*'published'/.test(payLib),
  '리다이렉트 URL 로 발행되면 위조 리다이렉트로 무료 게재가 가능해진다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ paddle-webhook-signature tests FAILED'); process.exit(1); }
console.log('✅ paddle-webhook-signature tests passed');
