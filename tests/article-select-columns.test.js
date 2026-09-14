/**
 * 기사 조회에서 embedding(19KB)을 빼는 규칙 (2026-09-14 전송량 초과 사고 후속).
 *
 * [사건] 2026-09-14 새벽 Supabase 가 전송량 초과로 프로젝트를 잠갔다. 사이트가
 * 3시간 40분 멈췄다. 원인을 재보니 기사 한 줄을 JSON 으로 바꾸면 평균 25,379
 * 바이트인데, embedding 열 하나가 그 중 19,254 바이트(76%)였다. 이 열은
 * "비슷한 기사 찾기"를 만들 때만 쓰고 화면을 그리는 데는 한 글자도 안 쓴다.
 * 그런데 SSR(api/seo/article/[slug].js)도 SPA 상세(api/articles/[id].js)도
 * select('*') 라서 기사 한 번 열 때마다 19KB 를 공짜로 퍼 날랐다.
 * SPA 쪽은 그걸 브라우저에까지 보냈다.
 *
 * [고친 것] api/_lib/articleCols.js 의 ARTICLE_SELECT (embedding 뺀 41개 열).
 * 실측: 25,379 → 6,125 바이트 (4.14배 작아짐).
 *
 * [이 테스트가 지키는 것]
 *  1) 목록에 embedding 이 다시 들어오지 않는다
 *  2) 화면에 꼭 필요한 열이 빠지지 않는다 (새 열 추가 때 빠뜨리면 조용히 undefined)
 *  3) 뜨거운 경로가 select('*') 로 되돌아가지 않는다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const { ARTICLE_COLUMNS, ARTICLE_SELECT, ARTICLE_EXCLUDED } =
  require(path.join(__dirname, '..', 'api', '_lib', 'articleCols'));

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

console.log('\n=== 열 목록 ===');
t('embedding 은 목록에 없다 (한 줄의 76%)', !ARTICLE_COLUMNS.includes('embedding'));
t('제외 목록에 embedding 이 적혀 있다', ARTICLE_EXCLUDED.includes('embedding'));
t('중복된 열이 없다', new Set(ARTICLE_COLUMNS).size === ARTICLE_COLUMNS.length);
t('41개 열 (2026-09-14 스키마: 42개 중 embedding 제외)', ARTICLE_COLUMNS.length === 41, ARTICLE_COLUMNS.length);
t('ARTICLE_SELECT 은 쉼표로 이은 문자열', /^[a-z_]+(, [a-z_]+)+$/.test(ARTICLE_SELECT));
t('ARTICLE_SELECT 에 * 가 없다', !ARTICLE_SELECT.includes('*'));

console.log('\n=== 화면이 실제로 쓰는 열은 반드시 있다 ===');
/* 이 목록을 줄이려면 화면 코드에서 그 열을 안 쓴다는 걸 먼저 확인할 것 */
const MUST = [
  'id', 'title', 'subtitle', 'slug', 'custom_url', 'status', 'category',
  'published_date', 'updated_at', 'content', 'content_en', 'title_en',
  'thumbnail_url', 'hero_image_url', 'gallery', 'credits', 'tags', 'videos',
  'faq', 'faq_en', 'seo_title', 'seo_description', 'description_en',
  'redirect_from', 'instagram_caption', 'source_instagram_url',
  'is_celeb', 'digest_kind', 'post_form', 'view_count'
];
for (const c of MUST) t('필수 열: ' + c, ARTICLE_COLUMNS.includes(c));

console.log('\n=== 뜨거운 경로가 select(*) 로 돌아가지 않는다 ===');
for (const f of ['api/seo/article/[slug].js', 'api/articles/[id].js']) {
  const s = R(f);
  t(f + " — articles 에 select('*') 없음", !/from\('articles'\)[\s\S]{0,40}?select\('\*'\)/.test(s));
  t(f + ' — ARTICLE_SELECT 을 require 한다', /require\((?:'|")[^'"]*_lib\/articleCols(?:'|")\)/.test(s));
  t(f + ' — ARTICLE_SELECT 을 실제로 쓴다', /select\(ARTICLE_SELECT\)/.test(s));
}

console.log('\n=== 왜 뺐는지 파일에 적혀 있다 ===');
const lib = R('api/_lib/articleCols.js');
t('전송량 사고 날짜가 적혀 있다', lib.includes('2026-09-14'));
t('새 열 추가 시 여기도 고치라는 경고가 있다', /새 열/.test(lib));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ article-select-columns tests FAILED'); process.exit(1); }
console.log('✅ article-select-columns tests passed');
