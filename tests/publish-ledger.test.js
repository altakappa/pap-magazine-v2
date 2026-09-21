// PAP Magazine — 발행 장부: 브리핑이 "발행이 멈췄나" 를 추측하지 못하게 (2026-09-21)
//
// [무슨 일] 9/21 주간 브리핑이 threads 유입 -91% 를 보고 이렇게 썼다:
//   "② threads/X 알고리즘 변화 또는 posting 중단"
//   "다음 주의 베팅: threads 1일 1회, X 1일 2회 발행 재개"
// 멈춘 적이 없었다. 실측: threads 49 vs 49, X 171 vs 179.
// 한 주의 베팅 전부를 "재개할 것이 없는 재개" 에 걸었다.
//
// [왜 그랬나] 브리핑이 AI 에게 넘기는 입력에 **발행 실적이 없었다.**
// 유입·팔로워·도달은 다 넘기면서 그 숫자를 만든 쪽은 안 넘겼다.
// 사람이 로그를 매일 적게 만드는 것보다 **DB 가 이미 아는 것을 넘기는 것**이
// 먼저다.
//
// Run with `node tests/publish-ledger.test.js` (npm test 에 연결).

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const LIB = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'publishLedger.js'), 'utf8');
const WB = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'weekly-briefing.js'), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('\n=== 네 채널을 전부 센다 ===');
for (const [label, table, col] of [
  ['웹 기사', 'articles', 'published_date'],
  ['스레드', 'threads_posts', 'created_at'],
  ['X', 'x_posts', 'created_at'],
  ['인스타그램', 'ig_post_latest', 'posted_at'],
]) {
  ok(`${label} — ${table}.${col}`,
    new RegExp(`countTwoWeeks\\('${label}', '${table}', '${col}'`).test(LIB));
}
ok('기사는 발행분만 센다 (초안이 섞이면 숫자가 부풀려진다)',
  /q\.eq\('status', 'published'\)/.test(LIB));

console.log('\n=== 표 렌더링을 실제로 돌린다 ===');
{
  const m = LIB.match(/function renderPublishLedgerMd\(ledger\) \{[\s\S]*?\n\}/);
  ok('renderPublishLedgerMd 를 찾았다', !!m);
  if (m) {
    // eslint-disable-next-line no-new-func
    const render = new Function(`${m[0]}; return renderPublishLedgerMd;`)();

    // 9/21 실측값을 그대로 넣는다
    const real = render({ rows: [
      { channel: '웹 기사', this_week: 54, last_week: 65, pct: -17, error: null },
      { channel: '스레드', this_week: 49, last_week: 49, pct: 0, error: null },
      { channel: 'X', this_week: 171, last_week: 179, pct: -4, error: null },
    ] });
    ok('채널과 숫자가 표에 들어간다',
      real.includes('| 스레드 | 49 | 49 |') && real.includes('| X | 171 | 179 |'));
    ok('감소는 마이너스로', real.includes('-17%'));
    ok('증가는 플러스 기호를 붙인다',
      render({ rows: [{ channel: 'a', this_week: 10, last_week: 5, pct: 100, error: null }] }).includes('+100%'));

    /* 이게 이 파일의 핵심이다 — 못 센 것을 0 으로 보여주면
       "발행이 멈췄다" 는 거짓 서사가 그대로 다시 나온다. */
    const broken = render({ rows: [
      { channel: '인스타그램', this_week: null, last_week: null, pct: null, error: 'column does not exist' },
    ] });
    ok('측정 실패를 0 으로 보여주지 않는다', !/\| 인스타그램 \| 0 \|/.test(broken));
    ok('측정 실패라고 적는다', broken.includes('측정 실패'));
    ok('실패 사유를 표에 남긴다', broken.includes('column does not exist'));

    /* 전주 0 → "+500%" 같은 숫자는 규모를 착각하게 한다 */
    const fromZero = render({ rows: [{ channel: 'a', this_week: 5, last_week: 0, pct: null, error: null }] });
    ok('전주가 0 이면 변화율을 적지 않는다', /\| a \| 5 \| 0 \| — \|/.test(fromZero));

    ok('빈 장부는 빈 문자열 (브리핑에 빈 표가 안 붙는다)',
      render({ rows: [] }) === '' && render(null) === '');
  }
}

console.log('\n=== 변화율 계산을 실제로 돌린다 ===');
{
  const pctOf = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
  ok('소스와 같은 식을 쓴다', /prev > 0 \? Math\.round\(\(\(cur - prev\) \/ prev\) \* 100\) : null/.test(LIB));
  ok('49 → 49 는 0%', pctOf(49, 49) === 0);
  ok('171 → 179 는 -4%', pctOf(171, 179) === -4);
  ok('전주 0 은 null', pctOf(5, 0) === null);
}

console.log('\n=== 브리핑 배선 ===');
ok('장부를 만든다', /buildPublishLedger\(\)/.test(WB));
ok('AI 입력에 싣는다', /발행 장부\(우리가 내보낸 양/.test(WB));
ok('입력 맨 앞에 둔다 (원인을 찾을 때 가장 먼저 읽어야 한다)',
  WB.indexOf("'발행 장부(우리가 내보낸 양") < WB.indexOf("'이번 주 데일리 요약("));
ok('표를 본문에 붙인다', /renderPublishLedgerMd\(pubLedger\)/.test(WB));
ok('장부가 실패해도 브리핑은 나간다 (best-effort)',
  /try \{ pubLedger = await buildPublishLedger\(\); \}\s*\n\s*catch/.test(WB));

console.log('\n=== 프롬프트가 추측을 금지하는가 ===');
ok('발행 중단 추측 금지를 명시한다', /추측하지 마라/.test(WB) && /장부를 읽어라/.test(WB));
ok('error 를 0 으로 읽지 말라고 한다', /0건이 아니라 모르는 것/.test(WB));
ok('같은 양인데 유입만 줄었을 때 쓸 문장을 준다',
  /같은 양을 내보냈는데 유입만 줄었다/.test(WB));
ok('원인 분석에서 장부를 먼저 보게 한다', /발행 장부부터\*\* 대조/.test(WB));
ok('발행 회복 베팅에 근거를 요구한다', /장부에서 실제로 줄어든 것을 먼저 보여라/.test(WB));

console.log(`\n${failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음'} — 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
