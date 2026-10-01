'use strict';
/**
 * 유료 전환 장치 5종 (2026-10-01, 도메니코 "2번은 어려운거같고 나머지는 추가할까?").
 *  1. subscribe_view 가 어느 문(utm_source)으로 왔는지 path 에 남긴다
 *  3. 연간 혜택 상자 앵커 한 줄 (€380 면제 = 연간 4년치보다 큼) · 4. 안심 한 줄 (언제든 해지, 남은 기간 유지) — 9개 언어
 *  5. 쉬어가기(PayPal suspend)/다시 시작(activate): 포털 action, 모달 버튼, 쉬는 중 화면, 만료 스윕 'paused'
 *  6. 월간 2번째 결제 → 연간 제안 메일 한 번(yearlyOffer) · 새 구독 활성화 시 이전 PayPal 구독 자동 해지 · 구독 페이지 '연간으로 바꾸기'
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }
const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
const HANGUL = /[가-힣]/;

(async () => {
// 1
const sb = R('frontend/subscribe.html');
t('1. subscribe_view path 에 utm_source (영문·숫자·밑줄 40자 이내만)', /step:'subscribe_view',source:src,path:location\.pathname\+\(\/\^\[a-z0-9_\]\{1,40\}\$\/\.test\(utm\)\?'\?utm_source='\+utm:''\)/.test(sb));

// 3·4
const cnt = (k) => (sb.match(new RegExp('\\b' + k + ":'", 'g')) || []).length;
t('3. 앵커 ypWaiverAnchor 9개 언어 + 자리', cnt('ypWaiverAnchor') === 9 && /data-i18n="ypWaiverAnchor"/.test(sb));
t('3. 앵커 숫자가 사실 (€380 > €89.90×4=€359.60)', 380 > 89.90 * 4 && /연간 구독료 4년치보다 큽니다/.test(sb) && /four years of the yearly fee/.test(sb));
t('4. 안심 cancelAnytime 9개 언어 + 결제 안내 아래', cnt('cancelAnytime') === 9 && /<p class="payment-note" data-i18n="cancelAnytime"/.test(sb) && /언제든 마이페이지에서 해지할 수 있고, 이미 결제한 기간은 그대로 이용합니다/.test(sb));
t('3·4. subscribe 사전 8개 언어에 한국어 키', ['en','de','it','fr','es','ja','zh','ru'].every((l) => { const d = JSON.parse(R('frontend/i18n/ui/subscribe.' + l + '.json')); return d['면제 1회(€380)가 연간 구독료 4년치보다 큽니다'] && d['언제든 마이페이지에서 해지할 수 있고, 이미 결제한 기간은 그대로 이용합니다.'] && d['연간으로 바꾸기'] && !HANGUL.test(d['연간으로 바꾸기']); }));
t('subscribe 사전 버전 올림 (≥6)', Number((sb.match(/content="subscribe" data-v="(\d+)"/) || [])[1]) >= 6);

// 5
const portal = R('api/subscriptions/paypal-portal.js');
t('5. 포털: pause/resume action 허용, 다른 건 400', /action !== 'cancel' && action !== 'pause' && action !== 'resume'/.test(portal) && /handlePauseResume\(req, res, user, action, reason, note\)/.test(portal));
t('5. 포털: PayPal suspend/activate 호출, 등급(profiles)은 안 건드림', /const verb = action === 'pause' \? 'suspend' : 'activate'/.test(portal) && !/from\('profiles'\)\.update/.test(portal.slice(portal.indexOf('async function handlePauseResume'), portal.indexOf('async function getAccessToken'))));
t('5. 포털: 쉬어가기도 사유 표에 action=pause 로 기록', /recordCancelReason\(user\.id, row, reason, note, 'pause'\)/.test(portal) && /action: action \|\| 'cancel'/.test(portal));
t('5. 마이그레이션 173 (action 열) · 174 (yearly_offer_sent_at)', fs.existsSync(path.join(ROOT, 'supabase_migrations/173_cancel_reasons_action.sql')) && fs.existsSync(path.join(ROOT, 'supabase_migrations/174_yearly_offer_sent.sql')));
t('5. 만료 스윕: paused 는 등급만 내리고 status 는 그대로(재개 가능)', /if \(String\(row\.status\) !== 'paused'\) \{/.test(R('api/cron/subscription-expiry-sweep.js')));
t('5. 만료 스윕이 paused 도 본다', /\['active', 'trialing', 'past_due', 'payment_failed', 'canceled', 'paused'\]/.test(R('api/cron/subscription-expiry-sweep.js')));
const api = R('frontend/pap-api.js');
t('5. pap-api: pauseIntlSubscription / resumeIntlSubscription', /async pauseIntlSubscription\(opts\)/.test(api) && /action: 'pause', reason: o\.reason \|\| null/.test(api) && /async resumeIntlSubscription\(\)/.test(api) && /action: 'resume'/.test(api));
const mp = R('frontend/mypage.html');
const pm = mp.match(/var _MP_PAUSE_I18N = (\{[\s\S]*?\n\});/);
let PI = null; try { PI = require('vm').runInNewContext('(' + pm[1] + ')'); } catch (e) { PI = null; }
t('5. 마이페이지: 쉬어가기 사전 9개 언어 × 6키, 외국어에 한국어 없음', !!PI && LANGS.every((l) => PI[l] && ['pause','pauseHint','paused','resume','pauseDone','resumeDone'].every((k) => PI[l][k])) && LANGS.filter((l) => l !== 'ko').every((l) => Object.values(PI[l]).every((v) => !HANGUL.test(v))));
t('5. 마이페이지: 해지 창에 쉬어가기 버튼 + 안내, 해지 버튼은 그대로', /id="mpCancelPause"/.test(mp) && /_mpPauseT\('pauseHint'\)/.test(mp) && /id="mpCancelGo"/.test(mp) && /pick\('pause'\)/.test(mp) && /pick\('cancel'\)/.test(mp));
t('5. 마이페이지: 쉬는 중이면 같은 자리에 다시 시작 버튼', /if\(st === 'paused'\)/.test(mp) && /id = 'mpResumeSubBtn'/.test(mp) && /resumeIntlSubscription\(\)/.test(mp));
t('5. 마이페이지: free 로 내려간 뒤에도 쉬는 중이면 다시 시작 버튼만', /mpMaybeShowCancel\(\{ onlyPaused: true \}\)/.test(mp) && /if\(opts\.onlyPaused\) return;/.test(mp));
t('5. 마이페이지: pause 선택 시 pauseIntlSubscription 호출', /if\(_cr\.action === 'pause'\)/.test(mp) && /pauseIntlSubscription\(_cr\)/.test(mp));

// 6
const yo = require(path.join(ROOT, 'api/_lib/yearlyOffer.js'));
t('6. 월간 판정 / REGULAR 주기 수', yo.isMonthlyPlan('premium_monthly') && !yo.isMonthlyPlan('premium_yearly') && yo.regularCycles({ billing_info: { cycle_executions: [{ tenure_type: 'TRIAL', cycles_completed: 1 }, { tenure_type: 'REGULAR', cycles_completed: 2 }] } }) === 2);
t('6. 제안 링크: 연간 탭 + utm', /billing=yearly&utm_source=renewal_mail&utm_medium=email&utm_campaign=yearly_offer/.test(yo.offerUrl('en')) && yo.offerUrl('it').indexOf('/it/subscribe') > 0);
// 가짜 DB 로 "한 번만" 과 "첫 결제는 제외" 검사
function fakeDb(row, profile, claimOk) {
  const calls = [];
  const q = (table) => ({
    update(v) { calls.push(['update', table, v]); return { eq() { return { is() { return { select: async () => ({ data: claimOk ? [{ user_id: 'u' }] : [], error: null }) }; }, eq: async () => ({ data: null, error: null }) }; } }; },
    select() { return { eq() { return { maybeSingle: async () => ({ data: profile }) }; } }; },
  });
  return { from: q, calls };
}
const subRenew = { billing_info: { cycle_executions: [{ tenure_type: 'REGULAR', cycles_completed: 2 }], next_billing_time: '2026-11-01T00:00:00Z' } };
const subFirst = { billing_info: { cycle_executions: [{ tenure_type: 'REGULAR', cycles_completed: 1 }] } };
let sent = [];
const deps = (db) => ({ db, sendEmail: async (to, tpl) => { sent.push({ to, subject: tpl.subject }); return { sent: true }; }, templates: require(path.join(ROOT, 'api/_lib/email')).templates, resolveEmailLang: () => 'en' });
const row = { user_id: 'u', plan: 'premium_monthly', paypal_subscription_id: 'I-1', current_period_end: '2026-11-01' };
let r1 = await yo.maybeSendYearlyOffer(subFirst, row, deps(fakeDb(row, { email: 'a@b.c' }, true)));
t('6. 첫 결제(REGULAR 1회)에는 안 보냄', r1.skipped === 'first_payment' && sent.length === 0);
let r2 = await yo.maybeSendYearlyOffer(subRenew, row, deps(fakeDb(row, { email: 'a@b.c', name: 'Mina' }, true)));
t('6. 2번째 결제에 한 통, 제목은 연간 제안, 날짜 치환', r2.sent === true && sent.length === 1 && /two months free/.test(sent[0].subject));
let r3 = await yo.maybeSendYearlyOffer(subRenew, Object.assign({}, row, { yearly_offer_sent_at: '2026-10-01' }), deps(fakeDb(row, { email: 'a@b.c' }, true)));
t('6. 이미 보냈으면 안 보냄', r3.skipped === 'already_sent' && sent.length === 1);
let r4 = await yo.maybeSendYearlyOffer(subRenew, row, deps(fakeDb(row, { email: 'a@b.c' }, false)));
t('6. 도장을 못 찍으면(동시 실행) 안 보냄', r4.skipped === 'already_sent' && sent.length === 1);
const copy = require(path.join(ROOT, 'api/_lib/yearlyOfferCopy.js')).OFFER;
t('6. 메일 문구 9개 언어 × 5키, 외국어에 한국어 없음, 남은 날 손실을 숨기지 않음', LANGS.every((l) => copy[l] && ['subject','heading','body1','body2','cta'].every((k) => copy[l][k])) && LANGS.filter((l) => l !== 'ko').every((l) => !HANGUL.test(Object.values(copy[l]).join(''))) && /\{date\}/.test(copy.ko.body2) && /다음 결제일/.test(copy.ko.body2) && /next billing date/.test(copy.en.body2));
const tpl = require(path.join(ROOT, 'api/_lib/email')).templates.yearlyOffer({ name: 'Mina' }, { url: 'https://x/subscribe?billing=yearly', date: '2026-11-01' }, 'en');
t('6. 템플릿: 버튼 링크·날짜 들어감', /https:\/\/x\/subscribe\?billing=yearly/.test(tpl.html) && /2026-11-01/.test(tpl.html) && /Switch to yearly/.test(tpl.subject));
const wh = R('api/paypal-webhook.js');
t('6. 웹훅: 갱신 결제(PAYMENT.SALE.COMPLETED) 뒤 연간 제안 시도, 실패해도 갱신 처리 유지', /maybeSendYearlyOffer\(sub, row, \{ db: supabaseAdmin/.test(wh) && /연간 제안 건너뜀/.test(wh));
t('6. 웹훅: 새 구독 활성화 시 같은 회원의 다른 PayPal 구독 해지 (이중 청구 방지)', /async function cancelOtherPaypalSub\(oldId, newId, userId\)/.test(wh) && /prev\.paypal_subscription_id !== sub\.id/.test(wh) && /\['active', 'past_due', 'paused', 'pending'\]\.includes/.test(wh) && /r\.status === 204 \|\| r\.status === 422/.test(wh));
t('6. 웹훅: 같은 구독 id 면 해지 안 함', /if \(!oldId \|\| !newId \|\| oldId === newId\) return \{ skipped: 'same' \}/.test(wh));
t('6. 구독 페이지: 월간 이용자 + 연간 탭 → 연간으로 바꾸기 + 손실 안내 (9개 언어)', /function _monthlyToYearly\(\)/.test(sb) && /ctaSwitchYearly/.test(sb) && cnt('ctaSwitchYearly') === 9 && cnt('switchYearlyNote') === 9 && /id="switchYearlyNote"/.test(sb) && /_loadSubInfo\(\);/.test(sb) && /남은 날은 사라집니다/.test(sb));
t('6. 구독 페이지: 탭 바꿀 때 다시 판정', /_applyTrialCta\(\);\n  try\{ _markCurrentPlan\(\); \}catch\(_\)\{\}/.test(sb));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
