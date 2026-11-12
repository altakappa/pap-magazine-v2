/**
 * 아티클 게재료(€790) 결제 회귀 테스트 (2026-11-12)
 * ─────────────────────────────────────────────────────────────────────
 * 결제는 반쯤 만들면 가장 위험하다. 그래서 돈이 움직이는 순서와 금액의
 * 출처를 테스트로 묶어 둔다.
 *
 * 지키려는 것:
 *  ① 금액은 서버가 정한다. 브라우저는 "어느 기고" 만 말한다.
 *  ② 금액의 근거는 article_submissions.fee_type 이고, 그 칸은 관리자만 쓴다.
 *  ③ €790 숫자는 한 곳(submissionPayment.SUBMISSION_FEE_CENTS)에만 있다.
 *  ④ 캡처(돈이 나가는 지점) 전에 금액·소유자·중복을 모두 확인한다.
 *  ⑤ 이중청구는 스키마(부분 UNIQUE 인덱스)가 받친다 — 앱 검사만으로는 경합을 못 막는다.
 *  ⑥ 결제된 건은 코드로 거절·무료화하지 않는다 (환불은 사람이).
 *  ⑦ 결제 버튼은 한 벌이다 — 두 벌이면 SDK intent 규칙이 한쪽에서만 지켜진다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* 주석을 떼고 코드만 본다 — "여기서는 AUTHORIZE 를 쓰지 않는다" 를 설명하는
   주석이 검사에 걸리면 설명을 지우게 된다. 설명은 남기고 코드만 본다. */
const CODE = (f) => R(f)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

const O = require('../api/_lib/paypalOrders');
const { SUBMISSION_FEE_CENTS } = require('../api/_lib/submissionPayment');

// ── 1. 금액은 서버가, fee_type 으로만 ──
console.log('=== 1. 금액 산출 ===');
t('홍보성이면 €790', (function () {
  const a = O.resolveAmount({ fee_type: 'branded' }, 'article_fee');
  return a.cents === 79000 && !a.error;
})());
t('€790 은 공용 상수를 그대로 쓴다 (두 벌이면 한쪽만 올라간다)',
  O.resolveAmount({ fee_type: 'branded' }, 'article_fee').cents === SUBMISSION_FEE_CENTS.branded);
t('무료 건은 값을 매기지 않는다', O.resolveAmount({ fee_type: 'free' }, 'article_fee').error === 'not_a_paid_article');
t('fee_type 이 없으면 값을 매기지 않는다',
  O.resolveAmount({}, 'article_fee').error === 'not_a_paid_article'
  && O.resolveAmount(null, 'article_fee').error === 'not_a_paid_article');
// 클라이언트가 fee_type 을 실어 보내도 소용없다 — 서버가 DB 행을 읽어 넘긴다.
t('금액 인자를 받는 경로가 없다 (resolveAmount 는 행과 종류만 받는다)',
  O.resolveAmount.length <= 3, String(O.resolveAmount.length));

console.log('\n=== 2. custom_id ===');
t('아티클은 af| 접두어', O.buildCustomId('article_fee', 'X') === 'af|X');
t('af| 를 article_fee 로 되돌린다', (function () {
  const m = O.parseCustomId('af|X');
  return m && m.kind === 'article_fee' && m.submissionId === 'X';
})());
t('에디토리얼 접두어는 그대로다 (기존 결제가 깨지지 않는다)',
  O.buildCustomId('submission_fee', 'X') === 'f|X'
  && O.buildCustomId('submission_addon', 'X', 'z') === 'a|X|z'
  && O.parseCustomId('f|X').kind === 'submission_fee'
  && O.parseCustomId('a|X|z').kind === 'submission_addon');
t('모르는 접두어는 null', O.parseCustomId('zz|X') === null && O.parseCustomId('') === null);

console.log('\n=== 3. 주문 생성 ===');
const ORD = CODE('api/article-submissions/paypal-order.js');
t('결제 경로는 strict 인증 (로그아웃 뒤 옛 토큰 차단)', /requireAuthStrict/.test(ORD));
t('intent 는 CAPTURE — 심사가 이미 끝난 뒤의 결제다', /intent: 'CAPTURE'/.test(ORD));
t('AUTHORIZE 로 묶는 경로가 없다 (Honor Period 안에 캡처할 심사 시점이 없다)',
  !/AUTHORIZE/.test(ORD));
t('소유자를 확인한다', /sub\.user_id\) !== String\(user\.id\)/.test(ORD) && /not_owner/.test(ORD));
t('이미 결제·면제된 건은 새 주문을 만들지 않는다',
  /already_paid/.test(ORD) && /already_waived/.test(ORD));
t('거절·철회된 건은 결제 대상이 아니다 (받으면 환불 대화가 된다)',
  /not_payable/.test(ORD) && /'rejected'/.test(ORD) && /'withdrawn'/.test(ORD));
t('금액은 resolveAmount 로만 — 본문에 숫자를 적지 않는다',
  /resolveAmount\(sub, 'article_fee', null\)/.test(ORD) && !/79000/.test(ORD) && !/790\.00/.test(ORD));
t('멱등키를 보낸다 (재시도가 새 주문을 만들지 않게)', /'PayPal-Request-Id'/.test(ORD));
t('결제 일시중지 스위치를 존중한다', /PAYMENTS_PAUSED/.test(ORD));
t('오류 응답에 원문을 싣지 않는다', /code: 'order_failed'/.test(ORD) && !/e\.message \|\|/.test(ORD));

console.log('\n=== 4. 캡처 — 돈이 움직이는 순서 ===');
const CAP = CODE('api/article-submissions/paypal-capture.js');
t('strict 인증', /requireAuthStrict/.test(CAP));
t('custom_id 가 article_fee 가 아니면 거부', /meta\.kind !== 'article_fee'/.test(CAP));
t('소유자 확인', /not_owner/.test(CAP));
/* 순서가 핵심이다. 캡처 호출이 금액 대조·중복 확인·상태 확인보다 뒤에 와야 한다.
   예전 에디토리얼 코드는 캡처가 첫 부수효과였고, 그래서 "이미 냈다" 를 확인하는
   순간에 두 번째 돈이 이미 나간 뒤였다(2026-08-07 €17.98 이중결제). */
const iAmount = CAP.indexOf('amount_mismatch');
const iPaid = CAP.indexOf("payment_status) === 'paid'");
const iStatus = CAP.indexOf('not_approved');
const iCapture = CAP.indexOf("/capture'");
t('금액 대조가 캡처보다 먼저', iAmount > -1 && iAmount < iCapture, iAmount + ' < ' + iCapture);
t('이미 결제됨 확인이 캡처보다 먼저 (이중청구 원천 차단)', iPaid > -1 && iPaid < iCapture);
t('주문 상태 확인이 캡처보다 먼저', iStatus > -1 && iStatus < iCapture);
t('캡처 뒤에 금액을 한 번 더 확인한다 (방어 심층)',
  CAP.indexOf('paid_but_unconfirmed') > iCapture);
t('ORDER_ALREADY_CAPTURED 를 멱등 처리한다', /ORDER_ALREADY_CAPTURED/.test(CAP));
t('UNIQUE 위반은 중복으로 본다 (스키마가 막은 경합)', /duplicate key\|unique/.test(CAP));
t('캡처 실패는 "재시도 안전" 코드로 구분해 준다', /code: 'capture_failed'/.test(CAP));
t('돈을 받고 기록 실패하면 재결제를 권하지 않는다',
  /paid_but_unconfirmed/.test(CAP) && /Do not pay again/.test(CAP));
t('돈이 움직인 뒤의 실패는 전부 텔레그램으로 올린다', (CAP.match(/alertStuck\(/g) || []).length >= 5,
  String((CAP.match(/alertStuck\(/g) || []).length));
t('알림은 await 한다 (서버리스 프리즈로 유실되면 안 되는 종류)',
  /await sendTextToTelegramSafe\(text\)/.test(CAP));
t('발행 상태를 건드리지 않는다 (게재 판단은 사람)',
  !/status: 'approved'/.test(CAP) && !/status: 'published'/.test(CAP));

console.log('\n=== 5. 스키마가 이중청구를 받친다 ===');
const M184 = R('supabase_migrations/184_article_fee_order_unique.sql');
t('paypal_order_id 에 부분 UNIQUE 인덱스',
  /CREATE UNIQUE INDEX IF NOT EXISTS idx_article_submissions_paypal_order/.test(M184)
  && /WHERE paypal_order_id IS NOT NULL/.test(M184));
t('paypal_authorization_id 에도 함께 걸어 둔다 (나중 AUTHORIZE 경로 대비)',
  /idx_article_submissions_paypal_authorization/.test(M184));

console.log('\n=== 6. 결제된 건은 코드로 뒤집지 않는다 ===');
const RV = CODE('api/article-submissions/[id]/review.js');
t('결제된 건을 free 로 되돌리지 않는다', /already_settled/.test(RV));
t('결제된 건을 거절하지 않는다 (환불 먼저)',
  (RV.match(/already_settled/g) || []).length >= 2,
  String((RV.match(/already_settled/g) || []).length));
t('미결제 €790 건은 승인되지 않는다', /fee_unpaid/.test(RV));

console.log('\n=== 7. 결제 버튼은 한 벌이다 ===');
const FEE = R('frontend/pap-submission-fee.js');
t('엔드포인트를 옵션으로 받는다', /opts\.endpoints \|\| \{\}/.test(FEE));
t('기본값은 종전 그대로 (에디토리얼 동작 불변)',
  /_EP\.order\s*\|\|\s*'\/api\/submissions\/paypal-order'/.test(FEE)
  && /_EP\.capture\s*\|\|\s*'\/api\/submissions\/paypal-capture'/.test(FEE)
  && /_EP\.authorize\s*\|\|\s*'\/api\/submissions\/paypal-authorize'/.test(FEE));
t('하드코딩된 엔드포인트가 fetch 에 남아 있지 않다',
  !/fetch\('\/api\/submissions\/paypal-(order|capture|authorize)'/.test(FEE));
const ST = R('frontend/submission-article-status.html');
t('현황 페이지가 공용 버튼을 쓴다 (전용 PayPal 코드를 새로 쓰지 않았다)',
  /window\.papPayOneTime\(\{/.test(ST) && !/paypal\.com\/sdk\/js/.test(ST));
t('현황 페이지가 아티클 엔드포인트를 넘긴다',
  /\/api\/article-submissions\/paypal-order/.test(ST)
  && /\/api\/article-submissions\/paypal-capture/.test(ST));
t('현황 페이지에 금액이 하드코딩돼 있지 않다 (서버가 산출한다)',
  !/79000/.test(ST));
t('결제 버튼은 홍보성·미결제·거절아님일 때만 뜬다',
  /fee_type === 'branded'/.test(ST) && /payment_status !== 'paid'/.test(ST)
  && /status !== 'rejected'/.test(ST));
t('pap-submission-fee.js 를 고쳤으니 캐시버스트를 올렸다',
  /pap-submission-fee\.js\?v=11/.test(ST)
  && /pap-submission-fee\.js\?v=11/.test(R('frontend/submission.html'))
  && /pap-submission-fee\.js\?v=11/.test(R('frontend/mypage.html')));

console.log('\n=== 8. 안내가 흐름과 맞는가 ===');
const EM = R('api/_lib/email.js');
t('€790 안내 메일 CTA 가 결제할 수 있는 화면으로 간다',
  /submission\/article\/status/.test(EM));
t('현황 페이지 라우팅이 있다', (function () {
  const v = JSON.parse(R('vercel.json'));
  return (v.rewrites || []).some((r) => r.source === '/submission/article/status'
    && r.destination === '/submission-article-status.html');
})());
t('안내 문구가 "안 내도 된다" 를 말한다 (철회 선택지가 있다)',
  /stays unpublished/.test(EM) && /게재되지 않은 채로 남/.test(EM));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ article-fee-payment tests FAILED'); process.exit(1); }
console.log('✅ article-fee-payment tests passed');
