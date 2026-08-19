/**
 * IG 스팸 댓글 봇 — 구조 계약 검사
 *
 * 이 봇이 지켜야 할 약속은 '무엇을 하는가'보다 '무엇을 절대 안 하는가'다.
 * 오늘 하루에만 오탐을 두 번 냈고(이모지 20건·멘션 4건), 둘 다 자동으로
 * 숨겼다면 팬 댓글이 사라졌다. 그 경로가 생기면 이 테스트가 깨진다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SCAN = read('api/cron/ig-comment-scan.js');
const QUEUE = read('api/ops/ig-comment-queue.js');
const LIB = read('api/_lib/igComments.js');
const VERCEL = JSON.parse(read('vercel.json'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

console.log('IG 스팸 댓글 봇');

t('수집 크론은 스스로 숨기거나 지우지 않는다', () => {
  assert.ok(!/setHidden|hide=true|\.delete\s*\(/.test(SCAN), '수집 크론에 쓰기 경로가 있다');
});

t('어디에도 삭제 경로가 없다', () => {
  for (const [name, src] of [['scan', SCAN], ['queue', QUEUE], ['lib', LIB]]) {
    assert.ok(!/method:\s*['"]DELETE['"]/i.test(src), name + ' 에 DELETE 요청이 있다');
  }
});

t('선택 없이 전부 처리되는 경로가 없다', () => {
  // 2026-08-18 본문 보강 때와 같은 규칙 — 한 번의 실수로 전부 바뀌면 안 된다.
  // 주석이 아니라 실제 동작을 본다: ids 가 비면 400 이고, '비었으면 전체'가 아니다.
  assert.ok(/if \(!ids\.length\)[\s\S]{0,120}status\(400\)/.test(QUEUE),
    '선택이 비었을 때 거부하지 않는다');
  assert.ok(!/eq\('status', 'pending'\)[\s\S]{0,80}(update|setHidden)/.test(QUEUE),
    '대기 전체를 한 번에 처리하는 질의가 있다');
  assert.ok(/slice\(0, MAX_BATCH\)/.test(QUEUE), '한 번에 처리할 상한이 없다');
});

t('숨기기 직전에 다시 판정한다', () => {
  assert.ok(/spam\.score\(cur\.text/.test(QUEUE), '재판정이 없다');
  assert.ok(/sc\.total\s*<\s*THRESHOLD/.test(QUEUE), '기준점 하한 검사가 없다');
});

t('쓰기 후 재조회로 검증한다', () => {
  assert.ok(/getComment\(commentId, opts\)/.test(LIB), '사후 재조회가 없다');
  assert.ok(/verified/.test(LIB) && /r\.verified === false/.test(QUEUE), '검증 결과를 안 본다');
});

t('권한 오류를 다른 실패와 구분한다', () => {
  assert.ok(/isPermissionError/.test(LIB), '권한 판별 함수가 없다');
  assert.ok(/instagram_manage_comments/.test(SCAN), '권한 안내 문구가 없다');
  assert.ok(/e\.permission/.test(QUEUE), '큐가 권한 오류를 구분하지 않는다');
});

t('권한 오류면 나머지를 계속 시도하지 않는다', () => {
  assert.ok(/if \(e && e\.permission\) break/.test(QUEUE), '권한 실패 시 조기 중단이 없다');
});

t('토큰을 응답에 흘리지 않는다', () => {
  assert.ok(/function scrub/.test(LIB), 'scrub 없음');
  assert.ok(/split\(token\)\.join\('\[TOKEN\]'\)/.test(LIB), '토큰 마스킹이 없다');
});

t('살포 가산은 자기 신호가 있을 때만 준다', () => {
  // 2026-08-19 오탐 2차: 멘션 댓글이 살포 가산만으로 기준점을 넘었다
  assert.ok(/r\.score <= 0\) continue/.test(SCAN), '0점 댓글에 살포 가산을 준다');
});

t('사람이 판단한 건은 다시 큐에 안 올린다', () => {
  assert.ok(/seen\.has\(c\.comment_id\)/.test(SCAN), '기존 판단을 무시하고 재삽입한다');
});

t('크론이 vercel.json 에 등재돼 있다', () => {
  const c = (VERCEL.crons || []).find((x) => x.path === '/api/cron/ig-comment-scan');
  assert.ok(c, '크론 미등재 — 만들어놓고 안 돌면 없는 것과 같다');
  assert.ok(/^\d+ \* \* \* \*$/.test(c.schedule), '매시간 스케줄이 아니다: ' + c.schedule);
});

t('큐 화면은 캐시되지 않는다', () => {
  // 캐시되면 이미 처리한 항목이 계속 보인다
  assert.ok(/no-store/.test(QUEUE), 'Cache-Control no-store 가 없다');
});

t('IG 토큰 생존 감시가 붙어 있다', () => {
  const PW = read('api/cron/pipeline-watch.js');
  assert.ok(/checkIgToken/.test(PW), '토큰 감시 함수가 없다');
  assert.ok(/ig-token-health/.test(PW), '알림 키가 없다');
  assert.ok(/IG_ACCESS_TOKEN/.test(PW) && /\[TOKEN\]/.test(PW), '토큰 마스킹이 없다');
});

console.log(`\n${n}개 테스트 통과`);
