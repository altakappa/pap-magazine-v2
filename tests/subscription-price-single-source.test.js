/**
 * 구독 표시가는 사이트 전체에서 하나여야 한다 (2026-08-11).
 *
 * [사고]
 * Paddle(MoR) → PayPal 전환으로 통화를 EUR 하나로 합쳤는데, subscribe.html 만
 * 고쳤다. 실제 구매 동선의 나머지가 옛 가격 그대로 남아 있었다:
 *   · auth.html      회원가입 화면 플랜 카드   ₩8,500 / ₩13,500  (9개 언어 전부)
 *   · magazine.html  구독 모달                $6.99 · €5,99 · ¥780 · ₽549 …
 *   · pap-i18n.js    전 페이지 푸터 법적 고지  ₩8,500/월
 * 가입 화면에서 ₩8,500 을 보고 결제창에서 €5.49 를 만나면 "가격이 두 개인 매체"가 된다.
 * PayPal 은 플랜당 통화가 하나뿐이라 국가별 현지가 자체가 불가능하다.
 *
 * [규칙] 표시가를 바꿀 때는 이 파일이 가리키는 곳을 전부 같이 바꾼다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const p = (...a) => path.join(__dirname, '..', ...a);
const read = (...a) => fs.readFileSync(p(...a), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

// 소수점은 언어별로 '.' 또는 ',' 를 쓴다. 둘 다 허용하되 숫자는 고정.
const STD  = /€\s?5[.,]49/;
const PREM = /€\s?8[.,]99/;

console.log('\n=== 1. 원화(₩) 표시가가 남아 있지 않다 ===');
// 관리자 화면(admin.html·pap-admin.js)의 ₩ 는 매출 집계 표시라 대상이 아니다.
const customerFacing = ['index.html','articles.html','films.html','search.html',
                        'mypage.html','auth.html','magazine.html','subscribe.html','pap-i18n.js'];
for (const f of customerFacing) {
  const src = read('frontend', f);
  t(`${f} 에 ₩ 구독가 없음`, !/₩\s?8[,.]?500|₩\s?13[,.]?500|&#8361;\s?8|&#8361;\s?13/.test(src));
}

console.log('\n=== 2. 회원가입 화면(auth.html) 9개 언어 전부 EUR ===');
const auth = read('frontend','auth.html');
const stdHits  = (auth.match(/planStdPrice:\s*'[^']*'/g)  || []);
const premHits = (auth.match(/planPremPrice:\s*'[^']*'/g) || []);
t(`planStdPrice 9개 언어 존재 (실제 ${stdHits.length})`,  stdHits.length >= 9);
t(`planPremPrice 9개 언어 존재 (실제 ${premHits.length})`, premHits.length >= 9);
t('planStdPrice 전부 €5.49/€5,49',  stdHits.every(s => STD.test(s)),  stdHits.filter(s=>!STD.test(s)).join(' | '));
t('planPremPrice 전부 €8.99/€8,99', premHits.every(s => PREM.test(s)), premHits.filter(s=>!PREM.test(s)).join(' | '));

console.log('\n=== 3. 구독 모달(magazine.html) 9개 언어 전부 EUR ===');
const mag = read('frontend','magazine.html');
const block = (mag.match(/var pricing=\{[\s\S]*?\};/) || [''])[0];
t('pricing 표가 존재한다', block.length > 0);
const stds  = (block.match(/std:\s*'[^']*'/g)  || []);
const prems = (block.match(/prem:\s*'[^']*'/g) || []);
t(`언어 9개 (실제 ${stds.length})`, stds.length === 9);
t('std 전부 €5.49/€5,49',  stds.every(s => STD.test(s)),  stds.filter(s=>!STD.test(s)).join(' | '));
t('prem 전부 €8.99/€8,99', prems.every(s => PREM.test(s)), prems.filter(s=>!PREM.test(s)).join(' | '));
t('옛 통화(달러·엔·위안·루블)가 남아 있지 않다',
  !/\$|¥|₽|₩/.test(block),
  'PayPal 은 플랜당 통화가 하나뿐이라 현지가를 유지할 수 없다');

console.log('\n=== 4. 결제 화면(subscribe.html)이 기준값이다 ===');
const sub = read('frontend','subscribe.html');
t('EUR_PRICES std_m = 5.49',  /std_m:\s*5\.49/.test(sub));
t('EUR_PRICES prem_m = 8.99', /prem_m:\s*8\.99/.test(sub));
t('EUR_PRICES std_y = 45.99', /std_y:\s*45\.99/.test(sub));
t('EUR_PRICES prem_y = 74.99',/prem_y:\s*74\.99/.test(sub));

console.log('\n=== 5. 푸터 법적 고지 9개 언어 ===');
const i18n = read('frontend','pap-i18n.js');
const footers = (i18n.match(/footerLegal:\s*'[^']*'/g) || []);
t(`footerLegal 9개 (실제 ${footers.length})`, footers.length === 9);
const withPrice = footers.filter(f => /STANDARD|Membership|Abonnement|Abbonamento|Suscripción|メンバーシップ|会员|Подписка|멤버십/.test(f));
t('가격을 적은 푸터는 전부 €5.49 / €8.99',
  withPrice.every(f => STD.test(f) && PREM.test(f)),
  withPrice.filter(f => !(STD.test(f) && PREM.test(f))).map(s=>s.slice(0,80)).join(' | '));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ subscription-price-single-source tests FAILED'); process.exit(1); }
console.log('✅ subscription-price-single-source tests passed');
