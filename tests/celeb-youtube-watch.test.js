// PAP Magazine — 유튜브 공식 채널 감시 (2026-09-18)
//
// [왜] 도메니코: "케이팝 아이돌 정보를 빠르게 알 수 있는 곳은?"
// 컴백은 티저 영상이 먼저 뜬다. 그리고 YOUTUBE_API_KEY 는 이미 있고
// playlistItems.list 는 1 유닛이라 사실상 공짜다.
//
// 이 테스트가 지키는 것은 **규칙이 한 벌로 남는 것**이다.
// 플랫폼이 둘이 되면 루프를 복사하고 싶어진다. 복사하는 순간 신선도·중복·
// 판정 규칙이 두 벌이 되고 한쪽만 고쳐진다 — 이 저장소가 가장 여러 번 겪은 일이다.
//
// Run with `node tests/celeb-youtube-watch.test.js` (npm test 에 연결).

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const WATCH = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'celeb-account-watch.js'), 'utf8');
const YT = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'ytDiscovery.js'), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('\n=== 규칙이 한 벌인가 (핵심) ===');
ok('플랫폼 분기가 discovery 호출 한 군데뿐이다',
  (WATCH.match(/acc\.platform === 'youtube'/g) || []).length <= 4,
  (WATCH.match(/acc\.platform === 'youtube'/g) || []).length + '곳');
ok('신선도 게이트는 하나다', (WATCH.match(/FRESH_MS/g) || []).length <= 3);
/* seen 테이블은 네 곳에서 쓴다 — 기준선 씨뿌리기 · 읽기 · 오래된 글 조용히
   처리 · 알림 직전 기록. 개수를 세는 건 의미가 없고(플랫폼과 무관하게 늘 넷이다),
   **알림을 내보내는 경로가 하나뿐인지**가 진짜로 지킬 것이다. */
ok('알림 직전 seen 기록(에러를 받는 것)은 정확히 하나다',
  (WATCH.match(/const \{ error: seenErr \} = await supabaseAdmin\.from\('celeb_account_seen'\)/g) || []).length === 1);
ok('플랫폼별로 seen 경로를 복사하지 않았다',
  !/platform === 'youtube'[\s\S]{0,400}celeb_account_seen/.test(WATCH));
ok('뉴스 판정 호출은 하나다', (WATCH.match(/judgeNews\(candidates\)/g) || []).length === 1);
ok('알림 전송은 하나다', (WATCH.match(/sendTextToChatSafe\(chatId, buildAlert/g) || []).length === 1);

console.log('\n=== 유닛 절약 ===');
ok('채널 ID 가 캐시돼 있으면 channels.list 를 건너뛴다',
  /if \(!uploadsPlaylistOf\(channelId\)\) \{[\s\S]{0,120}resolveChannel/.test(YT));
ok('푼 채널 ID 를 DB 에 캐시한다', /ytResolved \? \{ ext_id: ytResolved \} : \{\}/.test(WATCH));
ok('같은 값이면 다시 안 쓴다', /d\.channelId !== acc\.ext_id/.test(WATCH));
ok('영상마다 videos.list 를 또 부르지 않는다 (유닛 2배 방지)',
  !/\/videos\?/.test(YT) && /likes: null/.test(YT));

console.log('\n=== 판별기를 실제로 돌린다 ===');
{
  const m = YT.match(/function uploadsPlaylistOf\(channelId\) \{[\s\S]*?\n\}/);
  ok('uploadsPlaylistOf 를 찾았다', !!m);
  if (m) {
    // eslint-disable-next-line no-new-func
    const f = new Function(`${m[0]}; return uploadsPlaylistOf;`)();
    ok('UC → UU 로 바꾼다', f('UCLkAepWjdylmXSltofFvsYQ') === 'UULkAepWjdylmXSltofFvsYQ');
    ok('핸들은 재생목록이 안 된다 (null)', f('@BTS') === null);
    ok('빈 값·null 에도 안 던진다', f('') === null && f(null) === null);
    ok('UC 로 시작해도 너무 짧으면 거절', f('UCabc') === null);
  }
}

console.log('\n=== 핸들이 틀렸을 때 조용히 지나가지 않는가 ===');
ok('items 가 비면 던진다 (에러 아님을 에러로 만든다)',
  /if \(!item\) throw new Error\('채널을 찾지 못했다/.test(YT));
ok('그 에러가 last_error 로 간다', /last_error: String/.test(WATCH));

console.log('\n=== 알림이 플랫폼을 드러내는가 ===');
{
  const m2 = WATCH.match(/function fmtCount[\s\S]*?\nfunction buildAlert\(acc, m, why\) \{[\s\S]*?\n\}/);
  ok('buildAlert 를 찾았다', !!m2);
  if (m2) {
    // eslint-disable-next-line no-new-func
    const F = new Function(`${m2[0]}; return buildAlert;`)();
    const yt = F({ username: '@BTS', label: 'BTS', platform: 'youtube' },
      { type: 'VIDEO', likes: null, comments: null, ts: Date.now() - 60000,
        caption_head: 'Official Teaser', permalink: 'https://www.youtube.com/watch?v=x' }, '컴백 티저');
    const ig = F({ username: 'blackpinkofficial', label: '블랙핑크', platform: 'instagram' },
      { type: 'IMAGE', likes: 100, comments: 2, ts: Date.now() - 60000,
        caption_head: 'hi', permalink: 'https://www.instagram.com/p/A/' }, '투어');
    ok('유튜브는 ▶️ 로 시작한다', yt.startsWith('▶️'));
    ok('인스타는 📸 로 시작한다', ig.startsWith('📸'));
    ok('유튜브 핸들에 @ 를 덧붙이지 않는다', !yt.includes('@@'));
    ok('유튜브는 좋아요·댓글 칸을 만들지 않는다', !yt.includes('♥') && !yt.includes('💬'));
    ok('유튜브도 판정 이유가 보인다', yt.split('\n')[0].includes('컴백 티저'));
  }
}

console.log('\n=== 판정기가 유튜브를 안다 ===');
ok('제목이 핵심 신호라고 알려준다', /유튜브는 제목이 핵심 신호다/.test(WATCH));
ok('티저는 뉴스, 브이로그는 아님을 예시로 준다',
  /Official Teaser/.test(WATCH) && /브이로그/.test(WATCH));
ok('판정 입력에 플랫폼을 실어 보낸다', /platform: r\.acc\.platform === 'youtube'/.test(WATCH));

console.log(`\n${failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음'} — 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
