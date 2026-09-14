/**
 * PAP Magazine — articles 테이블의 "렌더에 쓰는 열" 목록 (2026-09-14)
 *
 * 왜 이 파일이 생겼나
 * ─────────────────────────────────────────────────────────────
 * 2026-09-14 Supabase 전송량(egress) 초과로 사이트가 3시간 40분 멈췄다.
 * 원인을 재보니 기사 한 줄의 평균 크기가 25,993 바이트인데 그 중
 * `embedding`(pgvector, 1536차원) 한 열이 19,241 바이트 — 74% 였다.
 * 이 열은 "비슷한 기사 찾기"를 만들 때만 쓰고, 기사 페이지를 그리는 데는
 * 한 글자도 쓰지 않는다. 그런데 SSR 도 SPA 상세 API 도 `select('*')` 라서
 * 기사 한 번 열 때마다 19KB 를 공짜로 퍼 나르고 있었다.
 *
 * 그래서 `select('*')` 대신 이 목록을 쓴다. 기사 한 줄이 26KB → 약 7KB 가
 * 된다 (약 1/3.7). 봇이 하루 19만 번 긁어가도 전송량이 그만큼 준다.
 *
 * 주의 — 새 열을 articles 에 추가하면 여기에도 추가해야 한다.
 * PostgREST 에는 "이 열만 빼고 전부" 라는 문법이 없어서, 빼려면 남길 것을
 * 일일이 적는 수밖에 없다. 빠뜨리면 그 열은 조용히 undefined 가 된다.
 * tests/article-cols.test.js 가 렌더에 꼭 필요한 열들이 빠지지 않았는지 지킨다.
 *
 * 일부러 뺀 열: embedding (렌더 미사용, 19KB)
 */

const ARTICLE_COLUMNS = [
  'id', 'title', 'subtitle', 'slug', 'published_date', 'category', 'tags',
  'thumbnail_url', 'hero_image_url', 'content', 'gallery', 'credits',
  'custom_url', 'status', 'created_at', 'updated_at', 'scheduled_publish_at',
  'admin_edited_at', 'created_by', 'updated_by', 'view_count',
  'source_instagram_url', 'source_instagram_post_id', 'instagram_imported_at',
  'title_en', 'content_en', 'videos', 'source_media_type', 'faq',
  'redirect_from', 'is_celeb', 'celeb_by', 'digest_kind', 'kind_by',
  'instagram_caption', 'seo_title', 'seo_description', 'description_en',
  'faq_en', 'post_form', 'post_form_by'
];

/* supabase .select() 에 그대로 넣는 문자열 */
const ARTICLE_SELECT = ARTICLE_COLUMNS.join(', ');

/* 일부러 제외한 열 — 테스트가 이 목록으로 "실수로 다시 들어왔는지" 를 본다 */
const ARTICLE_EXCLUDED = ['embedding'];

module.exports = { ARTICLE_COLUMNS, ARTICLE_SELECT, ARTICLE_EXCLUDED };
