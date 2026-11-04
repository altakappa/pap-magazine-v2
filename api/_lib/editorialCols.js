/**
 * PAP Magazine — editorials 테이블의 "렌더에 쓰는 열" 목록 (2026-11-04)
 *
 * 왜 (articleCols.js 와 같은 수술, 화보판):
 * 2026-11-03 10:00~11:57 KST DB 가 멈췄다. 크롤러(Ahrefs 감사)가 화보·번역 페이지를 연달아 열었고,
 * 화보 페이지는 select('*') 로 화보 한 줄을 통째로 읽었다. 실측: 한 줄 12,289 바이트 중
 * embedding(AI 검색용 벡터) 이 6,148 바이트 — 50%. 페이지를 그리는 데는 한 글자도 안 쓴다.
 * → 이 열을 빼면 화보 한 번 읽을 때 DB 가 꺼내는 양이 절반이 된다.
 *
 * 주의 — editorials 에 새 열을 추가하면 여기에도 추가해야 한다.
 * PostgREST 에는 "이 열만 빼고 전부" 문법이 없다. 빠뜨리면 그 열은 조용히 undefined 가 된다.
 * tests/editorial-cols.test.js 가 열 개수(2026-11-04 스키마 54열 중 embedding 제외 53열)와
 * 렌더 필수 열을 지킨다. 열을 추가했으면 그 테스트의 숫자도 같이 고친다.
 *
 * 쓰는 곳: api/seo/editorial/[slug].js (SSR, 크롤러가 여는 페이지) · api/editorials/[id].js GET (화보 상세 API)
 * 안 쓰는 곳: 관리자 수정 경로(변경 전 전체 행 비교가 목적) — 그대로 '*'.
 *
 * 일부러 뺀 열: embedding (렌더 미사용, 6KB)
 */
'use strict';

const EDITORIAL_COLUMNS = [
  'id', 'title', 'slug', 'cover_image', 'published_date', 'url', 'tags', 'issue', 'thumbnail',
  'gallery', 'credits', 'fashion', 'status', 'created_at', 'updated_at', 'description',
  'scheduled_publish_at', 'seo_title', 'seo_description', 'og_image', 'title_en', 'description_en',
  'instagram_caption', 'source_submission_id', 'approval_email_sent_at', 'admin_edited_at',
  'created_by', 'updated_by', 'description_it', 'view_count', 'approval_email_day',
  'approval_email_month', 'approval_email_status', 'approval_email_failed_reason',
  'pinterest_pin_id', 'pinterest_synced_at', 'pinterest_error', 'source_instagram_url', 'legacy',
  'meta_desc_attempted_at', 'insta_logo_settings', 'meta_desc_attempts', 'description_filled_at',
  'featured_month', 'credits_history', 'credits_edit_count', 'faq', 'faq_en', 'redirect_from',
  'report_card_sent_at', 'report_card_status', 'report_card_attempts', 'live_email_sent_at',
];

/* supabase .select() 에 그대로 넣는 문자열 */
const EDITORIAL_SELECT = EDITORIAL_COLUMNS.join(', ');

/* 일부러 제외한 열 — 테스트가 "실수로 다시 들어왔는지" 를 본다 */
const EDITORIAL_EXCLUDED = ['embedding'];

module.exports = { EDITORIAL_COLUMNS, EDITORIAL_SELECT, EDITORIAL_EXCLUDED };
