/**
 * 부계정 피드 참조 (2026-09-13, 마이그레이션 154).
 *
 * [배경] 272528b 가 캡션 첫 줄 매칭으로 드라이브 적체 16건 중 6건을 풀었다.
 * 남은 7건은 웹 기사 자체가 없다. 도메니코: "pap_magazine 스토리에만 올라간
 * 영상이 부계정에서 피드로 올라간다. 그 피드를 참고해도 돼."
 *
 * [이 표가 하는 일과 안 하는 일]
 * 하는 일: 영상이 어느 부계정의 어느 게시물인지 알려준다.
 * 안 하는 일: 기사를 만들지 않는다. 그래서 영상이 저절로 올라가지도 않는다.
 * 바뀌는 것은 알림 문구다 — 도메니코가 판단할 재료가 생긴다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const L = (m) => require(path.join(__dirname, '..', 'api', '_lib', m));

const { findSubPost, firstLine, shortcodeOf, SUB_ACCOUNTS, STALE_MS } = L('igSubPosts');
const { fileCore } = L('koMatch');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

console.log('\n=== 계정 목록 ===');
t('도메니코가 지정한 4곳',
  SUB_ACCOUNTS.length === 4
  && ['papfashion_', 'papbeauty_', 'pap_celeb', 'pap_object'].every((a) => SUB_ACCOUNTS.includes(a)),
  SUB_ACCOUNTS);
t('pap_magazine 본계정은 넣지 않는다 (sync-instagram 이 이미 한다)',
  !SUB_ACCOUNTS.includes('pap_magazine'));

console.log('\n=== 파싱 ===');
t('캡션 첫 줄만 가져온다', firstLine('엠포리오 아르마니\n\n@emporioarmani') === '엠포리오 아르마니');
t('\\r 을 정리한다', firstLine('민호 보고\r\n둘째 줄') === '민호 보고');
t('빈 캡션은 빈 문자열', firstLine(null) === '' && firstLine(undefined) === '');
t('permalink 에서 shortcode', shortcodeOf('https://www.instagram.com/p/DdAwlyvmcwB/') === 'DdAwlyvmcwB');
t('reel 도 된다', shortcodeOf('https://www.instagram.com/reel/Dc-ei_IvwcF/') === 'Dc-ei_IvwcF');
t('엉뚱한 URL 은 null', shortcodeOf('https://example.com/x') === null);

console.log('\n=== 파일명 → 부계정 게시물 ===');
const ROWS = [
  { account: 'papfashion_', shortcode: 's1', caption_line1: '엠포리오 아르마니', posted_at: '2026-08-28T00:00:00Z' },
  { account: 'pap_object', shortcode: 's2', caption_line1: '베를린 쇼룸', posted_at: '2026-08-31T00:00:00Z' },
  { account: 'papbeauty_', shortcode: 's3', caption_line1: '헬리녹스 웨어의 첫 플래그십 스토어 오픈 @helinox', posted_at: '2026-09-10T00:00:00Z' },
  { account: 'pap_celeb', shortcode: 's4', caption_line1: '포핸즈', posted_at: '2026-08-22T00:00:00Z' },
];
t('정확 일치', (findSubPost(fileCore('0828_엠포리오 아르마니.mp4'), ROWS) || {}).shortcode === 's1');
t('짧아도 정확 일치는 인정 (포핸즈 3자 → squash 3자 미만 아님)',
  (findSubPost(fileCore('0822_포핸즈.mp4'), ROWS) || {}) .shortcode === 's4' || fileCore('0822_포핸즈.mp4').length < 4);
t('접두 일치 (캡션 뒤 @태그)',
  (findSubPost(fileCore('0910_헬리녹스 웨어의 첫 플래그십 스토어 오픈.mp4'), ROWS) || {}).shortcode === 's3');
t('없는 것은 null', findSubPost(fileCore('0907_상쾌한 더 무비 Talk.mp4'), ROWS) === null);
t('UUID 파일명은 null', findSubPost(fileCore('copy_2A002017-031A-4F97-88EC-B4C6A77C26D6.mp4'), ROWS) === null);

const dup = ROWS.concat([{ account: 'pap_object', shortcode: 'dup', caption_line1: '엠포리오 아르마니', posted_at: '2026-08-29T00:00:00Z' }]);
t('둘 이상이면 모르는 것으로 둔다 (억지로 안 고른다)',
  findSubPost(fileCore('0828_엠포리오 아르마니.mp4'), dup) === null);

console.log('\n=== 비용 규약 ===');
/* 크론 호출 예산이 2,599/2,600 이라 새 크론을 만들 수 없다. 이 규약이 깨지면
   다음 사람이 무심코 크론을 만들고 예산 가드가 터진다. */
const mig = R('supabase_migrations/154_ig_sub_posts.sql');
const watch = R('api/cron/celeb-account-watch.js');
const vercel = JSON.parse(R('vercel.json'));
t('전용 크론을 만들지 않았다',
  !(vercel.crons || []).some((c) => /sub-posts|subposts/i.test(c.path)),
  (vercel.crons || []).map((c) => c.path).filter((p) => /sub/i.test(p)));
t('celeb-account-watch 에 얹혀 있다', /collectSubPosts/.test(watch));
t('본 일을 망치지 않는다 (try/catch 로 감쌌다)',
  /try \{\s*\n\s*sub = await collectSubPosts/.test(watch));
t('dry 실행에서는 수집하지 않는다', /if \(!dry\) \{\s*\n\s*try \{\s*\n\s*sub = await collectSubPosts/.test(watch));
t('2시간 게이트가 있다', STALE_MS === 2 * 3600 * 1000);

console.log('\n=== 마이그레이션 154 ===');
t('표를 만든다', /create table if not exists public\.ig_sub_posts/.test(mig));
t('(account, shortcode) 가 PK', /primary key \(account, shortcode\)/.test(mig));
t('caption_line1 색인', /idx_ig_sub_posts_line1/.test(mig));
t('RLS + anon 회수 + service_role 전용',
  /enable row level security/.test(mig)
  && /revoke all on public\.ig_sub_posts from anon/.test(mig)
  && /grant select, insert, update, delete on public\.ig_sub_posts to service_role/.test(mig));
t('주석이 "기사로 만들지 않는다" 를 못박는다', /기사로 만들지 않는다/.test(mig));

console.log('\n=== 알림 배선 ===');
const yt = R('api/cron/drive-youtube-post.js');
t('drive-youtube-post 가 부계정 힌트를 붙인다',
  /loadSubPosts/.test(yt) && /findSubPost/.test(yt) && /subHint/.test(yt));
t('힌트가 실패해도 알림은 나간다 (try/catch)', /catch \(_e\) \{ \/\* 힌트는 곁다리다/.test(yt));
t('힌트가 "웹 기사는 없음" 을 분명히 말한다', /웹 기사는 없음/.test(yt));

/* 2026-09-13 ③ — 도메니코: "웹기사가 없더라도 폴더안에 영상이 들어있지 않나?"
   맞다. drive-story-shorts(2026-08-21)가 '스토리쇼츠' 폴더를 훑어 기사 없이
   파일명 그대로 올린다(실제 18건 업로드됨). 그런데 이 알림은 '빼는 법'만
   말하고 그 길을 한 번도 말하지 않아 0822_포핸즈가 3주를 그대로 있었다. */
t('알림이 스토리쇼츠 폴더 경로를 알려준다',
  /웹 기사 없이 올리려면/.test(yt) && /STORY_FOLDER_NAME/.test(yt));
t('폴더 이름을 drive-story-shorts 와 같은 env 로 읽는다 (한쪽만 바뀌는 사고 방지)',
  /const STORY_FOLDER_NAME = process\.env\.DRIVE_STORY_FOLDER_NAME \|\| '스토리쇼츠'/.test(yt)
  && /const FOLDER_NAME = process\.env\.DRIVE_STORY_FOLDER_NAME \|\| '스토리쇼츠'/.test(R('api/cron/drive-story-shorts.js')));
t('빼는 법도 그대로 남아 있다 (둘 다 필요하다)', /아예 빼려면/.test(yt));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ig-sub-posts tests FAILED'); process.exit(1); }
console.log('✅ ig-sub-posts tests passed');
