/**
 * 부계정 게시물을 출처로 (2026-09-21)
 *
 * 배경 — 실측:
 *   2026-09-21 드라이브 '유튜브' 폴더 62파일 전수 대조: 15건이 유튜브·틱톡 둘 다 안 올라감.
 *   그중 6건은 @papfashion_ 릴스로 ig_sub_posts 에 캡션까지 있었다. 그런데 igSubPosts 는
 *   '힌트'만 줬다 — "@papfashion_ 9/18 게시물" 이라고 알림에 적고 올리지는 않았다.
 *   도메니코: "pap_celeb 과 papbeauty_ 그리고 pap_object 에서도 기사를 찾아서 붙일 수 있어."
 *
 * 이 하네스가 지키는 것:
 *   ① 부계정 게시물 → 기사 모양 (제목=첫 줄, 설명=나머지, id 없음, sub 표식)
 *   ② 설명문·캡션에 '기사 전문'(없는 URL) 대신 인스타 게시물 링크가 실린다
 *   ③ 웹 기사가 있으면 웹 기사가 먼저다 — 순서 보존
 *   ④ 두 크론 다 배선돼 있고, 기사 기준 중복 검사는 art.id 가 있을 때만 돈다
 *   ⑤ 기존 기사 경로의 출력은 그대로 (회귀 없음)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p); require.cache[p].exports = exports; require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('auth.js', { requireAdmin: async () => null });
stub('cronGuard.js', { withCronGuard: (_n, fn) => fn });
stub('buffer.js', { createVideoPost: async () => ({}) });
stub('youtube.js', { uploadVideo: async () => ({}) });
stub('driveVideos.js', { isConfigured: () => false, listVideos: async () => [], shouldSkip: () => null, folderId: () => 'x', downloadVideo: async () => null, findSubfolderId: async () => null, DEFAULT_FOLDER: 'x', VIDEO_EXT: [] });
stub('tiktokDrive.js', { recentArticles: async () => [], doneDriveIds: async () => new Set(), articlesWaitingForDrive: async () => ({ ids: new Set() }), pickViable: () => ({ candidates: [], skipped: [] }), judgeDriveBacklog: () => ({}), driveBacklog: async () => ({}) });

const sub = require(path.join(ROOT, 'api', '_lib', 'igSubPosts.js'));
const yt = require(path.join(ROOT, 'api', 'cron', 'drive-youtube-post.js'));
const tk = require(path.join(ROOT, 'api', 'cron', 'drive-tiktok-post.js'));

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', typeof d === 'string' ? d : JSON.stringify(d)); }
}

const SP = { account: 'papfashion_', shortcode: 'DAbc123', permalink: 'https://www.instagram.com/reel/DAbc123/',
  caption_line1: '세인트제임스 서울숲', caption_head: '세인트제임스 서울숲\n서울숲에 새 매장이 열렸다. 스트라이프의 원조.', posted_at: '2026-09-11T02:00:00Z' };

console.log('\n=== ① 부계정 게시물 → 기사 모양 ===');
{
  const a = sub.subPostAsArticle(SP);
  t('제목 = 캡션 첫 줄', a.title === '세인트제임스 서울숲', a);
  t('설명 = 첫 줄을 뺀 나머지 (제목 중복 방지)', a.content === '서울숲에 새 매장이 열렸다. 스트라이프의 원조.', a.content);
  t('id 는 null · sub 표식', a.id === null && a.sub === true);
  t('계정·shortcode·permalink 보존', a.account === 'papfashion_' && a.shortcode === 'DAbc123' && /reel\/DAbc123/.test(a.permalink));
  t('tags 는 빈 배열 (buildHashtags 가 터지지 않게)', Array.isArray(a.tags) && a.tags.length === 0);
  t('캡션 첫 줄 없으면 null', sub.subPostAsArticle({ account: 'x' }) === null && sub.subPostAsArticle(null) === null);
  t('caption_head 없어도 죽지 않는다', sub.subPostAsArticle({ account: 'x', caption_line1: '제목만' }).content === '');
  t('URL: permalink 우선', sub.subPostUrl(a) === SP.permalink);
  t('URL: permalink 없으면 shortcode 로', sub.subPostUrl({ shortcode: 'Zz9', account: 'pap_celeb' }) === 'https://www.instagram.com/p/Zz9/');
  t('URL: 둘 다 없으면 계정 홈', sub.subPostUrl({ account: 'pap_object' }) === 'https://www.instagram.com/pap_object/');
}

console.log('\n=== ② 설명문·캡션에 없는 기사 URL 대신 인스타 게시물 링크 ===');
{
  const a = sub.subPostAsArticle(SP);
  const d = yt.buildDescription(a, 'https://www.pap-magazine.com/article/');
  t('유튜브: 제목 줄', /^세인트제임스 서울숲 — PAP MAGAZINE/.test(d), d);
  t('유튜브: 첫 문장이 설명에', /서울숲에 새 매장이 열렸다\./.test(d), d);
  t('유튜브: 원문 링크 = 인스타 게시물', /▶ 원문 \(@papfashion_\) : https:\/\/www\.instagram\.com\/reel\/DAbc123\//.test(d), d);
  t('유튜브: "기사 전문" 줄이 없다 (404 링크 금지)', !/기사 전문/.test(d), d);
  t('유튜브: 인스타 유입 줄은 그대로', /▶ 인스타그램 : /.test(d));
  t('유튜브: < > 없음', !/[<>]/.test(d));
  const c = tk.buildCaption(a);
  t('틱톡: 제목 줄', /^세인트제임스 서울숲 — PAP MAGAZINE/.test(c), c);
  t('틱톡: 원문 링크 = 인스타 게시물', /▶ 원문 \(@papfashion_\) : https:\/\/www\.instagram\.com\/reel\/DAbc123\//.test(c), c);
  t('틱톡: "기사 전문" 줄이 없다', !/기사 전문/.test(c), c);
  t('틱톡: 해시태그가 붙는다', /#/.test(c), c);
}

console.log('\n=== ⑤ 기존 기사 경로 출력은 그대로 (회귀 없음) ===');
{
  const art = { id: 'a1', title: '아더에러와 버켄스탁', content: '<p>실로 이었다. 다음.</p>', slug: 'ader', custom_url: 'ader-birk', tags: ['adererror'] };
  const d = yt.buildDescription(art, 'https://www.pap-magazine.com/article/ader-birk');
  t('유튜브 기사: 기사 전문 링크 유지', /▶ 기사 전문 : https:\/\/www\.pap-magazine\.com\/article\/ader-birk/.test(d), d);
  t('유튜브 기사: 원문(@) 줄 없음', !/▶ 원문 \(@/.test(d));
  const c = tk.buildCaption(art);
  t('틱톡 기사: 기사 전문 링크 유지', /▶ 기사 전문 : pap-magazine\.com\/article\/ader-birk/.test(c), c);
  t('틱톡 기사: 원문(@) 줄 없음', !/▶ 원문 \(@/.test(c));
}

console.log('\n=== ③④ 배선 — 두 크론 · 순서 · 중복 검사 가드 ===');
{
  const ys = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'drive-youtube-post.js'), 'utf8');
  const ts = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'drive-tiktok-post.js'), 'utf8');
  for (const [name, src] of [['youtube', ys], ['tiktok', ts]]) {
    t(name + ': 부계정 표를 한 번 읽는다', (src.match(/loadSubPosts\(supabaseAdmin\)/g) || []).length === 1);
    t(name + ': 웹 기사 매칭이 먼저, 실패했을 때만 부계정', /if \(m\.matched\) \{ pick = [\s\S]{0,120}\n\s*const sp = subs\.length \? findSubPost\(fileCore\(f\.name\), subs\)/.test(src));
    t(name + ': 부계정 매치는 reason 에 계정을 남긴다', /reason: 'sub:@' \+ sa\.account/.test(src));
    t(name + ': 기사 기준 중복 검사는 art.id 가 있을 때만', /art\.id \? await supabaseAdmin/.test(src));
    t(name + ': 기록 detail 에 sub:@계정/shortcode', /sub:@' \+ art\.account \+ '\/' \+ \(art\.shortcode \|\| ''\)/.test(src));
  }
  t('힌트 블록이 subs 를 다시 읽지 않는다 (유튜브)', !/const subs = await loadSubPosts\(supabaseAdmin\);\s*\n\s*const hits/.test(ys));
}

console.log(`\n부계정 출처: ${pass} 통과 · ${fail} 실패`);
if (fail) process.exit(1);
