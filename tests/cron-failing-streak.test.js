/**
 * 크론 연속 실패 감시 (2026-08-17 신설)
 *
 * 배경 — 실측:
 *   drive-youtube-post 가 2026-08-09 16:15 부터 08-17 04:15 까지 **48회 연속**
 *   ok=false 로 끝났다. 매번 같은 note 였다.
 *     "DB 기록 실패 — 같은 영상이 반복 업로드될 수 있음! video_id=…"
 *   그 8일 동안 같은 쇼츠가 공개 채널에 48번 올라갔고, 감시는 전부 조용했다.
 *
 *   기존 감시가 못 본 이유:
 *     checkDeadRuns  duration_ms IS NULL 만 본다 — 이 크론은 끝났다(500 반환)
 *     checkDuration  시간만 본다 — 이 크론은 빨랐다
 *     나머지         전부 파이프라인 전용 — 이 크론은 대상이 아니었다
 *
 * 이 하네스가 지키는 것:
 *   ① 연속 실패를 센다 (실패 총합이 아니라 '지금도 이어지는' 연속)
 *   ② 성공이 끼면 연속이 끊긴다 (회복된 크론으로 안 울린다)
 *   ③ 기준(기본 3회) 미만이면 조용하다 — 소음 방지
 *   ④ 여러 크론을 독립적으로 센다
 *   ⑤ 알림에 '무엇이 실패했는지'(note)가 실린다 — 숫자만으로는 못 고친다
 *   ⑥ 안 끝난 실행은 이 감시가 안 본다 (checkDeadRuns 담당 — 중복 경보 금지)
 *   ⑦ 실제 48회 사고 데이터로 재현하면 잡힌다
 *   ⑧ 감시가 핸들러에 배선돼 있다 (함수만 있고 안 부르면 소용없다)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('auth.js', { requireAdmin: async () => ({ id: 'test' }) });
stub('pushAlert.js', { pushAlert: async () => ({ ok: true }) });
stub('instagramImport.js', {
  listRecentMedia: async () => [],
  isLikelyEditorialCaption: () => false,
  _extractShortcode: () => null,
});
stub('cronGuard.js', { withCronGuard: (_name, fn) => fn });

const P = path.join(ROOT, 'api', 'cron', 'pipeline-watch.js');
const mod = require(P);
const src = fs.readFileSync(P, 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', JSON.stringify(d)); }
}

const J = mod.judgeFailingCrons;
const B = mod.buildFailingCronAlert;

/** 최신이 먼저 오는 실행 목록을 만든다. pattern 예: 'FFFS' = 최근 3회 실패 후 성공 */
function runs(name, pattern, note) {
  const base = Date.parse('2026-08-17T04:15:00Z');
  return pattern.split('').map((c, i) => ({
    cron_name: name,
    ok: c !== 'F',
    ran_at: new Date(base - i * 7200000).toISOString(),
    note: c === 'F' ? (note || '실패') : '',
  }));
}

console.log('\n=== ① 연속 실패를 센다 ===');
{
  const d = J(runs('a', 'FFF'), 3);
  t('3회 연속이면 잡는다', !d.healthy, d.reason);
  t('streak 이 3', d.alarming[0] && d.alarming[0].streak === 3, d.alarming);
  t('fails 도 3', d.alarming[0] && d.alarming[0].fails === 3);
  t('runs 가 3', d.crons[0] && d.crons[0].runs === 3);
}

console.log('\n=== ② 성공이 끼면 연속이 끊긴다 ===');
{
  // 최신이 성공 -> 지금은 정상이다. 과거에 아무리 실패했어도 안 울린다.
  const d = J(runs('a', 'SFFFFF'), 3);
  t('최신이 성공이면 조용하다', d.healthy, d.reason);
  t('streak 은 0', d.crons[0] && d.crons[0].streak === 0, d.crons);
  t('총 실패는 그대로 센다', d.crons[0] && d.crons[0].fails === 5, d.crons);

  // 실패 2회 -> 성공 -> 과거 실패 다수. 지금 연속은 2회뿐이다.
  const d2 = J(runs('a', 'FFSFFFFF'), 3);
  t('성공 이전 실패는 연속에 안 더한다', d2.healthy, d2.reason);
  t('streak 이 2', d2.crons[0] && d2.crons[0].streak === 2, d2.crons);
}

console.log('\n=== ③ 기준 미만이면 조용하다 ===');
{
  t('2회 연속은 안 울린다', J(runs('a', 'FF'), 3).healthy);
  t('1회 실패는 안 울린다', J(runs('a', 'F'), 3).healthy);
  t('전부 성공이면 안 울린다', J(runs('a', 'SSSS'), 3).healthy);
  t('기준을 2로 낮추면 2회도 울린다', !J(runs('a', 'FF'), 2).healthy);
  t('기준을 5로 올리면 3회는 조용하다', J(runs('a', 'FFF'), 5).healthy);
  t('빈 입력에 안 터진다', J([], 3).healthy && J(null, 3).healthy);
  t('cron_name 없는 줄은 무시한다', J([{ ok: false }], 1).checked === 0);
}

console.log('\n=== ④ 크론마다 독립적으로 센다 ===');
{
  const d = J([].concat(runs('bad', 'FFFF'), runs('good', 'SSSS'), runs('mid', 'FF')), 3);
  t('망가진 것만 울린다', d.alarming.length === 1 && d.alarming[0].cron === 'bad', d.alarming);
  t('셋 다 집계에는 남는다', d.checked === 3, d.crons);
  t('정상 크론의 streak 은 0',
    d.crons.find((x) => x.cron === 'good').streak === 0);
  t('연속이 큰 순으로 정렬된다', d.crons[0].cron === 'bad', d.crons.map((x) => x.cron));
}

console.log('\n=== ⑤ 알림에 사유가 실린다 ===');
{
  const note = 'DB 기록 실패 — 같은 영상이 반복 업로드될 수 있음! video_id=ezayVsDK7jw';
  const d = J(runs('drive-youtube-post', 'FFFF', note), 3);
  t('reason 에 크론 이름이 있다', /drive-youtube-post/.test(d.reason), d.reason);
  t('reason 에 note 가 실린다', /반복 업로드/.test(d.reason), d.reason);

  const a = B(d, 'https://x.test');
  t('제목에 크론 이름', /drive-youtube-post/.test(a.title), a.title);
  t('제목에 연속 횟수', /4회 연속/.test(a.title), a.title);
  const body = a.lines.join('\n');
  t('본문에 실패 사유', /반복 업로드/.test(body));
  t('본문에 실패\\/전체 회차', /4회 중 4회 실패/.test(body), body);
  t('링크가 크론 상태로 간다', a.url === 'https://x.test/admin/crons', a.url);
  t('note 가 길면 잘린다',
    J(runs('a', 'FFF', 'x'.repeat(400)), 3).alarming[0].lastNote.length <= 160);
}

console.log('\n=== ⑥ 안 끝난 실행은 이 감시가 안 본다 ===');
{
  // checkDeadRuns 가 duration_ms IS NULL 을 담당한다. 여기서 또 보면
  // 같은 사고로 경보가 두 번 울린다 — 두 번 울리는 경보는 안 믿게 된다.
  t('쿼리가 duration_ms 있는 것만 고른다',
    /\.not\('duration_ms', 'is', null\)/.test(src), '쿼리 필터 없음');
  t('최신부터 읽는다 (연속 판정의 전제)',
    /order\('ran_at', \{ ascending: false \}\)/.test(src));
  t('창이 있다 (옛 사고가 영원히 울리지 않게)',
    /CRON_FAIL_WINDOW_H/.test(src));
  t('쿨다운이 있다', /CRON_FAIL_COOLDOWN_H/.test(src));
  t('기준이 env 로 조절된다', /CRON_FAIL_STREAK_MIN/.test(src));
  t('기본 기준은 3', /CRON_FAIL_STREAK_MIN \|\| 3/.test(src));
}

console.log('\n=== ⑦ 실제 48회 사고 재현 ===');
{
  const real = J(runs('drive-youtube-post', 'F'.repeat(48),
    'DB 기록 실패 — 같은 영상이 반복 업로드될 수 있음!'), 3);
  t('48회 연속을 잡는다', !real.healthy);
  t('streak 이 48', real.alarming[0].streak === 48, real.alarming[0]);

  // 3회째에 이미 울렸어야 한다 — 그게 이 감시의 존재 이유다
  const early = J(runs('drive-youtube-post', 'FFF'), 3);
  t('3회째에 이미 울린다 (48회까지 안 기다린다)', !early.healthy);
}

console.log('\n=== ⑧ 핸들러에 배선돼 있다 ===');
{
  t('checkFailingCrons 를 실제로 부른다',
    /const failingCrons = await checkFailingCrons\(\{ dry \}\)/.test(src));
  /* '맨 끝에 있다' 가 아니라 '응답 객체에 실린다' 를 본다.
     맨 끝을 보면 감시가 하나 더 붙을 때마다 남의 테스트가 깨진다
     (오늘 cron-dead-run 이 그렇게 깨졌다). */
  t('응답에 결과가 실린다',
    /return res\.status\(200\)\.json\(\{[^}]*\bfailingCrons\b/.test(src));
  t('판정 함수가 export 돼 있다', typeof J === 'function');
  t('알림 조립 함수가 export 돼 있다', typeof B === 'function');
  t('전용 alert key 를 쓴다 (다른 감시와 상태가 안 섞이게)',
    /FAILING_CRON_ALERT_KEY = 'cron-failing-streak'/.test(src));
  t('실패해도 감시 전체를 죽이지 않는다',
    /\[pipeline-watch\] 연속 실패 감시 실패/.test(src));
}

console.log('\n' + (fail ? '✗' : '✓') + ' cron-failing-streak: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
