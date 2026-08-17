/**
 * 릴스 시청유지·반복재생 화면 (2026-08-17 신설)
 *
 * 왜 릴스를 캐러셀과 분리했나 — 실측이 둘을 갈라놓는다:
 *   · 릴스는 follows·profile_visits 를 영구히 못 받는다 (영상 81건 전부 NULL,
 *     캐러셀은 567/567 수집. 따로 물어도 안 온다 = 인스타가 안 준다)
 *   · 릴스 30편에서 저장·공유·좋아요·댓글 어느 참여율도 도달과 상관이 없다
 *     (전부 |r| < 0.12). 캐러셀에서 통하던 지표가 릴스에선 안 통한다
 *
 * 그래서 릴스는 '얼마나 오래·몇 번 봤는가' 로 본다.
 *
 * 이 하네스가 지키는 것:
 *   ① 릴스만 골라 낸다 (캐러셀이 섞이면 숫자가 통째로 거짓이 된다)
 *   ② 평균이 아니라 중앙값 (이 파일이 이미 배운 규칙)
 *   ③ 반복재생 = 조회 ÷ 도달 (API 폐기분의 대리지표)
 *   ④ 측정 안 된 건수를 숨기지 않는다
 *   ⑤ 화면이 보여준다 (계산만 되고 안 보이면 없는 것과 같다)
 *   ⑥ 왜 릴스를 따로 보는지 근거가 화면에 적혀 있다
 *   ⑦ 캐러셀 카드(ig_perf)를 건드리지 않았다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const API = fs.readFileSync(path.join(ROOT, 'api', 'admin', 'ops-dashboard.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'ops-dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 200)); }
}

console.log('\n=== ① 릴스만 골라 낸다 ===');
{
  t('media_type 이 VIDEO 인 것만',
    /const reelRows = igPosts\.filter\(r => String\(r\.media_type \|\| ''\)\.toUpperCase\(\) === 'VIDEO'\)/.test(API));
  t('시청유지 있는 것만 따로 센다', /const withWatch = reelRows\.filter\(r => Number\(r\.avg_watch_time_ms\) > 0\)/.test(API));
  t('반복재생은 조회·도달 둘 다 있는 것만',
    /const withViews = reelRows\.filter\(r => Number\(r\.views\) > 0 && Number\(r\.reach\) > 0\)/.test(API));
  t('응답에 ig_reels 가 실린다', /\n      ig_reels,\n/.test(API));
}

console.log('\n=== ② 중앙값을 쓴다 ===');
{
  t('중앙값 함수가 있다', /const medianF = \(arr\)/.test(API));
  t('평균 시청 시간이 중앙값', /avg_watch_sec_median: round1\(medianF\(/.test(API));
  t('반복재생도 중앙값', /replay_rate_median: round2\(medianF\(/.test(API));
  t('키 이름에 median 이 드러난다 (평균으로 오해 금지)',
    /avg_watch_sec_median/.test(API) && /replay_rate_median/.test(API));
  // 총 시청 시간만 합계다 — 이건 합이 맞는 값이다
  t('총 시청 시간은 합계', /total_watch_hours: round1\(\s*withWatch\.reduce/.test(API));
}

console.log('\n=== ③ 반복재생 대리지표 ===');
{
  /* 두 곳(중앙값 계산 · 게시물별 값) 모두 같은 정의여야 한다. 한 곳만 보면
     한쪽을 뒤집어도 통과한다 — 실제로 첫 변이 시험에서 그 구멍이 드러났다. */
  t('조회 ÷ 도달 이다 (두 곳 모두)',
    (API.match(/Number\(r\.views\) \/ Number\(r\.reach\)/g) || []).length === 2,
    (API.match(/Number\(r\.views\) \/ Number\(r\.reach\)/g) || []).length);
  t('뒤집힌 정의가 없다', !/Number\(r\.reach\) \/ Number\(r\.views\)/.test(API));
  t('왜 대리지표인지 적어 뒀다', /clips_replays_count/.test(API) && /2025-04 에 폐기/.test(API));
  t('화면에도 이유를 적었다', /clips_replays_count 를 2025-04 에/.test(HTML));
  t('1.0 의 뜻을 화면에 적었다', /1\.0 이면 아무도 두 번 안 봤다/.test(HTML));
}

console.log('\n=== ④ 측정 공백을 숨기지 않는다 ===');
{
  t('측정된 편수를 낸다', /watch_measured_posts: withWatch\.length/.test(API));
  t('안 보이는 편수를 낸다', /watch_blind_posts: reelRows\.length - withWatch\.length/.test(API));
  t('화면에 공백 경고가 있다', /시청유지가 안 보이는 릴스/.test(HTML));
  t('수집 개시일을 밝힌다', /수집은 2026-08-17 에 시작했습니다/.test(HTML));
  t('반복재생 측정 편수도 따로 낸다', /replay_measured_posts: withViews\.length/.test(API));
}

console.log('\n=== ⑤ 화면이 보여준다 ===');
{
  t('렌더 함수가 있다', /function renderIgReels\(d\)\{/.test(HTML));
  t('실제로 호출된다', /renderIgReels\(d\);/.test(HTML));
  t('마운트 지점이 있다', /id="igReels"/.test(HTML) && /id="igReelsTop"/.test(HTML));
  t('평균 시청 시간 줄', /line\('평균 시청 시간', g\.avg_watch_sec_median/.test(HTML));
  t('반복재생 줄', /line\('반복재생', g\.replay_rate_median/.test(HTML));
  t('총 시청 시간 줄', /line\('총 시청 시간'/.test(HTML));
  t('상위 표가 평균 시청 순', /\.sort\(\(a, b\) => b\.avg_watch_sec - a\.avg_watch_sec\)/.test(API));
  t('빈 목록도 안내한다', /아직 측정된 릴스가 없습니다/.test(HTML));
}

console.log('\n=== ⑥ 근거가 화면에 적혀 있다 ===');
{
  t('팔로우를 못 받는다는 사실', /팔로우 전환을 영구히 못 받습니다/.test(HTML));
  /* 주석과 화면 문구 두 곳에 같은 수치가 있다. 한 곳만 보면 다른 쪽을
     흐려도 통과한다 — 첫 변이 시험에서 그 구멍이 드러났다. */
  t('81건 전부 NULL 이라는 증거 (주석·화면 두 곳)',
    (HTML.match(/81건 전부 NULL/g) || []).length === 2,
    (HTML.match(/81건 전부 NULL/g) || []).length);
  t('캐러셀 대조군 수치', /567\/567/.test(HTML));
  t('참여율 무상관 증거', /어느 참여율도 도달과 상관이 없습니다/.test(HTML));
  t('상관 임계값을 적었다', /0\.12/.test(HTML));
}

console.log('\n=== ⑦ 캐러셀 카드를 안 건드렸다 ===');
{
  t('ig_perf 가 그대로 있다', /const ig_perf = \{/.test(API));
  t('저장율 대표 유지', /save_rate: rate\(sum\('saved'\), sum\('reach'\)\)/.test(API));
  t('댓글율 유지', /comment_rate: rate\(sum\('comments_count'\)/.test(API));
  t('renderIgPerf 가 그대로 있다', /function renderIgPerf\(d\)\{/.test(HTML));
  t('저장율 상위 표가 그대로', /top_by_save_rate/.test(HTML));
  t('전환 사각지대 경고가 그대로', /전환 지표가 안 보이는 게시물/.test(HTML));

  // 쿼리 컬럼이 늘었을 뿐 기존 것이 빠지지 않았는지
  const cols = (API.match(/cols: '([^']*post_id[^']*reach[^']*)'/) || [])[1] || '';
  t('기존 컬럼 유지 + 신규 3종 추가',
    ['reach','shares','saved','follows','comments_count','views','avg_watch_time_ms','total_watch_time_ms']
      .every((c) => cols.includes(c)), cols);
}

console.log('\n' + (fail ? '✗' : '✓') + ' ig-reels-watch-surface: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
