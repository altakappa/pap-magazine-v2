/*
 * paypal-sale-refund-visible.test.js — 구독 결제 환불이 보이게 한다 (2026-11-09)
 *
 * ■ 무슨 일이 있었나 (실측)
 * 한 회원이 계정 두 개 문제로 €5.49 를 **일곱 번** 냈고, 여섯 건을 환불했다.
 * 그런데 우리 DB 에도, 텔레그램에도 **그 사실이 한 줄도 남지 않았다.**
 *
 * 원인: 웹훅은 PAYMENT.CAPTURE.REFUNDED 만 받고 있었다. 그건 Orders —
 * 서브미션 게재료(€380/€790) 같은 **일회성** 결제의 환불이다. 구독 결제는
 * Sales 라서 PAYMENT.SALE.REFUNDED 로 온다. 2026-08-12 에 일회성 결제용으로
 * 깔아 둔 그물에 구독 쪽 구멍이 그대로 남아 있었다. 환불은 돈이 움직이는
 * 사건인데 시스템에 안 보였다.
 *
 * ■ 이 테스트가 지키는 계약
 *  1) PAYMENT.SALE.REFUNDED · PAYMENT.SALE.REVERSED 를 받는다 (default 로 안 샌다).
 *  2) 받으면 **반드시 알린다** — 조용히 200 만 돌려주지 않는다.
 *  3) **등급을 자동으로 내리지 않는다.** 2026-08-07 lia.line 사고의 교훈이다:
 *     중복분을 환불·해지했다고 멀쩡한 접근권을 끊으면 안 된다. 어느 결제가
 *     어느 기간에 대응하는지는 사람이 봐야 안다. 회수는 사람이 한다.
 *  4) 회원을 못 찾아도 조용히 넘기지 않는다 (수동 확인 요청).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const W = fs.readFileSync(path.join(ROOT, 'api/paypal-webhook.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); }
}

console.log('\n=== 1. 이벤트를 받는다 ===');
t("PAYMENT.SALE.REFUNDED case 가 있다", /case 'PAYMENT\.SALE\.REFUNDED':/.test(W));
t("PAYMENT.SALE.REVERSED case 가 있다", /case 'PAYMENT\.SALE\.REVERSED':/.test(W));
t('기존 CAPTURE 환불 처리는 그대로 있다',
  /case 'PAYMENT\.CAPTURE\.REFUNDED':/.test(W) && /handleCaptureRefunded/.test(W),
  '서브미션 게재료 환불 경로를 깨뜨리면 안 된다');
t('머리말 이벤트 목록에도 적혀 있다', /PAYMENT\.SALE\.REFUNDED \/ \.REVERSED/.test(W));

// SALE 환불 case 의 본문만 떼어낸다
const block = (W.match(/case 'PAYMENT\.SALE\.REFUNDED':[\s\S]*?\n      \}/) || [''])[0];
t('본문을 찾았다', block.length > 200, String(block.length));

console.log('=== 2. 반드시 알린다 ===');
t('텔레그램으로 알린다', /sendTextToTelegramSafe\(/.test(block));
t('금액을 싣는다', /amount/.test(block) && /amt/.test(block));
t('sale id 와 구독 id 를 싣는다', /sale=/.test(block) && /sub=/.test(block));
t('서버 로그에도 남긴다', /console\.error\(/.test(block));
t('회원을 못 찾으면 수동 확인을 요청한다', /회원 미상/.test(block));
t('billing_agreement_id 로 구독을 찾는다', /billing_agreement_id/.test(block));

console.log('=== 3. 등급을 자동으로 내리지 않는다 (가장 중요) ===');
t('profiles 를 건드리지 않는다', !/from\('profiles'\)/.test(block), block.slice(0, 200));
t('강등 헬퍼를 부르지 않는다', !/downgradeToFree|subscription_plan:\s*'free'/.test(block));
t('subscriptions 를 update 하지 않는다', !/\.update\(/.test(block),
  '환불 한 건으로 구독 상태를 바꾸면 lia.line 사고가 재현된다');
t('조회는 select 만 한다', /\.select\(/.test(block));
t('사람이 판단한다고 명시한다', /자동으로 내리지 않|회수가 필요하면/.test(block));
t('lia.line 교훈을 근거로 적어 두었다', /lia\.line/.test(W));

console.log('=== 4. 응답 ===');
t('200 으로 받는다 (PayPal 재시도 유발 금지)', /res\.status\(200\)/.test(block));
t('처리 결과를 응답에 적는다', /refund: true/.test(block));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ paypal-sale-refund-visible tests FAILED'); process.exit(1); }
console.log('✅ paypal-sale-refund-visible tests passed');
