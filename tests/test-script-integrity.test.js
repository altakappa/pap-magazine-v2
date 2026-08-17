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
 *   3) 디스크에도 git 에도 있는데 **아무 스크립트도 안 부르는 파일** (2026-08-17 추가)
 *
 * 2번이 핵심이다. 1번만으로는 개발자 기계에서 절대 안 잡힌다.
 *
 * 3번을 왜 뒤늦게 넣었나 (2026-08-17):
 *   c0ed073 이 package.json 을 몇 시간 전 사본 기준으로 덮어써, 그 사이 추가된
 *   테스트 등록 4건(cron-failing-streak · faq-i18n-ssr · faq-translate-cron ·
 *   geo-entity-grounding)이 통째로 사라졌다. 그런데 **npm test 는 통과했다** —
 *   안 돌아가는 테스트는 실패할 수도 없기 때문이다. 1·2번은 "부르는데 없는" 쪽만
 *   보므로 이 방향을 못 본다.
 *   같은 날 전수로 세어 보니 그 사고와 무관하게도 5개가 파일만 있고 안 돌고
 *   있었다(affiliate-item-category · home-video · rss-src-param ·
 *   ssr-shop-story · submission-list-unpaid). 전부 통과하는 멀쩡한 회귀 테스트였다.
 *   즉 이건 한 번의 사고가 아니라 **상시로 새는 구멍**이었다.
 *
 *   판정 기준은 'test 스크립트'가 아니라 '아무 스크립트라도'다.
 *   production-smoke 처럼 일부러 분리한 것(smoke 스크립트)을 실패로 세면
 *   가드가 시끄러워지고, 시끄러운 가드는 곧 무시된다.
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

/* 3) 반대 방향 — 디스크에 있는데 아무도 안 부르는 테스트 (2026-08-17)
      1·2번은 "부르는데 없는" 쪽만 본다. 그 반대는 아무 데도 안 걸리고,
      실패조차 못 하므로 영원히 조용하다. 커버리지가 조용히 사라지는 경로다. */
const onDisk = fs.readdirSync(path.join(ROOT, 'tests'))
  .filter(f => f.endsWith('.test.js'))
  .map(f => 'tests/' + f)
  .sort();
const called = new Set(list);
const orphans = onDisk.filter(f => !called.has(f));
ok(orphans.length === 0,
   orphans.length
     ? `파일만 있고 아무 스크립트도 안 부르는 테스트: ${orphans.join(', ')} — 실패조차 못 하므로 영원히 조용하다`
     : `디스크의 테스트 ${onDisk.length}개가 전부 스크립트에 등재돼 있다`);

console.log(`\npassed: ${pass} failed: ${fail}`);
if (fail) process.exit(1);
console.log('✅ test-script-integrity tests passed');
