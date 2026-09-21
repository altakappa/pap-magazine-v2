// PAP Magazine — 주간 브리핑은 도메니코 메일로만 간다 (2026-09-21)
//
// 도메니코: "해당 주간 브리핑의 경우 domenico 이메일에만 보내줘."
//
// [왜 공용 함수를 안 고쳤나] briefingRecipients() 는 데일리 성장 브리핑도
// 같이 쓴다. 거길 고치면 도메니코가 말하지 않은 메일의 수신자까지 조용히
// 바뀐다. "한 곳만 고쳐 달라" 는 요청에 두 곳이 바뀌면 그건 다른 일을 한 것이다.
// 그래서 주간 브리핑만 전용 함수로 떼어냈다.
//
// Run with `node tests/weekly-briefing-recipient.test.js` (npm test 에 연결).

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MD = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'mdEmail.js'), 'utf8');
const WB = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'weekly-briefing.js'), 'utf8');
const DG = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'daily-growth-feedback.js'), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('\n=== 주간 브리핑 수신자 ===');
ok('전용 함수가 있다', /function weeklyBriefingRecipients\(\)/.test(MD));
ok('주간 브리핑이 전용 함수를 쓴다',
  /sendEmail\(weeklyBriefingRecipients\(\)/.test(WB));
ok('주간 브리핑이 더는 공용(DIGEST_TO) 함수를 쓰지 않는다',
  !/sendEmail\(briefingRecipients\(\)/.test(WB));

console.log('\n=== 옆 메일을 건드리지 않았는가 (이게 핵심) ===');
ok('데일리 성장 브리핑은 종전 그대로 briefingRecipients 를 쓴다',
  /sendEmail\(briefingRecipients\(\)/.test(DG));
ok('공용 briefingRecipients 는 여전히 DIGEST_TO 를 본다',
  /function briefingRecipients\(\)\s*\{\s*return process\.env\.DIGEST_TO/.test(MD));
ok('두 함수가 모두 export 된다', /weeklyBriefingRecipients \}/.test(MD) && /briefingRecipients,/.test(MD));

console.log('\n=== 판별기를 실제로 돌린다 ===');
{
  const m = MD.match(/function weeklyBriefingRecipients\(\) \{[\s\S]*?\n\}/);
  ok('함수를 찾았다', !!m);
  if (m) {
    // eslint-disable-next-line no-new-func
    const f = new Function('process', `${m[0]}; return weeklyBriefingRecipients;`)({ env: {} });
    ok('아무것도 설정 안 하면 도메니코 주소', f() === 'contact@pap-magazine.com');

    const withEnv = (v) => new Function('process',
      `${m[0]}; return weeklyBriefingRecipients;`)({ env: { WEEKLY_BRIEFING_TO: v } })();
    ok('WEEKLY_BRIEFING_TO 를 주면 그걸 쓴다', withEnv('a@b.com') === 'a@b.com');
    ok('빈 문자열이면 기본값으로 떨어진다', withEnv('') === 'contact@pap-magazine.com');
    ok('공백만 있어도 기본값으로 떨어진다', withEnv('   ') === 'contact@pap-magazine.com');

    /* DIGEST_TO 가 팀 전체로 세팅돼 있어도 주간 브리핑은 안 끌려가야 한다 —
       이게 도메니코가 요청한 것의 전부다. */
    const digestOnly = new Function('process',
      `${m[0]}; return weeklyBriefingRecipients;`)({ env: { DIGEST_TO: 'team@pap-magazine.com' } })();
    ok('DIGEST_TO 가 팀 주소여도 주간 브리핑은 도메니코에게만',
      digestOnly === 'contact@pap-magazine.com', digestOnly);
  }
}

console.log(`\n${failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음'} — 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
