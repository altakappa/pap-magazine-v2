/**
 * 화보 페이지가 embedding(6KB, 한 줄의 50%)을 읽지 않는다 (2026-11-04)
 *   11/03 DB 다운: 크롤러가 화보·번역 페이지를 연달아 열 때 select('*') 로 안 쓰는 벡터까지 매번 읽었다.
 *   ① 열 목록: embedding 없음 · 중복 없음 · 53열(2026-11-04 스키마 54열 - embedding) · 렌더 필수 열 포함
 *   ② SSR 화보 페이지와 화보 상세 API 가 이 목록을 쓴다 (editorials 를 '*' 로 읽는 곳이 남지 않음)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

const { EDITORIAL_COLUMNS, EDITORIAL_SELECT, EDITORIAL_EXCLUDED } = require(path.join(ROOT, 'api', '_lib', 'editorialCols.js'));

console.log('\n[1] 열 목록');
t('embedding 은 목록에 없다 (한 줄의 50%)', !EDITORIAL_COLUMNS.includes('embedding'));
t('제외 목록에 embedding', EDITORIAL_EXCLUDED.includes('embedding'));
t('중복 없음', new Set(EDITORIAL_COLUMNS).size === EDITORIAL_COLUMNS.length);
t('53열 (2026-11-04 스키마 54열 중 embedding 제외 — 열을 추가했으면 이 숫자도 고칠 것)', EDITORIAL_COLUMNS.length === 53, EDITORIAL_COLUMNS.length);
['id', 'title', 'slug', 'status', 'published_date', 'created_at', 'tags', 'gallery', 'credits', 'fashion',
  'cover_image', 'thumbnail', 'og_image', 'description', 'description_en', 'title_en', 'seo_title',
  'seo_description', 'faq', 'faq_en', 'redirect_from', 'legacy', 'insta_logo_settings', 'issue', 'url']
  .forEach((c) => t('렌더 필수 열: ' + c, EDITORIAL_COLUMNS.includes(c)));
t('select 문자열에 * 없음', !EDITORIAL_SELECT.includes('*') && /^[a-z_0-9]+(, [a-z_0-9]+)+$/.test(EDITORIAL_SELECT));

console.log('\n[2] 쓰는 곳');
{
  const ssr = R('api/seo/editorial/[slug].js');
  t('SSR: editorialCols 를 불러온다', /require\('\.\.\/\.\.\/_lib\/editorialCols'\)/.test(ssr));
  t("SSR: editorials 를 select('*') 로 읽는 곳이 없다", !/from\('editorials'\)\.select\('\*'\)/.test(ssr));
  t('SSR: EDITORIAL_SELECT 로 읽는다 (7곳)', (ssr.match(/from\('editorials'\)\.select\(EDITORIAL_SELECT\)/g) || []).length === 7);
  const api = R('api/editorials/[id].js');
  t('상세 API: 관련 필름과 함께 EDITORIAL_SELECT', /\.select\(EDITORIAL_SELECT \+ ', related_films:films!related_editorial_id\(/.test(api));
  t("상세 API: '*, related_films' 가 남지 않았다", !/select\('\*, related_films/.test(api));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ editorial-cols tests FAILED'); process.exit(1); }
console.log('✅ editorial-cols tests passed');
