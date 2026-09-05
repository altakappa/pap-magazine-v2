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
