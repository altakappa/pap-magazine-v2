/**
 * 2026-08-12 — 텔레그램 알림은 반드시 await 해야 한다.
 *
 * ■ 어떻게 발견했나
 *   샌드박스 €790 리허설에서 환불을 실행했다. DB 는 payment_status='refunded' 로
 *   정확히 바뀌었는데 **텔레그램이 오지 않았다.** 단위 테스트 27개는 전부
 *   통과한 상태였다.
 *
 * ■ 왜 테스트가 못 잡았나
 *   tests/paypal-orders-webhook-recovery.test.js 는 텔레그램을 이렇게 스텁한다:
 *       sendTextToTelegramSafe: (t) => { sent.push(t); return Promise.resolve(); }
 *   push 가 **동기**라 await 유무와 무관하게 sent 배열이 채워진다. 즉 이 테스트는
 *   "호출했는가" 만 검증했고 "완료를 기다렸는가" 는 못 봤다.
 *
 * ■ 왜 실서비스에서만 터지나
 *   Vercel 서버리스는 핸들러가 응답을 반환하면 그 즉시 함수를 **얼린다(freeze)**.
 *   await 없이 띄워만 둔 fetch 는 그 자리에서 죽는다. 로컬 node 에서는 프로세스가
 *   살아 있윴니 끝까지 간다 — 그래서 로컬 테스트로는 영원히 안 잡힌다.
 *
 * ■ 왜 조용했나
 *   sendTextToTelegramSafe 는 내부에서 모든 에러를 삼키도록 만들어져 있다
 *   (호출부를 절대 막지 않기 위해). "안전 래퍼" 가 오히려 유실을 숨겼다.
 *
 * ■ 이 테스트가 하는 일
 *   런타임 동작이 아니라 **소스를 직접 읽어** await 없는 호출을 찾는다.
 *   스텁으로는 재현이 안 되는 결함이므로 정적 검사가 유일하게 확실한 방법이다.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'api');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

function walk(dir, out) {
  out = out || [];
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const CALL = /sendTextToTelegram(?:Safe|PersonalSafe)\s*\(/;

console.log('=== api/ 전체에 await 없는 텔레그램 호출이 없다 ===');
{
  const offenders = [];
  for (const file of walk(API)) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!CALL.test(line)) return;

      // 선언·재수출·주석은 호출이 아니다.
      if (/require\(/.test(line)) return;
      if (/^\s*(async\s+)?function\s+sendTextToTelegram/.test(line)) return;
      if (/module\.exports/.test(line)) return;
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      // 객체 리터럴 속성으로 넘기는 형태(스텁 등)
      if (/sendTextToTelegram(Safe|PersonalSafe)\s*:/.test(line)) return;

      // await 이 붙어 있으면 통과. `return sendText…` 은 호출부가 await 하면
      // 되므로 허용하되, 그 사실을 사람이 알 수 있게 아래에서 따로 센다.
      if (/await\s+sendTextToTelegram/.test(line)) return;
      if (/^\s*return\s+sendTextToTelegram/.test(line)) return;

      offenders.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 80));
    });
  }
  ok('await 없는 호출이 0건이다', offenders.length === 0,
    '서버리스는 응답 반환 후 함수를 얼린다 — await 없는 알림은 전송되지 않는다\n         '
    + offenders.join('\n         '));
}

console.log('=== 돈이 움직이는 경로는 특히 확실히 await 한다 ===');
{
  // 이 파일들에서 알림이 유실되면 "돈은 받았는데 아무도 모른다" 가 된다.
  const MONEY = [
    'api/_lib/paypalCaptureRecovery.js',
    'api/paypal-webhook.js',
    'api/paddle-webhook.js',
    'api/submissions/paypal-capture.js',
    'api/auth/withdraw.js',
  ];
  for (const rel of MONEY) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { console.log('  · ' + rel + ' 없음 — 건너뜀'); continue; }
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    const calls = lines.filter((l) => CALL.test(l)
      && !/require\(/.test(l) && !/module\.exports/.test(l)
      && !/^\s*(\/\/|\*|\/\*)/.test(l)
      && !/sendTextToTelegram(Safe|PersonalSafe)\s*:/.test(l));
    const bad = calls.filter((l) => !/await\s+sendTextToTelegram/.test(l));
    ok(rel + ' 의 알림 ' + calls.length + '개가 전부 await 된다', bad.length === 0,
      bad.map((l) => l.trim().slice(0, 70)).join(' | '));
  }
}

console.log('=== 복구 그물의 알림 문구가 살아 있다 ===');
{
  // await 을 붙이면서 문구가 깨지지 않았는지 — 리허설에서 실제로 확인한 것들
  const src = fs.readFileSync(path.join(ROOT, 'api/_lib/paypalCaptureRecovery.js'), 'utf8');
  ok('환불 알림이 게재 대기열 확인을 요청한다',
    /await sendTextToTelegramSafe\('↩️ PayPal 환불 반영/.test(src)
    && /게재 대기열에서 빼야 하는지/.test(src));
  ok('게재료 복구 알림이 브라우저 확정 실패를 알린다',
    /await sendTextToTelegramSafe\('💶 \[웹훅 복구\] 게재료 결제 반영/.test(src));
  ok('서브미션 못 찾음 알림이 살아 있다',
    /await sendTextToTelegramSafe\('🚨 PayPal 캡처 완료 이벤트인데 서브미션을 못 찾음/.test(src));
}

console.log('=== 스텁이 await 를 검증하지 못한다는 사실을 문서로 남긴다 ===');
{
  // 이 테스트 자체가 왜 정적 검사인지 — 후임자가 "런타임으로 하지 그랬냐" 고
  // 되묻지 않도록 기존 테스트의 스텁 형태를 고정해 둔다.
  const p = path.join(ROOT, 'tests/paypal-orders-webhook-recovery.test.js');
  if (fs.existsSync(p)) {
    const t = fs.readFileSync(p, 'utf8');
    ok('기존 테스트의 텔레그램 스텁은 동기 push 다 (= await 유무를 못 본다)',
      /sent\.push\(t\)/.test(t),
      '이 스텁이 동기인 한 런타임 테스트로는 await 누락을 잡을 수 없다');
  } else {
    console.log('  · paypal-orders-webhook-recovery.test.js 없음 — 건너윀');
  }
}

console.log('\n=== SUMMARY ===');
if (fails.length) {
  console.error('passed: ' + pass + '   failed: ' + fails.length);
  fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
  process.exit(1);
}
console.log('passed: ' + pass + '   failed: 0');
console.log('✓ telegram-alerts-must-be-awaited tests passed');
process.exit(0);
