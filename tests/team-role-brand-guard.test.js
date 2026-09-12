/**
 * 팀 크레딧에 브랜드/디자이너 금지 (도메니코 2026-09-12)
 *   "의상 및 잡화, 주얼리 등의 디자이너는 크리에이터 크레딧이 아닌 의상 크레딧에만 입력할 수 있게."
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { passed++; console.log('  ✓ ' + l); } else { failed++; console.log('  ✗ ' + l + (d ? ' — ' + d : '')); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const G = require(path.join(ROOT, 'api', '_lib', 'brandRoleGuard'));
const { CANONICAL_ROLES } = require(path.join(ROOT, 'api', '_lib', 'creditRoles'));
const html = read('frontend/submission.html');

console.log('\n=== isBrandRole ===');
const yes = ['Designer', 'designers', 'Fashion Designer', 'Jewelry Designer', 'Jewellery', 'Bijoux', 'Brand', 'Accessories designer', 'Bags', 'Shoes', 'Eyewear', 'Watches', 'Hat designer', 'Clothing', 'Fashion by', 'Beauty by', 'Wardrobe', 'Dress', 'Couture', 'Ready-to-wear', 'Label', 'Maison', 'Atelier', 'Sneakers', 'Outfit', 'Knitwear designer', 'Bag designer', 'Textile designer'];
const no = ['Photographer', 'Set Design', 'Set Designer', 'Sound Designer', 'Lighting Designer', 'Production Designer', 'Graphic Designer', 'Stylist', 'Make Up & Hair', 'Producer', 'Model', 'Location', 'Special Thanks', 'Editor', 'Colorist', 'Hair', 'DOP / Cinematographer', 'Casting Director', 'Talent Agency', 'Video assist', 'Music', 'VFX', 'Retoucher', 'Nail Artist', 'Movement Director', 'Lighting assist', 'Driver', 'Photographer assist', 'Art Director', 'Creative Director', '', null];
ok('브랜드/디자이너 역할은 전부 걸린다 (' + yes.length + ')', yes.every(G.isBrandRole), yes.filter((r) => !G.isBrandRole(r)).join(','));
ok('사람 역할은 하나도 안 걸린다 (' + no.length + ')', no.every((r) => !G.isBrandRole(r)), no.filter(G.isBrandRole).join(','));
ok('표준 역할 목록(CANONICAL_ROLES)은 전부 통과', CANONICAL_ROLES.every((r) => !G.isBrandRole(r)), CANONICAL_ROLES.filter(G.isBrandRole).join(','));
ok('brandRolesIn: 문제 역할만 골라낸다', JSON.stringify(G.brandRolesIn([{ role: 'Photographer' }, { role: 'Jewelry' }, null, 'x', { role: ' Brand ' }])) === '["Jewelry","Brand"]');

console.log('\n=== 서버 배선 ===');
for (const f of ['api/submissions/index.js', 'api/submissions/[id].js']) {
  const src = read(f);
  ok(f + ': team 을 만든 직후 brandRolesIn 으로 막고 400 TEAM_ROLE_BRAND + roles', /const team = Array\.isArray\(data\.team\) \? data\.team : \[\];\s*\/\/[^\n]*\n\s*const _brandRoles = brandRolesIn\(team\);/.test(src) && /'TEAM_ROLE_BRAND'/.test(src) && /roles: _brandRoles/.test(src));
}

console.log('\n=== 폼 ===');
const m = /var _PAP_BRAND_ROLE_RE_SRC='((?:[^'\\]|\\.)*)';/.exec(html);
ok('폼 정규식이 서버 BRAND_ROLE_RE_SRC 와 글자 단위로 같다', !!m && eval("'" + m[1] + "'") === G.BRAND_ROLE_RE_SRC);
ok('추가 행의 역할 입력에 실시간 검사(oninput/onblur)', /placeholder="Role"[^>]*oninput="_teamRoleLiveCheck\(this\)" onblur="_teamRoleLiveCheck\(this\)"/.test(html));
ok('3단계 검증이 브랜드 역할을 0순위로 막는다', /if \(roleInput && roleText && _papIsBrandRole\(roleText\)\) brandRoleRows\.push/.test(html) && /if \(brandRoleRows\.length > 0\)\{[\s\S]{0,300}_errT\('teamRoleBrand'/.test(html));
ok('서버 400 TEAM_ROLE_BRAND → 언어별 문구', /code==='TEAM_ROLE_BRAND'/.test(html) && /_errT\('teamRoleBrand',\{role:_br\}\)/.test(html));
ok('teamRoleBrand 문구 9개 언어', /teamRoleBrand:\{ko:'[^']+',en:'[^']+',de:'[^']+',it:'[^']+',fr:'(?:[^'\\]|\\.)+',es:'[^']+',ja:'[^']+',zh:'[^']+',ru:'[^']+'\}/.test(html));
ok('팀 크레딧 안내문(teamCreditsDesc)에 "브랜드·디자이너는 룩 크레딧에" 9개 언어', (html.match(/teamCreditsDesc:(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g) || []).filter((t) => /(룩별 의상 크레딧|look credits|Look-Credits|crediti dei look|crédits des looks|créditos de los looks|衣装クレジット|服装署名|кредитах образов)/.test(t)).length === 9);

console.log('\npassed: ' + passed + '   failed: ' + failed);
if (failed) { console.log('❌ team-role-brand-guard FAILED'); process.exit(1); }
console.log('✅ team-role-brand-guard passed');
