/**
 * 릴스 시청유지 수집 (2026-08-17 신설)
 *
 * 배경 — 도메니코: "클릭율·시청유지·인게이지먼트·반복재생을 업계 최고치로."
 * 그 말을 듣고 무엇을 재고 있는지부터 봤더니 **시청유지를 한 번도 수집한 적이
 * 없었다.** 실측(릴스 30편, age>=24h): 참여율 지표와 도달의 상관이 전부
 * |r| < 0.12 다 (반복재생율 -0.069 · 저장율 0.078 · 공유율 -0.090 ·
 * 좋아요율 -0.006 · 댓글율 -0.112). 릴스 추천의 1차 신호가 데이터에 없다.
 *
 * 이 하네스가 지키는 것 — 새 지표를 얻는 것보다 **기존 수집을 안 깨는 것**이
 * 우선이다. 이 파일은 이미 그걸로 크게 데였다(plays 하나 때문에 릴스가
 * shares 까지 잃었다):
 *   ① 시청유지는 기존 계단에 절대 안 들어간다 (400 전파 차단)
 *   ② 영상에만 묻는다 (캐러셀에 헛콜을 쏘지 않는다)
 *   ③ 계단으로 좁혀 지표 하나가 죽어도 나머지를 건진다
 *   ④ 실패해도 기존 필드는 그대로 나온다
 *   ⑤ 커버리지를 집계해 로그에 남긴다 (조용한 사각지대 금지)
 *   ⑥ 저장 행에 실려 DB 까지 간다
 *   ⑦ 반복재생 컬럼은 만들지 않는다 (API 폐기 — 빈 컬럼이 더 나쁘다)
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

const P = path.join(ROOT, 'api', '_lib', 'igSnapshot.js');
const ig = require(P);
const src = fs.readFileSync(P, 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', JSON.stringify(d)); }
}

console.log('\n=== ① 기존 계단에 안 섞인다 (400 전파 차단) ===');
{
  // 이게 이 커밋에서 가장 중요한 보장이다. 하나라도 미지원이면 응답 전체가 400 이라
  // 시청유지 지표를 기존 세트에 넣는 순간 reach·saved 까지 통째로 잃는다.
  for (const mt of ['VIDEO', 'REELS', 'CAROUSEL_ALBUM', 'IMAGE']) {
    const flat = ig.insightLadder(mt).flat();
    t(mt + ' 계단에 시청유지 지표가 없다',
      !flat.some((m) => /watch|view_total_time/.test(m)), flat);
  }
  t('BASE_METRICS 가 안 오염됐다',
    !ig.BASE_METRICS.some((m) => /watch/.test(m)), ig.BASE_METRICS);
  t('CONVERSION_METRICS 가 안 오염됐다',
    !ig.CONVERSION_METRICS.some((m) => /watch/.test(m)), ig.CONVERSION_METRICS);
  // 기존 계단 자체가 그대로인지도 못 박는다
  t('영상 첫 칸은 예전 그대로',
    JSON.stringify(ig.insightLadder('VIDEO')[0])
      === JSON.stringify(['reach','saved','shares','total_interactions','views','profile_visits','follows']),
    ig.insightLadder('VIDEO')[0]);
}

console.log('\n=== ② 영상에만 묻는다 ===');
{
  t('영상이 아니면 skip 으로 표시한다', /out\.__watch = 'skip'/.test(src));
  t('VIDEO·REELS 일 때만 요청한다',
    /if \(mt === 'VIDEO' \|\| mt === 'REELS'\) \{[\s\S]{0,600}watchLadder\(\)/.test(src));
}

console.log('\n=== ③ 계단으로 좁힌다 ===');
{
  const L = ig.watchLadder();
  t('3칸이다', L.length === 3, L);
  t('첫 칸은 둘 다', L[0].length === 2 && L[0].includes('ig_reels_avg_watch_time')
    && L[0].includes('ig_reels_video_view_total_time'), L[0]);
  t('둘째·셋째는 하나씩 (하나가 죽어도 나머지를 건진다)',
    L[1].length === 1 && L[2].length === 1 && L[1][0] !== L[2][0], [L[1], L[2]]);
  t('WATCH_METRICS 가 첫 칸과 같다',
    JSON.stringify(ig.WATCH_METRICS) === JSON.stringify(L[0]));
}

console.log('\n=== ④ 커버리지 집계 ===');
{
  const c = ig.watchCoverage;
  t('빈 입력에 안 터진다', JSON.stringify(c([])) === JSON.stringify({ full: 0, partial: 0, unsupported: 0, skip: 0 }));
  t('null 에 안 터진다', c(null).full === 0);
  const got = c([{ __watch: 'full' }, { __watch: 'full' }, { __watch: 'partial' },
                 { __watch: 'unsupported' }, { __watch: 'skip' }, { __watch: 'skip' }, {}]);
  t('네 상태를 각각 센다',
    got.full === 2 && got.partial === 1 && got.unsupported === 1 && got.skip === 2, got);
  t('모르는 값은 무시한다', c([{ __watch: '이상한값' }]).full === 0);
  t('skip 을 따로 센다 (실패로 세면 커버리지가 늘 처참해 보인다)',
    Object.prototype.hasOwnProperty.call(c([]), 'skip'));
  t('로그로 남긴다', /\[igSnapshot\] 시청유지 수집/.test(src));
  t('하나도 못 받으면 이유를 적어 준다', /지표 이름이 폐기됐을 수 있다/.test(src));
}

console.log('\n=== ⑤ 저장 행에 실린다 ===');
{
  const rows = ig.toMetricRows([{
    id: 'x1', media_type: 'VIDEO', timestamp: '2026-08-17T00:00:00+0000',
    reach: 100, saved: 3, avg_watch_time_ms: 4200, total_watch_time_ms: 987654,
  }], Date.parse('2026-08-17T03:00:00Z'));
  t('평균 시청시간이 실린다', rows[0].avg_watch_time_ms === 4200, rows[0]);
  t('총 시청시간이 실린다', rows[0].total_watch_time_ms === 987654, rows[0]);
  t('기존 필드가 그대로다', rows[0].reach === 100 && rows[0].saved === 3);

  // 없으면 0 이 아니라 null 이어야 한다. 0 은 "0초 봤다" 라는 거짓말이다.
  const none = ig.toMetricRows([{ id: 'x2', media_type: 'CAROUSEL_ALBUM', timestamp: '2026-08-17T00:00:00+0000', reach: 50 }],
    Date.parse('2026-08-17T03:00:00Z'));
  t('값이 없으면 null (0 으로 속이지 않는다)',
    none[0].avg_watch_time_ms === null && none[0].total_watch_time_ms === null, none[0]);
}

console.log('\n=== ⑥ 마이그레이션 ===');
{
  const mig = path.join(ROOT, 'supabase_migrations', '127_ig_watch_time.sql');
  t('파일이 있다', fs.existsSync(mig), mig);
  if (fs.existsSync(mig)) {
    const sql = fs.readFileSync(mig, 'utf8');
    t('재실행 안전 (IF NOT EXISTS)', (sql.match(/IF NOT EXISTS/g) || []).length >= 2);
    t('avg 컬럼', /avg_watch_time_ms\s+INTEGER/i.test(sql));
    t('total 컬럼은 BIGINT (총합은 int 를 넘긴다)', /total_watch_time_ms\s+BIGINT/i.test(sql));
    t('반복재생 컬럼을 안 만든다 (API 폐기)',
      !/replay|replays/i.test(sql.replace(/--.*$/gm, '')), '주석 밖에 replay 컬럼이 있다');
  }
}

console.log('\n=== ⑦ 반복재생은 대리지표로 간다 ===');
{
  // clips_replays_count 는 2025-04 폐기. 요청하면 400 이 나고 계단이 통째로 떨어진다.
  t('폐기된 지표를 요청하지 않는다',
    !/clips_replays_count|ig_reels_aggregated_all_plays_count/.test(
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
    '코드에 폐기 지표가 남아 있다');
  t('대리지표(조회/도달)를 근거와 함께 적어 뒀다',
    /조회\/도달|조회 ?\/ ?도달/.test(src) && /1\.43/.test(src));
}

console.log('\n' + (fail ? '✗' : '✓') + ' ig-watch-time: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
