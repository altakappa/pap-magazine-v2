/**
 * CI 의 Node 버전이 의존성이 요구하는 것보다 낮으면 실패시킨다 (2026-08-12).
 *
 * ■ 무슨 일이 있었나
 * harness-integration 이 10커밋 동안 빨간불이었다.
 *     로컬  passed: 26  failed: 0
 *     CI    passed: 21  failed: 2   ← api/_lib/auth.js · supabase.js 로드 실패
 * 같은 커밋·같은 package-lock·같은 supabase-js(2.110.6)인데 결과가 달랐다.
 *
 * ■ 원인 (실측으로 확정)
 * @supabase/supabase-js 2.110 계열은 engines node>=22 이고, 그 안의 realtime-js 가
 * **전역 WebSocket** 을 쓴다. Node 22 부터 있는 물건이다. CI 는 Node 20 이었다.
 * 전역 WebSocket 을 지우고 로드해 그대로 재현했다:
 *     node -e "delete globalThis.WebSocket; require('./api/_lib/supabase.js')"
 *     → Node.js detected but native WebSocket not found.
 *        Suggested solution: Ensure you are running Node.js 22+ …
 * 로컬은 Node 22.22.3, 라이브(Vercel)는 Node 24.x 라 둘 다 멀쩡했다.
 * **CI 만 뒤처져 있었고, 그래서 CI 만 죽었다.**
 *
 * ■ 내가 처음에 틀렸던 것 (기록해 둔다)
 * "CI 환경에 SUPABASE_URL 이 이미 있어서 더미가 안 덮인다" 고 추정했다.
 * 저장소 Settings → Variables 를 열어보니 **변수가 하나도 없었다.** 가설은 틀렸다.
 * 증상을 재현했다고 원인을 맞힌 게 아니다 — 오염된 env 로도 같은 증상이 나올 뿐이었다.
 *
 * ■ 이 테스트가 지키는 것
 * package.json 의 engines 와 워크플로의 node-version 이 어긋나지 않게 한다.
 * 의존성이 node 를 올려도 CI 만 옛 버전에 남는 상황을 기계가 잡는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/test.yml'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

function majorOf(range) {
  const m = String(range || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/* 의존성이 요구하는 최대 major — node_modules 가 있을 때만 잰다.
   CI 는 npm ci 를 먼저 돌리므로 항상 있다. 로컬에 없으면 이 검사만 건너뛴다. */
function requiredMajorFromDeps() {
  const names = Object.keys(pkg.dependencies || {});
  let max = 0, who = '';
  for (const n of names) {
    try {
      const p = require.resolve(path.join(n, 'package.json'), { paths: [ROOT] });
      const eng = (JSON.parse(fs.readFileSync(p, 'utf8')).engines || {}).node;
      const mj = majorOf(eng);
      if (mj > max) { max = mj; who = n + ' (' + eng + ')'; }
    } catch (_) { /* 설치 안 됨 — 건너뛴다 */ }
  }
  return { max, who };
}

console.log('\n=== CI node-version ===');
const wfMatch = wf.match(/node-version:\s*'?(\d+)/);
t('워크플로에 node-version 이 있다', !!wfMatch);
const ciMajor = wfMatch ? parseInt(wfMatch[1], 10) : 0;
const pkgMajor = majorOf((pkg.engines || {}).node);

t('package.json 에 engines.node 가 있다', pkgMajor > 0);
t(`CI(${ciMajor}) 가 engines(${pkgMajor}) 이상이다`, ciMajor >= pkgMajor,
  'CI 가 낮으면 로컬·라이브는 멀쩡한데 CI 만 죽는다 — 가장 찾기 어려운 종류다');

const dep = requiredMajorFromDeps();
if (dep.max > 0) {
  t(`engines(${pkgMajor}) 가 의존성 요구치(${dep.max}) 이상이다`, pkgMajor >= dep.max,
    '가장 높은 요구: ' + dep.who);
  t(`CI(${ciMajor}) 가 의존성 요구치(${dep.max}) 이상이다`, ciMajor >= dep.max,
    '가장 높은 요구: ' + dep.who);
} else {
  console.log('  · node_modules 없음 — 의존성 요구치 검사 건너뜀');
}

console.log('=== 왜 이 값이 중요한가 (문서 고정) ===');
t('워크플로에 재발 방지 근거가 적혀 있다', /native WebSocket not found/.test(wf),
  '숫자만 바꿔두면 다음 사람이 이유를 모르고 되돌린다');

/* ── 스모크 테스트가 우리 봇 보호에 막히지 않게 (2026-09-14) ────────────────
 * 실측. 런 #1261·#1262·#1263 이 5분 내내 `HTTP 429 /pap-i18n.js?v=1` 만 받고
 * 죽었다. 마커가 없어서가 아니라 파일을 못 받아서다 — 같은 시각 브라우저로
 * 열면 마커가 멀쩡히 있었다. 429 를 낸 건 레이트리밋이 아니라
 * **Vercel 봇 보호의 챌린지**다 (Rate Limit 규칙 0/40 · 실제 Rate Limited 없음 ·
 * Attack Mode 꺼짐 · Bot Protection Active · 하루 Challenged 2.3k).
 * 챌린지는 JS 를 풀어야 통과하는데 깃허브 러너는 브라우저가 아니라 못 푼다.
 *
 * 고친 방식: 브라우저인 척하지 않고 **우리라고 밝힌다.** 전용 헤더를 보내고
 * Vercel System Bypass 규칙이 그 헤더만 통과시킨다. 봇 보호는 그대로 산다.
 * 아래 세 개가 그 연결을 고정한다 — 하나라도 끊기면 다시 429 로 돌아간다. */
console.log('=== 스모크가 봇 보호에 막히지 않는다 ===');
const smoke = fs.readFileSync(path.join(ROOT, 'tests/production-smoke.test.js'), 'utf8');

t('스모크의 모든 fetch 가 식별 헤더를 보낸다',
  !/fetch\(`\$\{PROD\}[^`]*`,\s*\{(?![^}]*smokeHeaders)/.test(smoke),
  '헤더 없는 fetch 가 남아 있다 — 그 요청만 429 로 막힌다');

t('헤더 값은 코드에 박지 않고 env 에서 온다', /process\.env\.PAP_SMOKE_TOKEN/.test(smoke),
  '토큰을 소스에 박으면 공개 저장소에 비밀이 새고 우회 열쇠가 된다');

t('워크플로가 같은 이름의 시크릿을 넘긴다',
  /PAP_SMOKE_TOKEN:\s*\$\{\{\s*secrets\.PAP_SMOKE_TOKEN\s*\}\}/.test(wf),
  '이름이 어긋나면 토큰이 빈 값으로 가고 조용히 429 로 돌아간다');

t('토큰이 없으면 시작하자마자 크게 알린다', /warnIfNoToken/.test(smoke),
  '5분 기다렸다가 이유 모르고 죽는 게 제일 나쁘다');

t('브라우저 User-Agent 흉내를 내지 않는다',
  !/Mozilla\/5\.0/.test(smoke),
  '우리 봇 보호를 우회하는 수법을 우리가 먼저 쓰면 같은 수법의 진짜 봇도 통과한다');

t('왜 이렇게 했는지 근거가 소스에 남아 있다', /429/.test(smoke) && /Bot Protection|봇 보호/.test(smoke),
  '이유가 없으면 다음 사람이 헤더를 지운다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ ci-node-version tests FAILED'); process.exit(1); }
console.log('✅ ci-node-version tests passed');
