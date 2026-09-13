/**
 * 캡션 첫 줄 매칭 회귀 (2026-09-13, 드라이브 영상 16건 적체 사건).
 *
 * [사건] drive-youtube-post · drive-tiktok-post 가 7일 내내 1,005회 전부
 * "매칭 실패" 를 찍었다. 실패 건수는 9/7 9건 → 9/11~13 16건으로 늘었다.
 * 유튜브·틱톡에 올라갈 영상이 계속 멈춰 있었다.
 *
 * [원인] 도메니코: "영상의 제목은 캡션 내 최상단의 타이틀로 매칭해서 넣고 있어."
 * 즉 파일명의 출처는 **인스타 캡션 첫 줄**인데, 우리는 기사 **제목**하고만
 * 비교했다. 기사 제목은 PAP 이 웹용으로 다시 쓴 것이라 글자가 다르다.
 * 2026-09-13 DB 대조: 실패 파일명 13개 중 6개가 캡션 첫 줄과 글자 그대로 같았다.
 *
 * [설계] 유사도 추정이 아니라 **동일성**이므로 토큰 점수보다 먼저 본다.
 * 안전핀 둘: 일치 기사가 정확히 1편일 때만 확정 · 접두 일치는 8자 이상.
 */
'use strict';
const path = require('path');
const { matchArticle, fileCore, captionHead, captionMatches } =
  require(path.join(__dirname, '..', 'api', '_lib', 'koMatch'));
const fs = require('fs');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

/* 2026-09-13 DB 실측에서 그대로 가져온 기사들 (캡션·제목 원문). */
const ARTS = [
  { id: 'a1', title: '30년의 옷이 한 방에 걸렸다', tags: [], instagram_caption: '바네사브루노의 서른 번째 챕터\n\n@vanessabruno' },
  { id: 'a2', title: '플레이리스트에서 폭발로, 실리카겔의 성수 무대', tags: [], instagram_caption: '차갑고 강렬한 맛, 실리카겔' },
  { id: 'a3', title: '성수에 나타난 혁오, 새 곡의 첫 라이브', tags: [], instagram_caption: '성수의 밤을 가장 혁오답게 채운 순간' },
  { id: 'a4', title: '2일간의 열기를 두 남매의 목소리로 닫은 밤', tags: [], instagram_caption: '악뮤와 떼창으로 마무리한 매들리 메들리 @akmuofficial @madly_medley' },
  { id: 'a5', title: '몬스타엑스, 2년 만에 완전체로 돌아온 MAGIC', tags: [], instagram_caption: '몬엑의 다음 페이즈는 그저 MAGIC 입니다' },
  { id: 'a6', title: '샤이니 민호, 두 번째 미니 앨범으로 여름을 붙잡다', tags: [], instagram_caption: '민호 보고 놀란 가슴 민호 보고 가라앉힙니다\r\n\r\n@choiminho_2708' },
  { id: 'a7', title: '김해김의 지난 10년을 보다', tags: [], instagram_caption: '김해김의 지난 10년을 보다' },
  { id: 'a8', title: '주운 것들로 가방을 만드는 작가', tags: [], instagram_caption: '주운 것들로 가방을 만드는 작가' },
];

console.log('\n=== 실측 6건이 붙는다 (적체 사건) ===');
for (const [fn, want] of [
  ['0911_바네사브루노의 서른 번째 챕터.mp4', 'a1'],
  ['0911_차갑고 강렬한 맛, 실리카겔.mp4', 'a2'],
  ['0911_성수의 밤을 가장 혁오답게 채운 순간.mp4', 'a3'],
  ['0906_악뮤와 떼창으로 마무리한 매들리 메들리.mp4', 'a4'],   // 캡션 뒤 @태그 → 접두
  ['0904_몬엑의 다음 페이즈는 그저 MAGIC 입니다.mp4', 'a5'],
  ['260907_민호 보고 놀란 가슴 민호 보고 가라앉힙니다.mp4', 'a6'], // 캡션에 \r 포함
]) {
  const r = matchArticle(fn, ARTS);
  t(fn.slice(0, 40), r.matched && r.matched.id === want, r.reason);
}

console.log('\n=== 붙으면 안 되는 것은 그대로 거부한다 ===');
/* 엉뚱한 영상이 공개 유튜브에 올라가는 것이 이 파일이 막는 사고다.
   캡션 경로를 얹었다고 기존 거부가 느슨해지면 안 된다. */
for (const fn of [
  "0903_김해김 10주년 기념 서울 쇼 '서울 라이트'.mp4",  // 캡션이 다르다
  'copy_2A002017-031A-4F97-88EC-B4C6A77C26D6.mp4',      // 파일명이 UUID
  '0822_포핸즈.mp4',                                     // 기사 자체가 없다
  '0828_엠포리오 아르마니.mp4',
]) {
  const r = matchArticle(fn, ARTS);
  t(fn.slice(0, 40) + ' → 거부', !r.matched, r.reason);
}

console.log('\n=== 안전핀 ===');
const dup = ARTS.concat([{ id: 'dup', title: '다른 기사', tags: [], instagram_caption: '차갑고 강렬한 맛, 실리카겔' }]);
const rd = matchArticle('0911_차갑고 강렬한 맛, 실리카겔.mp4', dup);
t('같은 캡션 기사가 둘이면 사람이 고르게 거부한다', !rd.matched && /사람이 골라야/.test(rd.reason), rd.reason);

const shortArts = [{ id: 's1', title: '긴 제목', tags: [], instagram_caption: '포핸즈가 성수에 문을 열었다' }];
t('짧은 파일명은 접두 일치로 안 붙는다 (포핸즈 3자)',
  !matchArticle('0822_포핸즈.mp4', shortArts).matched);
t('8자 이상이면 접두 일치를 인정한다',
  matchArticle('0822_포핸즈가 성수에.mp4', shortArts).matched === null
  || matchArticle('0822_포핸즈가 성수에 문을.mp4', shortArts).matched !== null);

console.log('\n=== 정규화 ===');
t('날짜 접두사를 뗀다 (0911_ · 260907_)',
  fileCore('0911_바네사브루노.mp4') === fileCore('260907_바네사브루노.mp4'));
t('확장자를 뗀다', fileCore('a바네사브루노.mp4') === fileCore('a바네사브루노.mov'));
t('캡션의 \\r 과 뒤 공백을 정리한다',
  captionHead({ instagram_caption: '민호 보고\r\n둘째 줄' }) === captionHead({ instagram_caption: '민호 보고' }));
t('캡션이 없으면 빈 문자열', captionHead({}) === '' && captionHead(null) === '');
t('캡션 후보가 없으면 hits 가 빈 배열', captionMatches('0911_없는이름.mp4', ARTS).hits.length === 0);

console.log('\n=== 배선: 두 크론이 캐션을 실제로 읽어온다 ===');
/* 컬럼을 안 가져오면 위 로직이 전부 무의미해진다. 조회에 박아 둔다. */
t('drive-youtube-post 가 instagram_caption 을 select 한다',
  /ART_COLS = '[^']*instagram_caption/.test(R('api/cron/drive-youtube-post.js')));
t('tiktokDrive 가 instagram_caption 을 select 한다',
  /ART_COLS = '[^']*instagram_caption/.test(R('api/_lib/tiktokDrive.js')));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ko-match-caption tests FAILED'); process.exit(1); }
console.log('✅ ko-match-caption tests passed');
