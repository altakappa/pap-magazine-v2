/**
 * 스레드·X 에 인스타 그림을 그대로 올린다 — tests/social-media-attach.test.js
 * (2026-08-07 신설)
 *
 * 무슨 문제였나 ───────────────────────────────────────────────────────
 * 도메니코:
 *   "인스타그램에서 게시물을 올릴때 연동해서 이미지가 올라가지만 캡션은
 *    인스타그램과 동일하게 올리지 않고, 지금 자동으로 올라가는 것처럼
 *    캡션을 써서 올리는걸로 하고싶어."
 *   "트위터도 마찬가지야. 현재 글만 올라가는 방식은 더이상 올리지말고."
 *   "내가 인스타에 올리는 영상이나 이미지들을 그대로 올려주면돼."
 *
 * 상태가 채널마다 반대였다:
 *   스레드 — 인스타 앱의 '스레드에도 공유' 가 이미지를 올리고 캡션을 복붙.
 *            우리 크론은 캡션은 좋은데 텍스트뿐.
 *   X      — uploadArticleMedia 가 이미 있는데 **수동 경로(x-publish)만** 썼다.
 *            자동 경로(sync-instagram)는 텍스트로만 나갔다.
 *
 * 여기서 지키는 것:
 *   ① 스레드가 한 장이면 IMAGE, 여러 장이면 CAROUSEL 로 나간다
 *   ② 릴스(영상)는 영상으로 나간다
 *   ③ 미디어 선택 판단이 X 와 스레드가 같다 (두 채널이 같은 그림을 올린다)
 *   ④ 미디어가 실패해도 글은 나간다 — 다만 조용히 넘어가지 않는다
 *   ⑤ 배선: 자동 경로 두 곳(sync-instagram · threads-post) 모두 미디어를 넘긴다
 *   ⑥ 미디어 칸을 SELECT 에서 빠뜨리지 않는다 (빠뜨리면 조용히 텍스트가 된다)
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const T = require(path.join(ROOT, 'api', '_lib', 'threads.js'));
const X = require(path.join(ROOT, 'api', '_lib', 'xPost.js'));

const IMG = (n) => Array.from({ length: n }, (_, i) =>
  'https://igcazquhkwxtqsaqpznx.supabase.co/storage/v1/object/public/media/ig-articles/123/' + i + '.jpg');

console.log('\n[1] 미디어 선택 — 스레드와 X 가 같은 판단을 한다');
{
  const cases = [
    ['릴스(영상)', { source_media_type: 'VIDEO', videos: ['https://x.test/v.mp4'], gallery: IMG(3) }],
    ['캐러셀 8장', { source_media_type: 'CAROUSEL_ALBUM', gallery: IMG(8), videos: [] }],
    ['단일 이미지', { source_media_type: 'IMAGE', gallery: IMG(1), videos: [] }],
    ['갤러리 없이 영상만', { source_media_type: 'IMAGE', gallery: [], videos: ['https://x.test/v.mp4'] }],
    ['아무것도 없음', { gallery: [], videos: [] }],
  ];
  for (const [name, art] of cases) {
    const th = T.selectArticleMedia(art);
    const xs = X.selectArticleMedia(art);
    const thKind = th.video ? 'video' : (th.images.length ? 'image' : 'none');
    t(name + ' — 두 채널의 종류 판단이 같다', thKind === xs.kind, thKind + ' vs ' + xs.kind);
  }
  t('릴스는 영상이 본체다 (갤러리가 있어도)',
    T.selectArticleMedia({ source_media_type: 'VIDEO', videos: ['https://x.test/v.mp4'], gallery: IMG(3) }).video
      === 'https://x.test/v.mp4');
  t('영상이 있으면 이미지는 안 싣는다',
    T.selectArticleMedia({ source_media_type: 'VIDEO', videos: ['https://x.test/v.mp4'], gallery: IMG(3) }).images.length === 0);
}

console.log('\n[2] 스레드 장수 상한');
{
  t('캐러셀 상한이 20 이다 (스레드 규격)', T.MAX_CAROUSEL === 20);
  const many = T.selectArticleMedia({ gallery: IMG(30), videos: [] });
  t('30장을 줘도 20장으로 자른다', many.images.length === 20, String(many.images.length));
  /* X 는 4장이 상한이다 — 채널 규격이 다르므로 여기서 같기를 요구하지 않는다. */
  t('X 는 4장으로 자른다 (규격이 달라도 되는 자리)',
    X.selectArticleMedia({ gallery: IMG(30), videos: [] }).urls.length === 4);
}

console.log('\n[3] postMedia — 형식별 요청이 맞게 나간다');
{
  const src = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'threads.js'), 'utf8');
  t('영상은 media_type=VIDEO + video_url', /media_type: 'VIDEO', video_url:/.test(src));
  t('한 장은 media_type=IMAGE + image_url', /media_type: 'IMAGE', image_url: urls\[0\], text:/.test(src));
  t('여러 장은 자식에 is_carousel_item=true', /is_carousel_item: 'true'/.test(src));
  t('자식 컨테이너에는 캡션을 안 붙인다 (부모에만)',
    !/is_carousel_item: 'true'[\s\S]{0,120}text: caption/.test(src));
  t('부모는 media_type=CAROUSEL + children', /media_type: 'CAROUSEL', children:/.test(src));
  t('webp 는 걸러낸다 (스레드는 JPEG·PNG 만 받는다)', /jpe\?g\|png/.test(src));
  t('https 아닌 URL 은 안 보낸다', /\^https:/.test(src));
  t('영상은 대기를 더 길게 준다 (트랜스코딩)', /waitContainer\(cj\.id, token, 20\)/.test(src));
  t('캐러셀은 장수에 비례해 기다린다', /Math\.max\(12, urls\.length \* 2\)/.test(src));
  t('텍스트 경로의 대기 횟수는 예전 그대로 6', /waitContainer\(cj\.id, token, 6\)/.test(src));
}

console.log('\n[4] 미디어가 실패해도 글은 나간다');
{
  const src = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'threadsAutopost.js'), 'utf8');
  /* 2026-08-13 — 본문 변수명이 text -> bodyText 로 바뀌었다. 링크를 본문에서 빼
     첫 답글로 옮겼기 때문(threads-link-reply.test.js). 의도는 그대로: 미디어가
     실패해도 글은 올라가야 한다. */
  t('미디어 실패 시 텍스트로 폴백한다', /if \(hasMedia\) \{[\s\S]{0,300}postText\(bodyText\)/.test(src));
  t('폴백했다는 사실을 detail 에 남긴다 (조용한 품질 저하 금지)',
    /미디어 없이 게시함/.test(src));
  t('폴백도 실패하면 원래 실패를 덮지 않는다', /폴백도 실패하면 원래 실패 그대로 둔다/.test(src));
  t('미디어가 아예 없는 기사만 텍스트 경로로 간다', /} else \{[\s\S]{0,240}postText\(bodyText\)/.test(src));
  t('결과에 어떤 형태로 나갔는지 싣는다', /media: mediaKind/.test(src));
}

console.log('\n[5] 배선 — 자동 경로 두 곳 모두');
{
  const sync = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'sync-instagram.js'), 'utf8');
  const sweep = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'threads-post.js'), 'utf8');

  t('sync-instagram 이 X 미디어를 올린다', /uploadArticleMedia\(row/.test(sync));
  t('X 트윗에 media_ids 를 붙인다', /postTweet\([\s\S]{0,120}mediaIds: xMedia\.mediaIds/.test(sync));
  t('X 미디어 업로드 실패가 트윗을 막지 않는다', /catch \(e\) \{ console\.error\('\[sync-ig\] X 미디어/.test(sync));
  t('미디어 없이 나간 트윗에 표시를 남긴다', /미디어없음/.test(sync));

  t('sync-instagram 이 스레드에 갤러리를 넘긴다', /gallery: row\.gallery, videos: row\.videos/.test(sync));
  t('스위퍼도 갤러리를 넘긴다', /gallery: art\.gallery, videos: art\.videos/.test(sweep));
  t('스위퍼가 미디어 칸을 SELECT 한다 — 빠뜨리면 조용히 텍스트가 된다',
    /gallery, videos, source_media_type/.test(sweep));
}

console.log('\n[6] 예전 텍스트 경로가 안 깨졌다');
{
  const src = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'threads.js'), 'utf8');
  t('postText 는 여전히 export 된다', typeof T.postText === 'function');
  t('postMedia 도 export 된다', typeof T.postMedia === 'function');
  t('selectArticleMedia 도 export 된다', typeof T.selectArticleMedia === 'function');
  t('postText 는 media_type=TEXT 그대로', /media_type: 'TEXT'/.test(src));
  t('컨테이너 대기·발행을 공용 함수로 뽑았다 (중복 로직 금지)',
    /async function waitContainer/.test(src) && /async function publishContainer/.test(src));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ social-media-attach tests FAILED'); process.exit(1); }
console.log('✅ social-media-attach tests passed');
