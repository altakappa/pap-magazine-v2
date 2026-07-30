/**
 * 크론 알림 체인이 npm 패키지를 "로드만 해도" 요구하지 않게 지킨다 (2026-07-30 신설).
 *
 * 왜 필요했나 — 2026-07-30 CI 실패:
 *   CI(.github/workflows/test.yml)는 `npm ci` 를 하지 않고 `npm test` 를 돌린다.
 *   하네스 테스트가 npm 패키지를 건드리지 않는 동안은 통과해 왔는데,
 *   backfill-translations 크론을 withCronGuard 로 감싼 순간 체인이 생겼다:
 *
 *     seo-translate-backfill.test.js → api/cron/backfill-translations.js
 *       → _lib/cronGuard → _lib/email    → nodemailer               (MODULE_NOT_FOUND)
 *                        → _lib/telegram → _lib/brandImage → sharp  (MODULE_NOT_FOUND)
 *
 *   로컬은 node_modules 가 있어 통과했다. CI 에서만 죽는, 가장 찾기 어려운 종류다.
 *
 * 왜 이 테스트인가 (CI 에 npm ci 를 넣는 것과의 차이):
 *   npm ci 는 CI 에서만, 즉 푸시한 뒤에 알려준다. 이 테스트는 커밋 전에 로컬에서
 *   잡는다. 둘은 배타적이지 않고, 이쪽이 먼저 울리는 게 낫다.
 *
 * 무엇을 강제하나:
 *   cronGuard 에서 상대경로 require 로 도달하는 모든 모듈은, 파일 최상단에서
 *   package.json dependencies 의 패키지를 require 하지 않아야 한다.
 *   무거운 의존(nodemailer·sharp 등)은 실제로 쓰는 함수 안에서 불러온다.
 *   부수 효과로 서버리스 콜드스타트도 가벼워진다 — cronGuard 는 15개 크론에 딸려온다.
 *
 * 판별 방식(휴게스틱, 의도적으로 단순하게):
 *   들여쓰기가 없는 줄(= 최상단 스코프)의 require 만 '즉시 로드' 로 본다.
 *   함수 안의 지연 로드는 반드시 들여쓰기가 있으므로 이 규칙으로 갈린다.
 *   AST 파서를 쓰지 않는 이유: 이 저장소 테스트는 의존성 없이 돌아야 한다(위 사건의 교훈).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEPS = Object.keys(require(path.join(ROOT, 'package.json')).dependencies || {});

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

/* 예외 — 반드시 근거를 함께 적는다. 근거 없이 늘리면 이 테스트는 무의미해진다. */
const ALLOW = {
  'api/_lib/supabase.js':
    '테스트가 이 경로를 require.cache 주입으로 항상 스텁한다(네트워크·키 없이 로직만 검증). ' +
    '실제로 로드되지 않으므로 @supabase/supabase-js 가 없어도 통과한다.',
};

/** 최상단 스코프에서 require 하는 npm 패키지 이름들 */
function eagerBareRequires(src) {
  const out = [];
  src.split('\n').forEach((line) => {
    if (/^\s/.test(line)) return;            // 들여쓰기 있음 → 함수 안 → 지연 로드
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // 주석
    const m = line.match(/require\((['"])([^'"]+)\1\)/);
    if (!m) return;
    const id = m[2];
    if (id.startsWith('.') || id.startsWith('/')) return; // 상대경로는 npm 패키지가 아님
    const pkg = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0];
    if (DEPS.includes(pkg)) out.push(pkg);
  });
  return out;
}

/** 상대경로 require 를 따라가며 도달 가능한 파일 전부 모은다 */
function reachable(entryRel) {
  const seen = new Set();
  const queue = [entryRel];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    seen.add(rel);
    const src = fs.readFileSync(abs, 'utf8');
    const re = /require\((['"])(\.[^'"]+)\1\)/g;
    let m;
    while ((m = re.exec(src))) {
      let target = path.resolve(path.dirname(abs), m[2]);
      if (!/\.js$/.test(target)) target += '.js';
      queue.push(path.relative(ROOT, target));
    }
  }
  return [...seen];
}

console.log('\n=== 판별기 자체 검증 (탐지를 못 하면 이 테스트는 거짓 안심이다) ===');
t('최상단 require 를 잡는다', eagerBareRequires("const sharp = require('sharp');").length === 1);
t('함수 안 지연 require 는 통과시킨다',
  eagerBareRequires("function f(){\n  const sharp = require('sharp');\n}").length === 0);
t('상대경로는 대상이 아니다', eagerBareRequires("const x = require('./supabase');").length === 0);
t('스코프 있는 패키지도 잡는다',
  eagerBareRequires("const { createClient } = require('@supabase/supabase-js');")[0] === '@supabase/supabase-js');
t('dependencies 에 없는 내장 모듈은 무시', eagerBareRequires("const fs = require('fs');").length === 0);

console.log('=== cronGuard 체인 — 로드만으로 npm 패키지를 요구하지 않는다 ===');
(function () {
  const files = reachable('api/_lib/cronGuard.js');
  t('체인 탐색이 실제로 동작한다 (파일 2개 이상)', files.length >= 2, '탐색 결과: ' + files.length + '개');
  let violations = 0;
  for (const rel of files) {
    const eager = eagerBareRequires(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    if (!eager.length) continue;
    if (ALLOW[rel]) { console.log('  · 예외 ' + rel + ' [' + eager.join(', ') + '] — ' + ALLOW[rel]); continue; }
    violations++;
    console.log('  ✗ ' + rel + ' 가 최상단에서 ' + eager.join(', ') + ' 를 require 한다');
  }
  t('예외 목록 밖의 즉시 로드 0건', violations === 0,
    'node_modules 없이 도는 CI 에서 MODULE_NOT_FOUND 로 죽는다. ' +
    '해당 패키지를 실제 사용 함수 안으로 옮기거나, 근거를 적어 ALLOW 에 등록할 것');
})();

console.log('=== 과거 실패 지점 회귀 고정 ===');
(function () {
  const email = fs.readFileSync(path.join(ROOT, 'api/_lib/email.js'), 'utf8');
  t('email.js — nodemailer 는 getTransporter 안에서', /function getTransporter\(\)[\s\S]{0,200}require\((['"])nodemailer\1\)/.test(email));
  const bi = fs.readFileSync(path.join(ROOT, 'api/_lib/brandImage.js'), 'utf8');
  t('brandImage.js — sharp 는 래퍼 안에서', /function sharp\([\s\S]{0,200}require\((['"])sharp\1\)/.test(bi));
  const acw = fs.readFileSync(path.join(ROOT, 'api/_lib/aiCreditWatch.js'), 'utf8');
  t('aiCreditWatch.js — supabase·pushAlert 는 _deps() 안에서', /function _deps\(\)[\s\S]{0,300}require\((['"])\.\/supabase\1\)/.test(acw));
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ no-eager-npm-deps tests FAILED'); process.exit(1); }
console.log('✅ no-eager-npm-deps tests passed');
