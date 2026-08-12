/**
 * 2026-08-12 — 제출 흐름의 승인후결제 배선을 고정한다.
 *
 * 여기서 지키려는 것은 딱 세 가지다.
 *   1) 무료 투고에는 결제가 붙지 않는다 (유료 유형일 때만 승인 단계로 간다)
 *   2) 승인을 마치지 않아도 제출물이 사라지지 않는다 (이어서 승인 화면)
 *   3) "지금 청구되지 않는다" 가 9개 언어로 사용자에게 전달된다
 *      — 이 말이 없으면 카드에 €790 이 잡힌 것을 보고 항의가 온다.
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

const sub = read('frontend/submission.html');
const fee = read('frontend/pap-submission-fee.js');
const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];

console.log('=== 무료 투고에는 결제가 붙지 않는다 ===');
{
  ok('유료 유형일 때만 승인 단계로 간다',
    /_needsAuth\s*=\s*\(_type === 'branded' \|\| _type === 'paid_few_looks'\)/.test(sub),
    '무료 투고에 결제창이 뜨면 참여가 죽는다');
  ok('  → 승인 호출이 _needsAuth 안에 있다', /if\(_needsAuth && _createdSubmissionId/.test(sub));
}

console.log('=== 승인 단계는 캡처가 아니다 (돈이 안 빠진다) ===');
{
  ok("mode:'authorize' 로 부른다", /mode:\s*'authorize'/.test(sub));
  ok('승인 모드는 paypal-authorize 로 간다',
    /_isAuth \? '\/api\/submissions\/paypal-authorize' : '\/api\/submissions\/paypal-capture'/.test(fee),
    '제출 시점에 캡처하면 떨어져도 돈이 빠진다');
  ok('  → 승인 모드에서는 새로고침하지 않는다',
    /if\(_isAuth\)\{[\s\S]{0,400}?done\(true, 'authorized'\)/.test(fee));
}

console.log('=== 중단해도 제출물이 사라지지 않는다 ===');
{
  ok('승인 실패·취소 시 재개 화면을 띄운다', /_showAuthPendingScreen\(_createdSubmissionId\)/.test(sub));
  ok('  → 재개 화면에 다시 승인 버튼이 있다', /_authResume/.test(sub) && /onDone: function\(ok\)\{ if\(ok\)/.test(sub));
  ok('  → 마이페이지로 미루는 길도 준다', /href="\/mypage"/.test(sub));
  ok('  → 취소를 결과로 알린다', /onCancel: function\(\)\{ done\(false,'cancelled'\)/.test(fee),
    '취소를 성공으로 넘기면 심사에 오르지 않는 건이 성공 화면을 본다');
}

console.log('=== "지금 청구되지 않는다" 가 9개 언어에 있다 ===');
{
  let okCount = 0;
  const miss = [];
  for (const l of LANGS) {
    const re = new RegExp("\\n  " + l + ":\\{ payAuthorizedOk:'([^']*)'");
    const m = sub.match(new RegExp("\\n  " + l + ":\\{t:'(?:[^'\\\\]|\\\\.)*', d:'((?:[^'\\\\]|\\\\.)*)'"));
    const f = fee.match(re);
    if (f && m) okCount += 1; else miss.push(l);
  }
  ok('9개 언어 전부 승인 완료 문구가 있다', okCount === 9, '빠진 언어: ' + miss.join(','));

  // 각 언어가 "아직 청구되지 않았다" 는 뜻을 실제로 담고 있는가
  const NOT_CHARGED = {
    // 소스에는 n\\'est / l\\'autorizzazione 처럼 아포스트로피가 이스케이프되어
    // 저장된다. \\\\? 로 백슬래시를 선택적으로 허용해야 실제 문구를 잡는다.
    ko: /청구되지 않/, en: /not (?:been )?charged/i, de: /nichts abgebucht/,
    it: /addebitato nulla/, fr: /Rien n\\\\?'est débité/i, es: /no se te cobra/i,
    ja: /請求されません/, zh: /不会扣款/, ru: /списания нет/,
  };
  const bad = [];
  for (const l of LANGS) {
    // 이탈리아어·프랑스어는 l\'autorizzazione 처럼 이스케이프된 아포스트로피를
    // 포함한다. [^']* 로 끊으면 문구를 잘못 잘라 읽는다(2026-08-11 같은 함정).
    const m = sub.match(new RegExp("\\n  " + l + ":\\{t:'(?:[^'\\\\]|\\\\.)*', d:'((?:[^'\\\\]|\\\\.)*)'"));
    if (!m || !NOT_CHARGED[l].test(m[1])) bad.push(l);
  }
  ok('  → 재개 화면 문구가 실제로 "지금 청구 안 됨" 을 말한다', bad.length === 0,
    '뜻이 안 맞는 언어: ' + bad.join(','));
}

console.log('=== intent 는 "심사 전인가" 로 갈린다 (기존 66건 결제 불능 방지) ===');
{
  const order = read('api/submissions/paypal-order.js');
  ok('심사 전이면 AUTHORIZE, 승인된 건이면 CAPTURE',
    /kind === 'submission_fee' && String\(sub\.status\) !== 'approved'/.test(order)
    && /\? 'AUTHORIZE' : 'CAPTURE'/.test(order),
    'kind 만으로 가르면 이미 승인된 건이 AUTHORIZE 주문을 만들고 capture 로 보내 실패한다 '
    + '— 미결제 18건(€13,400) 회수 경로가 통째로 막힌다. 2026-08-12 실측으로 잡았다.');
  ok('  → 판단에 쓰는 status 를 실제로 조회한다', /\.select\('[^']*\bstatus\b[^']*'\)/.test(order),
    '조회하지 않으면 undefined 가 되어 항상 AUTHORIZE 로 샌다');
  ok('  → 애드온은 CAPTURE 그대로', /kind === 'submission_fee' &&/.test(order),
    '애드온은 게재 확정 후 사는 상품이라 묶어둘 이유가 없다');
}

console.log('=== 캐시버스트 ===');
{
  const s1 = read('frontend/submission.html').match(/pap-submission-fee\.js\?v=(\d+)/);
  const s2 = read('frontend/mypage.html').match(/pap-submission-fee\.js\?v=(\d+)/);
  ok('submission/mypage 가 같은 버전을 본다', s1 && s2 && s1[1] === s2[1],
    'submission=' + (s1 && s1[1]) + ' mypage=' + (s2 && s2[1]));
  ok('  → v6 이상이다 (이번 변경 반영)', s1 && Number(s1[1]) >= 6, s1 && s1[1]);
}

console.log('\n=== SUMMARY ===');
if (fails.length) {
  console.error('passed: ' + pass + '   failed: ' + fails.length);
  fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
  process.exit(1);
}
console.log('passed: ' + pass + '   failed: 0');
console.log('✓ submission-authorize-flow tests passed');
process.exit(0);
