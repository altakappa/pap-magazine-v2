/**
 * 레거시 슬러그 정리 시 옛 URL 보존 301 (lever ②, 2026-07-26).
 * articles.redirect_from(text[])에 옛 슬러그를 담으면 SSR 리졸버가 해석하고
 * 정규 슬러그로 301 → 264개 레거시 슬러그(categoryfashion…)를 안전하게 정리.
 * 컬럼 미생성 환경에서도 죽지 않아야 한다(try/catch).
 *
 * 2026-08-16 추가 — 그 301 이 **중복 URL 을 스스로 찍어내고 있었다.**
 * Vercel rewrite 는 경로 조각을 쿼리로도 실어준다(?slug=…, ?lang=…).
 * 예전 코드가 req.url 쿼리를 통째로 이어붙여서 목적지가
 *   /article/<정규슬러그>?slug=<uuid>
 * 가 됐고 구글이 그 주소를 색인했다. GSC 실측(2026-07-17~08-12):
 *   ?slug= / ?lang=&slug= 유령 URL 61개 · 노출 715 · 클릭 20.
 * 그리고 번역 없음 302 가 custom_url 을 먼저 써서
 *   /en/article/%2Fcategory%2FFashion%2F3130%2Fnews%2F
 * 꼴 URL 33개가 또 색인됐다.
 * 아래 [B]·[C] 가드가 이 두 공장을 다시 열지 못하게 막는다.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const route = fs.readFileSync(path.join(__dirname, '..', 'api', 'seo', 'article', '[slug].js'), 'utf8');
const { buildCanonicalRedirect, REDIRECT_LANGS } = require(path.join(__dirname, '..', 'api', '_lib', 'articleRedirect.js'));

let pass=0, fail=0;
function t(n,c,d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== [A] redirect_from 리졸버 ===');
t('route: redirect_from 조회 단계 존재', /\.contains\('redirect_from'/.test(route));
t('route: decoded 변형도 시도', /contains\('redirect_from', \[decoded\]\)/.test(route));
t('route: 컬럼 미생성 안전(try/catch)', /try \{[\s\S]*redirect_from[\s\S]*\} catch/.test(route));
t('route: status published 필터', /contains\('redirect_from'[\s\S]{0,90}'published'\)/.test(route));
t('route: 기존 정규-슬러그 301 유지', /res\.status\(301\)\.end\(\)/.test(route) && /canonicalSlug !== decoded/.test(route));
t('route: 해석 실패 시 404 유지', /renderNotFoundHtml\('article', slug\)/.test(route));

console.log('\n=== [B] 301 목적지가 중복 URL 을 만들지 않는다 (2026-08-16) ===');

const UUID = 'cf160e96-5e27-4fe7-9b64-456ff8d75d66';
const CANON = 'waterbomb-seoul-2026-final-lineup-revealed';

t('내부 slug 파라미터를 목적지에 남기지 않는다',
  buildCanonicalRedirect('/api/seo/article/' + UUID + '?slug=' + UUID, CANON) === '/article/' + CANON,
  buildCanonicalRedirect('/api/seo/article/' + UUID + '?slug=' + UUID, CANON));

t('lang 은 쿼리가 아니라 경로 프리픽스로 승격한다',
  buildCanonicalRedirect('/api/seo/article/legacy-x?lang=en&slug=legacy-x', 'clean-slug')
    === '/en/article/clean-slug',
  buildCanonicalRedirect('/api/seo/article/legacy-x?lang=en&slug=legacy-x', 'clean-slug'));

t('utm 은 반드시 보존한다 (유입 계측이 301 을 넘어 살아남아야 한다)',
  buildCanonicalRedirect('/api/seo/article/x?slug=x&utm_source=kakao&utm_medium=share', 'clean-slug')
    === '/article/clean-slug?utm_source=kakao&utm_medium=share',
  buildCanonicalRedirect('/api/seo/article/x?slug=x&utm_source=kakao&utm_medium=share', 'clean-slug'));

t('utm + lang 동시: 프리픽스 승격 후에도 utm 이 남는다',
  buildCanonicalRedirect('/api/seo/article/x?lang=ja&slug=x&utm_source=naver', 'clean-slug')
    === '/ja/article/clean-slug?utm_source=naver',
  buildCanonicalRedirect('/api/seo/article/x?lang=ja&slug=x&utm_source=naver', 'clean-slug'));

t('ko 는 프리픽스를 붙이지 않는다 (정본은 프리픽스 없는 경로)',
  buildCanonicalRedirect('/api/seo/article/x?lang=ko&slug=x', 'clean-slug') === '/article/clean-slug');

t('모르는 언어 코드는 프리픽스로 쓰지 않는다',
  buildCanonicalRedirect('/api/seo/article/x?lang=zz&slug=x', 'clean-slug') === '/article/clean-slug');

t('쿼리 없는 요청은 쿼리 없는 목적지',
  buildCanonicalRedirect('/api/seo/article/x', 'clean-slug') === '/article/clean-slug');

t('헤더 인젝션 방지 — 개행은 목적지에 들어가지 않는다',
  !/[\r\n]/.test(buildCanonicalRedirect('/api/seo/article/x?slug=x\r\nX-Injected: 1', 'clean-slug')));

t('한글/특수문자 슬러그는 인코딩한다',
  buildCanonicalRedirect('/api/seo/article/x?slug=x', '한글 슬러그').indexOf('%') > 0);

t('route: 목적지 생성은 공용 함수 하나만 쓴다 (규칙이 두 벌이면 한쪽만 고쳐진다)',
  /buildCanonicalRedirect\(req\.url, canonicalSlug\)/.test(route));

t("route: req.url 쿼리를 통째로 이어붙이던 옛 코드가 남아 있지 않다",
  !/encodeURIComponent\(canonicalSlug\)\s*\+\s*qs/.test(route));

t('언어 목록이 한 벌이다 (301 프리픽스 = lang 판정)',
  /const VALID_LANGS = REDIRECT_LANGS/.test(route) && Array.isArray(REDIRECT_LANGS) && REDIRECT_LANGS.includes('ko'));

console.log('\n=== [C] 번역 없음 302 가 레거시 경로를 뱉지 않는다 (2026-08-16) ===');

t("302 목적지는 custom_url 이 아니라 정규 슬러그를 먼저 쓴다",
  /Location', '\/en\/article\/' \+ encodeURIComponent\(data\.slug \|\| data\.custom_url/.test(route),
  '레거시 custom_url(/category/Fashion/3130/news/)이 앞에 오면 %2Fcategory%2F… URL 이 다시 색인된다');

t('route: custom_url 을 먼저 쓰는 Location 이 남아 있지 않다',
  !/Location'[^\n]*encodeURIComponent\(data\.custom_url \|\| data\.slug/.test(route));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ article-redirect-from tests FAILED'); process.exit(1); }
console.log('✅ article-redirect-from tests passed');
