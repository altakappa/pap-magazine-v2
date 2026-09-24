/**
 * 볼트 자동 푸시 하네스 (2026-09-25, 도메니코 "볼트에도 푸시할 수 있게 변경해줘")
 *
 * autopush-gate.test.js 와 같은 방식: 임시 git 저장소 + 로컬 bare 원격을 만들어
 * scripts/vault-autopush.sh 를 **진짜로 돌리고**, 원격이 움직였는지로 판정한다.
 * GitHub 에는 닿지 않는다.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VSCRIPT = path.join(ROOT, 'scripts', 'vault-autopush.sh');
const MAIN = path.join(ROOT, 'scripts', 'autopush.sh');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); } }
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

/** 노트 30개가 원격에 있는 볼트 + 밀어야 할 새 커밋 하나. mutate 로 새 커밋 내용을 바꾼다. */
function makeVault(mutate) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'papvault-'));
  const bare = path.join(base, 'remote.git');
  const work = path.join(base, 'vault');
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'ignore' });
  fs.mkdirSync(work);
  git(work, 'init', '-b', 'main');
  git(work, 'config', 'user.name', 'T');
  git(work, 'config', 'user.email', 't@t');
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(work, 'note' + i + '.md'), '# 노트 ' + i + '\n내용\n');
  git(work, 'add', '.');
  git(work, 'commit', '-m', '처음');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-u', 'origin', 'main');
  (mutate || ((w) => { fs.writeFileSync(path.join(w, 'new.md'), '새 기록\n'); }))(work);
  git(work, 'add', '-A');
  git(work, 'commit', '-m', '볼트 기록');
  return { base, bare, work, head: git(work, 'rev-parse', 'HEAD') };
}
function run(v, body, script, extraEnv) {
  fs.mkdirSync(path.join(v.work, '.autopush'), { recursive: true });
  if (body !== null) fs.writeFileSync(path.join(v.work, '.autopush', 'request'), body);
  spawnSync('bash', [script || VSCRIPT], { env: Object.assign({}, process.env, { PAP_VAULT_AUTOPUSH_REPO: v.work, HOME: v.base }, extraEnv || {}), encoding: 'utf8' });
  const remote = git(v.bare, 'rev-parse', 'main');
  let log = ''; try { log = fs.readFileSync(path.join(v.work, '.autopush', 'log.txt'), 'utf8'); } catch (_) {}
  return { pushed: remote === v.head, log, left: fs.existsSync(path.join(v.work, '.autopush', 'request')) };
}
const clean = (v) => { try { fs.rmSync(v.base, { recursive: true, force: true }); } catch (_) {} };

console.log('\n=== 정상: 해시 = HEAD + kind=요청 이면 민다 ===');
{ const v = makeVault(); const o = run(v, v.head + '\nkind=요청\n');
  t('원격이 새 커밋으로 움직였다', o.pushed, o.log); t('완료를 남긴다', /볼트 푸시 완료/.test(o.log)); t('요청서를 치운다', !o.left); clean(v); }

console.log('\n=== ① 해시 불일치 ===');
{ const v = makeVault(); const o = run(v, '0'.repeat(40) + '\nkind=요청\n');
  t('밀지 않는다', !o.pushed); t('사유 거부①', /거부①/.test(o.log), o.log); t('요청서를 치운다', !o.left); clean(v); }

console.log('\n=== ② kind=요청 없으면 안 민다 (볼트는 자동 트랙 없음) ===');
{ const v = makeVault(); const o = run(v, v.head + '\n');
  t('밀지 않는다', !o.pushed); t('사유 거부②', /거부②/.test(o.log), o.log); clean(v); }

console.log('\n=== ③ main 이 아니면 안 민다 ===');
{ const v = makeVault(); git(v.work, 'checkout', '-q', '-b', 'side'); const o = run(v, v.head + '\nkind=요청\n');
  t('밀지 않는다', !o.pushed); t('사유 거부③', /거부③/.test(o.log), o.log); clean(v); }

console.log('\n=== ④ iCloud 껍데기 방지 ===');
{ const v = makeVault((w) => { for (let i = 0; i < 25; i++) fs.unlinkSync(path.join(w, 'note' + i + '.md')); });
  const o = run(v, v.head + '\nkind=요청\n');
  t('파일 25개 삭제 커밋은 거부', !o.pushed && /거부④/.test(o.log), o.log); clean(v); }
{ const v = makeVault((w) => { for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(w, 'note' + i + '.md'), ''); });
  const o = run(v, v.head + '\nkind=요청\n');
  t('내용 있던 파일 6개가 0바이트가 되면 거부', !o.pushed && /거부④/.test(o.log), o.log); clean(v); }
// 한글 이름 파일: 먼저 내용 있게 원격에 올린 뒤 비운다 (git 기본 quotepath 로는 못 잡는다)
{ const base = fs.mkdtempSync(path.join(os.tmpdir(), 'papvault-')); const bare = path.join(base, 'remote.git'); const work = path.join(base, 'vault');
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'ignore' }); fs.mkdirSync(work);
  git(work, 'init', '-b', 'main'); git(work, 'config', 'user.name', 'T'); git(work, 'config', 'user.email', 't@t');
  for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(work, '한글 노트' + i + '.md'), '내용\n');
  git(work, 'add', '.'); git(work, 'commit', '-m', '처음'); git(work, 'remote', 'add', 'origin', bare); git(work, 'push', '-u', 'origin', 'main');
  for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(work, '한글 노트' + i + '.md'), '');
  git(work, 'add', '-A'); git(work, 'commit', '-m', '비움');
  const v = { base, bare, work, head: git(work, 'rev-parse', 'HEAD') };
  const o = run(v, v.head + '\nkind=요청\n');
  t('한글 이름 파일 6개가 0바이트가 돼도 잡아낸다 (quotepath)', !o.pushed && /거부④/.test(o.log), o.log); clean(v); }
{ const v = makeVault((w) => { for (let i = 0; i < 3; i++) fs.unlinkSync(path.join(w, 'note' + i + '.md')); });
  const o = run(v, v.head + '\nkind=요청\n');
  t('평범한 정리(3개 삭제)는 민다', o.pushed, o.log); clean(v); }

console.log('\n=== 워킹트리가 지저분해도 커밋된 것만 올라간다 ===');
{ const v = makeVault(); fs.writeFileSync(path.join(v.work, 'draft.md'), '다른 세션이 쓰는 중\n');
  const o = run(v, v.head + '\nkind=요청\n');
  const remoteFiles = git(v.bare, 'ls-tree', '-r', '--name-only', 'main');
  t('민다', o.pushed, o.log); t('커밋 안 된 draft.md 는 원격에 없다', !/draft\.md/.test(remoteFiles)); clean(v); }

console.log('\n=== 오래된 잠금 파일은 맥이 치운다 ===');
{ const v = makeVault(); const lock = path.join(v.work, '.git', 'index.lock'); fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 10 * 60000); fs.utimesSync(lock, old, old);
  const o = run(v, v.head + '\nkind=요청\n');
  t('10분 된 index.lock 제거', !fs.existsSync(lock)); t('그리고 민다', o.pushed, o.log); clean(v); }

console.log('\n=== autopush.sh 가 볼트 요청서도 처리한다 (웹사이트 요청서 없이) ===');
{ const v = makeVault();
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'papsite-')); git(site, 'init', '-b', 'main');
  const o = run(v, v.head + '\nkind=요청\n', MAIN, { PAP_AUTOPUSH_REPO: site });
  t('같은 LaunchAgent 한 번에 볼트가 올라간다', o.pushed, o.log);
  try { fs.rmSync(site, { recursive: true, force: true }); } catch (_) {} clean(v); }

console.log('\n=== 볼트가 없으면 조용히 끝난다 (다른 컴퓨터·테스트 환경) ===');
{ const r = spawnSync('bash', [VSCRIPT], { env: Object.assign({}, process.env, { PAP_VAULT_AUTOPUSH_REPO: '/nonexistent/vault' }), encoding: 'utf8' });
  t('종료 코드 0', r.status === 0, r.stderr); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
