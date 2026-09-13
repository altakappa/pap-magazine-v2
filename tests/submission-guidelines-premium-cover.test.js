/**
 * 서브미션 가이드라인 개정 + 프리미엄 커버 선택 + 가이드라인 동의 게이트 (도메니코 2026-09-12)
 *   · 고해상도 사진 6장 이상 (서버 하한 MIN_TOTAL_IMAGES 도 6)
 *   · 제출 후 수정은 프리미엄만(수수료 없음) — 가이드라인·약관 제3조 모두
 *   · 단일 브랜드 = 브랜디드(제출 시 €790) · 무료는 옷 브랜드 3개(액세서리·잡화 제외)
 *   · 유료 애드온(€220 이미지+커버 · €110 게시일) 폐지, 커버 선택은 프리미엄 혜택
 *   · 로그인 후 가이드라인 먼저 → "동의합니다" 체크 → 폼 1단계
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { passed++; console.log('  ✓ ' + l); } else { failed++; console.log('  ✗ ' + l + (d ? ' — ' + d : '')); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('frontend/submission.html');
const terms = read('frontend/submission-terms.js');
const count = (re) => (html.match(re) || []).length;
const Q = "(?:[^'\\\\]|\\\\.)*";   // 작은따옴표 문자열 내부(이스케이프 포함)

console.log('\n=== 가이드라인 문구 9개 언어 ===');
ok('필수 자료: 사진 6장 이상 (8장 없음)', count(new RegExp("glReqBody:'" + Q + "(6장|6 high|6 hoch|6 foto|6 photos|6 fotos|写真6枚|6 张|6 фотограф)", 'g')) === 9 && !new RegExp("glReqBody:'" + Q + "(8장|8 high|8 hoch|8 foto|8 photos|8 fotos|写真8枚|8 张|8 фотограф)").test(html));
ok('이용 약관: 제출 후 수정은 프리미엄만 (€100 수수료 문구 없음)', count(new RegExp("glTermsBody:'" + Q + "(프리미엄 회원만|only Premium|nur Premium|solo i membri Premium|seuls les membres Premium|solo los miembros Premium|プレミアム会員のみ|仅高级会员|только участники Premium)", 'g')) === 9 && !/€100|100 €|100 유로|100 欧元/.test(html));
ok('이용 약관: 단일 브랜드 = 브랜디드, 제출 시 €790', count(new RegExp("glTermsBody:'" + Q + "790", 'g')) === 9);
ok('이용 약관: 무료는 옷 브랜드 3개, 액세서리·잡화 제외', count(new RegExp("glTermsBody:'" + Q + "(액세서리|accessories|Accessoires|accessori|accessoires|accesorios|アクセサリー|配饰|аксессуары)", 'g')) === 9);
// 2026-09-12 도메니코 2차: 혜택 섹션에 커버 선택은 쓰지 않고, "프리미엄만 공동작업자로 추천·지정" 을 명시.
ok('추가 옵션(유료) 섹션 → 프리미엄 혜택: 공동작업자는 프리미엄만 (커버 문구·€220·€110 없음)', count(new RegExp("glAddBody:'<ul><li>" + Q + "(공동작업자|collaborators|Collaborators|collaboratori|collaborateurs|colaboradores|コラボレーター|合作者|соавторы)", 'g')) === 9 && !new RegExp("glAddBody:'" + Q + "(커버|cover|Cover|copertina|couverture|portada|カバー|封面|обложк)").test(html) && !/glAddBody:'[^']*(€220|€110|220 €|110 €)/.test(html) && !/glAddTitle:'[^']*(유료|paid|kostenpflichtig|pagamento|payantes|de pago|有料|付费|платно)/.test(html));
ok('이용 약관 가이드라인: 종이 잡지·오프라인 전시 사용 가능 9개 언어', count(new RegExp("glTermsBody:'" + Q + "(종이 잡지|print magazine|gedruckten|cartacea|imprimée|impresa|紙媒体|纸质杂志|печатном)", 'g')) === 9);
ok('정적 마크업(영어 기본값)도 6장·공동작업자 혜택·종이 잡지', /<li>At least 6 high-resolution photos/.test(html) && /glAddBody"><ul>(?:<li>[^<]*<\/li>)*<li>Only Premium members can be recommended and tagged as Instagram collaborators<\/li>/.test(html) && /glTermsBody"><ul><li>[^<]*<\/li><li>Submitted work may be published in a future PAP print magazine/.test(html));
ok('법적 약관 제2조 ④ 종이 잡지·오프라인 전시 9개 언어 + 제목 갱신 + 캐시버스트 v=4', (terms.match(/④ (?:[^'\\]|\\.)*(종이 잡지|print magazine|gedruckten|cartacea|imprimée|impresa|紙媒体|纸质杂志|печатном)/g) || []).length === 9 && (terms.match(/(제2조|Article 2|Artikel 2|Articolo 2|Artículo 2|第2条|Статья 2)[^<]*(전시|Exhibition|Ausstellungen|Mostre|Exposition|Exposiciones|展示|展览|выставках)/g) || []).length === 9 && /submission-terms\.js\?v=[4-9]/.test(html) && /④ Submitted Works may be published in a future PAP print magazine/.test(html));

console.log('\n=== 법적 약관 제3조 (submission-terms.js) ===');
ok('제3조 ②: 프리미엄만 마이페이지에서, 수수료 없음, 비프리미엄 수정 불가 — 9개 언어', (terms.match(/② (?:[^'\\]|\\.)*(마이페이지|My Page|auf ihrer Seite|propria pagina|leur page|su página|マイページ|个人页面|своей странице)(?:[^'\\]|\\.)*<br>/g) || []).length === 9);
ok('제3조에 €100 수정 수수료가 없다', !/100/.test(terms));
ok('제3조 제목에서 "수수료" 제거 (9개 언어)', !/수정 수수료\)|Correction Fee\)|Korrekturgebühr\)|Tariffa di Correzione\)|Frais de Correction\)|Tarifa de Corrección\)|修正手数料\)|更正费用\)|плата за корректировку\)/.test(terms));
ok('시행일 2026-09-12 이후 (9개 언어) + submission-terms.js 캐시버스트 v=3', count(/termsEffective:'[^']*(9월 1[2-9]일|September 1[2-9], 2026|1[2-9]\. September 2026|1[2-9] settembre 2026|1[2-9] septembre 2026|1[2-9] de septiembre de 2026|9月1[2-9]日|1[2-9] сентября 2026)/g) === 9 && /submission-terms\.js\?v=[4-9]/.test(html));
ok('정적 마크업 Article 3 도 갱신', /Article 3 \(Accuracy and Correction of Credit Information\)/.test(html) && !/correction fee of €100/.test(html));

console.log('\n=== 사진 하한 6장 ===');
const st = require(path.join(ROOT, 'api', '_lib', 'submissionType'));
ok('서버 MIN_TOTAL_IMAGES = 6 = 폼 상수', st.MIN_TOTAL_IMAGES === 6 && /var MIN_TOTAL_IMAGES = 6;/.test(html));

console.log('\n=== 유료 애드온 폐지 ===');
const po = require(path.join(ROOT, 'api', '_lib', 'paypalOrders'));
ok('서버 애드온 가격표가 비어 있다 (모든 애드온 unknown_addon)', Object.keys(po.ADDON_FEE_CENTS).length === 0 && po.resolveAmount({}, 'submission_addon', 'ig_images_cover').error === 'unknown_addon' && po.resolveAmount({}, 'submission_addon', 'posting_date').error === 'unknown_addon');
ok('승인 안내 페이지에서 애드온 결제 버튼·소개문 제거', !/_apT\('addonImages'\)/.test(html) && !/_apT\('addonDate'\)/.test(html) && !/_apT\('apAddonIntro'\)/.test(html) && !/payAddonFee\(\\'/.test(html));

console.log('\n=== 커버 선택은 프리미엄만 ===');
const pc = require(path.join(ROOT, 'api', '_lib', 'premiumCover'));
ok('resolveCoverIndex: 프리미엄 아니면 0, 프리미엄이면 요청값', pc.resolveCoverIndex(3, false) === 0 && pc.resolveCoverIndex(3, true) === 3 && pc.resolveCoverIndex('x', true) === 0 && pc.resolveCoverIndex(-2, true) === 0 && pc.resolveCoverIndex(undefined, true) === 0);
(async () => {
  const db = (row) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }) });
  ok('isPremiumUser: premium+active 만 참, 조회 실패는 거짓', (await pc.isPremiumUser(db({ subscription_plan: 'premium', subscription_status: 'active' }), 'u')) === true
    && (await pc.isPremiumUser(db({ subscription_plan: 'premium', subscription_status: 'inactive' }), 'u')) === false
    && (await pc.isPremiumUser(db({ subscription_plan: 'standard', subscription_status: 'active' }), 'u')) === false
    && (await pc.isPremiumUser({ from: () => { throw new Error('x'); } }, 'u')) === false
    && (await pc.isPremiumUser(db(null), '')) === false);
  for (const f of ['api/submissions/index.js', 'api/submissions/[id].js']) {
    const src = read(f);
    ok(f + ': 저장 전에 isPremiumUser 로 판정하고 coverImageIndex 를 resolveCoverIndex 로 넣는다', /const _isPremium = await isPremiumUser\(supabaseAdmin, user\.id\);/.test(src) && /coverImageIndex: resolveCoverIndex\(data\.coverImageIndex, _isPremium\)/.test(src) && !/coverImageIndex: data\.coverImageIndex \|\| 0/.test(src));
  }
  ok('[id].js PATCH(file_urls) 경로도 비프리미엄은 커버 0', /_isPremiumPatch && typeof body\.coverImageIndex === 'number'/.test(read('api/submissions/[id].js')));
  ok('폼: 셀렉트에 mousedown/keydown 가드 + 프리미엄 안내 줄', /onmousedown="return _coverGuard\(event\)" onkeydown="return _coverGuard\(event\)"/.test(html) && /id="coverPremiumNote"/.test(html));
  ok('폼: _coverGuard 가 비프리미엄이면 막고 coverPremiumOnly 토스트', /function _coverGuard\(e\)\{\s*if\(_papIsPremium\(\)\) return true;[\s\S]{0,200}_t\('coverPremiumOnly'\)/.test(html));
  ok('폼: setCoverImage 가 비프리미엄 선택을 되돌린다, 선택기 갱신 때 잠금 상태 반영', /function setCoverImage\(\)\{\s*if\(!_papIsPremium\(\)\)\{ _applyCoverPremiumState\(\);/.test(html) && /_applyCoverPremiumState\(\);\s*\/\/ 2026-09-12/.test(html));
  ok('폼: 로드 시 refreshUser 로 서버 기준 등급을 새로 받는다', /PAP\.auth\.refreshUser\(\)\.then\(function\(\)\{ _applyCoverPremiumState\(\); \}\)/.test(html));
  ok('폼 문구 coverPremiumOnly·coverPremiumNote 9개 언어', count(/coverPremiumOnly:'/g) === 9 && count(/coverPremiumNote:'/g) === 9);

  console.log('\n=== 가이드라인 먼저 → 동의 체크 → 폼 ===');
  ok('가이드라인 블록 id=glBox + 동의 줄(glAgreeRow, #glAgree)', /id="glBox"/.test(html) && /id="glAgreeRow"/.test(html) && /<input type="checkbox" id="glAgree" onchange="_glAgreeChanged\(this\)">/.test(html));
  ok('로그인 후·로그인 버튼 후 둘 다 게이트 호출', count(/if\(_glGateNeeded\(\)\) _showGuidelineGate\(\);/g) === 2);
  ok('게이트: 폼 숨김 + 가이드라인을 폼 앞으로 + 전부 펼침', /fa\.style\.display='none';\s*gl\.classList\.add\('gl-first'\);\s*fa\.parentNode\.insertBefore\(gl, fa\);/.test(html));
  ok('동의 체크: 세션 기억 + 가이드라인 원위치 + 폼 표시', /sessionStorage\.setItem\(GL_AGREE_KEY,'1'\)/.test(html) && /fa\.parentNode\.insertBefore\(gl, fa\.nextSibling\);\s*fa\.style\.display='block';/.test(html));
  ok('재제출(?revise)은 게이트 건너뜀', /get\('revise'\)\) return false;/.test(html));
  ok('동의 문구 glAgreeLabel·glAgreeHint 9개 언어', count(/glAgreeLabel:'/g) === 9 && count(/glAgreeHint:'/g) === 9);
  ok('5단계의 법적 약관 체크박스는 그대로 남아 있다', /<input type="checkbox" id="termsAgree">/.test(html));

  console.log('\n=== 제7조 ⑦ 무료 조건·유료 부과 (도메니코 2026-09-13) ===');
ok('제7조 ⑦: 옷 브랜드 3개·룩 3개, 잡화 제외, 미충족 시 €380·단일 브랜드 €790 — 9개 언어', (terms.match(/⑦ (?:[^'\\]|\\.)*380(?:[^'\\]|\\.)*<\/li>'/g) || []).length === 9 && (terms.match(/⑦ (?:[^'\\]|\\.)*(액세서리|accessories|Accessoires|accessori|accessoires|accesorios|アクセサリー|配饰|аксессуаров)/g) || []).length === 9);
ok('제7조 ③: 브랜디드 서비스료 €790 명시(사전 협의 문구 제거) — 9개 언어', (terms.match(/③ (?:[^'\\]|\\.)*790/g) || []).length === 9 && !/사전 협의를 통해 결정|prior consultation with PAP/.test(terms));
ok('정적 마크업 Article 7 도 ③ €790 + ⑦, 약관 v5', /③ Branded Content is subject to a service fee of €790/.test(html) && /⑦ A free submission must include at least 3 different clothing brands/.test(html) && /submission-terms\.js\?v=[5-9]/.test(html));

console.log('\npassed: ' + passed + '   failed: ' + failed);
  if (failed) { console.log('❌ submission-guidelines-premium-cover FAILED'); process.exit(1); }
  console.log('✅ submission-guidelines-premium-cover passed');
})();
