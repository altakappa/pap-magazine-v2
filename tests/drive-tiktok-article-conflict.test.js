/**
 * 드라이브 영상 → 틱톡: article_id 충돌로 인한 무한 재게시 (2026-08-12).
 *
 * ■ 무슨 일이 있었나 (실측)
 * 2026-08-09 16:45 ~ 08-12 00:45, **2시간마다 29회** 같은 영상이 틱톡에 올라갔다.
 *     오피셜히게단디즘 내한.mp4
 *     duplicate key value violates unique constraint "uq_tiktok_posts_article_id"
 *
 * 흐름:
 *   ① 드라이브 파일을 '찜'(claiming 줄 INSERT)
 *   ② 틱톡에 게시 — 성공
 *   ③ 결과 기록(update)에서 article_id 유니크 충돌 → 500
 *   ④ 다음 회차가 그 줄을 '죽은 찜' 으로 보고 회수 → ②로 …  무한반복
 *
 * ■ 설계 자체는 옳았다
 * "기록이 실패하면 게시했다고 말하지 않는다"(2026-08-07 유튜브 중복 교훈)는
 * 그대로 유지한다. 문제는 그 기록이 **애초에 성공할 수 없는 값**을 쓴 것이다.
 *
 * ■ 왜 충돌했나
 * tiktok_posts.article_id 에는 유니크 인덱스가 있다(한 기사는 한 번만 게시).
 * 그런데 그 기사는 이미 기사 경로로 게시돼 줄을 갖고 있었다.
 * 드라이브 경로는 drive_file_id 가 자기 고유키이고 article_id 는 참고값일 뿐이다.
 * **참고값 때문에 게시 기록이 실패하면 안 된다.**
 *
 * ■ 버린 선택지
 * 유니크 인덱스를 부분 인덱스로 되돌리기 — 기사 경로의
 * upsert(onConflict:'article_id') 가 부분 인덱스로는 동작하지 않는다(42P10).
 * 2026-08-10 에 정확히 그 이유로 전체 인덱스로 바꿨다. 되돌리면 그 사고가 돌아온다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'api/cron/drive-tiktok-post.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== article_id 충돌 회피 ===');
t('기록 전에 그 기사에 이미 줄이 있는지 확인한다',
  /\.eq\('article_id', art\.id\)/.test(src) && /tiktok_posts'\)[\s\S]{0,80}select\('drive_file_id'\)/.test(src));
t('자기 줄이면 그대로 쓴다 (자기 자신과 충돌하지 않는다)',
  /taken\.drive_file_id !== file\.id/.test(src),
  '무조건 비우면 정상 연결까지 잃는다');
t('이미 다른 줄이 잡고 있으면 article_id 를 비운다',
  /articleIdForRow = null/.test(src));
t('연결 정보를 detail 에 남긴다', /이미 게시된 기사라 연결 생략/.test(src),
  '조용히 버리면 나중에 어느 기사 영상인지 알 수 없다');
t('update 에 확인한 값을 쓴다', /article_id: articleIdForRow/.test(src));

console.log('=== 지켜야 하는 기존 설계 ===');
t('기록 실패를 삼키지 않는다 (2026-08-07 유튜브 중복 교훈)',
  /DB 기록 실패 — 같은 영상이 반복 게시될 수 있음/.test(src));
t('찜한 줄을 upsert 가 아니라 update 로 갱신한다',
  /finishClaim\('tiktok_posts', file\.id/.test(src) && !/upsert\(\s*\{\s*drive_file_id/.test(src));
t('확인 쿼리가 실패해도 게시 흐름을 막지 않는다', /catch \(_\) \{ \/\* 확인 실패는 무시/.test(src));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ drive-tiktok-article-conflict tests FAILED'); process.exit(1); }
console.log('✅ drive-tiktok-article-conflict tests passed');
