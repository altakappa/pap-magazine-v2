/**
 * 인스타그램 공동작업자 지정 (도메니코 2026-09-12 → 2026-09-24 재변경)
 *   9/12: "제출자가 아이디로 고르고, 지정받는 사람은 전부 프리미엄 회원." → 실측: 이걸로 프리미엄에 드는 사람이 없었다.
 *   9/24: "지정하는 쪽은 연간 프리미엄, 지정받는 자는 무료 회원이라도 괜찮다. 프리미엄 한 명을 확보하고
 *          지정받는 회원들의 DB를 확보한다. 프리미엄에 권력이 생기게." 최대 5명(인스타그램 상한).
 * 규칙은 api/_lib/collaborators.js 한 곳 — 폼 실시간 확인·POST·PUT·승인 재판정·마이페이지 등록이 전부 그걸 쓴다.
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
ok('중복 제거·상한 5·무효 분리', pi.handles.join(',') === 'a,b,c,d,e' && pi.invalid.join(',') === '한글', JSON.stringify(pi));
ok('MAX_COLLABORATORS = 5 (도메니코 2026-09-24: 인스타그램 공동작업자 상한)', C.MAX_COLLABORATORS === 5);

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
/* subscriptions: yearly = 활성 연간 프리미엄 제출자, monthly = 월간 프리미엄(고를 수 없다), none = 무료 */
const subs = {
  yearly: [{ id: 's1', plan: 'premium_yearly', status: 'active', billing_cycle: 'yearly', current_period_start: '2026-01-01' }],
  monthly: [{ id: 's2', plan: 'premium_monthly', status: 'active', billing_cycle: 'monthly', current_period_start: '2026-09-01' }],
  none: [],
};
const fakeDb = { from: (t) => ({ select: () => ({
  in: async (col, hs) => ({ data: rows.filter((r) => t === 'profiles' && hs.includes(r.instagram)), error: null }),
  eq: (col, uid) => ({ in: async () => ({ data: (t === 'subscriptions' ? (subs[uid] || []) : []), error: null }) }),
}) }) };
const Y = { userId: 'yearly' }, M = { userId: 'monthly' }, N = { userId: 'none' }, A = { userId: 'x', isAdmin: true };
(async () => {
  let r = await C.validateCollaborators(fakeDb, ['@Prem'], Y);
  ok('연간 프리미엄 제출자 + 등록 회원 → 통과, {handle,userId} 저장형', r.ok && r.collaborators.length === 1 && r.collaborators[0].handle === 'prem' && r.collaborators[0].userId === 'u1', JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, ['@prem', '@std', '@expired'], Y);
  ok('지정받는 쪽은 등급 무관 — 스탠다드·만료 회원도 통과 (9/24: 무료 회원이라도 괜찮다)', r.ok && r.collaborators.map((c) => c.handle).join() === 'prem,std,expired', JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, ['@prem', '@nobody'], Y);
  ok('등록 안 된 아이디 → COLLAB_NOT_MEMBER + 문제 아이디만', !r.ok && r.code === 'COLLAB_NOT_MEMBER' && r.handles.join() === 'nobody', JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, ['@prem'], M);
  ok('월간 프리미엄 제출자 → COLLAB_YEARLY_PREMIUM_ONLY (고를 수 없다)', !r.ok && r.code === 'COLLAB_YEARLY_PREMIUM_ONLY', JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, ['@prem'], N);
  ok('무료 제출자 → COLLAB_YEARLY_PREMIUM_ONLY', !r.ok && r.code === 'COLLAB_YEARLY_PREMIUM_ONLY', JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, ['@prem'], undefined);
  ok('제출자 정보가 없으면 거부 (누가 고르는지 모르면 못 고른다)', !r.ok && r.code === 'COLLAB_YEARLY_PREMIUM_ONLY', JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, ['@std'], A);
  ok('관리자는 예외', r.ok && r.collaborators.length === 1, JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, ['한글'], Y);
  ok('무효 아이디 → COLLAB_HANDLE_INVALID', !r.ok && r.code === 'COLLAB_HANDLE_INVALID', JSON.stringify(r));
  r = await C.validateCollaborators(fakeDb, [], N);
  ok('비어 있으면 무료 제출자도 통과 (임의 지정 또는 미지정)', r.ok && r.collaborators.length === 0);
  r = await C.validateCollaborators(fakeDb, undefined, N);
  ok('필드 자체가 없어도 통과 (구 클라이언트)', r.ok && r.collaborators.length === 0);
  ok('canPickCollaborators: 연간 참 · 월간 거짓 · 무료 거짓 · 관리자 참',
    (await C.canPickCollaborators(fakeDb, Y)) === true && (await C.canPickCollaborators(fakeDb, M)) === false
    && (await C.canPickCollaborators(fakeDb, N)) === false && (await C.canPickCollaborators(fakeDb, A)) === true);

  console.log('\n=== 배선: 서버 ===');
  for (const f of ['api/submissions/index.js', 'api/submissions/[id].js']) {
    const src = read(f);
    ok(f + ' 가 validateCollaborators 에 제출자(userId·isAdmin)를 넘겨 검사하고 거부 코드를 그대로 낸다', /validateCollaborators\(supabaseAdmin, data\.collaborators, \{ userId: user\.id, isAdmin: user\.role === 'admin' \}\)/.test(src) && /_cv\.code/.test(src));
    ok(f + ' 가 collaborators 를 description 에 저장한다', /\n\s+collaborators,\s*\/\//.test(src));
    ok(f + ' 검사가 분류(classifySubmissionType)보다 앞', src.indexOf('validateCollaborators(supabaseAdmin') < src.indexOf('classifySubmissionType(looks'));
  }
  const chk = read('api/submissions/collaborator-check.js');
  ok('collaborator-check: GET·로그인 필수·회원 여부(member)+내 자격(canPick)만 (이름·이메일·등급 없음)', /requireAuth\(req, res\)/.test(chk) && /member: !!hit,/.test(chk) && /canPick: !!canPick,/.test(chk) && !/premium:/.test(chk) && !/email|name/.test(chk.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
  const fw = read('api/submissions/fee-waiver.js');
  ok('fee-waiver 응답에 yearlyPremium (폼의 공동작업자 칸 열쇠)', /yearlyPremium: c\.reason !== 'not_yearly_premium'/.test(fw));
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
  ok('폼 상한 MAX_COLLABORATORS=5 (서버와 동일)', /var MAX_COLLABORATORS=5;/.test(html));
  ok('폼 안내 문구의 "최대 5명" 9개 언어 (4 는 어디에도 없다)', (html.match(/collabDesc:'(?:[^'\\]|\\.)*(최대 5명|up to 5|bis zu 5|massimo 5|5 maximum|hasta 5|最大5名|最多 5 位|до 5)/g) || []).length === 9
    && !/collabDesc:'(?:[^'\\]|\\.)*(최대 4명|up to 4|bis zu 4|massimo 4|4 maximum|hasta 4|最大4名|最多 4 位|до 4)/.test(html));
  ok('폼 안내: 지정은 연간 프리미엄만 · 지정받는 쪽은 무료 회원 포함 — 9개 언어', (html.match(/collabDesc:'(?:[^'\\]|\\.)*(연간 프리미엄|Yearly Premium|Jahres-Premium|Premium annual|Premium annuel|Premium anual|年間プレミアム|年度高级|годовым Premium)/g) || []).length === 9
    && (html.match(/collabDesc:'(?:[^'\\]|\\.)*(무료 회원 포함|free members included|auch kostenlose|anche membri gratuiti|membres gratuits inclus|miembros gratuitos incluidos|無料会員も可|含免费会员|включая бесплатных)/g) || []).length === 9);
  ok('연간 프리미엄이 아니면 칸을 잠그고 안내(collabGateNote · collabYearlyOnly 9개 언어)', /id="collabGateNote"/.test(html) && /function _applyCollabGate\(yearly\)/.test(html)
    && (html.match(/collabYearlyOnly:'/g) || []).length === 9 && /if\(j && typeof j\.yearlyPremium==='boolean'\) _applyCollabGate/.test(html)
    && /if\(window\._papYearlyPremium===false\) return out;/.test(html));
  ok('입력 시 /api/submissions/collaborator-check 로 회원 확인', /\/api\/submissions\/collaborator-check\?handle=/.test(html) && /if\(res\.ok && j\.member\)/.test(html));
  ok('회원이면 등록, 아니면 경고 문구 (프리미엄 문구 키는 사라졌다)', /_t\('collabOk'/.test(html) && /_t\('collabNotMember'/.test(html) && !/collabNotPremium/.test(html));
  ok('payload 에 data.collaborators', /data\.collaborators=_collabHandles\(\);/.test(html));
  ok('제출 직전 전부 재확인해서 막는다', /var _cvf=await _collabVerifyAll\(\);/.test(html) && /_t\('collabBlock'/.test(html));
  ok('3단계 검증도 회원 아님을 막는다 (못 고르는 사람은 건너뛴다)', /window\._papYearlyPremium!==false && \(inp\.dataset\.state==='not_member'\|\|inp\.dataset\.state==='invalid'\)/.test(html));
  ok('서버 COLLAB_NOT_MEMBER · COLLAB_YEARLY_PREMIUM_ONLY 를 언어별 문구로', /code==='COLLAB_NOT_MEMBER'/.test(html) && /collabNotMemberApi:\{ko:/.test(html) && /code==='COLLAB_YEARLY_PREMIUM_ONLY'/.test(html) && /collabYearlyOnlyApi:\{ko:/.test(html));
  ok('재제출 때 저장된 공동작업자를 채운다', /desc\.collaborators/.test(html));
  const keys = ['sectionCollab', 'collabDesc', 'btnAddCollab', 'phCollab', 'collabOk', 'collabNotMember', 'collabInvalid', 'collabChecking', 'collabLogin', 'collabError', 'collabBlock', 'collabMax', 'collabYearlyOnly'];
  ok('폼 문구 13키 × 9개 언어', keys.every((k) => (html.match(new RegExp(k + ":'", 'g')) || []).length === 9), keys.map((k) => k + '=' + (html.match(new RegExp(k + ":'", 'g')) || []).length).join(' '));
  ok('"임의 지정 또는 미지정" 안내가 9개 언어에', (html.match(/collabDesc:'(?:[^'\\]|\\.)*(임의로|random|zufällig|a caso|au hasard|al azar|任意に|随机|случайно)/g) || []).length === 9);

  console.log('\n=== 마이페이지 / 관리자 ===');
  const mp = read('frontend/mypage.html');
  ok('마이페이지에 인스타그램 아이디 입력·저장', /id="mpIgInput"/.test(mp) && /_mpSaveInstagram/.test(mp) && /body:JSON\.stringify\(\{instagram:v,activityCountry:country,activityCity:city\}\)/.test(mp));
  ok('마이페이지 문구 9개 언어', ['labelInstagram', 'btnIgSave', 'igHint', 'igSaved', 'igTaken', 'igInvalid', 'igError'].every((k) => (mp.match(new RegExp(k + ":'", 'g')) || []).length === 9));
  ok('관리자 검토 모달에 공동작업자 표시', /id="reviewModalCollab"/.test(read('frontend/admin.html')) && /desc\.collaborators/.test(read('frontend/pap-admin.js')));
  ok('/submissions 랜딩이 연간 프리미엄 공동작업자 혜택(5명·무료 회원 포함)을 말한다', /Yearly Premium submitters choose up to 5 PAP members \(free members included\) to be tagged as Instagram collaborators/.test(read('frontend/submissions.html')));
  const sb = read('frontend/subscribe.html');
  ok('/subscribe 혜택 행이 "연간 프리미엄: 5명 지정" 으로 9개 언어 (옛 "지정 자격" 문구 없음)', (sb.match(/\['[^']*(연간 프리미엄|Yearly Premium|Годовой Premium|Jahres-Premium|Premium annuale|Premium annuel|Premium anual|年間プレミアム|年度高级会员)[^']*5[^']*',false,false,true\]/g) || []).length >= 9 && !/지정 자격|collaborator eligibility|Eligible to be tagged/.test(sb));

  console.log('\n=== 프리미엄 유지 중에만 · 활동 국가·도시 (도메니코 2차) ===');
  const rv = read('api/submissions/[id]/review.js');
  ok('승인 시 다시 판정: 제출자 연간 프리미엄 끊김 → 전부, 아이디 지움 → 그 사람만 (collaboratorsDropped)', /canPickCollaborators\(supabaseAdmin, \{ userId: submission\.user_id \}\)/.test(rv) && /picker_yearly_premium_lapsed/.test(rv) && /handle_removed/.test(rv) && !/'premium_lapsed'/.test(rv) && /desc\.collaboratorsDropped/.test(rv));
  ok('폼 안내에 "연간 프리미엄 유지 중에만, 끝나면 자동 종료" · 마이페이지에 "무료 회원도 지정받는다" 9개 언어', (html.match(/collabDesc:'(?:[^'\\]|\\.)*(자동으로 종료|ends automatically|endet automatisch|termina automaticamente|prend fin automatiquement|termina automáticamente|自動的に終了|自动结束|прекращается автоматически)/g) || []).length === 9
    && (mp.match(/igHint:'(?:[^'\\]|\\.)*(무료 회원도|Free members can|membri gratuiti|membres gratuits|miembros gratuitos|無料会員も|免费会员也|Бесплатных участников|kostenlose Mitglieder)/g) || []).length === 9
    && !/igHint:'(?:[^'\\]|\\.)*(프리미엄 자격이 유지|Premium membership stays active)/.test(mp));
  ok('check 응답·폼 등록 문구에 도시·국가를 노출하지 않는다 (아이디는 유일하므로 구분 불필요 — 도메니코 2026-09-12)', !/location:/.test(chk) && (html.match(/collabOk:'✓ @\{h\} /g) || []).length === 9 && !/\{loc\}/.test(html));
  ok('PUT /api/auth/me: 아이디 등록엔 활동 국가·도시 필수(ACTIVITY_LOCATION_REQUIRED), 저장·반환', /ACTIVITY_LOCATION_REQUIRED/.test(me) && /updates\.activity_country/.test(me) && /activityCountry: profile\.activity_country/.test(me));
  ok('마이페이지에 국가·도시 입력이 있고 저장 본문에 실린다', /id="mpCountryInput"/.test(mp) && /id="mpCityInput"/.test(mp) && /activityCountry:country,activityCity:city/.test(mp));
  ok('마이페이지 국가·도시 문구 9개 언어', ['labelActivityLocation', 'phCountry', 'phCity', 'igLocationRequired'].every((k) => (mp.match(new RegExp(k + ":'", 'g')) || []).length === 9));
  ok('마이그레이션 149: activity_country·activity_city', /activity_country TEXT/.test(read('supabase_migrations/149_profiles_activity_location.sql')) && /activity_city/.test(read('supabase_migrations/149_profiles_activity_location.sql')));

  console.log('\n=== 텔레그램 알림 (도메니코 2026-09-12: 지정되면 알려줘) ===');
  const lib = read('api/_lib/collaborators.js');
  ok('collaboratorAlertText 가 내보내지고 아이디·제출자·건수를 담는다', typeof C.collaboratorAlertText === 'function'
    && /@prem @std/.test(C.collaboratorAlertText('new', { id: 's1', title: 'T' }, [{ handle: 'prem' }, { handle: 'std' }], 'me'))
    && /2\/5/.test(C.collaboratorAlertText('new', { id: 's1', title: 'T' }, [{ handle: 'prem' }, 'std'], 'me'))
    && /재제출/.test(C.collaboratorAlertText('resubmit', { id: 's1', title: 'T' }, ['a'], 'me'))
    && C.collaboratorAlertText('new', { id: 's1' }, [], 'me') === '');
  ok('제출·재제출 API 가 공동작업자 있을 때만 sendTextToTelegramSafe 를 await 한다', ['api/submissions/index.js', 'api/submissions/[id].js'].every((f) => {
    const src = read(f);
    return /collaboratorAlertText/.test(src) && /if \(collaborators && collaborators\.length\) \{[\s\S]{0,200}await sendTextToTelegramSafe\(collaboratorAlertText\(/.test(src);
  }));
  ok('lib 의 lookupHandles 는 여전히 활동 국가·도시를 읽는다(관리자 참고용)', /activity_country, activity_city/.test(lib));

  console.log('\npassed: ' + passed + '   failed: ' + failed);
  if (failed) { console.log('❌ submission-collaborators FAILED'); process.exit(1); }
  console.log('✅ submission-collaborators passed');
})();
