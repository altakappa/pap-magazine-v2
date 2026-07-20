// PAP Magazine — IG 성과 스냅샷 집계 테스트
//
// 지키는 회귀 (2026-07-21):
//   - age_hours 계산이 맞을 것 (게시 후 나이를 틀리면 24시간 비교가 무너진다)
//   - 팔로워 일평균 증가가 관측 간격에 흔들리지 않을 것
//   - 주간 평균 참여가 월요일 기준으로 묶일 것
//   - 데이터가 부족할 때 숫자를 지어내지 않을 것 (null 반환)
//
// Run with `node tests/ig-snapshot.test.js` (wired into `npm test`).

'use strict';

const path = require('path');
const Module = require('module');

// supabase 클라이언트를 스텁으로 갈아끼운다 — 네트워크·DB 없이 로직만 본다.
const SUPABASE = path.join(__dirname, '..', 'api', '_lib', 'supabase.js');
require.cache[SUPABASE] = new Module(SUPABASE);
require.cache[SUPABASE].exports = { supabaseAdmin: {} };
require.cache[SUPABASE].loaded = true;

const { toMetricRows, followerGrowth, weeklyEngagement } = require('../api/_lib/igSnapshot');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* ---------------------------------------------------------------- */
section('toMetricRows — 나이 계산과 방어');

const NOW = Date.parse('2026-07-21T12:00:00Z');
const rows = toMetricRows([
  { id: '1', timestamp: '2026-07-20T12:00:00Z', like_count: 500, comments_count: 12,
    permalink: 'https://instagram.com/p/a', media_type: 'CAROUSEL_ALBUM' },
  { id: '2', timestamp: '2026-07-21T09:00:00Z', like_count: 30, comments_count: 1 },
  { id: '3' }, // 타임스탬프 없음
], NOW);

ok('24시간 전 게시물의 age_hours = 24', rows[0].age_hours === 24);
ok('3시간 전 게시물의 age_hours = 3', rows[1].age_hours === 3);
ok('좋아요·댓글이 보존된다', rows[0].like_count === 500 && rows[0].comments_count === 12);
ok('타임스탬프 없으면 age_hours 는 null (0 으로 속이지 않는다)', rows[2].age_hours === null);
ok('like_count 없으면 null (0 으로 속이지 않는다)', rows[2].like_count === null);
ok('id 없는 항목은 버린다', toMetricRows([{ timestamp: '2026-07-21T00:00:00Z' }], NOW).length === 0);

/* ---------------------------------------------------------------- */
section('followerGrowth — 일평균 증가');

const g = followerGrowth([
  { followers: 373966, captured_at: '2026-07-10T00:00:00Z' },
  { followers: 375000, captured_at: '2026-07-13T00:00:00Z' },
  { followers: 377779, captured_at: '2026-07-21T00:00:00Z' },
]);
ok('증가분 = 마지막 - 처음', g.gained === 3813);
ok('기간 = 11일', g.days === 11);
ok('일평균 = 347명', g.per_day === 347);

// 순서가 뒤섞여 들어와도 같은 결과여야 한다 (DB 정렬을 신뢰하지 않는다)
const gShuffled = followerGrowth([
  { followers: 377779, captured_at: '2026-07-21T00:00:00Z' },
  { followers: 373966, captured_at: '2026-07-10T00:00:00Z' },
  { followers: 375000, captured_at: '2026-07-13T00:00:00Z' },
]);
ok('입력 순서에 흔들리지 않는다', gShuffled.per_day === g.per_day);

ok('관측이 1건이면 null (추세를 지어내지 않는다)',
  followerGrowth([{ followers: 1, captured_at: '2026-07-21T00:00:00Z' }]) === null);
ok('빈 배열도 null', followerGrowth([]) === null);
ok('같은 시각 2건이면 null (0 으로 나누지 않는다)',
  followerGrowth([
    { followers: 1, captured_at: '2026-07-21T00:00:00Z' },
    { followers: 2, captured_at: '2026-07-21T00:00:00Z' },
  ]) === null);

/* ---------------------------------------------------------------- */
section('weeklyEngagement — 주간 평균');

const wk = weeklyEngagement([
  // 2026-07-13(월) 주
  { posted_at: '2026-07-13T02:00:00Z', like_count: 1000, comments_count: 20 },
  { posted_at: '2026-07-15T02:00:00Z', like_count: 500,  comments_count: 10 },
  { posted_at: '2026-07-19T02:00:00Z', like_count: 300,  comments_count: 0 },
  // 2026-07-20(월) 주
  { posted_at: '2026-07-20T02:00:00Z', like_count: 200,  comments_count: 4 },
  { posted_at: '2026-07-21T02:00:00Z', like_count: 100,  comments_count: 2 },
]);

ok('주가 2개로 묶인다', wk.length === 2);
ok('첫 주는 월요일 07-13', wk[0].week === '2026-07-13');
ok('일요일(07-19)은 앞 주에 들어간다', wk[0].posts === 3);
ok('첫 주 평균 좋아요 600', wk[0].avg_likes === 600);
ok('둘째 주 평균 좋아요 150', wk[1].avg_likes === 150);
ok('평균 댓글은 소수 1자리', wk[0].avg_comments === 10);
ok('주 오름차순 정렬', wk[0].week < wk[1].week);
ok('빈 입력은 빈 배열', weeklyEngagement([]).length === 0);
ok('posted_at 없는 행은 무시', weeklyEngagement([{ like_count: 999 }]).length === 0);

/* ---------------------------------------------------------------- */
console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.error('❌ ig-snapshot tests failed'); process.exit(1); }
console.log('✅ ig-snapshot tests passed');
