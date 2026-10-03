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
t('2. mine.js 가 canCertificate 를 서버에서 계산 (10/3: 스탠다드부터 기본형, 연간은 검증 코드형)', /canCertificate = maxEdits > 0 \|\| !!\(await findYearlyPremiumSubscription/.test(R('api/editorials/mine.js')) && /editorials, isPremium, canCertificate/.test(R('api/editorials/mine.js')));
const mp = R('frontend/mypage.html');
t('2. 마이페이지: 인증서 버튼(연간) / 안내 링크(그 외) + 인쇄용 창', /_mpEdMeta\.canCertificate/.test(mp) && /mpOpenCertificate\(/.test(mp) && /utm_source=mypage_certificate/.test(mp) && /CERTIFICATE OF PUBLICATION/.test(mp) && /SAVE AS PDF/.test(mp));
t('2. 마이페이지 사전 9개 언어 certBtn·certLocked·certFail', ['certBtn','certLocked','certFail'].every((k) => (mp.match(new RegExp(k + ":'", 'g')) || []).length === 9));

// ── 구독 페이지 ──
const sb = R('frontend/subscribe.html');
t('구독: 연간 상자 4칸(€380·5·7·PDF) + 사전 9개 언어', /class="yp-big">7</.test(sb) && /class="yp-big">PDF</.test(sb) && ['ypCasting','ypCastingSub','ypCert','ypCertSub'].every((k) => (sb.match(new RegExp(k + ":'", 'g')) || []).length === 9));
t('구독: 프리미엄 표 연간 줄(y:true) 9개 언어 × 4', (sb.match(/y:true, text:'/g) || []).length === 36);
t('구독: ru 사전 블록이 하나(죽은 중복 제거) + 10/1 키가 살아있는 블록에', (sb.match(/ypTag:'/g) || []).length === 9 && /\nru:\{ ctaSwitchYearly:[^\n]*\n  business:'БИЗНЕС'/.test(sb));
t('구독 사전 버전 올림 (≥7)', (() => { const m = sb.match(/content="subscribe" data-v="(\d+)"/); return m && Number(m[1]) >= 7; })());
// ── 월간 지렛대 1: 화보 공개 메일에 티어시트 한 줄 (무료 회원만) ──
{
  const live = R('api/_lib/editorialLive.js');
  t('월간1. 무료 회원에게만 upsellUrl (유료는 안 판다) · utm live_mail/tearsheet', /isFree \? upsellUrl\(lang, row\.slug\) : null/.test(live) && /utm_source=live_mail&utm_medium=email&utm_campaign=tearsheet/.test(live) && /subscription_plan'\)\.eq\('id', sub\.user_id\)/.test(live));
  const { LIVE } = require('../api/_lib/editorialLiveCopy');
  t('월간1. 문구 9개 언어 dlHeading·dlBody·dlCta, 외국어에 한국어 없음', LANGS.every((l) => LIVE[l] && LIVE[l].dlHeading && LIVE[l].dlBody && LIVE[l].dlCta) && FOREIGN.every((l) => !HANGUL.test(LIVE[l].dlHeading + LIVE[l].dlBody + LIVE[l].dlCta)));
  const sbp = R('frontend/subscribe.html').match(/std_m:\s*([\d.]+)/);
  const price = sbp ? sbp[1] : '';
  t('월간1. 메일 가격이 EUR_PRICES std_m (' + price + ') 과 같다 (9개 언어)', !!price && LANGS.every((l) => (LIVE[l].dlBody + LIVE[l].dlCta).includes('€' + price) || (LIVE[l].dlBody + LIVE[l].dlCta).includes('€' + price.replace('.', ','))));
  const { templates } = require('../api/_lib/email');
  const withU = templates.editorialLive({ name: 'A' }, { title: 'T', url: 'https://x', upsellUrl: 'https://www.pap-magazine.com/subscribe?utm_source=live_mail' }, 'en');
  const noU = templates.editorialLive({ name: 'A' }, { title: 'T', url: 'https://x' }, 'en');
  t('월간1. 템플릿: upsellUrl 있을 때만 티어시트 블록', withU.html.includes('utm_source=live_mail') && withU.html.includes('Tearsheet') && !noU.html.includes('Tearsheet'));
}
// ── 월간 지렛대 2: 화보 페이지 다운로드 안내가 사실이어야 한다 (8/10 개정: 본인 작품도 스탠다드부터) ──
{
  const seo = R('api/_lib/seoRenderer.js');
  const i = seo.indexOf('const DL_T = {'); const blk = seo.slice(i, seo.indexOf('  };', i));
  t('월간2. "무료로 다운로드" 거짓 문구가 9개 언어 어디에도 없다', !/무료로 다운로드|for free|gratuitamente|gratuitement|gratis\b|無料|免费|бесплатно|kostenlos/i.test(blk));
  t('월간2. 9개 언어 모두 크리에이터 본인 화보도 스탠다드(€5.49) 안내', ['ko','en','it','fr','es','ja','de','zh','ru'].every((l) => { const m = blk.match(new RegExp(l + ": \\{ note: '([^']*)'")); return m && /€5[.,]49/.test(m[1]) && /Standard|스탠다드|スタンダード|标准/.test(m[1]); }));
  t('월간2. 구독 버튼에 출처 utm (editorial_downloads)', /href="\/subscribe\?utm_source=editorial_downloads&utm_medium=web"/.test(seo));
}
// ── 월간 지렛대 3: 크레딧 팀원 끌어오기 (90일 크레딧 370명 중 비회원 352명) ──
{
  const cs = R('frontend/pap-content-creator-shorts.js');
  t('월간3. 프로필 팝업에 Claim 상자: 브랜드·잘못된 핸들 제외, 로그인이면 마이페이지, 아니면 가입(return) + utm credit_claim', /function _renderCreditClaim\(igHandle, isBrand\)/.test(cs) && /_renderCreditClaim\(igHandle, isBrand\)/.test(cs) && /isBrand\|\|!\/\^\[a-z0-9\._\]\{2,30\}\$\/\.test\(h\)/.test(cs) && /\/auth\?mode=signup&return=/.test(cs) && /utm_source=credit_claim/.test(cs) && /\/mypage\?claim=/.test(cs));
  const sh = JSON.parse(R('frontend/i18n/ui/_shared.en.json'));
  t('월간3. Claim 문구 3개가 공용 사전 8개 언어에', ['en','de','it','fr','es','ja','zh','ru'].every((l) => { const d = JSON.parse(R('frontend/i18n/ui/_shared.' + l + '.json')); return d['이 크레딧이 당신 것인가요?'] && d['내 크레딧 가져가기']; }) && /Claim my credit/.test(sh['내 크레딧 가져가기']));
  t('월간3. 마이페이지가 ?claim= 으로 인스타 칸을 미리 채운다 (이미 등록된 아이디는 안 덮음)', /get\('claim'\)/.test(R('frontend/mypage.html')) && /if\(u\.instagram\) inp\.value=/.test(R('frontend/mypage.html')));
  t('월간3. creator-shorts 캐시버스트 ≥15 (모든 HTML)', !/pap-content-creator-shorts\.js\?v=(1[0-4]|[0-9])"/.test(fs.readdirSync(path.join(ROOT, 'frontend')).filter((f) => f.endsWith('.html')).map((f) => R('frontend/' + f)).join('\n')));
  const { LIVE } = require('../api/_lib/editorialLiveCopy');
  t('월간3. 공개 메일 "팀에게 보내기" 9개 언어 + 템플릿에 항상', LANGS.every((l) => LIVE[l] && LIVE[l].teamLine) && FOREIGN.every((l) => !HANGUL.test(LIVE[l].teamLine)) && /if \(L\.teamLine\) html \+=/.test(R('api/_lib/email.js')));
}
t('테스트 스크립트 등록', /yearly-perks-two\.test\.js/.test(R('package.json')));

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
