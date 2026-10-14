'use strict';
/**
 * DEP0169(url.parse) 경고만 걸러낸다 (2026-10-14). 다른 경고는 그대로 나와야 한다.
 * 실제 node 자식 프로세스로 stderr 를 본다.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

function run(code) { const r = spawnSync(process.execPath, ['-e', code], { cwd: ROOT, encoding: 'utf8' }); return (r.stderr || '') + (r.stdout || ''); }
const pre = "require('./api/_lib/quietDep0169');";
t('DEP0169 코드 경고는 안 찍힌다', !/DEP0169/.test(run(pre + "process.emitWarning('x','DeprecationWarning','DEP0169'); console.log('ok')")));
t('url.parse 문구 경고(코드 없이)도 안 찍힌다', !/url\.parse/.test(run(pre + "process.emitWarning('`url.parse()` behavior is not standardized and prone to errors','DeprecationWarning')")));
t('다른 폐기 경고(DEP0000)는 그대로 찍힌다', /DEP0000/.test(run(pre + "process.emitWarning('other','DeprecationWarning','DEP0000')")));
t('Error 객체 경고도 그대로 통과한다', /custom-warning-text/.test(run(pre + "process.emitWarning(new Error('custom-warning-text'))")));
t('두 번 로드해도 한 번만 감싼다', /once/.test(run(pre + "const a=process.emitWarning; require('./api/_lib/quietDep0169'); console.log(a===process.emitWarning?'once':'twice')")));
for (const lib of ['supabase', 'cors', 'auth', 'cronGuard']) {
  t('api/_lib/' + lib + '.js 첫 줄에서 로드', /^require\('\.\/quietDep0169'\);/.test(R('api/_lib/' + lib + '.js')));
}
const total = fs.readdirSync(path.join(ROOT, 'api'), { recursive: true }).filter((f) => f.endsWith('.js') && !f.startsWith('_lib')).length;
t('함수 293개 이상 존재 (커버리지 기준점)', total >= 293, 'got ' + total);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
