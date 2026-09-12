/**
 * 프로필 국가·도시 + 안내창 (도메니코 2026-09-12)
 *   "나라 및 국가를 쓰는 이유는 나중에 커뮤니티에서 크리에이터들 자동매치 기능을 위해서" →
 *   국가는 ISO 3166-1 alpha-2 코드로 저장(드롭다운), 도시는 정리해서 저장.
 *   "프리미엄뿐 아니라 모든 회원의 인스타그램 아이디·국가·도시 설문·DB 확보" →
 *   로그인 후 안내창(pap-profile-prompt.js) + 마이페이지. 가입 절차 코드는 건드리지 않는다.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'api', '_lib', 'countries'));
let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { passed++; console.log('  ✓ ' + l); } else { failed++; console.log('  ✗ ' + l + (d ? ' — ' + d : '')); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

console.log('\n=== 국가 목록 ===');
ok('ISO alpha-2 249개, 코드 유일', C.COUNTRIES.length === 249 && new Set(C.COUNTRIES.map((c) => c[0])).size === 249);
ok('코드 형식 AA', C.COUNTRIES.every((c) => /^[A-Z]{2}$/.test(c[0]) && c[1]));
global.window = {}; eval(read('frontend/pap-countries.js'));
ok('프론트 목록이 서버 목록과 같다', JSON.stringify(global.window.PAP_COUNTRIES) === JSON.stringify(C.COUNTRIES));
ok('papCountryName: 현재 언어 이름, 폴백 영어', global.window.papCountryName('IT', 'ko') === '이탈리아' && global.window.papCountryName('KR', 'en') === 'South Korea');
const sel = { innerHTML: '' }; global.window.papCountryOptions(sel, 'ja', 'IT');
ok('papCountryOptions: 빈 옵션 + 249개, 선택값 유지', (sel.innerHTML.match(/<option/g) || []).length === 250 && /value="IT" selected/.test(sel.innerHTML));

console.log('\n=== 정규화 ===');
ok('normalizeCountryCode: 코드·영어 이름 → 코드, 그 외 빈값', C.normalizeCountryCode('it') === 'IT' && C.normalizeCountryCode('South Korea') === 'KR' && C.normalizeCountryCode('이탈리아') === '' && C.normalizeCountryCode('') === '');
ok('normalizeCity: 공백 정리 + 첫 글자 대문자, 80자', C.normalizeCity('  milan   city ') === 'Milan City' && C.normalizeCity("saint-tropez d'or") === "Saint-Tropez D'Or" && C.normalizeCity('a'.repeat(100)).length === 80 && C.normalizeCity('서울') === '서울');
ok('countryName', C.countryName('it') === 'Italy' && C.countryName('ZZ') === '');

console.log('\n=== PUT /api/auth/me ===');
const me = read('api/auth/me.js');
ok('국가는 normalizeCountryCode 로 코드 저장, 모르면 400 COUNTRY_INVALID', /normalizeCountryCode\(activityCountry\)/.test(me) && /COUNTRY_INVALID/.test(me));
ok('도시는 normalizeCity 로 정리', /normalizeCity\(activityCity\)/.test(me));
ok('공동작업자 확인 응답의 위치는 국가 이름으로 보여준다', /countryName\(p\.activity_country\)/.test(read('api/_lib/collaborators.js')));

console.log('\n=== 마이페이지 ===');
const mp = read('frontend/mypage.html');
ok('국가가 드롭다운(select#mpCountryInput)이고 pap-countries.js 를 읽는다', /<select id="mpCountryInput"/.test(mp) && /pap-countries\.js\?v=\d/.test(mp) && /papCountryOptions\(ci/.test(mp));
ok('COUNTRY_INVALID 문구 9개 언어', (mp.match(/igCountryInvalid:'/g) || []).length === 9);

console.log('\n=== 로그인 후 안내창 (pap-profile-prompt.js) ===');
const pp = read('frontend/pap-profile-prompt.js');
const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
ok('9개 언어 미니 사전(title·body·ig·country·city·save·later·saved·오류 4종)', LANGS.every((l) => new RegExp('\\n    ' + l + ': \\{ title:').test(pp)) && ['errCountry', 'errCity', 'errTaken', 'errIg', 'errGeneric'].every((k) => (pp.match(new RegExp(k + ": '", 'g')) || []).length === 9));
ok('국가·도시가 이미 있으면 뜨지 않고 done 표시', /u\.activityCountry && u\.activityCity/.test(pp) && /DONE_KEY, '1'/.test(pp));
ok('"나중에" 는 7일 뒤 다시', /7 \* 24 \* 3600 \* 1000/.test(pp));
ok('관리자·마이페이지·서브미션·인증 화면에서는 안 뜬다', /\(admin\|studio-admin\|ops-dashboard\|site-analysis\|mypage\|submission\|auth\|pepperit\)/.test(pp));
ok('저장은 PUT /api/auth/me 하나로(가입 절차 코드 무접촉)', /fetch\('\/api\/auth\/me', \{ method: 'PUT'/.test(pp) && !fs.readFileSync(path.join(ROOT, 'api', 'auth', 'signup.js'), 'utf8').includes('activityCountry'));
ok('안내창 자체는 런타임 번역·브라우저 번역 대상에서 뺀다(translate=no, data-ui-i18n-skip)', /setAttribute\('translate', 'no'\)/.test(pp) && /data-ui-i18n-skip/.test(pp));
let wired = 0, skipped = [];
for (const f of fs.readdirSync(path.join(ROOT, 'frontend')).filter((x) => x.endsWith('.html'))) {
  const h = read('frontend/' + f);
  if (!/pap-ui-i18n\.js\?v=\d/.test(h)) continue;
  const has = /pap-profile-prompt\.js\?v=\d/.test(h);
  if (/^(admin|studio-admin|ops-dashboard|site-analysis|pepperit|mypage|submission|auth)\.html$/.test(f)) { if (has) skipped.push(f); continue; }
  if (has) wired++; else skipped.push(f);
}
ok('공개 페이지 전부에 안내창 스크립트 배선, 제외 페이지엔 없음 (' + wired + '개)', wired >= 25 && skipped.length === 0, skipped.join(','));
ok('SSR 셸(기사·화보·기여자·파트너·브랜드·아카이브)에도 배선', ['api/_lib/seoRenderer.js', 'api/_lib/contributorProfile.js', 'api/seo/brand/[id].js', 'api/seo/partners.js', 'api/seo/archive.js'].every((f) => /pap-profile-prompt\.js\?v=\d/.test(read(f))));

console.log('\n=== PUT /api/auth/me 를 실제로 돌린다 (2026-09-12 사고: updates 선언 전 사용 → 국가·도시 실린 PUT 전부 500) ===');
(async () => {
  const Module = require('module');
  // 체인형 가짜 supabase: update().eq().select().single() 은 저장값을 되돌려주고, select 체인은 빈 결과.
  function chain(kind, u) {
    const c = {};
    ['eq', 'neq', 'limit', 'select', 'update'].forEach((m) => { c[m] = (a) => (m === 'update' ? chain('update', a) : c); });
    c.single = async () => ({ data: Object.assign({ id: 'u1', email: 'a@b', subscription_plan: 'free' }, u || {}), error: null });
    c.maybeSingle = async () => ({ data: null, error: null });
    c.then = (fn) => Promise.resolve({ data: [], error: null }).then(fn);   // await .limit(1)
    return c;
  }
  const stubs = {
    '_lib/supabase': { supabaseAdmin: { from: () => chain('select') } },
    '_lib/auth': { requireAuth: () => ({ id: 'u1' }), requireAuthStrict: async () => ({ id: 'u1' }) },
    '_lib/cors': { handleCors: () => false },
    '_lib/rateLimit': { rateLimit: () => false, RATE_LIMITS: { api: {} } },
    '_lib/emailLocale': { countryFromRequest: () => '' },
  };
  const origLoad = Module._load;
  Module._load = function (request, parent, ...rest) {
    for (const k of Object.keys(stubs)) if (request.endsWith(k)) return stubs[k];
    return origLoad.call(this, request, parent, ...rest);
  };
  let handler;
  try { handler = require(path.join(ROOT, 'api', 'auth', 'me.js')); } finally { Module._load = origLoad; }
  function run(body) {
    return new Promise((resolve) => {
      const res = { _s: 200, status(c) { this._s = c; return this; }, json(j) { resolve({ status: this._s, body: j }); }, setHeader() {} };
      handler({ method: 'PUT', body, headers: {} }, res).catch((e) => resolve({ status: 'threw', body: String(e) }));
    });
  }
  let r = await run({ activityCountry: 'Italy', activityCity: 'milan' });
  ok('국가·도시만 보내면 200 + 코드·정리된 도시 (500 이 아니다)', r.status === 200 && r.body.user && r.body.user.activityCountry === 'IT' && r.body.user.activityCity === 'Milan', JSON.stringify(r));
  r = await run({ activityCountry: 'Narnia' });
  ok('모르는 국가 → 400 COUNTRY_INVALID', r.status === 400 && r.body.code === 'COUNTRY_INVALID', JSON.stringify(r));
  r = await run({ instagram: '@Pap_Magazine', activityCountry: 'KR', activityCity: 'seoul' });
  ok('아이디+국가+도시 → 200, 아이디 정규화', r.status === 200 && r.body.user.instagram === 'pap_magazine', JSON.stringify(r));
  r = await run({ instagram: '@x' });
  ok('아이디만 → 400 ACTIVITY_LOCATION_REQUIRED', r.status === 400 && r.body.code === 'ACTIVITY_LOCATION_REQUIRED', JSON.stringify(r));
  const src = read('api/auth/me.js');
  ok('updates 선언이 첫 사용보다 앞에 있다', src.indexOf('const updates = {}') < src.indexOf('updates.activity_country'));

  console.log('\npassed: ' + passed + '   failed: ' + failed);
  if (failed) { console.log('❌ profile-location FAILED'); process.exit(1); }
  console.log('✅ profile-location passed');
})();
