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
t('EUR_PRICES std_y = 54.90 (월 × 10, 2개월 무료 — 2026-09-24)', /std_y:\s*54\.90/.test(sub));
t('EUR_PRICES prem_y = 89.90 (월 × 10, 2개월 무료 — 2026-09-24)',/prem_y:\s*89\.90/.test(sub));

console.log('\n=== 5. 푸터 법적 고지 9개 언어 ===');
const i18n = read('frontend','pap-i18n.js');
const footers = (i18n.match(/footerLegal:\s*'[^']*'/g) || []);
t(`footerLegal 9개 (실제 ${footers.length})`, footers.length === 9);
const withPrice = footers.filter(f => /STANDARD|Membership|Abonnement|Abbonamento|Suscripción|メンバーシップ|会员|Подписка|멤버십/.test(f));
t('가격을 적은 푸터는 전부 €5.49 / €8.99',
  withPrice.every(f => STD.test(f) && PREM.test(f)),
  withPrice.filter(f => !(STD.test(f) && PREM.test(f))).map(s=>s.slice(0,80)).join(' | '));

console.log('\n=== 6. 상담봇 사실 카드 (2026-11-23) ===');
/* 상담봇은 가격을 말한다. 저장소에 가격 단일 상수 파일이 없으므로, 이 파일이
   '다섯 번째 가격표' 가 된 셈이다. 그래서 여기서 함께 지킨다 — 가격을 바꾸면서
   봇을 빠뜨리면 봇만 옛 숫자를 말하게 되고, 그 말은 우리 이름으로 한 약속이 된다.
   (이번 주 사고 셋이 전부 '두 곳 중 한 곳만 고침' 이었다) */
const kn = require('../api/_lib/assistantKnowledge.js');
const sheet = kn.factSheet(kn.FACTS);
t('봇이 말하는 스탠다드 월간 = €5.49',  STD.test(sheet),  kn.FACTS.membership.standardMonthly);
t('봇이 말하는 프리미엄 월간 = €8.99',  PREM.test(sheet), kn.FACTS.membership.premiumMonthly);
t('봇이 말하는 스탠다드 연간 = €54.90', /€\s?54[.,]90/.test(sheet), kn.FACTS.membership.standardYearly);
t('봇이 말하는 프리미엄 연간 = €89.90', /€\s?89[.,]90/.test(sheet), kn.FACTS.membership.premiumYearly);
t('봇이 결제 화면과 같은 숫자를 쓴다 (subscribe.html 이 기준)',
  /std_m:\s*5\.49/.test(sub) && STD.test(sheet)
  && /prem_m:\s*8\.99/.test(sub) && PREM.test(sheet));
t('봇 사실 카드에 옛 통화가 없다', !/₩|\$|¥|₽/.test(sheet));
/* 제출 게재료도 같은 이유로 여기서 본다 — 사이트 문구와 봇이 갈라지면 안 된다. */
t('봇이 말하는 게재료 = €380 / €790', /€380/.test(sheet) && /€790/.test(sheet));
const subsPage = read('frontend','submissions.html');
t('제출 안내 페이지와 같은 숫자다',
  /€380/.test(subsPage) && /€790/.test(subsPage));

console.log('\n=== 7. 상담봇이 무료 회원도 설명한다 (도메니코 2026-11-24) ===');
/* 도메니코: "회원은 무료회원도 있는데 문의하기에서 유료회원에 대해서만
   설명하는것 같아."
   사실 카드에 유료 두 등급만 있으면 봇은 "카드에 없는 건 모른다" 규칙을
   그대로 지켜서 무료 회원 질문에 답하지 못한다. 회원 대다수가 무료 등급인데
   그쪽 설명이 비어 있었다. subscribe.html 의 등급표가 단일 출처이므로,
   여기서 둘이 갈라지지 않게 묶어 둔다. */
t('봇이 €0 무료 등급을 말한다', /€0/.test(sheet), kn.FACTS.membership.free);
t('봇이 등급 셋을 말한다', /무료/.test(sheet) && /스탠다드/.test(sheet) && /프리미엄/.test(sheet));
t('봇이 "무료 회원도 제출할 수 있다" 를 말한다',
  /무료 회원이면 할 수 있고/.test(sheet) && /유료 구독은 필요하지 않다/.test(sheet));
t('봇이 무료 등급의 한계도 말한다 (혜택만 말하지 않는다)',
  /무료 회원에 없는 것/.test(sheet) && /광고/.test(sheet) && /풀레터/.test(sheet));
/* 아래 넷은 subscribe.html 의 features.free / comparison 과 짝을 맞춘다.
   등급표를 고치면서 봇을 빠뜨리면 여기서 걸린다. */
t('결제 화면도 무료 등급이 €0 이다', /priceFree:'€0'/.test(sub));
t('결제 화면: 무료도 서브미션 제출 가능 → 봇도 같다',
  /\['서브미션 제출',true,true,true\]/.test(sub) && /서브미션 제출/.test(sheet));
t('결제 화면: 무료 열람은 최신 10개 → 봇도 같다',
  /최신 10개/.test(sub) && /최신 에디토리얼 10개/.test(sheet));
t('결제 화면: 무료 심사도 최대 7영업일 → 봇도 같다',
  /\['심사 결과','최대 7영업일','최대 7영업일'/.test(sub) && /최대 7영업일\(스탠다드와 같다\)/.test(sheet));
t('봇이 묻는 사람을 유료 회원으로 가정하지 않는다 (프롬프트 규칙)',
  /Never assume the asker has, or needs, a paid plan/.test(read('api','assistant','ask.js'))
  && /Do not turn an answer into a sales pitch/.test(read('api','assistant','ask.js')));

console.log('\n=== 8. 문의 창구 정책 (도메니코 2026-11-25) ===');
/* 도메니코: "유료서비스와 결제관련된 내용이 아니라면 이메일로 문의해도 답변을
   못받는다고 쓰고 나머지 사항은 웹사이트 ai 상담사를 통해" + "dm도 마찬가지".
   이 정책은 **두 곳이 같은 말을 해야** 성립한다 — /contact 페이지(사람이 읽는 곳)와
   상담봇(그 정책 때문에 질문을 받게 되는 곳). 한쪽만 바꾸면 봇이 계속 "메일 주세요"
   라고 해서 정책이 무색해진다. 오늘 하루 사고가 전부 '두 곳 중 한 곳만 고침' 이었다. */
const contact = read('frontend','contact.html');
t('contact 페이지에 안내 블록이 있다', /class="contact-notice"/.test(contact));
/* ru 가 두 번 정의돼 있고 뒤쪽이 이긴다. 한쪽만 고치면 러시아어에서 안 보인다. */
t('안내가 모든 body 에 있다 (ru 중복 2곳 포함)',
  (contact.match(/class="contact-notice"/g) || []).length
  === (contact.match(/body:'<div class="contact-notice"/g) || []).length
  && (contact.match(/class="contact-notice"/g) || []).length === 10,
  String((contact.match(/class="contact-notice"/g) || []).length));
/* 파일 전체로 비교하면 상단 CSS 의 .contact-grid 에 걸린다. body 단위로 본다 —
   안내 없이 주소부터 시작하는 body 가 하나도 없어야 한다. */
t('안내 없이 주소부터 시작하는 body 가 없다',
  (contact.match(/body:'<div class="contact-grid"/g) || []).length === 0);
t('DM 도 같은 규칙이라고 적혀 있다', /인스타그램 DM|Instagram DMs|Instagram-DM|DM Instagram|Instagram の DM|InstagramのDM|Instagram 私信|DM de Instagram|Instagram/.test(contact));
/* 범위에 '계정' 을 넣은 이유: privacy·refund·terms·data-deletion 이 contact@ 를
   공식 창구로 명시한다. 결제만 남기면 그 문서들과 어긋나고, 삭제·열람 요구는
   법으로 보장된 창구라 더 위험하다. */
['privacy','refund','terms','data-deletion'].forEach((p) => {
  t(p + ' 가 여전히 contact@ 를 창구로 쓴다 (안내와 모순되면 안 됨)',
    /contact@pap-magazine\.com/.test(read('frontend', p + '.html')));
});
t('안내가 계정·개인정보·삭제 요청을 이메일 범위에 포함한다',
  /개인정보·계정 삭제 요청/.test(contact) && /account-deletion requests/.test(contact));

const sheet8 = kn.factSheet(kn.FACTS);
t('봇도 같은 규칙을 안다', /이메일과 인스타그램 DM 은 유료 서비스·결제·계정 문의만 답한다/.test(sheet8));
t('봇이 "나머지는 내가 받는다" 를 안다', /이 AI 상담사가 받는다/.test(sheet8));
const ask8 = read('api','assistant','ask.js');
t('봇이 아무 질문에나 메일로 떠넘기지 않는다',
  /Do NOT hand people off to email by default/.test(ask8)
  && !/If you do not know, say so plainly in one sentence and give contact@pap-magazine\.com/.test(ask8));
t('봇이 "메일로 답해 주겠다" 고 약속하지 않는다', /Never promise that someone will email back/.test(ask8));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ subscription-price-single-source tests FAILED'); process.exit(1); }
console.log('✅ subscription-price-single-source tests passed');
