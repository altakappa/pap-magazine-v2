'use strict';
/**
 * 연간 프리미엄 혜택 2종 (2026-10-02, 도메니코 "응 그렇게해줘")
 *  1. 캐스팅 콜 7일 선공개: 관리자 입력 → 연간 프리미엄에게 각자 언어 메일 → 7일 뒤 서브미션 페이지 공개
 *  2. 게재 인증서: 연간 프리미엄만 발급, 검증 코드(HMAC)는 누구나 확인
 *  + 구독 페이지 혜택 상자·플랜 표 9개 언어, 죽은 ru 사전 블록 제거(10/1 키가 거기 들어가 있었다)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }
const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
const FOREIGN = LANGS.filter((l) => l !== 'ko');
const HANGUL = /[가-힣]/;

// ── 1. 캐스팅 콜 ──
t('1. 마이그레이션 175 casting_calls (RLS 켬)', /create table if not exists public\.casting_calls/.test(R('supabase_migrations/175_casting_calls.sql')) && /enable row level security/.test(R('supabase_migrations/175_casting_calls.sql')));
const lib = R('api/_lib/castingCall.js');
t('1. lib: 7일 선공개 · 한 번만 보냄(sent_at 잠금) · 연간 프리미엄만 수신', /EARLY_DAYS = 7/.test(lib) && /\.is\('sent_at', null\)/.test(lib) && /isYearlyPremiumRow\(r\)/.test(lib));
t('1. lib: 공개 판정은 viewerYearly ? early_at : public_at', /viewerYearly \|\| String\(r\.public_at\) <= nowIso/.test(lib) && /teaser: true/.test(lib));
const adm = R('api/admin/casting-calls.js');
t('1. 관리자 API: requireAdmin · POST 저장+발송 · public_at = +7일', /requireAdmin\(req, res\)/.test(adm) && /EARLY_DAYS \* 24 \* 60 \* 60 \* 1000/.test(adm) && /sendCastingCall\(row/.test(adm));
const pub = R('api/casting-calls/current.js');
t('1. 공개 API: 토큰 선택 · 연간이면 미리 · rateLimit', /verifyToken\(req\)/.test(pub) && /findYearlyPremiumSubscription/.test(pub) && /rateLimit\(req, res, RATE_LIMITS\.api\)/.test(pub));
const { CC } = require('../api/_lib/castingCallCopy');
t('1. 메일 문구 9개 언어 × 6키, 외국어에 한국어 없음', LANGS.every((l) => CC[l] && ['subject','heading','intro','deadline','cta','why'].every((k) => CC[l][k])) && FOREIGN.every((l) => Object.values(CC[l]).every((v) => !HANGUL.test(v))));
t('1. email.js 템플릿 castingCall + one-language 테스트 등록', /castingCall\(user, info, lang\)/.test(R('api/_lib/email.js')) && /castingCall: \(l\) => templates\.castingCall/.test(R('tests/email-one-language.test.js')));
const sub = R('frontend/submission.html');
t('1. 서브미션 페이지: 상자 + 로더 + setLang 뒤 호출', /id="castingCallBox" hidden/.test(sub) && /function loadCastingCall\(\)/.test(sub) && /setLang\(saved\);\n  try\{ loadCastingCall\(\); \}/.test(sub) && /\/api\/casting-calls\/current\?lang=/.test(sub));
t('1. 서브미션 사전 9개 언어 ccKicker·ccEarly·ccDeadline·ccTeaser·ccTeaserCta', ['ccKicker','ccEarly','ccDeadline','ccTeaser','ccTeaserCta'].every((k) => (sub.match(new RegExp(k + ":'", 'g')) || []).length === 9));
const adminHtml = R('frontend/admin.html'), adminJs = R('frontend/pap-admin.js');
t('1. 관리자 화면: 캐스팅 콜 탭 + 로더 + 캐시버스트', /go\('casting',this\)/.test(adminHtml) && /id="t-casting"/.test(adminHtml) && /if\(id==='casting'\) loadCastingCalls\(\);/.test(adminJs) && /async function submitCastingCall/.test(adminJs) && /pap-admin\.js\?v=(16[4-9]|1[7-9]\d|[2-9]\d\d)/.test(adminHtml));

// ── 2. 게재 인증서 ──
const cert = R('api/editorials/certificate.js');
t('2. 인증서 API: HMAC 코드 · 소유 판정(submissions.user_id) · 연간 프리미엄 게이트 · 공개 검증', /createHmac\('sha256', secret\)/.test(cert) && /owned\.ownerId !== user\.id/.test(cert) && /findYearlyPremiumSubscription\(supabaseAdmin, user\.id\)/.test(cert) && /timingSafeEqual/.test(cert) && /req\.query\.verify !== undefined/.test(cert));
t('2. 인증서 검증 페이지는 noindex HTML', /name="robots" content="noindex"/.test(cert) && /text\/html; charset=utf-8/.test(cert));
t('2. mine.js 가 canCertificate 를 서버에서 계산', /canCertificate = !!\(await findYearlyPremiumSubscription/.test(R('api/editorials/mine.js')) && /editorials, isPremium, canCertificate/.test(R('api/editorials/mine.js')));
const mp = R('frontend/mypage.html');
t('2. 마이페이지: 인증서 버튼(연간) / 안내 링크(그 외) + 인쇄용 창', /_mpEdMeta\.canCertificate/.test(mp) && /mpOpenCertificate\(/.test(mp) && /utm_source=mypage_certificate/.test(mp) && /CERTIFICATE OF PUBLICATION/.test(mp) && /SAVE AS PDF/.test(mp));
t('2. 마이페이지 사전 9개 언어 certBtn·certLocked·certFail', ['certBtn','certLocked','certFail'].every((k) => (mp.match(new RegExp(k + ":'", 'g')) || []).length === 9));

// ── 구독 페이지 ──
const sb = R('frontend/subscribe.html');
t('구독: 연간 상자 4칸(€380·5·7·PDF) + 사전 9개 언어', /class="yp-big">7</.test(sb) && /class="yp-big">PDF</.test(sb) && ['ypCasting','ypCastingSub','ypCert','ypCertSub'].every((k) => (sb.match(new RegExp(k + ":'", 'g')) || []).length === 9));
t('구독: 프리미엄 표 연간 줄(y:true) 9개 언어 × 4', (sb.match(/y:true, text:'/g) || []).length === 36);
t('구독: ru 사전 블록이 하나(죽은 중복 제거) + 10/1 키가 살아있는 블록에', (sb.match(/ypTag:'/g) || []).length === 9 && /\nru:\{ ctaSwitchYearly:[^\n]*\n  business:'БИЗНЕС'/.test(sb));
t('구독 사전 버전 올림 (≥7)', (() => { const m = sb.match(/content="subscribe" data-v="(\d+)"/); return m && Number(m[1]) >= 7; })());
t('테스트 스크립트 등록', /yearly-perks-two\.test\.js/.test(R('package.json')));

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
