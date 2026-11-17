/**
 * 홈 메인 영상 = 유튜브 채널 대표 영상 연동 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * 요청(도메니코): "유튜브에서 홈 영상을 바꿀 때마다 그 영상이 홈페이지
 * 영상으로 대체되게 해줘."
 *
 * ── 방식 ────────────────────────────────────────────────────────────
 * 유튜브 채널의 "대표 영상"(비구독자에게 채널 홈에 보이는 트레일러 =
 * brandingSettings.channel.unsubscribedTrailer)을 /api/home-video 가 조회해
 * videoId 를 반환한다. 홈 메인 플레이어가 이 값을 우선 재생하고, 없거나 실패하면
 * 기존대로 최신 필름을 튼다. 도메니코가 유튜브에서 대표 영상만 바꾸면 홈이
 * 따라간다 — 사이트 코드·관리자 조작 불필요.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 엔드포인트가 대표 영상(unsubscribedTrailer)을 읽을 것
 *  2. 실패·미설정 시 500 이 아니라 videoId:null 로 응답할 것 (홈이 폴백하게)
 *  3. 프론트가 대표 영상을 우선 쓰고, 없으면 최신 필름으로 폴백할 것
 *  4. videoId 추출이 순수 id·URL 모두 견딜 것 (실행 검증)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const api = fs.readFileSync(path.join(ROOT, 'api/home-video/index.js'), 'utf8');
const sync = fs.readFileSync(path.join(ROOT, 'frontend/pap-content-api-sync.js'), 'utf8');

console.log('\n=== 1. 엔드포인트가 대표 영상을 읽는가 ===');
t('brandingSettings 를 요청한다',
  /part:\s*'brandingSettings'/.test(api));
t('unsubscribedTrailer(대표 영상) 를 읽는다',
  /unsubscribedTrailer/.test(api),
  '이게 유튜브 채널 홈에 설정하는 "대표 영상"이다');
t('youtube-sync 와 같은 env 를 쓴다 (별도 설정 불필요)',
  /YOUTUBE_API_KEY/.test(api) && /YOUTUBE_CHANNEL_ID/.test(api));
t('require 경로가 하위 폴더 기준(../_lib)이다',
  /require\('\.\.\/_lib\/cors'\)/.test(api),
  "api/home-video/index.js 는 한 단계 아래라 ../_lib 가 맞다 (./_lib 면 배포 후 500)");

console.log('\n=== 2. 실패·미설정 시 홈이 폴백하도록 200+null 인가 ===');
/* 500 을 주면 프론트 fetch 가 에러 처리로 빠져 폴백 경로가 흐려진다.
   env 없음/조회 실패/예외 어느 경우든 200 + videoId:null 이어야 한다. */
t('env 미설정 시 videoId:null 로 200',
  /YOUTUBE_API_KEY \|\| !process\.env\.YOUTUBE_CHANNEL_ID[\s\S]{0,200}status\(200\)[\s\S]{0,60}videoId: null/.test(api),
  '500 이면 홈이 폴백을 못 한다');
t('조회 실패해도 500 을 던지지 않는다',
  !/res\.status\(500\)/.test(api),
  '홈은 트래픽이 많아 유튜브 장애가 곧 홈 장애가 되면 안 된다');
t('엣지 캐시로 유튜브 쿼터를 아낀다',
  /s-maxage=1800/.test(api));

console.log('\n=== 3. 프론트가 대표 영상 우선 + 폴백하는가 ===');
/* 2026-11-17 — 추출을 정확히 바꿨다. 전에는 /\n {2}\};/ 로 끊었는데 함수 안에
   그런 줄이 없어서, 함수를 지나 한참 뒤까지 삼킨 덩어리를 검사하고 있었다.
   단언이 우연히 통과하던 상태라 리팩터링을 못 막는다. 이제 함수만 자른다. */
function fnBody(src, head){
  const i = src.indexOf(head);
  if (i < 0) return '';
  const end = src.indexOf('\n};', i);
  return end < 0 ? src.slice(i) : src.slice(i, end + 3);
}
const autoplay = fnBody(sync, 'window._papFilmAutoPlay = function(){');
t('_papFilmAutoPlay 를 찾았다', autoplay.length > 0);
t('/api/home-video 를 조회한다',
  /\/home-video/.test(autoplay));
/* 2026-11-17 — 옛 단언은 `j.videoId … _papSetHomeVideo(vid)` 였다. 즉 "조회되면
   그 자리에서 심는다" 는 설계를 못 박고 있었는데, 그게 바로 이번에 고친 버그다
   (화면 밖에서 autoplay 를 시작해 모바일에서 재생 버튼만 떠 있었다). 지킬 값어치가
   있는 건 "심는 시점" 이 아니라 **대표 영상이 최신 필름보다 우선한다** 는 순서다. */
t('대표 영상(videoId)이 최신 필름보다 우선이다',
  /j && j\.videoId[\s\S]{0,200}filmAllData\[0\]\.yt/.test(autoplay),
  '폴백이 대표 영상을 덮으면 유튜브에서 바꾼 게 반영되지 않는다');
t('대표 영상이 없으면 최신 필름으로 폴백',
  /filmAllData\[0\]\.yt/.test(autoplay),
  '유튜브에 대표 영상 미설정이어도 홈이 비면 안 된다');
t('네트워크 실패 시에도 폴백한다',
  /\.catch\(function\(\)\{[\s\S]{0,160}filmAllData\[0\]\.yt/.test(autoplay),
  '엔드포인트가 죽어도 기존 동작으로 떨어진다');

console.log('\n=== 3b. 보여질 때 재생한다 (2026-11-17 도메니코) ===');
/* 실측: 모바일에서 필름 섹션까지 스크롤하면 영상이 아니라 유튜브 재생 버튼이
   떠 있었다. 원인은 화면 밖에서 autoplay 를 시작한 것. 아래 네 줄이 그 재발을 막는다. */
const film = fs.readFileSync(path.join(ROOT, 'frontend/pap-content-film.js'), 'utf8');
t('필름 섹션 옵서버가 보임 여부를 넘긴다',
  /_papHomeVideoOnView\(e\.isIntersecting\)/.test(film),
  '옵서버가 filmInView 만 적고 끝나면 아무 일도 일어나지 않는다');
t('로드 순서와 무관하게 보임 상태가 전역에 남는다',
  /window\.__papFilmInView\s*=\s*e\.isIntersecting/.test(film),
  'film.js 가 api-sync 보다 먼저 로드돼 첫 보고를 놓칠 수 있다');
t('심기는 보일 때만 한다 (__papHomeVideoId 에 담아 뒀다가)',
  /__papHomeVideoId[\s\S]{0,200}_papSetHomeVideo\(window\.__papHomeVideoId\)/.test(sync));
t('두 번째부터는 src 를 다시 쓰지 않고 재생 명령만 보낸다',
  /armed[\s\S]{0,200}_papHomeVideoCmd\('playVideo'\)/.test(sync),
  'src 를 다시 쓰면 영상을 처음부터 다시 받는다');
t('화면 밖으로 나가면 멈춘다',
  /_papHomeVideoCmd\('pauseVideo'\)/.test(sync),
  '무음 루프를 계속 돌리면 모바일 데이터와 배터리를 태운다');
t('유튜브 iframe API 스크립트를 새로 부르지 않는다',
  !/iframe_api/.test(sync),
  'CSP script-src 에 youtube.com 이 없다 — postMessage 규약만 쓴다');
t('postMessage 대상 오리진을 고정한다',
  /postMessage\([\s\S]{0,160}'https:\/\/www\.youtube\.com'/.test(sync),
  "'*' 로 보내면 아무 프레임이나 받는다");

console.log('\n=== 4. videoId 추출 (실행 검증) ===');
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return '';
}
const fnSrc = extractFn(api, 'extractVideoId');
t('extractVideoId 를 추출했다', fnSrc.length > 0);
if (fnSrc) {
  const extractVideoId = new Function(fnSrc + '; return extractVideoId;')();
  t('순수 videoId 를 그대로 반환', extractVideoId('5AvI0PwvMQ8') === '5AvI0PwvMQ8');
  t('watch?v= URL 에서 id 추출',
    extractVideoId('https://youtube.com/watch?v=5AvI0PwvMQ8') === '5AvI0PwvMQ8');
  t('embed URL 에서 id 추출',
    extractVideoId('https://www.youtube.com/embed/5AvI0PwvMQ8') === '5AvI0PwvMQ8');
  t('빈 값이면 null', extractVideoId('') === null && extractVideoId(null) === null);
}

console.log('\n=== 5. 캐시버스트 ===');
const htmlDir = path.join(ROOT, 'frontend');
const vers = fs.readdirSync(htmlDir).filter((f) => f.endsWith('.html'))
  .map((f) => (fs.readFileSync(path.join(htmlDir, f), 'utf8').match(/pap-content-api-sync\.js\?v=(\d+)/) || [])[1])
  .filter(Boolean);
t('api-sync 를 참조하는 HTML 의 ?v= 가 동일하다 (' + [...new Set(vers)].join(', ') + ')',
  new Set(vers).size === 1);

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ home-video tests FAILED'); process.exit(1); }
console.log('✅ home-video tests passed');
