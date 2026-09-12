/**
 * 인스타그램 공동작업자 지정 (도메니코 2026-09-12)
 *   "공동작업자 태그 €100 유료 폐지. 제출자가 인스타그램 아이디로 공동작업자를 고르고,
 *    지정받는 사람은 전부 프리미엄 회원이어야 한다. 프리미엄이 아니면 '프리미엄 회원만 지정할 수
 *    있다' 경고. 아무도 안 고르면 임의 지정 또는 미지정 문구."
 * 규칙은 api/_lib/collaborators.js 한 곳 — 폼 실시간 확인·POST·PUT·마이페이지 등록이 전부 그걸 쓴다.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'api', '_lib', 'collaborators'));
let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { passed++; console.log('  ✓ ' + l); } else { failed++; console.log('  ✗ ' + l + (d ? ' — ' + d : '')); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

console.log('\n=== normalizeHandle ===');
ok('@Pap_Magazine → pap_magazine', C.normalizeHandle('@Pap_Magazine') === 'pap_magazine');
ok('URL 도 벗긴다', C.normalizeHandle('https://www.instagram.com/PAP_magazine/?hl=en') === 'pap_magazine');
ok('한글·공백·특수문자 → 무효', C.normalizeHandle('팝매거진') === '' && C.normalizeHandle('a b') === '' && C.normalizeHandle('a-b') === '');
ok('31자 → 무효, 30자 → 유효', C.normalizeHandle('a'.repeat(31)) === '' && C.normalizeHandle('a'.repeat(30)).length === 30);
ok('빈값 → 빈문자열', C.normalizeHandle('') === '' && C.normalizeHandle(null) === '');

console.log('\n=== parseCollaboratorInput ===');
const pi = C.parseCollaboratorInput(['@A', 'a', { handle: '@b' }, '', 'c', 'd', 'e', '한글']);
ok('중복 제거·상한 3·무효 분리', pi.handles.join(',') === 'a,b,c' && pi.invalid.join(',') === '한글', JSON.stringify(pi));
ok('MAX_COLLABORATORS = 3', C.MAX_COLLABORATORS === 3);

console.log('\n=== isPremiumProfile ===');
ok('premium + active 만 참', C.isPremiumProfile({ subscription_plan: 'premium', subscription_status: 'active' })
  && !C.isPremiumProfile({ subscription_plan: 'premium', subscription_status: 'inactive' })
  && !C.isPremiumProfile({ subscription_plan: 'standard', subscription_status: 'active' })
  && C.isPremiumProfile({ subscription_plan: 'premium_monthly', subscription_status: 'active' }));

console.log('\n=== validateCollaborators (가짜 DB) ===');
const rows = [
  { id: 'u1', instagram: 'prem', subscription_plan: 'premium', subscription_status: 'active' },
  { id: 'u2', instagram: 'std', subscription_plan: 'standard', subscription_status: 'active' },
  { id: 'u3', instagram: 'expired', subscription_plan: 'premium', subscription_status: 'inactive' },
];
const fakeDb = { from: (t) => ({ select: () => ({ in: async (col, hs) => ({ data: rows.filter((r) => t === 'profiles' && hs.includes(r.instagram)), error: null }) }) }) };
(async () => {
  let r = await C.validateCollaborators(fakeDb, ['@Prem']);
  ok('프리미엄 회원 → 통과, {handle,userId} 저장형', r.ok && r.collaborators.length === 1 && r.collaborators[0].handle === 'prem' && r.collaborators[0].userId === 'u1', JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, ['@prem', '@std']);
  ok('스탠다드 회원 섞이면 COLLAB_NOT_PREMIUM + 문제 아이디만', !r.ok && r.code === 'COLLAB_NOT_PREMIUM' && r.handles.join() === 'std', JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, ['@expired']);
  ok('만료된 프리미엄 → 거부', !r.ok && r.code === 'COLLAB_NOT_PREMIUM', JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, ['@nobody']);
  ok('등록 안 된 아이디 → 거부 (프리미엄이 아니라고 본다)', !r.ok && r.code === 'COLLAB_NOT_PREMIUM' && r.handles.join() === 'nobody', JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, ['한글']);
  ok('무효 아이디 → COLLAB_HANDLE_INVALID', !r.ok && r.code === 'COLLAB_HANDLE_INVALID', JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, []);
  ok('비어 있으면 통과 (임의 지정 또는 미지정)', r.ok && r.collaborators.length === 0);
  r = await C.validateCollaborators(fakeDb, undefined);
  ok('필드 자체가 없어도 통과 (구 클라이언트)', r.ok && r.collaborators.length === 0);

  console.log('\n=== 배선: 서버 ===');
  for (const f of ['api/submissions/index.js', 'api/submissions/[id].js']) {
    const src = read(f);
    ok(f + ' 가 validateCollaborators 로 검사하고 거부 코드를 그대로 낸다', /validateCollaborators\(supabaseAdmin, data\.collaborators\)/.test(src) && /_cv\.code/.test(src));
    ok(f + ' 가 collaborators 를 description 에 저장한다', /\n\s+collaborators,\s*\/\//.test(src));
    ok(f + ' 검사가 분류(classifySubmissionType)보다 앞', src.indexOf('validateCollaborators(supabaseAdmin') < src.indexOf('classifySubmissionType(looks'));
  }
  const chk = read('api/submissions/collaborator-check.js');
  ok('collaborator-check: GET·로그인 필수·프리미엄 여부만 (이름·이메일 없음)', /requireAuth\(req, res\)/.test(chk) && /premium: !!\(hit && hit\.premium\)/.test(chk) && !/email|name/.test(chk.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
  const me = read('api/auth/me.js');
  ok('PUT /api/auth/me 가 아이디를 정규화하고 중복은 409 INSTAGRAM_TAKEN', /normalizeHandle\(raw\)/.test(me) && /INSTAGRAM_TAKEN/.test(me) && /INSTAGRAM_INVALID/.test(me));
  ok('마이그레이션 148: profiles.instagram 유일 인덱스', fs.existsSync(path.join(ROOT, 'supabase_migrations', '148_profiles_instagram_unique.sql')) && /CREATE UNIQUE INDEX IF NOT EXISTS profiles_instagram_unique/.test(read('supabase_migrations/148_profiles_instagram_unique.sql')));

  console.log('\n=== 유료 태그 폐지 ===');
  const po = read('api/_lib/paypalOrders.js');
  ok('paypalOrders 에 ig_collab 가격이 없다', !/ig_collab:\s*\d/.test(po) && !/ig_collab: 'Instagram/.test(po));
  const html = read('frontend/submission.html');
  ok('가이드라인 추가옵션(glAddBody)에 공동작업자 €110 줄이 9개 언어 어디에도 없다',
    !/콜라보레이터 태그: €110|collaborator tag: €110|Collaborator-Tag: 110|collaboratore Instagram: 110|collaborateur Instagram : 110|colaborador en Instagram: 110|コラボレータータグ：€110|合作者标签：€110|Тег соавтора в Instagram: €110/.test(html));
  ok('승인 안내의 애드온 목록에서 공동작업자 항목 제거', !/_apT\('addonCollab'\)/.test(html));

  console.log('\n=== 폼 ===');
  ok('공동작업자 섹션·입력·추가 버튼', /id="collabSection"/.test(html) && /class="team-input collab-input"/.test(html) && /onclick="addCollabRow\(\)"/.test(html));
  ok('폼 상한 MAX_COLLABORATORS=3 (서버와 동일)', /var MAX_COLLABORATORS=3;/.test(html));
  ok('입력 시 /api/submissions/collaborator-check 로 프리미엄 확인', /\/api\/submissions\/collaborator-check\?handle=/.test(html));
  ok('프리미엄이면 등록, 아니면 경고 문구', /_t\('collabOk'/.test(html) && /_t\('collabNotPremium'/.test(html));
  ok('payload 에 data.collaborators', /data\.collaborators=_collabHandles\(\);/.test(html));
  ok('제출 직전 전부 재확인해서 막는다', /var _cvf=await _collabVerifyAll\(\);/.test(html) && /_t\('collabBlock'/.test(html));
  ok('3단계 검증도 프리미엄 아님을 막는다', /inp\.dataset\.state==='not_premium'\|\|inp\.dataset\.state==='invalid'/.test(html));
  ok('서버 COLLAB_NOT_PREMIUM 을 언어별 문구로', /code==='COLLAB_NOT_PREMIUM'/.test(html) && /collabNotPremiumApi:\{ko:/.test(html));
  ok('재제출 때 저장된 공동작업자를 채운다', /desc\.collaborators/.test(html));
  const keys = ['sectionCollab', 'collabDesc', 'btnAddCollab', 'phCollab', 'collabOk', 'collabNotPremium', 'collabInvalid', 'collabChecking', 'collabLogin', 'collabError', 'collabBlock', 'collabMax'];
  ok('폼 문구 12키 × 9개 언어', keys.every((k) => (html.match(new RegExp(k + ":'", 'g')) || []).length === 9), keys.map((k) => k + '=' + (html.match(new RegExp(k + ":'", 'g')) || []).length).join(' '));
  ok('"임의 지정 또는 미지정" 안내가 9개 언어에', (html.match(/collabDesc:'(?:[^'\\]|\\.)*(임의로|random|zufällig|a caso|au hasard|al azar|任意に|随机|случайно)/g) || []).length === 9);

  console.log('\n=== 마이페이지 / 관리자 ===');
  const mp = read('frontend/mypage.html');
  ok('마이페이지에 인스타그램 아이디 입력·저장', /id="mpIgInput"/.test(mp) && /_mpSaveInstagram/.test(mp) && /body:JSON\.stringify\(\{instagram:v,activityCountry:country,activityCity:city\}\)/.test(mp));
  ok('마이페이지 문구 9개 언어', ['labelInstagram', 'btnIgSave', 'igHint', 'igSaved', 'igTaken', 'igInvalid', 'igError'].every((k) => (mp.match(new RegExp(k + ":'", 'g')) || []).length === 9));
  ok('관리자 검토 모달에 공동작업자 표시', /id="reviewModalCollab"/.test(read('frontend/admin.html')) && /desc\.collaborators/.test(read('frontend/pap-admin.js')));
  ok('/submissions 랜딩이 프리미엄 공동작업자 혜택을 말한다', /tagged as Instagram collaborators/.test(read('frontend/submissions.html')));

  console.log('\n=== 프리미엄 유지 중에만 · 활동 국가·도시 (도메니코 2차) ===');
  const rv = read('api/submissions/[id]/review.js');
  ok('승인 시 공동작업자를 다시 판정해 자격 끊긴 사람을 뺀다(collaboratorsDropped)', /lookupHandles\(supabaseAdmin, _hs\)/.test(rv) && /premium_lapsed/.test(rv) && /desc\.collaboratorsDropped/.test(rv));
  ok('폼·마이페이지 안내에 "프리미엄 유지 중에만, 끝나면 자동 종료" 9개 언어', (html.match(/collabDesc:'(?:[^'\\]|\\.)*(자동으로 종료|ends automatically|endet automatisch|termina automaticamente|prend fin automatiquement|termina automáticamente|自動的に終了|自动结束|прекращается автоматически)/g) || []).length === 9
    && (mp.match(/igHint:'(?:[^'\\]|\\.)*(자동으로 종료|ends automatically|endet automatisch|termina automaticamente|prend fin automatiquement|termina automáticamente|自動的に終了|自动结束|прекращается автоматически)/g) || []).length === 9);
  ok('lookupHandles 가 활동 도시·국가를 함께 돌려주고 check 응답에 location 이 있다', /activity_country, activity_city/.test(read('api/_lib/collaborators.js')) && /location:/.test(chk));
  ok('폼 등록 문구에 도시·국가({loc}) 9개 언어', (html.match(/collabOk:'✓ @\{h\}\{loc\}/g) || []).length === 9);
  ok('PUT /api/auth/me: 아이디 등록엔 활동 국가·도시 필수(ACTIVITY_LOCATION_REQUIRED), 저장·반환', /ACTIVITY_LOCATION_REQUIRED/.test(me) && /updates\.activity_country/.test(me) && /activityCountry: profile\.activity_country/.test(me));
  ok('마이페이지에 국가·도시 입력이 있고 저장 본문에 실린다', /id="mpCountryInput"/.test(mp) && /id="mpCityInput"/.test(mp) && /activityCountry:country,activityCity:city/.test(mp));
  ok('마이페이지 국가·도시 문구 9개 언어', ['labelActivityLocation', 'phCountry', 'phCity', 'igLocationRequired'].every((k) => (mp.match(new RegExp(k + ":'", 'g')) || []).length === 9));
  ok('마이그레이션 149: activity_country·activity_city', /activity_country TEXT/.test(read('supabase_migrations/149_profiles_activity_location.sql')) && /activity_city/.test(read('supabase_migrations/149_profiles_activity_location.sql')));

  console.log('\npassed: ' + passed + '   failed: ' + failed);
  if (failed) { console.log('❌ submission-collaborators FAILED'); process.exit(1); }
  console.log('✅ submission-collaborators passed');
})();
