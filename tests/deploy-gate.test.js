/**
 * 배포 관문 (2026-08-18 신설)
 *
 * ■ 무슨 일이 있었나
 * 커밋 00de7a7 은 테스트 1건이 깨진 채 main 에 올라갔다. GitHub Actions 는
 * 빨간불(#1039)을 켰고 production smoke test 는 건너뛰었다. 그런데 Vercel
 * 배포는 그대로 나갔다. **빨간불이 떠도 사이트는 이미 바뀌어 있었다.**
 *
 * 원인은 vercel.json 의
 *     "buildCommand": ""
 * 였다. 빌드 단계에서 아무것도 안 돌았다. package.json 의 build 스크립트
 * (echo …)도 그래서 한 번도 실행된 적이 없다. 관문이 뚫린 게 아니라
 * **관문 자리가 비어 있었다.**
 *
 * ■ 이 하네스가 지키는 것
 *   ① buildCommand 가 다시 비지 않는다 (실제 버그의 모양 그대로)
 *   ② 관문이 정말로 테스트를 돌린다 — 가짜 npm 을 물려 동작으로 확인한다
 *   ③ 실패가 전파된다 (테스트 실패 → 배포 중단)
 *   ④ '모르겠다' 를 통과로 바꾸지 않는다 (npm 실행 불가 · 시그널 사망)
 *   ⑤ 비상구 [skip-tests] 는 있고, 조용하지 않다
 *   ⑥ 평범한 커밋 메시지가 실수로 비상구를 열지 않는다
 *   ⑦ CI 와 관문의 Node 메이저가 어긋나지 않는다
 *
 * 정규식으로 소스를 훑는 대신 **실제로 실행해서** 종료 코드를 본다.
 * 관문은 종료 코드가 전부인 물건이라, 종료 코드를 안 보면 검증이 아니다.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GATE = path.join(ROOT, 'scripts', 'vercel-build.js');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); }
}

/* 가짜 npm 을 만들어 PATH 앞에 끼운다. 관문이 npm 을 실제로 부르는지,
   그 결과를 그대로 전달하는지를 종료 코드로 확인한다. */
function fakeNpmDir(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papgate-'));
  const f = path.join(dir, 'npm');
  fs.writeFileSync(f, '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
  return dir;
}
function runGate(npmBody, env) {
  const dir = npmBody === null ? fs.mkdtempSync(path.join(os.tmpdir(), 'papempty-')) : fakeNpmDir(npmBody);
  const r = spawnSync(process.execPath, [GATE], {
    cwd: ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PATH: dir }, env || {}),
  });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

console.log('\n=== ① buildCommand 가 비어 있지 않다 ===');
{
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const bc = String(vj.buildCommand == null ? '' : vj.buildCommand).trim();
  t('buildCommand 가 빈 문자열이 아니다', bc.length > 0,
    '빈 문자열이면 빌드 단계가 통째로 안 돈다 — 2026-08-17 의 원인이다');
  t('buildCommand 가 관문을 부른다', /scripts\/vercel-build\.js/.test(bc), bc);
  t('관문 파일이 실제로 있다', fs.existsSync(GATE));

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  t('package.json build 도 같은 관문이다', /scripts\/vercel-build\.js/.test(String(pkg.scripts.build)),
    pkg.scripts.build);
  t('죽어 있던 echo 빌드가 남아 있지 않다', !/echo 'Static frontend/.test(String(pkg.scripts.build)));
}

console.log('\n=== ② 관문이 정말로 테스트를 돌린다 ===');
{
  const r = runGate('echo "FAKE_NPM_CALLED $@"; exit 0');
  t('npm 을 실제로 부른다', /FAKE_NPM_CALLED/.test(r.out), r.out);
  t('인자가 test 다', /FAKE_NPM_CALLED test/.test(r.out), r.out);
  t('통과하면 0 을 낸다', r.code === 0, r.code);
}

console.log('\n=== ③ 실패가 전파된다 ===');
{
  const r = runGate('exit 1');
  t('테스트 실패면 0 이 아니다', r.code !== 0, r.code);
  t('종료 코드를 그대로 전달한다', r.code === 1, r.code);
  t('왜 멈췄는지 로그에 남는다', /배포를 중단한다/.test(r.out), r.out);

  const r7 = runGate('exit 7');
  t('다른 종료 코드도 그대로', r7.code === 7, r7.code);
}

console.log("\n=== ④ '모르겠다' 를 통과로 바꾸지 않는다 ===");
{
  const r = runGate(null);   // PATH 에 npm 이 없다
  t('npm 을 못 띄우면 실패다', r.code !== 0, r.code);
  t('이유를 밝힌다', /실행하지 못했다/.test(r.out), r.out);

  const rs = runGate('kill -TERM $$');   // 시그널로 사망
  t('시그널로 죽어도 실패다', rs.code !== 0, rs.code);
  t('시그널 사망을 구분해 적는다', /시그널/.test(rs.out), rs.out);
}

console.log('\n=== ⑤ 비상구는 있고, 조용하지 않다 ===');
{
  const r = runGate('exit 1', { VERCEL_GIT_COMMIT_MESSAGE: 'hotfix: 결제 터짐 [skip-tests]' });
  t('제목에 있으면 테스트가 깨져도 통과', r.code === 0, r.code);
  t('npm 을 아예 안 부른다', !/FAKE_NPM_CALLED/.test(r.out), r.out);
  t('빌드 로그에 크게 남는다', /검증되지 않았다/.test(r.out), r.out);
  t('무엇을 건너뛰었는지 이름이 남는다', /\[skip-tests\]/.test(r.out), r.out);

  /* ── 2026-08-18 실제 사고 ──────────────────────────────────────────
     이 관문을 만든 커밋(1328eef)의 본문에 기능 설명으로
     "비상구: 커밋 메시지에 [skip-tests]" 라고 적었다. 그 글자가 스위치가
     됐고, 관문을 만든 배포가 관문을 통과하지 않고 나갔다. 나는 배포 상태만
     보고 '통과했다' 고 보고했다. 이 절이 그 재발을 막는다. */
  const body = 'feat(ci): 배포 관문\n\n비상구: 커밋 메시지에 [skip-tests] 를 넣으면 건너뛴다.\n로그에 크게 남는다.';
  const rb = runGate('echo "FAKE_NPM_CALLED $@"; exit 1', { VERCEL_GIT_COMMIT_MESSAGE: body });
  t('본문에만 있으면 열리지 않는다 (실제 사고 재현)', rb.code !== 0, 'code=' + rb.code);
  t('그때는 테스트를 실제로 돌린다', /FAKE_NPM_CALLED/.test(rb.out), rb.out);

  const multi = '[skip-tests] hotfix\n\n본문 설명';
  t('제목이면 여러 줄이어도 열린다', runGate('exit 1', { VERCEL_GIT_COMMIT_MESSAGE: multi }).code === 0);
}

console.log('\n=== ⑥ 평범한 메시지가 비상구를 열지 않는다 ===');
{
  const 평범 = [
    'fix(test): 테스트 하나 고침',
    'skip tests 라고 쓴 게 아니다',
    'feat: skip-tests 문구를 문서에 언급',
    'chore: [skip ci] 는 다른 물건이다',
  ];
  for (const m of 평범) {
    const r = runGate('exit 1', { VERCEL_GIT_COMMIT_MESSAGE: m });
    t('열리지 않는다 — ' + m.slice(0, 28), r.code !== 0, 'code=' + r.code);
  }
  const r = runGate('exit 1', {});   // 메시지 없음(로컬 npm run build)
  t('메시지가 없으면 그냥 돈다', r.code === 1, r.code);
}

console.log('\n=== ⑦ CI 와 관문의 Node 가 어긋나지 않는다 ===');
{
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/test.yml'), 'utf8');
  const m = wf.match(/node-version:\s*'?(\d+)/);
  const ci = m ? parseInt(m[1], 10) : 0;
  /* Vercel 프로젝트 런타임은 24.x 다. 관문이 거기서 도는 이상, CI 가 그보다
     낮으면 '24 에서만 깨지는 것' 을 배포 직전에야 알게 된다. */
  t('CI 가 Node 24 이상이다', ci >= 24, 'CI=' + ci);
  t('왜 올렸는지 근거가 워크플로에 적혀 있다', /배포 관문/.test(wf),
    '숫자만 바꿔두면 다음 사람이 이유를 모르고 되돌린다');
}

console.log('\n=== ⑧ 테스트에 모델 키를 물려주지 않는다 ===');
{
  /* 2026-09-03 실제 사고 — 148b1a1 이 로컬 npm test 초록으로 커밋됐는데
     배포 관문에서 죽었다. tests/x-threads-parity.test.js 가 "모델 없는
     폴백"을 잰다면서 키를 지우지 않았고, 내 맥에는 키가 없고 Vercel 에는
     있어서 **같은 커밋이 두 환경에서 다른 코드를 탔다.** 관문에서 한 번
     떼면 어느 기계에서 돌리든 같은 경로를 잰다. 덤으로 배포마다 나가던
     진짜 모델 호출이 사라진다. */
  const probe = 'echo "KEY=[${ANTHROPIC_API_KEY:-없음}]"; exit 0';
  const r = runGate(probe, { ANTHROPIC_API_KEY: 'sk-ant-절대-새면-안-되는-값' });
  t('테스트 자식에게 키가 보이지 않는다', /KEY=\[없음\]/.test(r.out), r.out);
  t('키 값이 빌드 로그에 찍히지 않는다', r.out.indexOf('sk-ant-절대') === -1);
  t('키를 뗀 뒤에도 테스트는 정상적으로 돈다', r.code === 0, r.code);

  /* 다른 환경변수까지 같이 날리면 테스트가 통째로 못 돈다. PATH 는 남아야 한다. */
  const r2 = runGate('echo "PATH_OK=${PATH:+yes}"; exit 0', { ANTHROPIC_API_KEY: 'x' });
  t('나머지 환경변수는 그대로 넘긴다', /PATH_OK=yes/.test(r2.out), r2.out);
}

console.log('\n' + (fail ? '✗' : '✓') + ' deploy-gate: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
