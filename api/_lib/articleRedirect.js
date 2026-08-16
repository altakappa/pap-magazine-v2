/**
 * PAP Magazine — 기사 정규-슬러그 301 목적지 생성기.
 *
 * 의존성 0. 라우트(api/seo/article/[slug].js)와 테스트가 같은 규칙을 본다 —
 * 규칙이 두 벌이면 한쪽만 고쳐진다. 라우트 본체는 supabase 를 require 해서
 * 환경변수 없이는 load 조차 안 되므로, 검증 가능한 순수 로직만 여기로 뺐다.
 */
'use strict';

/* SSR 이 인정하는 언어. 정규-슬러그 301 의 경로 프리픽스와 아래 lang 판정이
   같은 목록을 봐야 한다 — 목록이 두 벌이면 한쪽만 고쳐진다 (2026-08-16). */
const REDIRECT_LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'];

/**
 * 정규-슬러그 301 의 Location 을 만든다. 순수 함수 — 테스트가 동작을 직접 검증한다.
 *
 * 2026-08-16 — 이 301 이 중복 URL 을 스스로 찍어내고 있었다.
 * Vercel 은 rewrite 할 때 경로 조각을 쿼리로도 실어준다:
 *   /article/<x>     → /api/seo/article/<x>?slug=<x>
 *   /en/article/<x>  → /api/seo/article/<x>?lang=en&slug=<x>
 * 예전 코드는 req.url 의 쿼리를 통째로 이어붙여서 목적지가
 *   /article/<정규슬러그>?slug=<uuid>   ← 구글이 이 주소를 그대로 색인했다
 * 가 됐다. GSC 실측(2026-07-17~08-12) 61개 URL · 노출 715 · 클릭 20 이 전부
 * 이렇게 태어난 유령이고, 정본과 노출을 나눠 갖는다.
 *
 * 규칙: 내부 라우팅 파라미터(slug·lang)는 버리고 진짜 쿼리(utm 등)만 남긴다.
 *       lang 은 버리는 대신 경로 프리픽스(/en/article/…)로 승격한다 —
 *       쿼리로 남기면 언어판이 또 다른 중복 URL 이 되기 때문이다.
 *
 * @param {string} reqUrl        req.url (Vercel 내부 경로 + 쿼리)
 * @param {string} canonicalSlug articles.slug — 정본 슬러그
 * @returns {string} Location 헤더 값
 */
function buildCanonicalRedirect(reqUrl, canonicalSlug) {
  const raw = String(reqUrl || '');
  const qi = raw.indexOf('?');
  const sp = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1).replace(/[\r\n]/g, '') : '');
  const langQ = String(sp.get('lang') || '');
  sp.delete('slug');   // Vercel 이 실어준 경로 조각 — 공개 URL 에 나가면 안 된다
  sp.delete('lang');   // 경로 프리픽스로 승격
  const keptQs = sp.toString();
  const langPrefix = (langQ && langQ !== 'ko' && REDIRECT_LANGS.includes(langQ))
    ? '/' + langQ : '';
  return langPrefix + '/article/' + encodeURIComponent(canonicalSlug)
    + (keptQs ? '?' + keptQs : '');
}

module.exports = { REDIRECT_LANGS, buildCanonicalRedirect };
