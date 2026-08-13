/**
 * 2026-08-13 — '이달의 에디토리얼' 이 실제로 홈 메인에 걸린다.
 *
 * ■ 왜 필요한가
 *   submission.html 이 9개 언어로 크리에이터에게 이렇게 약속하고 있다:
 *     "매월 최우수 에디토리얼 1편을 선정해 한 달간 홈페이지 메인에 노출하고
 *      PAP 공식 소셜 채널에서 홍보합니다."
 *   그런데 그 '메인 노출' 을 하는 코드가 **하나도 없었다.** 약속만 있고 구현이
 *   없는 상태로 유료 투고를 받아 왔다. 돈이 걸린 페이지에서 못 지킬 약속을
 *   하는 것은 문구 오류가 아니라 신뢰 문제다(2026-08-13 게재료 문구 건과 같다).
 *
 * ■ 이 테스트가 고정하는 것
 *   1. 배너 API 가 이번 달 지정분을 마지막 슬라이드로 붙인다
 *   2. 조회가 실패해도 커버 배너는 그대로 나간다 (부수 기능이 주 기능을 막지 않는다)
 *   3. 지정은 그 달 1일로 정규화되고, 한 달에 한 편만 남는다
 *   4. 어드민에 지정/해제 버튼이 있고 발행된 건에만 붙는다
 *   5. 히어로 회전 간격이 도메니코가 요청한 값이다
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const codeOf = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? ('\n      → ' + detail) : ''));
  console.log('  ✗ ' + name + (detail ? (' — ' + detail) : ''));
}

const banners = codeOf(read('api/banners/index.js'));
const edPut   = codeOf(read('api/editorials/[id].js'));
const edList  = codeOf(read('api/editorials/index.js'));
const admin   = codeOf(read('frontend/pap-admin.js'));
const shell   = codeOf(read('frontend/pap-shell-bootstrap.js'));

console.log('=== 1. 배너 API 가 이번 달 지정분을 붙인다 ===');
{
  ok("featured_month 로 이번 달만 조회한다",
    /\.eq\('featured_month', monthKey\)/.test(banners)
    && /monthStart\.setUTCDate\(1\)/.test(banners),
    '달이 지나면 자동으로 빠져야 한다 — 지난 달 최우수작이 계속 걸리면 안 된다');
  ok('발행된 건만 올린다',
    /\.eq\('featured_month', monthKey\)[\s\S]{0,120}\.eq\('status', 'published'\)/.test(banners),
    '초안을 메인에 걸 수는 없다');
  ok("슬라이드 문구가 'EDITORIAL OF THE MONTH' 다",
    /issue: 'EDITORIAL OF THE MONTH'/.test(banners),
    '커버 슬라이드와 구별돼야 수상작이라는 게 전달된다');
  ok('링크가 그 에디토리얼로 간다',
    /link_url: eom\.slug \? \('\/editorial\/' \+ eom\.slug\)/.test(banners));
  ok('이미지가 없으면 붙이지 않는다',
    /eom && eom\.cover_image/.test(banners),
    '빈 슬라이드가 도는 것이 안 도는 것보다 나쁘다');
  ok('커버 그룹 뒤에 붙는다 (out.push)',
    banners.indexOf('out.push(') > banners.indexOf("from('cover_groups')"));
  ok("합성 그룹 id 가 실제 행과 구별된다 ('eom-' 접두사)",
    /id: 'eom-' \+ eom\.id/.test(banners),
    '어드민 커버 화면이 이 id 로 저장을 시도하면 안 된다');
}

console.log('=== 2. 부수 기능이 주 기능을 막지 않는다 ===');
{
  ok('조회 실패해도 커버 배너는 나간다 (try/catch + 에러 시 무시)',
    /try \{[\s\S]{0,1400}editorial-of-month[\s\S]{0,600}catch \(e\)/.test(banners)
    && /eomErr[\s\S]{0,120}console\.error/.test(banners),
    '2026-08-12 가드와 같은 원칙 — 부수 조회 실패가 주 화면을 죽이면 더 큰 사고다');
}

console.log('=== 3. 한 달에 한 편, 그 달 1일로 정규화 ===');
{
  ok('featured_month 는 allowed 배열로 그냥 통과시키지 않는다',
    !/'featured_month'[,\s]*\n?\s*\]\.join|allowed = \[[\s\S]{0,900}'featured_month'/.test(edPut),
    '값을 그대로 저장하면 정규화도, 중복 해제도 안 된다');
  ok('그 달 1일로 정규화한다',
    /d\.setUTCDate\(1\)/.test(edPut));
  ok('같은 달의 다른 편을 먼저 내려놓는다',
    /\.update\(\{ featured_month: null \}\)[\s\S]{0,120}\.eq\('featured_month', monthKey\)[\s\S]{0,60}\.neq\('id', id\)/.test(edPut),
    'DB unique index 만 믿으면 저장이 그냥 실패하고 관리자는 이유를 모른다');
  ok('null 이면 해제된다',
    /raw === null \|\| raw === ''[\s\S]{0,80}featured_month = null/.test(edPut));
  ok('형식이 틀리면 400 이다',
    /isNaN\(d\.getTime\(\)\)[\s\S]{0,120}status\(400\)/.test(edPut));
}

console.log('=== 4. 어드민에서 한 번에 지정한다 ===');
{
  ok('목록 API 가 featured_month 를 내려준다',
    /'featured_month'/.test(edList),
    '없으면 별표가 켜졌는지 그릴 수 없다');
  ok('지정/해제 함수가 있다', /async function toggleEditorialOfMonth\(/.test(admin));
  ok('발행된 건에만 버튼이 붙는다',
    /if\(st==='published'\)\{[\s\S]{0,600}toggleEditorialOfMonth/.test(admin));
  ok('현재 달 판정이 UTC 기준으로 API 와 같다',
    /getUTCFullYear\(\)[\s\S]{0,120}getUTCMonth\(\)\+1[\s\S]{0,60}'-01'/.test(admin),
    '로컬 시간으로 계산하면 월말·월초에 화면과 서버가 어긋난다');
  ok('확인창이 "한 달에 한 편" 과 "자동 해제" 를 알린다',
    /한 편만 지정됩니다/.test(admin) && /달이 바뀌면 자동으로 내려갑니다/.test(admin));
}

console.log('=== 4b. 전용 화면이 "지금 무엇이 걸려 있는지" 를 보여준다 ===');
{
  const html = read('frontend/admin.html');
  ok('사이드바에 항목이 있다', /go\('eom',this\)/.test(html));
  ok('탭 컨테이너가 있다 (라우팅 화이트리스트는 DOM 에서 만들어진다)',
    /class="tab" id="t-eom"/.test(html),
    'id 가 t-eom 이어야 /admin/eom 새로고침이 동작한다');
  ok('화면에 진입하면 데이터를 불러온다',
    /if\(id==='eom'\) loadEditorialOfMonth\(\);/.test(admin));
  ok('렌더 함수가 있다', /async function loadEditorialOfMonth\(/.test(admin));
  ok('미지정 상태를 눈에 띄게 알린다',
    /아직 지정하지 않았습니다/.test(admin),
    '매달 챙겨야 하는 일이라 화면이 상기시켜야 한다 — 잊으면 약속이 조용히 깨진다');
  ok('이번 달 발행분을 기간으로 잘라서 가져온다 (전량 순회 금지)',
    /status=published&from=' \+ monthKey \+ '&to=' \+ lastDay/.test(admin),
    '2,298편을 전부 받으면 목록 관리가 불가능해진다 — 기존 주석이 경고하는 지점');
  ok('지난 선정 기록을 보여준다', /featured=1/.test(admin) && /지난 선정/.test(admin),
    '같은 편을 두 번 뽑는 사고를 막는다');
  ok('지정 후 목록과 전용 화면이 둘 다 갱신된다',
    /loadEditorialOfMonth\(\); \}catch\(_\)\{ \} \}[\s\S]{0,60}await loadEditorials\(\);/.test(admin),
    '한쪽만 갱신하면 다른 쪽 별표가 옛 상태로 남는다');
  ok('목록 API 가 featured=1 필터를 지원한다',
    /req\.query\.featured[\s\S]{0,120}\.not\('featured_month', 'is', null\)/.test(edList));
}

console.log('=== 5. 히어로 회전 속도 (도메니코 요청 0.7배) ===');
{
  const m = shell.match(/const HERO_INTERVAL_MS = (\d+);/);
  ok('HERO_INTERVAL_MS 가 정의돼 있다', !!m);
  ok('간격이 7143ms 다 (5000 ÷ 0.7)', !!m && m[1] === '7143',
    m ? ('현재 ' + m[1] + 'ms') : '없음');
}

console.log('=== 6. 캐시버스트가 올라가 있다 ===');
{
  const idx = read('frontend/index.html');
  const bm = idx.match(/pap-shell-bootstrap\.js\?v=(\d+)/);
  ok('index.html 의 pap-shell-bootstrap.js 가 v11 이상이다',
    !!bm && parseInt(bm[1], 10) >= 11, bm ? ('현재 v' + bm[1]) : '태그 없음');
  const ah = read('frontend/admin.html');
  const am = ah.match(/pap-admin\.js\?v=(\d+)/);
  ok('admin.html 의 pap-admin.js 가 v151 이상이다',
    !!am && parseInt(am[1], 10) >= 151, am ? ('현재 v' + am[1]) : '태그 없음');
}

console.log('\n=== SUMMARY ===');
if (fails.length) {
  console.error('passed: ' + pass + '   failed: ' + fails.length);
  fails.forEach((f, i) => console.error('  ' + (i + 1) + ') ' + f));
  process.exit(1);
}
console.log('passed: ' + pass + '   failed: 0');
console.log('✓ hero-editorial-of-month tests passed');
process.exit(0);
