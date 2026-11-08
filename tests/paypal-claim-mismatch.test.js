/*
 * paypal-claim-mismatch.test.js — 결제했는데 등급이 안 올라갔을 때 **말을 한다** (2026-11-08)
 *
 * ■ 무슨 일이 있었나 (실측)
 * 한 회원이 37분 동안 PayPal 구독을 **네 번** 만들었다
 * (I-5VLWTJT34R2Y → I-S0TPMR24S6S5 → I-DSC3N4YUXACT → I-V4XUBEFLLY93).
 * 사기도 결제 버그도 아니었다. 그 회원은 PAP 계정이 두 개였고, 로그인한 계정과
 * PayPal 계정의 이메일이 서로 달랐다. 웹훅(api/paypal-webhook.js resolveUserId)은
 * 브라우저가 심는 custom_id 를 **일부러 믿지 않고**(위조 가능) 결제자 이메일 쪽
 * 계정을 택한다. 그래서 결제는 매번 다른 계정에 붙었고, 그가 보던 화면은 계속 무료였다.
 *
 * 결정적인 건 화면이 **아무 말도 안 했다**는 점이다. _waitUpgradeThenGo 는
 * 1.5초×8번(12초)만 기다린 뒤 **성공이든 실패든 똑같이** /mypage 로 보냈다.
 * 결제한 사람에게는 "돈은 나갔는데 아무 일도 안 일어남" 으로 보인다. 그래서 다시 낸다.
 *
 * 선례가 이미 있었다 — pap-api.js 주석의 2026-08-07 lia.line 건: 버튼 이중 클릭으로
 * 구독 2건이 생겨 €8.99 가 두 번 청구됐는데 우리 DB 에는 1건만 남아 아무도 몰랐다.
 * 같은 뿌리다. **중복 청구가 실제 피해이고, 그걸 막는 건 한 줄의 안내다.**
 *
 * ■ 이 테스트가 지키는 계약
 *  1) 12초가 지나도 반영이 없으면 **조용히 리디렉트하지 않는다.**
 *  2) 이유를 물어볼 수 있게 onApprove 가 subscriptionID 를 넘긴다.
 *  3) 조회 엔드포인트는 인증·레이트리밋을 거치고, 상태 한 단어만 돌려준다.
 *  4) **어느 계정에 붙었는지는 절대 돌려주지 않는다** — 이메일도 user_id 도.
 *     구독 id 만으로는 '그 결제의 주인' 임이 증명되지 않아 열거 공격의 창구가 된다.
 *  5) 안내 문구는 9개 언어 전부에 있고, 전부 문의처를 포함한다(프런트 언어 정책).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); }
}

const API = R('api/subscriptions/paypal-claim-check.js');
const FE = R('frontend/pap-api.js');

// ───────────────────────────────────────────────────────────────
console.log('\n=== 1. 조회 엔드포인트의 기본 방어 ===');
t('파일이 있다', fs.existsSync(path.join(ROOT, 'api/subscriptions/paypal-claim-check.js')));
t('CORS 를 거친다', /handleCors\(req, res\)/.test(API));
t('레이트리밋을 거친다', /rateLimit\(req, res, RATE_LIMITS\.api\)/.test(API));
t('로그인을 요구한다', /requireAuth\(req, res\)/.test(API));
t('GET 외에는 405', /req\.method !== 'GET'/.test(API));
t('service_role 로 조회한다', /supabaseAdmin/.test(API));
t('PayPal API 를 부르지 않는다 (불필요한 외부 왕복 없음)',
  !/api[-.]m?\.?paypal\.com|PAYPAL_API_BASE/.test(API));

console.log('=== 2. 구독 id 형식 검사 — 실제로 돌려서 잰다 ===');
const m = API.match(/function validSubId\(v\)\s*\{[\s\S]*?\n\}/);
t('validSubId 소스를 뽑을 수 있다', !!m);
if (m) {
  // eslint-disable-next-line no-new-func
  const validSubId = new Function(m[0] + '; return validSubId;')();
  t('정상 id 통과', validSubId('I-V4XUBEFLLY93') === true);
  t('소문자도 통과', validSubId('i-v4xubeflly93') === true);
  for (const bad of ['', null, undefined, 'X-123', 'I-', 'I-abc', "I-' or 1=1--",
                     'I-AAAAAAAA,I-BBBBBBBB', 'I-AAAAAAAA)', 'I-' + 'A'.repeat(64)]) {
    t('거부: ' + JSON.stringify(bad), validSubId(bad) === false);
  }
  /* 이 값이 .or() 필터 문자열에 그대로 들어가므로, 쉼표·괄호가 통과하면
     PostgREST 필터를 비틀 수 있다. 위 거부 목록이 그걸 막는다. */
}

console.log('=== 3. 다른 계정 정보를 흘리지 않는다 (privacy) ===');
const otherBranch = (API.match(/other_account[\s\S]{0,200}/) || [''])[0];
t("other_account 응답에 email 이 없다", !/email/i.test(otherBranch), otherBranch.slice(0, 120));
t("other_account 응답에 user_id 가 없다", !/user_id/.test(otherBranch), otherBranch.slice(0, 120));
t('응답은 status 세 가지뿐', /'ok'/.test(API) && /'other_account'/.test(API) && /'pending'/.test(API));
t('왜 안 흘리는지 근거가 적혀 있다', /열거 공격|enumerat/i.test(API));
t('에러 응답에 원문 에러를 싣지 않는다 (api 규칙)',
  !/err\.message/.test(API.split('return res.status(500)')[1] || '') && /code: 'claim_check_failed'/.test(API));

// ───────────────────────────────────────────────────────────────
console.log('=== 4. 프런트 — 조용한 리디렉트를 없앴다 ===');
t('onApprove 가 subscriptionID 를 받는다', /onApprove: function \(data\)/.test(FE));
t('구독 id 를 꺼내 둔다', /data\.subscriptionID/.test(FE));
t('_waitUpgradeThenGo 에 넘긴다', /_waitUpgradeThenGo\(_subId\)/.test(FE));
t('_waitUpgradeThenGo 가 id 를 받는다', /function _waitUpgradeThenGo\(subId\)/.test(FE));
t('_explainNoUpgrade 가 있다', /function _explainNoUpgrade\(subId\)/.test(FE));
t('소진 시 안내로 간다 (리디렉트 아님)',
  /if \(tries >= 8\) \{ _explainNoUpgrade\(subId\); return; \}/.test(FE));
t('성공했을 때만 /mypage 로 보낸다',
  !/if \(up \|\| tries >= 8\) \{ window\.location\.href = '\/mypage'; return; \}/.test(FE),
  '옛 코드가 되살아났다 — 실패도 성공처럼 보내던 그 줄이다');
t('claim-check 를 호출한다', /\/subscriptions\/paypal-claim-check\?subscription_id=/.test(FE));
t('구독 id 를 URL 인코딩한다', /encodeURIComponent\(subId\)/.test(FE));
t('문구를 textContent 로 넣는다 (HTML 해석 금지)', /w\.textContent = msg/.test(FE));
t('조회가 실패해도 안내는 뜬다 (fail-closed)', /\.catch\(function \(\) \{ show\(_ppT\('notYet'\)\); \}\)/.test(FE));
t('오버레이가 닫혀 있어도 최소한 말은 한다', /alert\(msg\)/.test(FE));
t('닫기 버튼이 결제 잠금을 푼다', /_papCheckoutBusy = false/.test(FE));

// ───────────────────────────────────────────────────────────────
console.log('=== 5. 9개 언어 안내 문구 (프런트 언어 정책) ===');
const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
const dict = FE.match(/var _PP_I18N = \{[\s\S]*?\n  \};/);
t('_PP_I18N 사전을 찾았다', !!dict);
const D = dict ? dict[0] : '';
for (const L of LANGS) {
  const line = (D.match(new RegExp("\\n    " + L + ":\\{[\\s\\S]*?\\n", 'm')) || [''])[0];
  t(L + ' — notYet 있음', /notYet:'/.test(line), line.slice(0, 80));
  t(L + ' — otherAccount 있음', /otherAccount:'/.test(line), line.slice(0, 80));
  t(L + ' — 문의처가 들어 있다', (line.match(/contact@pap-magazine\.com/g) || []).length >= 2,
    '두 문구 모두 문의처를 포함해야 한다');
}
t('빈 문구가 없다', !/notYet:''/.test(D) && !/otherAccount:''/.test(D));

// ───────────────────────────────────────────────────────────────
console.log('=== 6. 캐시버스트 (프런트 규칙: pap-*.js 는 참조 HTML 과 함께 올린다) ===');
const htmls = fs.readdirSync(path.join(ROOT, 'frontend'))
  .filter((f) => f.endsWith('.html'))
  .filter((f) => /pap-api\.js\?v=/.test(R('frontend/' + f)));
t('pap-api.js 를 참조하는 HTML 을 찾았다 (9개 이상)', htmls.length >= 9, String(htmls.length));
let stale = [];
for (const f of htmls) {
  const v = (R('frontend/' + f).match(/pap-api\.js\?v=(\d+)/) || [])[1];
  if (Number(v) < 20) stale.push(f + '(v' + v + ')');
}
t('전부 v20 이상', stale.length === 0, stale.join(', ') + ' — 안 올리면 옛 코드가 서빙된다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ paypal-claim-mismatch tests FAILED'); process.exit(1); }
console.log('✅ paypal-claim-mismatch tests passed');
