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

// 인사이트(저장·공유·도달·재생·총상호작용) 병합 — 2026-07-27
ok('인사이트 없으면 saved/reach 는 null (0 으로 속이지 않는다)', rows[0].saved === null && rows[0].reach === null);
const irows = toMetricRows([
  { id: '9', timestamp: '2026-07-20T12:00:00Z', like_count: 10, comments_count: 1,
    saved: 40, shares: 5, reach: 900, views: 1200, total_interactions: 56 },
], NOW);
ok('saved·shares·reach 가 보존된다', irows[0].saved === 40 && irows[0].shares === 5 && irows[0].reach === 900);
ok('views·total_interactions 가 보존된다', irows[0].views === 1200 && irows[0].total_interactions === 56);

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
section('소스 회귀 가드 — 저장 버그 재발 방지');
const fs = require('fs');
const IGSRC = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'igSnapshot.js'), 'utf8');
ok('깨진 upsert(rows) 를 다시 쓰지 않는다', !/\.upsert\(rows/.test(IGSRC));
ok('ig_post_metric 은 plain insert 로 저장한다', /from\('ig_post_metric'\)\.insert\(rows\)/.test(IGSRC));
ok('fetchPostInsights 존재 (저장·공유·도달 수집)', /async function fetchPostInsights/.test(IGSRC));

/* ---------------------------------------------------------------- */
/* 2026-07-30 — 팔로워 '전환' 과 '국적'.
 *
 * 도메니코의 목표는 "한국인 진성 팔로워"인데, 지금까지 저장한 도달·좋아요·저장은
 * 전부 대리지표였다. 도달 2만인데 팔로우 0 인 글과 도달 5천인데 팔로우 50 인 글을
 * 구분할 수 없었고, 국가 구성은 아예 데이터가 없어 목표 달성 여부를 판정 자체가
 * 불가능했다. 그 두 구멍을 막은 것이 아래 계약이다. */
section('팔로워 전환 · 국가 구성 (2026-07-30)');
ok('게시물 인사이트에 follows 요청', /'follows'/.test(IGSRC));
ok('게시물 인사이트에 profile_visits 요청', /'profile_visits'/.test(IGSRC));
ok('저장 행에 두 값을 담는다',
  /profile_visits: numOrNull\(p\.profile_visits\)/.test(IGSRC) && /follows: numOrNull\(p\.follows\)/.test(IGSRC));
/* views 가 750건 중 0건이던 이유 — plays 만 요청했는데 Instagram 이 views 로
   교체(v22+)했다. 세트에 미지원 metric 이 하나라도 있으면 응답 전체가 400 이라
   릴스는 늘 축소 세트로 떨어졌고 shares 까지 함께 잃었다(461/750). */
ok('views 를 직접 요청한다 (plays 만으로는 0건이었다)', /'views'/.test(IGSRC));
ok('plays 폴백은 유지 (구 API 계정 대비)', /out\.plays/.test(IGSRC));
ok('계단식 축소로 부분 수집을 살린다', /const ladder = \[/.test(IGSRC),
  '신규 metric 이 거부돼도 기존 수집이 통째로 깨지면 안 된다');

ok('국가 구성 수집 함수 존재', /async function fetchAudienceCountries/.test(IGSRC));
ok('신형·구형 API 를 모두 시도', /follower_demographics/.test(IGSRC) && /audience_country/.test(IGSRC),
  'Instagram 이 이 지표 API 를 두 번 바꿨다 — 한쪽만 보면 조용히 끊긴다');
ok('하루 1행만 저장 (3시간 크론이 중복 적재하지 않게)', /captured_on/.test(IGSRC) && /onConflict: 'handle,country_code,captured_on'/.test(IGSRC));
ok('국가 수집 실패가 본 수집을 죽이지 않는다', /국가 구성 수집 실패/.test(IGSRC));
ok('응답이 비면 로그로 알린다 (조용한 실패 금지)', /국가 구성 응답 없음/.test(IGSRC));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.error('❌ ig-snapshot tests failed'); process.exit(1); }
console.log('✅ ig-snapshot tests passed');
