/**
 * 릴스 기사 → 틱톡 크론 가드 (2026-08-22 신설)
 *
 * 이 테스트가 지키는 것
 *   ① 유튜브와 같은 잣대로 고른다 (두 채널이 갈리면 "왜 저건 유튜브에만" 이 생긴다)
 *   ② 올리기 **전에** 자리를 찜한다 (2026-08-09 기사 6편 17회 중복 게시 재발 방지)
 *   ③ 기록 실패를 삼키지 않는다
 *   ④ 크론이 vercel.json 에 등재돼 있다 (만들어놓고 안 돌면 없는 것과 같다)
 *   ⑤ 조기 반환마다 cronNote 를 남긴다 (무음 실패 방지 — 21일 사고)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
const SRC = read('api/cron/tiktok-reels.js');
/* 주석을 걷어낸 '진짜 코드'. 이 파일의 주석에는 '문제 생기면 muteMp4 로 바꿔라'
 * 같은 안내가 일부러 들어 있어서, 문자열 검사만 하면 주석을 코드로 오인한다. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const YT = read('api/cron/youtube-post.js');
const VERCEL = JSON.parse(read('vercel.json'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

console.log('릴스 → 틱톡 크론');

t('유튜브와 같은 선택 조건을 쓴다', () => {
  for (const cond of ["'status', 'published'", "'source_media_type', 'VIDEO'"]) {
    assert.ok(SRC.includes(cond), '선택 조건 누락: ' + cond);
    assert.ok(YT.includes(cond), '유튜브 쪽 조건이 바뀌었다 — 두 파일을 다시 맞춰야 한다: ' + cond);
  }
  assert.ok(/verdictForMedia/.test(SRC), '크레딧 게이트가 없다');
  assert.ok(/verdictForMedia/.test(YT), '유튜브 쪽 크레딧 게이트가 사라졌다');
});

t('크레딧 미달 후보는 건너뛴다 (거기서 멈추지 않는다)', () => {
  assert.ok(/skipped\.push/.test(SRC), '건너뛴 후보를 기록하지 않는다');
  assert.ok(!/return[^\n]*크레딧[^\n]*중단/.test(SRC), '첫 후보에서 멈추는 경로가 있다');
});

t('올리기 전에 자리를 찜한다', () => {
  const claimAt = SRC.indexOf("status: 'claiming'");
  const postAt = SRC.indexOf('createVideoPost');
  assert.ok(claimAt > 0, '찜하기(claiming) 가 없다');
  assert.ok(postAt > 0, '게시 호출이 없다');
  assert.ok(claimAt < postAt, '게시가 찜하기보다 먼저다 — 중복 게시 사고가 재발한다');
});

t('찜 충돌은 실패가 아니라 정상 스킵이다', () => {
  assert.ok(/claimErr/.test(SRC) && /claimed: false/.test(SRC), '충돌 처리가 없다');
});

t('기록 실패를 삼키지 않는다', () => {
  assert.ok(/recErr/.test(SRC), 'update 오류를 읽지 않는다');
  assert.ok(/중복 게시 위험/.test(SRC), '기록 실패를 크게 울리지 않는다');
});

t('영상은 스토리지 공개 URL 을 그대로 넘긴다 (재업로드 없음)', () => {
  assert.ok(/videoUrl: art\.videos\[0\]/.test(SRC), '스토리지 보관본을 안 쓴다');
  assert.ok(/\^https:\\\/\\\//.test(SRC) || /https:\\\/\\\//.test(SRC), '공개 HTTPS 검사가 없다');
});

t('소리를 벗기지 않는다 — 다만 그 위험이 문서화돼 있다', () => {
  // 도메니코 2026-08-22 결정: 원본 소리 그대로.
  // 주석에는 '문제 생기면 muteMp4 로 바꿔라' 가 적혀 있다 — 그건 통과시킨다.
  // 막을 것은 실제로 불러 쓰는 것이다.
  assert.ok(!/muteMp4/.test(CODE), '음소거를 실제로 호출한다 — 결정과 다르다');
  assert.ok(/음원/.test(SRC) && /위험/.test(SRC), '음원 위험이 주석에 남아 있지 않다');
});

t('조기 반환마다 cronNote 를 남긴다', () => {
  /* 2026-08-07 사고: 조기 반환이 note 를 안 남겨 cron_runs 에 '성공·메모 없음'만
   * 21일간 쌓였다. 돌긴 도는데 아무것도 안 하는 걸 아무도 몰랐다.
   * note(res,…) 는 반환문 안이 아니라 바로 앞 줄에 있을 수도 있으므로
   * '반환문 + 그 앞 240자' 를 함께 본다. */
  const parts = CODE.split('return res.status(');
  assert.ok(parts.length - 1 >= 6, '반환 경로를 못 찾았다: ' + (parts.length - 1));
  for (let i = 1; i < parts.length; i++) {
    const before = parts[i - 1].slice(-240);
    const stmt = parts[i].slice(0, 320);
    assert.ok(/note\(res|note:/.test(before + stmt),
      'cronNote 없는 반환이 있다:\n' + stmt.slice(0, 120));
  }
});

t('크론이 vercel.json 에 등재돼 있다', () => {
  const c = (VERCEL.crons || []).find((x) => x.path === '/api/cron/tiktok-reels');
  assert.ok(c, '크론 미등재 — tiktok-post 기사 모드가 등재 안 돼 죽어 있던 것과 같은 실수');
  /* 시간당 몇 건까지 나갈 수 있는지를 못박는다.
   * 이 크론은 한 회차에 1건만 올린다 → 시간당 상한 = 시간당 실행 횟수.
   * 배포 시점 후보가 6건이었다. 10분 주기였으면 1시간에 6건이 한꺼번에
   * 나갔을 것이고, 팔로워 297 계정에서 그건 스팸 신호다. */
  const perHour = String(c.schedule).split(' ')[0].split(',').length;
  assert.ok(perHour <= 2, '시간당 게시 상한이 너무 높다(' + perHour + '건/시): ' + c.schedule);
  const others = (VERCEL.crons || []).filter((x) => /drive-tiktok-post|drive-youtube-post|youtube-post$/.test(x.path));
  for (const o of others) {
    assert.notStrictEqual(o.schedule, c.schedule, '다른 영상 크론과 같은 분에 겹친다: ' + o.path);
  }
});

console.log(`\n${n}개 테스트 통과`);
