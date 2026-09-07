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
const { CANONICAL_ITEM_TYPES, normalizeItemType, hasCjk } = require('../api/_lib/itemTypes');

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
const itemFn = /function itemOptions\(\)\{\n  return '([^\n]*)';\n\}/.exec(html);
t('itemOptions 존재', !!itemFn);
const opts = itemFn ? (itemFn[1].match(/<option value="([^"]*)">([^<]*)<\/option>/g) || []) : [];
t('품목 option 전부 value 명시(24 + Select)', opts.length === 25, opts.length);
const optVals = opts.map((o) => /value="([^"]*)"/.exec(o)[1]).filter(Boolean);
t('option value == 표시 글자', opts.every((o) => { const m = /value="([^"]*)">([^<]*)</.exec(o); return m[1] === '' || m[1] === m[2]; }));
t('폼 옵션 == itemTypes CANONICAL 목록', JSON.stringify(optVals) === JSON.stringify(CANONICAL_ITEM_TYPES));
t('value 없는 <option> 이 itemOptions 에 없음', !/<option>[A-Z]/.test(itemFn ? itemFn[1] : ''));
t('look-select 에 translate="no"', (html.match(/<select class="look-select" translate="no">/g) || []).length === 2);
t('수집 코드가 data-role 을 먼저 읽음 (제출)', /var role = roleEl \? \(roleEl\.getAttribute\('data-role'\) \|\| roleEl\.textContent\)/.test(html));
t('검증 코드가 data-role 을 먼저 읽음 (필수 크레딧)', /roleText = \(roleEl\.getAttribute\('data-role'\) \|\| roleEl\.textContent/.test(html));
t('삭제 방어가 data-role 을 먼저 읽음', /roleEl\.getAttribute\('data-role'\)\|\|roleEl\.textContent/.test(html));

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
t('creditRoles require', /require\('\.\.\/_lib\/creditRoles'\)/.test(idx));
t('itemTypes require', /require\('\.\.\/_lib\/itemTypes'\)/.test(idx));
t('looks item type 정규화', /it\.type = normalizeItemType\(it\.type\)/.test(idx));
t('team role 정규화', /m\.role = normalizeRole\(m\.role\)/.test(idx));

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
