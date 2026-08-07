/*
 * test-script-integrity.test.js
 *
 * 왜 이 테스트가 있는가 (2026-08-07):
 *   fbab26d 가 package.json 의 test 스크립트에
 *   `node tests/editorial-publish-conflict.test.js` 를 넣었는데,
 *   정작 그 파일은 `git add` 되지 않았다.
 *   → 로컬은 파일이 디스크에 있으니 통과, CI 는 체크아웃에 없으니 MODULE_NOT_FOUND.
 *   → main 이 3커밋 연속 빨간불이 됐고, 그동안 production smoke 잡이
 *     needs: test 때문에 통째로 skip 되어 배포 검증이 사라졌다.
 *
 * 이 테스트가 막는 것:
 *   1) test 스크립트가 부르는데 디스크에 없는 파일   (CI 에서 잡힘)
 *   2) 디스크에는 있는데 git 이 모르는 파일          (푸시 전 로컬에서 잡힘)
 *
 * 2번이 핵심이다. 1번만으로는 개발자 기계에서 절대 안 잡힌다.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

console.log('\n=== package.json 스크립트 무결성 ===');

// scripts 전체에서 참조하는 로컬 .js 파일을 뽑는다 (test 뿐 아니라 smoke 도).
const refs = new Set();
for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
  const m = String(cmd).match(/(?:^|\s)(tests\/[\w.\-/]+\.js)/g) || [];
  m.forEach(s => refs.add(s.trim()));
  if (name) { /* name 은 진단용 */ }
}
const list = [...refs].sort();
ok(list.length > 0, `스크립트에서 테스트 파일 ${list.length}개를 찾았다`);

// 1) 디스크에 있는가
const missing = list.filter(f => !fs.existsSync(path.join(ROOT, f)));
ok(missing.length === 0,
   missing.length ? `디스크에 없는 파일: ${missing.join(', ')}` : '전부 디스크에 존재한다');

// 2) git 이 아는가 — 푸시 전에 잡히는 유일한 방어선
let gitChecked = false, untracked = [];
if (fs.existsSync(path.join(ROOT, '.git'))) {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '--', 'tests'], { encoding: 'utf8' });
    const tracked = new Set(out.split('\n').map(s => s.trim()).filter(Boolean));
    untracked = list.filter(f => !tracked.has(f));
    gitChecked = true;
  } catch (e) { /* git 없음 — CI 컨테이너 등. 1번 검사로 충분하다 */ }
}
if (gitChecked) {
  ok(untracked.length === 0,
     untracked.length
       ? `git add 안 된 파일: ${untracked.join(', ')} — 이대로 푸시하면 CI 가 죽는다`
       : '전부 git 이 추적 중이다');
} else {
  console.log('  - git 조회 불가 (체크아웃 환경) — 디스크 검사로 대체');
}

console.log(`\npassed: ${pass} failed: ${fail}`);
if (fail) process.exit(1);
console.log('✅ test-script-integrity tests passed');
