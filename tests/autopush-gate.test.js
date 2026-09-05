/**
 * 자동 푸시 집행기 하네스 (2026-09-05 신설)
 *
 * ■ 왜 이제야 만드나
 * scripts/autopush.sh 는 2026-08-09 부터 **무인으로 push 를 실행**해 왔는데
 * 테스트가 한 줄도 없었다. 안전핀 세 개(해시·마커·워킹트리)가 정말 도는지
 * 아무도 확인한 적이 없다. 오늘 여기에 네 번째 경로(도메니코 요청)를 여는 김에
 * **기존 핀부터 실측으로 고정한다.** 핀을 늘리기 전에 있는 핀이 사는지 본다.
 *
 * ■ 어떻게 재나
 * 정규식으로 스크립트를 훑지 않는다. 임시 git 저장소와 **로컬 bare 원격**을
 * 만들어 스크립트를 진짜로 돌리고, 원격의 커밋이 움직였는지로 판정한다.
 * push 는 이 안에서 전부 끝나므로 GitHub 에 닿지 않는다.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'autopush.sh');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); }
}
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** 커밋 1개짜리 저장소 + 로컬 bare 원격을 만든다. */
function makeRepo(msg) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'papauto-'));
  const bare = path.join(base, 'remote.git');
  const work = path.join(base, 'work');
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'ignore' });
  fs.mkdirSync(work);
  git(work, 'init', '-b', 'main');
  git(work, 'config', 'user.name', 'T');
  git(work, 'config', 'user.email', 't@t');
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
  git(work, 'add', 'a.txt');
  git(work, 'commit', '-m', '첫 커밋');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-u', 'origin', 'main');
  // 밀어야 할 두 번째 커밋
  fs.writeFileSync(path.join(work, 'a.txt'), 'two\n');
  git(work, 'add', 'a.txt');
  git(work, 'commit', '-m', msg);
  return { base, bare, work, head: git(work, 'rev-parse', 'HEAD') };
}
function run(r, requestBody) {
  fs.mkdirSync(path.join(r.work, '.autopush'), { recursive: true });
  if (requestBody !== null) fs.writeFileSync(path.join(r.work, '.autopush', 'request'), requestBody);
  spawnSync('bash', [SCRIPT], {
    env: Object.assign({}, process.env, { PAP_AUTOPUSH_REPO: r.work }),
    encoding: 'utf8',
  });
  const remoteHead = git(r.bare, 'rev-parse', 'main');
  const log = (() => { try { return fs.readFileSync(path.join(r.work, '.autopush', 'log.txt'), 'utf8'); } catch (_) { return ''; } })();
  const 남음 = fs.existsSync(path.join(r.work, '.autopush', 'request'));
  return { 밀렸나: remoteHead === r.head, log, 요청서남음: 남음 };
}
function clean(r) { try { fs.rmSync(r.base, { recursive: true, force: true }); } catch (_) {} }

console.log('\n=== ① 해시가 HEAD 와 다르면 안 민다 ===');
{
  const r = makeRepo('feat: 뭔가 [auto-r&d]');
  const out = run(r, '0000000000000000000000000000000000000000\n');
  t('밀지 않는다', !out.밀렸나);
  t('사유를 남긴다', /거부①/.test(out.log), out.log);
  t('요청서를 치운다 (무한 재시도 방지)', !out.요청서남음);
  clean(r);
}

console.log('\n=== ② 자동 트랙은 [auto-r&d] 마커가 있어야 한다 ===');
{
  const r1 = makeRepo('fix: 평범한 작업');
  const o1 = run(r1, r1.head + '\n');
  t('마커 없으면 안 민다', !o1.밀렸나);
  t('사유를 남긴다', /거부②/.test(o1.log), o1.log);
  clean(r1);

  const r2 = makeRepo('feat: 성장 개선 [auto-r&d]');
  const o2 = run(r2, r2.head + '\n');
  t('마커 있으면 민다', o2.밀렸나, o2.log);
  t('옛 한 줄 요청서가 그대로 동작한다 (하위호환)', o2.밀렸나);
  clean(r2);
}

console.log('\n=== ③ 워킹트리가 더러우면 안 민다 (남의 작업을 쓸어가지 않는다) ===');
{
  const r = makeRepo('feat: 뭔가 [auto-r&d]');
  fs.writeFileSync(path.join(r.work, 'a.txt'), '누군가 작업 중\n');
  const out = run(r, r.head + '\n');
  t('밀지 않는다', !out.밀렸나);
  t('사유를 남긴다', /거부③/.test(out.log), out.log);
  clean(r);
}

console.log('\n=== ④ 도메니코 요청 경로 (2026-09-05 신설) ===');
{
  const r = makeRepo('fix(faq): 마커 없는 평범한 커밋');
  const out = run(r, r.head + '\nkind=요청\n');
  t('마커가 없어도 민다', out.밀렸나, out.log);
  t('무엇을 밀었는지 로그에 크게 남긴다', /도메니코 요청 푸시/.test(out.log), out.log);
  t('커밋 제목을 로그에 남긴다', /마커 없는 평범한 커밋/.test(out.log), out.log);
  clean(r);
}

console.log('\n=== ⑤ 요청 경로여도 나머지 핀은 살아 있다 ===');
{
  /* 요청 경로는 마커 검사를 면제한다. 그러면 '남의 미완성 작업을 쓸어가지
     않는다' 를 지키는 건 워킹트리 핀 하나뿐이다. 그 핀이 살아 있는지 본다. */
  const r1 = makeRepo('fix: 평범한 커밋');
  fs.writeFileSync(path.join(r1.work, 'a.txt'), '누군가 작업 중\n');
  const o1 = run(r1, r1.head + '\nkind=요청\n');
  t('더러운 트리는 요청이어도 거부한다  ← 이 핀이 유일한 방어다', !o1.밀렸나, o1.log);
  t('사유를 남긴다', /거부③/.test(o1.log), o1.log);
  clean(r1);

  const r2 = makeRepo('fix: 평범한 커밋');
  const o2 = run(r2, '0000000000000000000000000000000000000000\nkind=요청\n');
  t('해시가 어긋나면 요청이어도 거부한다', !o2.밀렸나, o2.log);
  t('사유를 남긴다', /거부①/.test(o2.log), o2.log);
  clean(r2);
}

console.log('\n=== ⑥ 요청서가 없으면 아무것도 안 한다 ===');
{
  const r = makeRepo('feat: 뭔가 [auto-r&d]');
  const out = run(r, null);
  t('가만히 있는다', !out.밀렸나);
  clean(r);
}

console.log('\n=== ⑦ 문서와 코드가 어긋나지 않는다 ===');
{
  const md = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const sh = fs.readFileSync(SCRIPT, 'utf8');
  t('CLAUDE.md 가 요청 경로를 설명한다', /kind=요청/.test(md),
    '스크립트에만 있고 문서에 없으면 다음 사람이 모른다');
  t('스크립트가 요청 경로를 실제로 가지고 있다', /kind=요청/.test(sh));
  t('도메니코가 직접 누르는 길이 문서에 남아 있다', /PAP-푸시하기\.command/.test(md));
}

console.log('\n' + (fail ? '✗' : '✓') + ' autopush-gate: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
