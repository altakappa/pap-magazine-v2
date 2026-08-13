/**
 * 2026-08-13 — 게재료 문구가 실제 결제 흐름과 어긋나지 않는다.
 *
 * ■ 왜 필요한가
 *   8/12 에 게재료를 '승인후결제'(제출 시 돈을 묶고, 수락 시 청구, 거절 시 해제)로
 *   바꿨는데, 작가에게 보여주는 문구 세 곳은 그 전 흐름("수락되면 MY SUBMISSIONS
 *   에서 직접 결제")을 그대로 말하고 있었다. 같은 날 다른 작업으로 각각 쓰였고
 *   서로를 몰랐다.
 *
 *   실측(2026-08-13 프리뷰): 모달이 "수락되면 나중에 결제하시면 됩니다" 라고 한
 *   직후, [동의하고 제출] 을 누르자 곧바로 PayPal 카드 요구가 떴다. 작가 입장에서는
 *   방금 읽은 안내와 정반대다. 돈이 걸린 화면에서 이런 어긋남은 신뢰를 깬다.
 *
 * ■ 이 테스트가 고정하는 것
 *   1. 옛 문구("수락되면 직접 결제")가 어느 언어에도 남아 있지 않다
 *   2. 새 사실(승인/보류 = 청구 아님)이 9개 언어 전부에 들어 있다
 *   3. 결제 승인을 중간에 닫은 작가가 이어서 마칠 길이 있다 (막다른 길 방지)
 *
 *   문구는 사람이 자주 손대는 곳이라 "한 언어만 고치고 나머지를 잊는" 사고가
 *   기본값이다. 9개 전부를 세는 이유가 그것이다.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

const consent = read('frontend/pap-submission-fee-consent.js');
const submission = read('frontend/submission.html');
const mypage = read('frontend/mypage.html');
const feeJs = read('frontend/pap-submission-fee.js');

// 옛 흐름을 말하는 표현들 — 언어별로 다르게 쓰였으므로 전부 나열한다.
const STALE = [
  'MY SUBMISSIONS에서 직접 결제',
  'MY SUBMISSIONS</b> 에서 직접 결제',
  'pay from <b>MY SUBMISSIONS',
  'Once accepted you pay from MY SUBMISSIONS',
  'paga desde MY SUBMISSIONS',
  'paga desde <b>MY SUBMISSIONS',
  'paghi da MY SUBMISSIONS',
  'paghi da <b>MY SUBMISSIONS',
  'payez depuis MY SUBMISSIONS',
  'payez depuis <b>MY SUBMISSIONS',
  'zahlen Sie unter MY SUBMISSIONS',
  'zahlen Sie unter <b>MY SUBMISSIONS',
  'MY SUBMISSIONSからお支払い',
  'MY SUBMISSIONS</b>からお支払い',
  'MY SUBMISSIONS 中支付',
  'оплачиваете в MY SUBMISSIONS',
  'оплатите в разделе <b>MY SUBMISSIONS',
];

console.log('=== 옛 흐름을 말하는 문구가 남아 있지 않다 ===');
{
  for (const [label, src] of [['제출 전 확인 모달', consent], ['룩 크레딧 안내', submission]]) {
    const hit = STALE.filter((p) => src.indexOf(p) !== -1);
    ok(label + ' 에 "수락 후 직접 결제" 표현이 0건이다', hit.length === 0,
      '남은 표현: ' + hit.join(' | '));
  }
}

console.log('=== 새 사실이 9개 언어 전부에 들어 있다 ===');
{
  // "묶기만 하고 청구되지 않는다" 를 각 언어가 어떻게 말하는지 — 최소 한 개씩.
  const HELD = [
    /묶이기만 하고 청구되지는 않습니다/,          // ko
    /only held, not charged/i,                    // en
    /solo bloccato, non addebitato/i,             // it
    /seulement bloqué, pas débité/i,              // fr
    /solo queda retenido, no se cobra/i,          // es
    /nur reserviert, nicht abgebucht/i,           // de
    /確保されるだけで/,                            // ja
    /仅被冻结，不会扣款/,                          // zh
    /только резервируется, а не списывается/i,    // ru
  ];
  const hitConsent = HELD.filter((re) => re.test(consent)).length;
  ok('모달: 9개 언어가 모두 "묶임 ≠ 청구" 를 말한다 (' + hitConsent + '/9)',
    hitConsent === 9,
    '한 언어만 고치고 나머지를 잊는 것이 이 파일의 기본 사고 패턴이다');

  // 룩 안내문은 문장이 다르므로 별도 표현으로 센다.
  const HELD2 = [
    /금액이 묶이기만 하고 청구되지는 않으며/,
    /the amount is only held, not charged/i,
    /l\\?'importo viene solo bloccato, non addebitato/i,
    /le montant est seulement bloqué, pas débité/i,
    /el importe solo queda retenido, no se cobra/i,
    /der Betrag wird nur reserviert, nicht abgebucht/i,
    /金額は確保されるだけで請求はされません/,
    /金额仅被冻结，不会扣款/,
    /сумма только резервируется, а не списывается/i,
  ];
  const hitNotice = HELD2.filter((re) => re.test(submission)).length;
  ok('룩 안내: 9개 언어가 모두 "묶임 ≠ 청구" 를 말한다 (' + hitNotice + '/9)',
    hitNotice === 9);
}

console.log('=== 48시간 SLA 를 작가에게 먼저 말한다 ===');
{
  // 우리가 지켜야 할 약속이므로 숨기지 않는다. 넘기면 자동 해제된다는 것까지.
  const SLA = [/2일 안에/, /within 2 days/i, /entro 2 giorni/i, /sous 2 jours/i,
    /2 días/i, /2 Tagen/i, /2日以内/, /2 天内/, /2 дней/i];
  const hit = SLA.filter((re) => re.test(consent)).length;
  ok('모달이 9개 언어로 2일 심사·자동해제를 알린다 (' + hit + '/9)', hit === 9);
}

console.log('=== 결제 승인을 중간에 닫아도 막다른 길이 아니다 ===');
{
  ok('mypage 가 awaiting_authorization 을 별도 상태로 본다',
    /payment_status === 'awaiting_authorization'[\s\S]{0,80}authorization_required/.test(mypage),
    "없으면 그냥 '대기 중' 으로 보이고, 관리자는 승인 불가(409), 크론도 안 훑는다");
  ok('그 상태에 이어서 승인할 버튼이 있다',
    /ds === 'authorization_required'/.test(mypage) && /authorizeBaseFee\(/.test(mypage));
  ok('authorizeBaseFee 가 승인 모드로 연다 (청구가 아니다)',
    /function authorizeBaseFee[\s\S]{0,300}mode: 'authorize'/.test(feeJs));
  ok('상태 라벨이 9개 언어 사전과 무관하게 ko/en 둘 다 있다',
    /authorization_required: \{ ko:'[^']+', en:'[^']+'/.test(mypage));
}

console.log('=== 어드민 버튼도 실제 동작을 말한다 ===');
{
  const admin = read('frontend/pap-admin.js');
  ok("승인 버튼이 '결제요청' 이 아니라 '청구' 다",
    /승인 및 청구/.test(admin) && !/승인 및 결제요청'\+/.test(admin),
    '승인후결제에서 승인은 곧 청구다 — 작가에게 요청을 보내는 단계가 아니다');
}

console.log('=== 캐시버스트가 올라가 있다 ===');
{
  for (const [file, name, min] of [
    ['frontend/submission.html', 'pap-submission-fee-consent.js', 2],
    ['frontend/submission.html', 'pap-submission-fee.js', 8],
    ['frontend/mypage.html', 'pap-submission-fee.js', 8],
  ]) {
    const src = read(file);
    const m = src.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=(\\d+)'));
    ok(file + ' 의 ' + name + ' 가 v' + min + ' 이상이다',
      !!m && parseInt(m[1], 10) >= min, m ? ('현재 v' + m[1]) : '태그 없음');
  }
}

console.log('\n=== SUMMARY ===');
if (fails.length) {
  console.error('passed: ' + pass + '   failed: ' + fails.length);
  fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
  process.exit(1);
}
console.log('passed: ' + pass + '   failed: 0');
console.log('✓ fee-copy-matches-flow tests passed');
process.exit(0);
