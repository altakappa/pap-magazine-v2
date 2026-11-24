/**
 * 브라우저 자동번역 방어 (2026-09-05, Modern Teddy 사고 재발 방지)
 *
 * 사고: 제출자가 Chrome 자동번역을 켠 채 서브미션 폼을 썼다. 폼이 역할 라벨의
 * textContent 와 value 없는 <option> 글자를 그대로 읽어 '摄影师'·'裤子' 가
 * DB → 에디토리얼 → 사이트 캡션까지 노출됐다.
 *
 * 방어 3겹을 검증한다.
 *  1) 프론트: 고정 역할 div 에 data-role + translate="no", 품목 option 에 value,
 *     look-select 에 translate="no", 수집 코드는 data-role 을 먼저 읽는다.
 *  2) 서버 저장(submissions/index.js): normalizeRole / normalizeItemType 적용.
 *  3) 서버 승인(review.js): 품목 normalizeItemType 적용.
 *  + 별칭 표가 실제 사고 값을 되돌리는지, 표준 품목 목록이 폼 옵션과 같은지.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { normalizeRole } = require('../api/_lib/creditRoles');
const { CANONICAL_ITEM_TYPES, BEAUTY_ITEM_TYPES, normalizeItemType, hasCjk } = require('../api/_lib/itemTypes');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

console.log('\n=== 1) 프론트 submission.html ===');
const html = read('frontend/submission.html');
const roleDivs = html.match(/<div class="team-role"[^>]*>/g) || [];
t('고정 역할 div 8개', roleDivs.length === 8, roleDivs.length);
t('모든 고정 역할 div 에 data-role', roleDivs.every((d) => /data-role="[^"]+"/.test(d)));
t('모든 고정 역할 div 에 translate="no"', roleDivs.every((d) => /translate="no"/.test(d)));
const dataRoles = roleDivs.map((d) => /data-role="([^"]+)"/.exec(d)[1].replace(/&amp;/g, '&'));
t('data-role 값은 전부 표준 역할', dataRoles.every((r) => normalizeRole(r) === r), dataRoles.join(' | '));
/* 2026-11-24 — 품목 목록이 장르별로 둘이 됐다(의상 / 뷰티). 둘 다 **한 줄 상수**라
   여기서 정적으로 뽑아 서버 itemTypes.js 와 대조할 수 있다. 상수를 함수 안으로
   옮기거나 여러 줄로 쪼개면 이 대조가 조용히 비어 버리므로, 모양 자체를 지킨다. */
function optionBlock(name){
  const m = new RegExp('var ' + name + "='([^\\n]*)';").exec(html);
  return m ? m[1] : null;
}
function checkList(name, canon, label){
  const raw = optionBlock(name);
  t(label + ' 상수 존재(한 줄)', !!raw);
  const opts = raw ? (raw.match(/<option value="([^"]*)">([^<]*)<\/option>/g) || []) : [];
  t(label + ' option 전부 value 명시(' + canon.length + ' + Select)', opts.length === canon.length + 1, opts.length);
  t(label + ' option value == 표시 글자',
    opts.every((o) => { const m = /value="([^"]*)">([^<]*)</.exec(o); return m[1] === '' || m[1] === m[2]; }));
  const vals = opts.map((o) => /value="([^"]*)"/.exec(o)[1]).filter(Boolean);
  t(label + ' == itemTypes 목록', JSON.stringify(vals) === JSON.stringify(canon), vals.join(','));
  t(label + ' 에 value 없는 <option> 없음', !/<option>[A-Z]/.test(raw || ''));
  return vals;
}
const optVals = checkList('_PAP_FASHION_ITEM_OPTIONS', CANONICAL_ITEM_TYPES, '의상 품목');
const beautyVals = checkList('_PAP_BEAUTY_ITEM_OPTIONS', BEAUTY_ITEM_TYPES, '뷰티 품목');

/* 도메니코 2026-11-24 — "뷰티 에디토리얼은 패션 크레딧을 쓸 수 없다. 만약 패션
   크레딧을 쓰고자 한다면 그것은 패션 에디토리얼이다."
   그러므로 뷰티 목록에 의상이 섞이면 안 된다('Other' 만 양쪽에 공통). */
const CLOTHING_ONLY = CANONICAL_ITEM_TYPES.filter((v) => v !== 'Other');
t('뷰티 목록에 의상 품목이 섞여 있지 않다',
  beautyVals.every((v) => CLOTHING_ONLY.indexOf(v) === -1),
  beautyVals.filter((v) => CLOTHING_ONLY.indexOf(v) !== -1).join(','));
t('itemOptions 가 장르를 보고 고른다', /_papBeautyOnlyGenre\(\) \? _PAP_BEAUTY_ITEM_OPTIONS : _PAP_FASHION_ITEM_OPTIONS/.test(html));
t('BEAUTY 만 고른 경우에만 뷰티 목록을 쓴다 (FASHION 이 함께면 의상)',
  /indexOf\('BEAUTY'\)!==-1 && g\.indexOf\('FASHION'\)===-1/.test(html));
t('장르가 바뀌면 이미 그린 select 를 다시 그린다', /_papRefreshItemOptions/.test(html));
t('목록에 없는 값은 비우고, 몇 개를 비웠는지 말해 준다',
  /lookItemsCleared/.test(html) && /cleared\+\+/.test(html));
t('제출 전에도 한 번 더 막는다 (장르를 나중에 바꾼 경우)',
  /_papBeautyOnlyGenre\(\)\)\{[\s\S]{0,400}_papItemTypeValid/.test(html));
t('look-select 에 translate="no"', (html.match(/<select class="look-select" translate="no">/g) || []).length === 2);
t('수집 코드가 data-role 을 먼저 읽음 (제출)', /var role = roleEl \? \(roleEl\.getAttribute\('data-role'\) \|\| roleEl\.textContent\)/.test(html));
t('검증 코드가 data-role 을 먼저 읽음 (필수 크레딧)', /roleText = \(roleEl\.getAttribute\('data-role'\) \|\| roleEl\.textContent/.test(html));
t('삭제 방어가 data-role 을 먼저 읽음', /roleEl\.getAttribute\('data-role'\)\|\|roleEl\.textContent/.test(html));

console.log('\n=== 1c) 뷰티 = 메이크업 룩 (도메니코 2026-11-24) ===');
/* 도메니코: "뷰티는 패션 룩이 없는 거지 메이크업 룩이 있는 거기 때문에 그것
   기준으로 정렬하면 어떨까?" — 그래서 룩 구조는 그대로 두고 호칭과 카피만
   장르에 따라 갈라진다. 구조를 없애면 커버 선택·이미지 순서·수정 모드·어드민
   화면이 함께 흔들리므로, 이 테스트는 "구조는 그대로"까지 같이 지킨다. */
t('_papLookWord 가 장르로 갈린다', /function _papLookWord\(\)\{ return _papBeautyOnlyGenre\(\) \? 'MAKEUP LOOK' : 'LOOK'; \}/.test(html));
const addLookBody = (/function addLook\(\)\{[\s\S]*?\n\}/.exec(html) || [''])[0];
t('addLook 이 그 단어를 쓴다 (LOOK 하드코딩 없음)',
  /look-title">'\+_lw\+' '\+n/.test(addLookBody) && /look-img-label">'\+_lw\+' '\+n\+' IMAGES/.test(addLookBody)
  && !/look-title">LOOK /.test(addLookBody), addLookBody ? 'ok' : 'addLook 못 찾음');
t('이미 그려 둔 룩의 머리말도 다시 쓴다',
  /\.look-title'\)/.test(html) && /\.look-img-label'\)/.test(html) && /w\+' '\+n\+' IMAGES'/.test(html));
t('4단계 라벨 3종을 키째로 바꾼다',
  /\['sectionLookCredits','sectionMakeupLooks'\]/.test(html)
  && /\['lookCreditsDesc','makeupLookCreditsDesc'\]/.test(html)
  && /\['btnAddLook','btnAddMakeupLook'\]/.test(html));
/* 2026-11-24 — 처음엔 '#step4 의 첫 .section-title' 처럼 위치로 찾았는데,
   그러면 이웃한 ADDITIONAL IMAGES 제목을 잘못 집는다. 속성 기준으로 못 박는다. */
t('라벨을 위치가 아니라 data-i18n 값으로 찾는다',
  /cur===pair\[0\]\|\|cur===pair\[1\]/.test(html) && !/#step4 p\[data-i18n\]/.test(html));
/* 선택자를 문자열로 조립하면 lang-consistency 의 사전 스캐너가 '+pair[0]+' 를
   키로 읽어 "어느 사전에도 없는 키" 로 터진다. 한 번 당했으니 못 박는다. */
t('선택자 문자열로 data-i18n 키를 만들지 않는다', !/\[data-i18n="'\+/.test(html));
t('장르를 바꾸면 호칭도 따라 바뀐다', /_papRefreshLookWording\(\);/.test(html) && (html.match(/_papRefreshLookWording\(\)/g) || []).length >= 3);
t('초안 복원 경로도 호칭을 다시 맞춘다',
  /_papRefreshItemOptions==='function'\) _papRefreshItemOptions\(\); \}catch\(_\)\{\}[\s\S]{0,160}_papRefreshLookWording/.test(html));
['sectionMakeupLooks','btnAddMakeupLook','makeupLookCreditsDesc'].forEach((k) => {
  t('i18n ' + k + ' 9개 언어', (html.match(new RegExp(k + ':', 'g')) || []).length === 9,
    (html.match(new RegExp(k + ':', 'g')) || []).length);
});
/* 뷰티는 genreMode==='beauty' 라서 무조건 무료다. 패션 카피를 그대로 쓰면
   "룩 3개 미만이면 €380" 이 뷰티 제출자에게 뜬다 — 그게 돈 사고의 입구였다. */
const mkDescs = (html.match(/makeupLookCreditsDesc:'((?:\\.|[^'])*)'/g) || []);
t('뷰티 카피 9개를 다 읽었다', mkDescs.length === 9, mkDescs.length);
t('뷰티 카피에 유료 금액(€380/€790)이 없다',
  mkDescs.every((d) => !/380|790/.test(d)),
  mkDescs.filter((d) => /380|790/.test(d)).length + '건');
t('뷰티 카피가 FASHION 선택을 안내한다', mkDescs.every((d) => /FASHION/.test(d)));
/* 도메니코: "6장 그대로 두자." 룩 호칭만 바뀌고 장수 요건은 건드리지 않는다. */
t('MIN_TOTAL_IMAGES 는 프론트·서버 모두 6 그대로',
  /MIN_TOTAL_IMAGES\s*=\s*6/.test(html) && /MIN_TOTAL_IMAGES\s*=\s*6/.test(read('api/_lib/submissionType.js')));
t('룩 구조 자체는 그대로 (lookList·lookFiles·커버 선택 유지)',
  /id="lookList"/.test(html) && /lookFiles\[n\]=\[\]/.test(html) && /block\.id='look'\+lookCount/.test(html));

console.log('\n=== 1b) 장르 버튼 (2026-09-07 러시아 회원 400 사고) ===');
const genreBtns = html.match(/<button class="genre-tag"[^>]*>/g) || [];
t('장르 버튼 8개', genreBtns.length === 8, genreBtns.length);
t('모든 장르 버튼에 data-genre', genreBtns.every((b) => /data-genre="[^"]+"/.test(b)));
t('모든 장르 버튼에 translate="no"', genreBtns.every((b) => /translate="no"/.test(b)));
const { ALLOWED_CATEGORIES, normalizeGenres } = require('../api/_lib/submissionCategories');
const genreVals = genreBtns.map((b) => /data-genre="([^"]+)"/.exec(b)[1]);
t('data-genre 값 == 서버 화이트리스트', JSON.stringify(genreVals) === JSON.stringify(ALLOWED_CATEGORIES), genreVals.join('|'));
t('장르 수집이 _genreOf 를 씀', (html.match(/selectedGenres\.push\(_genreOf\(g\)\)/g) || []).length === 2);
t('장르 수집에 textContent 직접 사용 없음', !/selectedGenres\.push\(g\.textContent\)/.test(html));
t('초안 복원이 _genreOf 를 씀', /_genreOf\(tag\)===g/.test(html) && /d\.genre\.indexOf\(_genreOf\(g\)\)/.test(html));
t('서버 역번역: МОДА→FASHION', JSON.stringify(normalizeGenres(['МОДА'])) === '["FASHION"]');
t('서버 역번역: Показ мод→FASHION SHOW', JSON.stringify(normalizeGenres(['Показ мод'])) === '["FASHION SHOW"]');
t('서버 역번역: 時尚/뷰티/ビューティー', JSON.stringify(normalizeGenres(['時尚','뷰티','ビューティー'])) === '["FASHION","BEAUTY"]');
t('서버: 모르는 값은 여전히 거부', normalizeGenres(['HACK','<script>']).length === 0);
const idx0 = read('api/submissions/index.js');
t('서버 400 에 code + 로그 (_reject400)', /function _reject400\(/.test(idx0) && /CATEGORY_INVALID/.test(idx0) && /GENRE_REQUIRED/.test(idx0) && /TITLE_REQUIRED/.test(idx0) && /NO_IMAGE_URLS/.test(idx0));
t('서버 400 에 코드 없는 res.status(400) 남지 않음 (헬퍼 1곳 + 기존 2곳)', (idx0.match(/res\.status\(400\)/g) || []).length === 3);
t('프론트가 CATEGORY_INVALID 를 언어별 문구로', /code==='CATEGORY_INVALID'/.test(html) && /categoryInvalid:\{ko:/.test(html));
t('프론트가 BRAND_LATIN_ONLY 를 언어별 문구로', /code==='BRAND_LATIN_ONLY'/.test(html) && /brandLatin:\{ko:/.test(html));

console.log('\n=== 2) 서버 저장 api/submissions/index.js ===');
const idx = read('api/submissions/index.js');
// 2026-09-10 — 표준화·라틴 검사는 api/_lib/submissionEnglishOnly.js 한 곳으로 옮겼다 (POST·PUT 공용).
const eo = read('api/_lib/submissionEnglishOnly.js');
t('englishOnly require (POST)', /require\('\.\.\/_lib\/submissionEnglishOnly'\)/.test(idx));
t('englishOnly: creditRoles·itemTypes 를 쓴다', /require\('\.\/creditRoles'\)/.test(eo) && /require\('\.\/itemTypes'\)/.test(eo));
t('looks item type 정규화', /it\.type = normalizeItemType\(it\.type\)/.test(eo) && /englishOnly\.normalize\(data\)/.test(idx));
t('team role 정규화', /m\.role = normalizeRole\(m\.role\)/.test(eo));
const EO = require(path.join(__dirname, '..', 'api/_lib/submissionEnglishOnly.js'));
{ const d = { looks: [{ n: 1, items: [{ type: '裤子', brand: 'Acne', instagram: '@acne' }] }], team: [{ name: 'Kim', role: '摄影师' }], credits: { '摄影师': ['Kim'] } };
  EO.normalize(d);
  t('normalize 동작: 裤子→Pants · 摄影师→Photographer · credits 키', d.looks[0].items[0].type === 'Pants' && d.team[0].role === 'Photographer' && Object.keys(d.credits)[0] === 'photographer'); }
t('violations: 팀 이름 한글 잡음', EO.violations({ team: [{ name: '홍길동', role: 'Photographer' }] }).length === 1);
t('violations: 모델 에이전시 일본어 잡음', EO.violations({ models: [{ name: 'A', agency: '東京モデル' }] }).length === 1);
t('violations: 제목·스테이트먼트 키릴 잡음', EO.violations({ title: 'Москва', artistStatement: 'ок' }).length === 2);
t('violations: 악센트 라틴은 통과 (Hermès · Niño · über)', EO.violations({ team: [{ name: 'Niño Hermès', role: 'Stylist' }], looks: [{ n: 1, items: [{ brand: 'über', instagram: '@x' }] }] }).length === 0);
t('rejection 코드는 BRAND_LATIN_ONLY 유지(프론트 호환)', EO.rejection([{ label: 'x', value: 'y' }]).code === 'BRAND_LATIN_ONLY');
const idPut = read('api/submissions/[id].js');
t('재제출(PUT)도 같은 검사 + 표준화', /englishOnly\.normalize\(data\)/.test(idPut) && /englishOnly\.violations\(data\)/.test(idPut) && /englishOnly\.rejection\(/.test(idPut));

console.log('\n=== 3) 서버 승인 api/submissions/[id]/review.js ===');
const rev = read('api/submissions/[id]/review.js');
t('itemTypes require (../../_lib)', /require\('\.\.\/\.\.\/_lib\/itemTypes'\)/.test(rev));
t('품목 normalizeItemType 적용', /const type = normalizeItemType\(it\.type\)/.test(rev));

console.log('\n=== 4) 별칭 표: 실제 사고 값 ===');
const roleCases = { '摄影师': 'Photographer', '造型师': 'Stylist', '化妆和发型': 'Make Up & Hair', '修图': 'Retouching', '制片人': 'Producer', '포토그래퍼': 'Photographer', 'フォトグラファー': 'Photographer' };
Object.keys(roleCases).forEach((k) => t('role ' + k + ' → ' + roleCases[k], normalizeRole(k) === roleCases[k], normalizeRole(k)));
const itemCases = { '裤子': 'Pants', '项链': 'Necklace', '戒指': 'Ring', '外套': 'Jacket', '其他': 'Other', '衬衫': 'Shirt', '靴子': 'Boots', '鞋': 'Shoes', '太阳镜': 'Sunglasses', 'Trousers': 'Pants', 'pants': 'Pants' };
Object.keys(itemCases).forEach((k) => t('item ' + k + ' → ' + itemCases[k], normalizeItemType(k) === itemCases[k], normalizeItemType(k)));
t('모르는 품목은 원본 보존', normalizeItemType('Cape') === 'Cape');
t('빈 품목 → 빈 문자열', normalizeItemType('') === '' && normalizeItemType(null) === '');
t('hasCjk', hasCjk('摄影师') && hasCjk('바지') && !hasCjk('Photographer'));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ submission-translate-guard tests FAILED'); process.exit(1); }
console.log('✅ submission-translate-guard tests passed');
