/**
 * 2026-08-13 — 청구가 실패하면 게재 승인 자체가 막혀야 한다.
 *
 * ■ 어떻게 발견했나
 *   샌드박스 A판(거절→해제) 검증 중, 해제가 진짜인지 확인하려고 이미 void 된
 *   승인건에 일부러 승인을 눌렀다. PayPal 은 청구를 거부했는데(정상) 우리 쪽은:
 *     - status 가 approved 로 저장됐고
 *     - 크리에이터에게 "축하드립니다 — 게재가 승인되었습니다" 메일이 나갔고
 *     - API 는 200 을 돌려줘 어드민 화면엔 경고가 없었다
 *   즉 **돈을 못 받은 채 게재가 확정되는 경로**가 조용히 열려 있었다.
 *   잡아주는 건 텔레그램 알람 하나뿐이었다.
 *
 *   실제로 터지는 상황은 드물지 않다:
 *     · 48시간 SLA 를 넘겨 승인이 만료된 뒤 승인을 누를 때
 *     · 크리에이터가 PayPal 쪽에서 먼저 취소했을 때
 *
 * ■ 고친 방향 (도메니코 결정 2026-08-13, 1번안)
 *   저장 전에 먼저 청구하고, 실패하면 409 로 막는다. 두 실패 모드 비교:
 *     저장 먼저 → 청구 실패 = 게재 확정됐는데 돈이 없다   (회수 불가)
 *     청구 먼저 → 저장 실패 = 돈은 받았는데 상태만 안 바뀜 (재시도로 복구)
 *   후자가 압도적으로 안전하다.
 *
 * ■ 이 테스트가 하는 일
 *   소스를 직접 읽어 순서와 조건을 고정한다. review.js 는 supabase·PayPal·메일을
 *   전부 물고 있어 런타임으로 세우려면 스텁이 과해지고, 정작 중요한 "순서" 는
 *   스텁으로 증명되지 않는다.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REVIEW = path.join(ROOT, 'api/submissions/[id]/review.js');
const SETTLE = path.join(ROOT, 'api/_lib/settleAuthorization.js');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

const src = fs.readFileSync(REVIEW, 'utf8');
const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

console.log('=== 청구를 저장보다 먼저 한다 (순서가 이 수정의 전부다) ===');
{
  const gateAt = code.indexOf('preCaptured = true');
  const writeAt = code.indexOf('.update(patchToWrite)');
  ok('청구 게이트가 존재한다', gateAt > -1);
  ok('DB 저장이 존재한다', writeAt > -1);
  ok('청구 게이트가 저장보다 앞에 있다', gateAt > -1 && writeAt > -1 && gateAt < writeAt,
    '저장이 먼저면 청구 실패 시 게재가 확정된 채로 남는다 — 이 버그 자체다');
}

console.log('=== 게이트가 걸리는 조건 ===');
{
  ok("승인 + payment_status='authorized' 일 때만 건다",
    /status === 'approved'\s*&&\s*String\(prevPaymentStatus\) === 'authorized'/.test(code),
    "무료·구(舊) 경로('none')까지 막으면 정상 심사가 멈춘다");
  ok('사전 조회 실패 시에는 막지 않는다 (prevRowFull 가드)',
    /&&\s*prevRowFull/.test(code),
    '부수 조회 실패가 정상 심사를 멈추면 그게 더 큰 사고다 — 2026-08-12 가드와 같은 원칙');
  ok('사전 조회가 정산에 필요한 필드를 가져온다',
    /select\('id, admin_notes, payment_status, paypal_authorization_id, description'\)/.test(code),
    'settle 이 이 행에서 authorization_id 와 description(금액 산출)을 읽는다');
}

console.log('=== 실패하면 409 로 막고, 성공/해당없음은 통과시킨다 ===');
{
  ok('settle 이 error 를 돌려주면 409 다',
    /if \(pre && pre\.error\)[\s\S]{0,200}status\(409\)/.test(code));
  ok("409 코드가 'capture_failed' 다",
    /code: 'capture_failed'/.test(code));
  ok('PayPal 이슈 코드를 detail 로 같이 돌려준다',
    /detail: pre\.code \|\| pre\.error/.test(code),
    '어드민이 "왜 실패했는지" 를 알 수 있어야 한다');
  ok('예외가 나도 막는다',
    /catch \(e\)[\s\S]{0,400}status\(409\)[\s\S]{0,120}capture_failed/.test(code),
    '청구가 됐는지 모르는 상태로 게재를 확정하면 안 된다');
  ok('예외 시 텔레그램으로 사람에게 올린다',
    /await sendTextToTelegramSafe\('🚨 승인 직전 청구 시도 중 예외/.test(code));
}

console.log('=== 두 번 청구되지 않는다 ===');
{
  ok('저장 뒤 정산은 이미 청구했으면 건너뛴다',
    /const settled = preCaptured \? \{ captured: true \} : await settleSubmissionAuthorization/.test(code));
  const settle = fs.readFileSync(SETTLE, 'utf8');
  ok("settle 자체가 멱등이다 (payment_status='paid' 면 already 로 빠진다)",
    /if \(pay === 'paid'\) return \{ already: 'paid' \};/.test(settle),
    '재시도가 안전해야 "청구 먼저" 전략이 성립한다');
  ok('캡처에 멱등키를 쓴다',
    /captureAuthorization\(authId, cents, 'pap-cap-' \+ sub\.id\)/.test(settle));
}

console.log('=== 2026-08-12 가드는 그대로 살아 있다 ===');
{
  ok("승인 없는 건은 여전히 409 authorization_missing 이다",
    /String\(prevPaymentStatus\) === 'awaiting_authorization'[\s\S]{0,200}authorization_missing/.test(code),
    '이번 수정이 먼저 만든 가드를 덮어쓰면 안 된다');
}

console.log('\n=== SUMMARY ===');
if (fails.length) {
  console.error('passed: ' + pass + '   failed: ' + fails.length);
  fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
  process.exit(1);
}
console.log('passed: ' + pass + '   failed: 0');
console.log('✓ review-capture-gate tests passed');
process.exit(0);
