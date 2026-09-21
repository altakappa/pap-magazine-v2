// PAP Magazine — 같은 자리에서 두 번 속았다: 오류 메시지로 권한을 판정하기 (2026-09-21)
//
// [무슨 일] threads-metrics 가 9/13~9/21 9일간 지표를 0건 수집했다.
// 노트는 매번 "insights 권한 없음 — 재인증 대기" 였고 ok=true 였다.
// 실제로는 권한 문제가 아니었다. 두 계정 모두 토큰 유효(10/02·10/04),
// scope 에 threads_manage_insights 보유. 밀린 게시물 57건.
//
// [진짜 원인] 9/12 16:03 에 올린 게시물 1건(thread_id 18107843381157893)이
// 조회되지 않는다. 지워졌거나 접근이 안 된다. 그게 큐 맨 앞에 있었고,
// needsReauth 로 오분류되면서 break 를 때렸다. 뒤의 56건은 9일 동안
// 단 한 번도 시도되지 못했다.
//
// [두 번 속은 자리]
// 1차: /permission|scope|insights/ — **엔드포인트 이름이 insights** 라
//      이 API 의 거의 모든 오류에 그 단어가 들어간다. 전부 '권한 없음'.
// 2차: 그래서 /permission|scope/ 로 좁혔다. 그런데 Graph 의 가장 흔한
//      일반 오류가 "... cannot be loaded due to missing permissions, or
//      does not support this operation." 다. 또 걸렸다.
//
// [고친 규칙]
// ① 메시지 문자열로 권한을 판정하지 않는다. 코드로만 한다.
// ② 한 건의 실패가 큐 전체를 멈추지 않는다. 토큰 문제일 때만 멈춘다.
// ③ 영영 못 읽는 게시물은 표시해서 큐에서 뺀다.
//
// Run with `node tests/threads-insights-misdiagnosis.test.js` (npm test 에 연결).

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const LIB = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'threads.js'), 'utf8');
const CRON = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'threads-metrics.js'), 'utf8');

// 9일을 날린 실제 메시지. 이 문자열이 이 파일의 주인공이다.
const REAL_MSG = "Unsupported get request. Object with ID '18107843381157893' does not exist, "
  + 'cannot be loaded due to missing permissions, or does not support this operation. '
  + 'Read the Graph API documentation for more details.';

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('\n=== ① 권한 판정에서 문자열 매칭이 사라졌는가 ===');
{
  const m = LIB.match(/e\.needsReauth = ([^;]+);/);
  ok('판정식을 찾았다', !!m);
  if (m) {
    const expr = m[1];
    ok('needsReauth 가 메시지를 보지 않는다 (msg 미참조)', !/msg/.test(expr), expr);
    ok('정규식이 없다', !/\//.test(expr), expr);
    ok('코드로 판정한다', /code ===/.test(expr));
  }
}
ok('토큰·권한 코드 4종을 본다 (10·102·190·200)',
  /code === 10 \|\| code === 102 \|\| code === 190 \|\| code === 200/.test(LIB));
ok('code 를 에러에 싣는다 (노트가 스스로 증명하게)', /e\.code = /.test(LIB));
ok('subcode 를 에러에 싣는다', /e\.subcode = /.test(LIB));
ok('실제 API 메시지도 그대로 싣는다', /e\.apiMessage = msg\.slice/.test(LIB));

console.log('\n--- needsReauth 판별기를 소스에서 떼어 실제로 돌린다 ---');
{
  /* 규칙을 테스트에 베껴 쓰면 두 벌이 되고 한쪽만 고쳐진다.
     그래서 소스의 식을 그대로 뜯어 와서 돌린다. */
  const m = LIB.match(/e\.needsReauth = ([^;]+);/);
  if (m) {
    const judge = (code, message, subcode) =>
      // eslint-disable-next-line no-new-func
      new Function('code', 'msg', 'subcode', `return !!(${m[1]});`)(
        Number(code), String(message || ''), Number(subcode));

    console.log('  [진짜 토큰·권한 문제 — true]');
    ok('code 10 (permission denied)', judge(10, '') === true);
    ok('code 102 (세션 무효)', judge(102, '') === true);
    ok('code 190 (토큰 무효·만료)', judge(190, '') === true);
    ok('code 200 (권한 부족)', judge(200, '') === true);

    console.log('  [권한 문제가 아님 — false]');
    ok('★ 9일을 날린 그 메시지 (permissions 가 들어 있다)',
      judge(100, REAL_MSG, 33) === false);
    ok('엔드포인트 이름이 든 일시 오류 (1차에 속은 형태)',
      judge(2, 'Error getting insights, please retry') === false);
    ok('"Insights are not available" (오래된 게시물)',
      judge(1, 'Insights are not available for this media') === false);
    ok('메시지에 permission 만 있고 코드는 무관',
      judge(4, 'Missing permission for this call') === false);
    ok('메시지에 scope 만 있고 코드는 무관',
      judge(1, 'Insufficient scope granted') === false);
    ok('빈 메시지', judge(1, '') === false);
    ok('타임아웃', judge(0, 'The operation was aborted due to timeout') === false);
  }
}

console.log('\n--- deadObject 판별기도 실제로 돌린다 ---');
{
  const m = LIB.match(/e\.deadObject = ([^;]+);/);
  ok('deadObject 판정식을 찾았다', !!m);
  if (m) {
    const judge = (code, message, subcode) =>
      // eslint-disable-next-line no-new-func
      new Function('code', 'msg', 'subcode', `return !!(${m[1]});`)(
        Number(code), String(message || ''), Number(subcode));

    ok('★ 9일을 날린 그 메시지는 죽은 게시물이다', judge(100, REAL_MSG, 33) === true);
    ok('code 100 + subcode 33', judge(100, '', 33) === true);
    ok('code 100 + "does not exist"', judge(100, 'Object does not exist', 0) === true);
    ok('토큰 무효(190)는 죽은 게시물이 아니다', judge(190, REAL_MSG, 33) === false);
    ok('권한 부족(200)은 죽은 게시물이 아니다', judge(200, 'no permission', 0) === false);
    ok('일시 오류는 죽은 게시물이 아니다 (재시도해야 한다)',
      judge(2, 'Please retry', 0) === false);
  }
}

console.log('\n=== ② 한 건의 실패가 큐 전체를 멈추지 않는가 ===');
{
  const c = CRON.match(/\} catch \(e\) \{[\s\S]*?\n    \}/);
  ok('catch 블록을 찾았다', !!c);
  if (c) {
    const body = c[0];
    ok('break 는 정확히 1개다', (body.match(/\bbreak;/g) || []).length === 1, body.match(/\bbreak;/g));
    ok('그 break 는 needsReauth 에만 달려 있다',
      /if \(e && e\.needsReauth\) \{ needsReauth = true; break; \}/.test(body));
    ok('deadObject 는 continue 로 넘어간다 (멈추지 않는다)',
      /if \(e && e\.deadObject\)[\s\S]*?continue;/.test(body));
    ok('deadObject 분기가 needsReauth 분기보다 뒤에 있다 (토큰 문제가 우선)',
      body.indexOf('e.needsReauth') < body.indexOf('e.deadObject'));
    ok('실패 코드를 기억한다 (노트에 싣기 위해)', /lastCode = /.test(body) && /lastSub = /.test(body));
  }
}
ok('죽은 게시물에 표시값을 쓴다', /metrics_stage: STAGE_DEAD/.test(CRON));
ok('STAGE_DEAD 가 선언돼 있다', /const STAGE_DEAD = (\d+)/.test(CRON));
{
  const m = CRON.match(/const STAGE_DEAD = (\d+)/);
  const v = m ? Number(m[1]) : null;
  /* 후보 조회가 `metrics_stage.is.null,metrics_stage.lt.2` 다.
     표시값이 2 미만이면 죽은 게시물이 매시간 다시 큐에 들어온다. */
  ok('STAGE_DEAD 가 2 이상이다 (아니면 다시 큐에 걸린다)', v !== null && v >= 2, String(v));
  ok('STAGE_DEAD 가 2 가 아니다 (확정치 평균에 섞이면 안 된다)', v !== 2, String(v));
}
ok('왜 못 쟀는지 detail 에 남긴다', /detail: why/.test(CRON));
ok('표시 실패도 조용히 넘기지 않는다 (로그를 남긴다)',
  /죽은 게시물 표시 실패/.test(CRON));

console.log('\n=== ③ 더는 조용히 지나가지 않는가 ===');
ok('토큰 문제로 멈춰도 생산량을 신고한다',
  /if \(needsReauth\)[\s\S]{0,2200}reportProduction\(res, \{ produced: collected, remaining: pending \}\)/.test(CRON));
ok('평상시에도 신고한다 (미신고면 감시가 이 크론을 영영 안 본다)',
  (CRON.match(/reportProduction\(res, \{ produced: collected/g) || []).length === 2);
ok('건너뛴 건은 대기(remaining)에서 뺀다 — 영영 안 될 일을 밀린 일로 세지 않는다',
  (CRON.match(/due\.length - collected - failed - dead/g) || []).length === 2);
ok('노트가 "권한 없음" 이라고 단정하지 않는다',
  !/insights 권한 없음 — 재인증 대기/.test(CRON));
ok('중단 노트에 code 를 싣는다 (다음 실행이 스스로 증명한다)',
  /· code ' \+ \(lastCode/.test(CRON));
ok('중단 노트에 실제 API 사유를 싣는다', /· 사유: ' \+ String\(lastErr/.test(CRON));
ok('정상 노트에도 실패 사유를 싣는다 (실패가 있을 때)',
  /failed && lastErr \? ' · 사유: '/.test(CRON));
ok('건너뛴 건수를 노트에 드러낸다', /건너뜀\(삭제됨\)/.test(CRON));

console.log('\n=== 틀린 주석·죽은 규칙이 남아있지 않은가 ===');
ok('"토큰 알림이 별도로 담당한다" 는 문구가 없다',
  !/토큰 알림\(threads\.js alertTokenTrouble\)이 별도로 담당한다/.test(CRON));
ok('alertTokenTrouble 은 여전히 만료·연장만 다룬다 (역할을 안 늘렸다)',
  /function alertTokenTrouble\(kind, msLeft/.test(LIB)
  && /const expired = kind === 'expired'/.test(LIB));
ok('"권한 문제는 전 건 동일 — 즉시 중단" 주석이 사라졌다 (그게 틀렸다)',
  !/권한 문제는 전 건 동일 — 즉시 중단/.test(CRON));

console.log(`\n${failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음'} — 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
