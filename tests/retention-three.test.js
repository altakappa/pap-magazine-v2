'use strict';
/**
 * 유료 유지·전환 3종 (2026-09-29, 도메니코 "일단 세개 진행해줘").
 * 근거(9/29 실측): 유료 활성 13 · 8월 가입 10명 중 둘째 달 갱신 2명 · 잠금 팝업 3,985 → 구독 페이지 587 · 연간 0.
 *  1. 해지 사유 한 문항: 마이페이지 확인창 → 모달(강제 아님), paypal-portal 이 whitelist 로 받아 표에 기록(fail-open)
 *  2. 잠금 팝업 A/B: 변형 고정(localStorage), 문구 2종, view·cta 를 path '?lp=a|b' 로 기록, 가격은 subscribe 와 같게
 *  3. 제출 완료 화면 연간 업셀: 9개 언어, 링크는 연간 탭이 켜진 채(?billing=yearly)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }
const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
const HANGUL = /[가-힣]/;

// ── 1. 해지 사유 ──────────────────────────────────────────────────────
const portal = R('api/subscriptions/paypal-portal.js');
t('portal: 사유 whitelist 5종 + skipped', /CANCEL_REASONS = new Set\(\['one_editorial', 'price', 'not_using', 'missing_feature', 'other'\]\)/.test(portal) && /return CANCEL_REASONS\.has\(s\) \? s : 'skipped'/.test(portal));
t('portal: 메모 300자 자르기', /slice\(0, 300\)/.test(portal));
t('portal: 성공·이미 해지 세 갈래 모두 기록', (portal.match(/await recordCancelReason\(user\.id, row, reason, note\)/g) || []).length === 3);
t('portal: 기록 실패는 해지를 막지 않음 (fail-open)', /cancel reason 기록 실패\(무시\)/.test(portal) && /catch \(e\)[\s\S]{0,120}cancel reason 예외\(무시\)/.test(portal));
t('portal: plan 도 select', /select\('paypal_subscription_id, provider, status, current_period_end, plan'\)/.test(portal));
t('마이그레이션 172 파일', fs.existsSync(path.join(ROOT, 'supabase_migrations/172_subscription_cancel_reasons.sql')) && /subscription_cancel_reasons/.test(R('supabase_migrations/172_subscription_cancel_reasons.sql')));
const api = R('frontend/pap-api.js');
t('pap-api: cancelIntlSubscription(opts) 가 reason·note 를 보냄', /cancelIntlSubscription\(opts\)/.test(api) && /action: 'cancel', reason: o\.reason \|\| null, note: o\.note \|\| null/.test(api));
const mp = R('frontend/mypage.html');
t('mypage: confirm() 대신 모달', !/if\(!confirm\(_mpCancT\('confirm'\)\)\) return;/.test(mp) && /var _cr = await _mpAskCancelReason\(\)/.test(mp) && /cancelIntlSubscription\(_cr\)/.test(mp));
const rm = mp.match(/var _MP_CANCEL_REASON_I18N = (\{[\s\S]*?\n\});/);
let RI = null; try { RI = vm.runInNewContext('(' + rm[1] + ')'); } catch (e) { RI = null; }
t('mypage: 사유 사전 9개 언어 × 8키', !!RI && LANGS.every((l) => RI[l] && ['q','r1','r2','r3','r4','r5','ph','keep'].every((k) => typeof RI[l][k] === 'string' && RI[l][k].trim())));
t('mypage: 외국어 칸에 한국어 없음', !!RI && LANGS.filter((l) => l !== 'ko').every((l) => Object.values(RI[l]).every((v) => !HANGUL.test(v))));
t('mypage: 강제 아님 (안 골라도 해지, 계속 이용하기 버튼이 기본 흰색)', /reason: sel\?sel\.value:null/.test(mp) && /id="mpCancelKeep" style="background:#fff/.test(mp));
t('mypage: 해지 버튼은 계정 정보 카드 끝 (마이페이지 안, 1클릭, 문구·대비 그대로) — 여기가 마지막 선', /querySelector\('#mp-account \.mp-card'\)/.test(mp) && !/querySelector\('#mpSubCard \.mp-sub-card-v2'\)/.test(mp) && /font-size:13px[^']*color:rgba\(255,255,255,\.78\)[^']*text-decoration:underline/.test(mp) && /b\.textContent = _mpCancT\('btn'\)/.test(mp));
t('mypage: 해지 버튼 문구 그대로 (§ 312k)', /id="mpCancelGo"[^>]*>'\+esc\(_mpCancT\('btn'\)\)/.test(mp));

// ── 2. 잠금 팝업 A/B ───────────────────────────────────────────────────
const ps = R('frontend/pap-subscription.js');
t('팝업: 변형 고정 함수 (a|b, localStorage)', /function _papLockedVariant\(\)/.test(ps) && /localStorage\.getItem\('pap-lp-variant'\)/.test(ps) && /Math\.random\(\) < 0\.5 \? 'a' : 'b'/.test(ps));
t('팝업: B 문구 3종 (비회원·스탠다드·프리미엄) ko/en', /무료 가입은 30초, 최신 화보 10편은 바로 열립니다/.test(ps) && /Free sign-up takes 30 seconds/.test(ps) && /면 이 화보와 ' \+ cut \+ ' 이후 모든 화보가 열립니다/.test(ps) && /this editorial and the full archive since 2019 open/.test(ps));
t('팝업: view·cta 를 ?lp=변형 으로 기록', /_papFunnelStep\('locked_popup_view', '\?lp=' \+ v\)/.test(ps) && /_papFunnelStep\('locked_popup_cta', '\?lp=' \+ v\)/.test(ps));
t('팝업: CTA 링크에 utm_content=lp_변형', /utmC = '&utm_content=lp_' \+ v/.test(ps) && (ps.match(/&utm_medium=web' \+ utmC/g) || []).length === 3);
t('팝업: _papFunnelStep 이 path 접미사를 받음', /function _papFunnelStep\(step, pathSuffix\)/.test(ps) && /location\.pathname \+ \(pathSuffix \|\| ''\)/.test(ps));
const sub = R('frontend/subscribe.html');
const eur = sub.match(/var EUR_PRICES = \{[^}]*std_m:([\d.]+),\s*prem_m:([\d.]+)/);
t('팝업 B 가격 = subscribe.html EUR_PRICES (월 €5.49 · €8.99 리터럴)', !!eur && new RegExp('월 €' + eur[1].replace('.', '\\.') + '면 이 화보와').test(ps) && new RegExp('월 €' + eur[2].replace('.', '\\.') + '면 이 화보와 2019년').test(ps) && new RegExp('€' + eur[1].replace('.', '\\.') + '로 지금 열기').test(ps), eur && (eur[1] + '/' + eur[2]));
const step = R('api/funnel/step.js');
t('funnel/step: locked_popup_cta 허용', /'locked_popup_cta'/.test(step));
const htmls = fs.readdirSync(path.join(ROOT, 'frontend')).filter((f) => f.endsWith('.html'));
const refs = htmls.map((f) => R('frontend/' + f)).join('\n');
t('캐시버스트: pap-subscription.js?v=7 로 통일', !/pap-subscription\.js\?v=6\b/.test(refs) && (refs.match(/pap-subscription\.js\?v=7\b/g) || []).length >= 10);
t('캐시버스트: pap-api.js?v=17 로 통일', !/pap-api\.js\?v=16\b/.test(refs) && (refs.match(/pap-api\.js\?v=17\b/g) || []).length >= 9);
const BKO = ['무료 가입은 30초, 최신 화보 10편은 바로 열립니다', '30초 만에 무료 가입', '월 €5.49면 이 화보와 {0} 이후 모든 화보가 열립니다', '€5.49로 지금 열기', '월 €8.99면 이 화보와 2019년부터의 모든 아카이브가 열립니다', '€8.99로 지금 열기'];
t('_shared 사전 7개 언어에 B 문구 6개', ['de','it','fr','es','ja','zh','ru'].every((l) => { const d = JSON.parse(R('frontend/i18n/ui/_shared.' + l + '.json')); return BKO.every((k) => d[k] && !HANGUL.test(d[k])) && /\{0\}/.test(d[BKO[2]]); }));
t('index.html 사전 버전 올림 (≥9)', Number((R('frontend/index.html').match(/content="index" data-v="(\d+)"/) || [])[1]) >= 9);

// ── 3. 제출 완료 연간 업셀 ─────────────────────────────────────────────
const sm = R('frontend/submission.html');
t('제출 완료: 링크가 연간 탭으로 (billing=yearly + utm_content=annual)', /href="\/subscribe\?utm_source=submission_done&utm_medium=site&utm_content=annual&billing=yearly"/.test(sm));
const kicker = (sm.match(/successPremKicker:'((?:[^'\\]|\\.)*)'/g) || []);
const desc = (sm.match(/successPremDesc:'((?:[^'\\]|\\.)*)'/g) || []);
t('제출 완료: successPrem 3키가 9개 언어 (사전에 9번씩)', kicker.length === 9 && desc.length === 9 && (sm.match(/successPremCta:'/g) || []).length === 9);
t('제출 완료: 연간 혜택 4가지 (€380 면제·공동작업자 5·풀레터·€89.90) ko/en', /€380 유료 서브미션이 1년에 1회 면제/.test(sm) && /공동작업자 5명/.test(sm) && /waives one €380 paid submission per year/.test(sm) && /5 Instagram collaborators/.test(sm) && (sm.match(/€89\.90/g) || []).length >= 4);
t('제출 완료: 옛 "FOR CREATIVE TEAMS" 문구 없음', !/FOR CREATIVE TEAMS/.test(sm) && !/Explore Premium'/.test(sm));
t('제출 완료: 외국어 desc 에 한국어 없음', desc.slice(1).every((d) => !HANGUL.test(d) || /^successPremDesc:'연간/.test(d)) && desc.filter((d) => HANGUL.test(d)).length === 1);
t('submission 사전 버전 올림 (≥11)', Number((sm.match(/content="submission" data-v="(\d+)"/) || [])[1]) >= 11);
t('subscribe.html: ?billing=yearly 면 연간 탭', /get\('billing'\)==='yearly' \? 'yearly' : 'monthly'/.test(sub));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
