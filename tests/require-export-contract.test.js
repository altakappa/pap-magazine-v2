/**
 * import 한 이름이 실제로 export 되어 있는가 — 전 저장소 전수 (2026-08-11).
 *
 * [왜 생겼나]
 * api/_lib/submissionPayment.js 의 module.exports 에 storedSubmissionType 이
 * 빠져 있었다. api/_lib/paypalOrders.js 는 그 이름으로 구조분해 import 했고
 * 값은 undefined 였다. 호출하는 순간 TypeError → 500.
 *   → €380 / €790 기본 게재료 결제가 100% 실패했다. 3주간 아무도 몰랐다.
 *     실제 고객 3명이 8번 시도해 전건 실패로 남아 있다.
 *
 * [왜 기존 테스트가 못 잡았나]
 * 우리 테스트는 대부분 파일을 문자열로 읽어 정규식으로 본다. 그 방식으로는
 * "이 이름이 정말 export 되었는가" 가 보이지 않는다. 정규식으로 exports 블록을
 * 파싱하려는 시도도 주석·중첩 때문에 오탐이 난다(실제로 났다).
 *
 * [그래서 이 파일은 실제로 require 한다.]
 * 문자열 검사가 아니라 Node 가 실제로 모듈을 로드하고 typeof 를 본다.
 * 느리지만 이 종류의 사고는 이 방법 말고 잡을 길이 없다.
 */
'use strict';
// supabase 등 일부 _lib 는 로드 시점에 클라이언트를 만든다. env 가 없으면 던져서
// 검사에서 통째로 빠진다(그러면 정작 중요한 파일들을 못 본다). 더미 값을 넣어 로드시킨다.
// 실제 통신은 하지 않는다 — require 만 한다.
for (const [k, v] of Object.entries({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_KEY: 'test-service-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
/* 2026-08-12 — `if (!process.env[k])` 를 뗀다. 이 가드 때문에 CI 가 10커밋 동안 빨간불이었다.
   증상: 로컬은 26/26 통과, CI 만 `api/_lib/auth.js` · `api/_lib/supabase.js` 로드 실패로 21/23.
   같은 커밋·같은 lock·같은 supabase-js(2.110.6) 인데 결과가 달랐다.
   남은 차이는 '실행 환경에 그 이름의 값이 이미 있느냐' 뿐이다 — 값이 비어 있지 않으면
   가드가 더미를 덮어쓰지 않으므로, 쓸 수 없는 값이 그대로 createClient 에 들어간다.
   이 테스트는 require 만 하고 실제 통신을 하지 않으므로 무조건 더미로 덮는 편이 옳다. */
})) process.env[k] = v;

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

// 주석을 지운 사본에서 찾는다 — 주석 안의 예시 코드가 오탐을 만든다.
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(path.join(ROOT, 'api'));
console.log(`\n=== 대상: api/ 아래 .js ${files.length}개 ===`);
t('스캔 대상이 충분히 많다', files.length > 100, String(files.length));

const RE = /const\s*\{([^}]+)\}\s*=\s*require\(\s*'(\.[^']+)'\s*\)/g;
const missing = [];
const unloadable = [];
let importCount = 0, edgeCount = 0;

for (const f of files) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src))) {
    const names = m[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean);
    const rel = m[2];
    let target = path.resolve(path.dirname(f), rel);
    if (!target.endsWith('.js')) target += '.js';
    if (!fs.existsSync(target)) { missing.push(`${path.relative(ROOT,f)} → ${rel} (파일 없음)`); continue; }

    let mod;
    try { mod = require(target); }
    catch (e) { unloadable.push(`${path.relative(ROOT,target)}: ${e.message.slice(0,90)}`); continue; }
    edgeCount++;

    for (const n of names) {
      if (!/^[A-Za-z_$][\w$]*$/.test(n)) continue;
      importCount++;
      if (!(n in mod)) {
        missing.push(`${path.relative(ROOT,f)}\n       require('${rel}') 의 «${n}» 가 export 되지 않음`);
      }
    }
  }
}

console.log(`\n=== 검사한 import 이름 ${importCount}개 / 연결 ${edgeCount}건 ===`);
t('import/export 불일치 0건', missing.length === 0, missing.join('\n     '));

// 로드 자체가 안 되는 모듈은 별도로 알린다(환경변수 없이 못 켜지는 것 등).
if (unloadable.length) {
  console.log('\n  ℹ️  로드하지 못한 모듈(참고, 실패로 세지 않음):');
  for (const u of [...new Set(unloadable)].slice(0, 10)) console.log('     ', u);
}

console.log('\n=== 결제 경로는 특히 못 박는다 ===');
const payPairs = [
  ['api/_lib/paypalOrders.js',            ['resolveAmount','centsToValue','paypalFetch','buildCustomId','parseCustomId']],
  ['api/_lib/submissionPayment.js',       ['feeForType','storedSubmissionType','SUBMISSION_FEE_CENTS']],
  ['api/_lib/cancelProviderSubscription.js', ['cancelProviderSubscription']],
  // 결제 확정(capture) 경로 — 실제 돈이 오갈 때만 실행되므로 라이브 테스트가 어렵다.
  // 최소한 import 가 전부 실재하는지는 여기서 매번 확인한다.
  ['api/_lib/auth.js',     ['requireAuth','requireAuthStrict']],
  ['api/_lib/cors.js',     ['handleCors']],
  ['api/_lib/rateLimit.js',['rateLimit','RATE_LIMITS']],
  ['api/_lib/telegram.js', ['sendTextToTelegramSafe']],
  ['api/_lib/supabase.js', ['supabaseAdmin']],
];
for (const [rel, names] of payPairs) {
  let mod = null;
  let loadErr = null;
  try { mod = require(path.join(ROOT, rel)); } catch (e) { loadErr = (e && e.message) || String(e); }
  /* 실패하면 반드시 '왜' 를 남긴다 — 이유 없는 ✗ 는 CI 로그를 봐도 알 수가 없다.
     이번에 그것 때문에 원인 좁히는 데만 여러 번 왕복했다. */
  t(`${rel} 로드된다`, !!mod, loadErr);
  if (mod) for (const n of names) {
    t(`  ${rel} → ${n}`, typeof mod[n] === 'function' || typeof mod[n] === 'object', `typeof=${typeof mod[n]}`);
  }
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ require-export-contract tests FAILED'); process.exit(1); }
console.log('✅ require-export-contract tests passed');
// 라이브러리를 실제로 require 하다 보면 열린 핸들(supabase 클라이언트 등)이 남아
// 프로세스가 안 끝난다. 검사는 끝났으므로 강제 종료한다.
process.exit(0);
