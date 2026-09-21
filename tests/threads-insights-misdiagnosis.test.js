// PAP Magazine — "권한 없음" 오분류가 8일을 삼켰다 (2026-09-21)
//
// [무슨 일] threads-metrics 가 9/13~9/21 8일간 지표를 0건 수집했는데
// 아무 경보도 안 울렸다. 노트는 매번 "insights 권한 없음 — 재인증 대기" 였고
// ok=true 였다. 주간 브리핑은 그 사이 threads 유입 -91% 를 두고
// "로그가 없어 원인 불명" 이라고 썼다. 지표가 있었으면 도달이 줄었는지
// 클릭이 줄었는지 갈렸을 텐데, 그 지표가 조용히 죽어 있었다.
//
// [원인 둘]
// ① 판정: e.needsReauth 를 /permission|scope|insights/ 로 세웠다.
//    **엔드포인트 이름이 insights** 라 이 API 의 거의 모든 오류 메시지에
//    그 단어가 들어간다. 권한과 무관한 오류가 전부 '재인증 대기' 가 됐다.
//    실측: threads_auth 두 계정 모두 scope 에 threads_manage_insights 가
//    들어 있고 토큰도 유효했다.
// ② 침묵: 재인증 대기는 ok=true 로 통과시키면서 produced/remaining 을
//    신고하지 않았다. 생산 감시는 미신고 크론을 '모른다' 로 빼므로
//    영원히 안 본다. 코드 주석은 "토큰 알림이 별도로 담당한다" 였는데
//    그 함수는 만료·연장 실패만 다룬다. 담당하는 곳이 없었다.
//
// Run with `node tests/threads-insights-misdiagnosis.test.js` (npm test 에 연결).

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const LIB = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'threads.js'), 'utf8');
const CRON = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'threads-metrics.js'), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('\n=== ① 판정이 좁아졌는가 ===');
ok('엔드포인트 이름(insights)을 더는 매칭하지 않는다',
  !/\/permission\|scope\|insights\/i/.test(LIB));
ok('permission·scope 는 그대로 본다', /\/permission\|scope\/i\.test\(msg\)/.test(LIB));
ok('권한 코드 10·190·200 은 그대로 본다',
  /code === 10 \|\| code === 190 \|\| code === 200/.test(LIB));
ok('실제 API 메시지를 에러에 실어 보낸다 (사유를 노트에 쓰기 위해)',
  /e\.apiMessage = msg\.slice/.test(LIB));

console.log('\n--- 판별기를 실제로 돌린다 ---');
{
  /* 소스에서 판정 한 줄을 떼어내 그대로 돌린다. 규칙을 테스트에 베껴 쓰면
     그게 두 벌이 되고, 한쪽만 고쳐진다. */
  const m = LIB.match(/e\.needsReauth = (code === 10[\s\S]*?);/);
  ok('판정식을 찾았다', !!m);
  if (m) {
    const judge = (code, message) =>
      // eslint-disable-next-line no-new-func
      new Function('code', 'msg', `return ${m[1]};`)(Number(code), String(message || ''));

    console.log('  [권한 문제 — true 여야 한다]');
    ok('code 10 (permission denied)', judge(10, 'anything') === true);
    ok('code 190 (토큰 무효)', judge(190, 'anything') === true);
    ok('code 200 (권한 부족)', judge(200, 'anything') === true);
    ok('메시지에 permission', judge(1, 'Missing permission for this call') === true);
    ok('메시지에 scope', judge(1, 'Insufficient scope granted') === true);

    console.log('  [권한 문제가 아님 — false 여야 한다]');
    ok('"insights are not available" (오래된 게시물)',
      judge(1, 'Insights are not available for this media') === false);
    ok('"insights" 만 들어간 일시 오류',
      judge(2, 'Error getting insights, please retry') === false);
    ok('빈 메시지', judge(1, '') === false);
    ok('타임아웃', judge(1, 'The operation was aborted due to timeout') === false);
  }
}

console.log('\n=== ② 더는 조용히 지나가지 않는가 ===');
ok('재인증 대기여도 생산량을 신고한다',
  /if \(needsReauth\)[\s\S]{0,1400}reportProduction\(res, \{ produced: collected, remaining: pending \}\)/.test(CRON));
ok('평상시에도 신고한다 (미신고면 감시가 이 크론을 영영 안 본다)',
  (CRON.match(/reportProduction\(res, \{ produced: collected/g) || []).length === 2);
ok('못 읽은 건수를 remaining 으로 올린다 (produced 0 · remaining 0 이면 새어나간다)',
  /const pending = Math\.max\(0, due\.length - collected - failed\)/.test(CRON));
ok('노트가 "권한 없음" 이라고 단정하지 않는다',
  !/insights 권한 없음 — 재인증 대기/.test(CRON));
ok('노트에 실제 API 사유를 싣는다', /· 사유: ' \+ String\(lastErr/.test(CRON));
ok('노트에 경고 표시가 붙는다 (한눈에 보이게)', /⚠️ 지표 수집 막힘/.test(CRON));

console.log('\n=== 틀린 주석이 남아있지 않은가 ===');
ok('"토큰 알림이 별도로 담당한다" 는 문구가 사라졌다',
  !/토큰 알림\(threads\.js alertTokenTrouble\)이 별도로 담당한다/.test(CRON));
ok('alertTokenTrouble 은 여전히 만료·연장만 다룬다 (역할을 안 늘렸다)',
  /function alertTokenTrouble\(kind, msLeft/.test(LIB)
  && /const expired = kind === 'expired'/.test(LIB));

console.log(`\n${failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음'} — 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
