/**
 * 배포 관문 — 테스트가 깨지면 배포를 내보내지 않는다 (2026-08-18 신설)
 *
 * ■ 무슨 일이 있었나
 * 2026-08-17 커밋 00de7a7 은 tests/social-inclick-src.test.js 한 건이 깨진 채
 * main 에 올라갔다. GitHub Actions 는 빨간불을 켰고 production smoke test 는
 * 건너뛰었다. 그런데 **Vercel 배포는 그대로 나갔다.**
 *
 * 원인은 단순했다. vercel.json 의 buildCommand 가 빈 문자열이었다.
 *     "buildCommand": ""
 * 빌드 단계에서 아무것도 안 돌았다는 뜻이다. package.json 의 build 스크립트도
 * 그래서 한 번도 실행된 적이 없다. 관문이 없었던 게 아니라 **관문 자리가
 * 비어 있었다.**
 *
 * ■ 왜 CI 로는 못 막나
 * GitHub Actions 와 Vercel 빌드는 **동시에** 시작한다. CI 결과를 기다렸다가
 * 배포를 막으려면 경합이 생긴다(빌드가 먼저 끝나면 그냥 나간다).
 * 같은 커밋의 테스트가 같은 커밋의 빌드를 막아야 경합이 없다. 그래서 관문을
 * 빌드 안에 둔다. 실패하면 배포가 안 만들어지고, 라이브는 직전 배포를
 * 그대로 서비스한다.
 *
 * ■ 급할 때
 * 커밋 메시지에 [skip-tests] 를 넣으면 건너뛴다. 빌드 로그에 크게 남는다.
 * 이건 비상구다. 상시로 쓰면 관문이 없는 것과 같다.
 *
 * ■ 불확실하면 실패시킨다
 * npm 을 못 띄웠거나 시그널로 죽었으면 0 을 돌려주지 않는다. '모르겠다' 를
 * '통과' 로 바꾸는 순간 이 파일은 존재 이유를 잃는다.
 */
'use strict';

const { spawnSync } = require('child_process');

const SKIP = '[skip-tests]';
const msg = String(process.env.VERCEL_GIT_COMMIT_MESSAGE || '');

if (msg.indexOf(SKIP) !== -1) {
  console.warn('');
  console.warn('=========================================================');
  console.warn('  ' + SKIP + ' — 테스트를 건너뛰고 배포한다.');
  console.warn('  이 배포는 검증되지 않았다. 확인 후 정상 배포로 덮을 것.');
  console.warn('=========================================================');
  console.warn('');
  process.exit(0);
}

console.log('[배포 관문] npm test 를 돌린다. 깨지면 이 배포는 나가지 않는다.');
const r = spawnSync('npm', ['test'], { stdio: 'inherit' });

if (r.error) {
  console.error('[배포 관문] npm 을 실행하지 못했다: ' + r.error.message);
  console.error('[배포 관문] 통과 여부를 모르므로 실패로 처리한다.');
  process.exit(1);
}
if (r.status === null) {
  console.error('[배포 관문] 테스트가 시그널(' + r.signal + ')로 죽었다. 실패로 처리한다.');
  process.exit(1);
}
if (r.status !== 0) {
  console.error('[배포 관문] 테스트 실패 (exit ' + r.status + '). 배포를 중단한다.');
  process.exit(r.status);
}

console.log('[배포 관문] 통과. 정적 프런트 + 서버리스 API 를 그대로 내보낸다.');
process.exit(0);
