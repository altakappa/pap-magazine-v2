/**
 * 화보 FAQ 언어판 — 가드 (2026-08-27)
 *
 * 화보 FAQ(editorials.faq)는 2026-08-27 에 생겼는데 번역 경로가 기사 전용이라
 * ko 판에만 뜨고 8개 언어판 페이지에는 FAQ 블록·FAQPage 스키마가 통째로 비었다.
 * 세 곳이 동시에 맞아야 실제로 뜬다: 번역 투입 · 번역 저장 · SSR 읽기.
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

const root = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const lib = rd('api/_lib/seoTranslateBackfill.js');
const edSsr = rd('api/seo/editorial/[slug].js');
const renderer = rd('api/_lib/seoRenderer.js');

console.log('=== 번역 투입 ===');
t('attachFaqs 가 kind 의 테이블을 쓴다 (articles 하드코딩 제거)',
  /async function attachFaqs\(items, cfg\)/.test(lib)
  && /const table = \(cfg && cfg\.table\) \|\| 'articles'/.test(lib)
  && /\.from\(table\)\.select\('id, faq'\)/.test(lib));
t('kind 무관하게 호출된다 (translateBody 조건 제거)',
  /await attachFaqs\(items, cfg\)/.test(lib)
  && !/if \(cfg\.translateBody\) await attachFaqs/.test(lib));
t('editorial src 가 faq 를 싣는다', /faq: e\.__faq \|\| undefined/.test(lib));

console.log('\n=== 번역 프롬프트·저장 ===');
{
  // editorial(비본문) 프롬프트 분기에도 faq 규칙이 있어야 한다
  const edPrompt = lib.slice(lib.indexOf('translating fashion-magazine editorial metadata'));
  t('editorial 프롬프트에 faq 번역 규칙', /If an input has "faq"/.test(edPrompt.slice(0, 1500)));
  t('editorial 출력 shape 에 faq', /"description":"\.\.\.","faq"/.test(edPrompt.slice(0, 1500)));
  t('인명·브랜드 원어 유지 규칙', /Keep person names, brand names and handles/.test(edPrompt.slice(0, 1500)));
}
t('저장이 kind 무관 (translateBody 게이트 제거)',
  !/if \(cfg\.translateBody\) \{\s*const trFaq/.test(lib) && /if \(trFaq\) upPayload\.faq = trFaq/.test(lib));
t('normalizeFaq 를 다시 통과 (형태 어긴 응답 차단)', /const trFaq = normalizeFaq\(t\.faq\)/.test(lib));

console.log('\n=== SSR 읽기 ===');
t('화보 SSR 이 번역 faq 를 select 한다', /select\('lang, title, description, faq'\)/.test(edSsr));
t('translation 객체에 faq 를 싣는다', /translation = \{ title: t\.title, description: t\.description, faq: t\.faq \}/.test(edSsr));
/* 2026-08-28 — en 이 분기에서 빠졌다. en 은 seo_translations 에 행이 0개인
   DB 원본 칼럼 언어라 tr 이 언제나 null 이었고, 그래서 영문 페이지 FAQ 가
   통째로 비어 있었다. en 은 faq_en 칼럼을 본다(tests/faq-en.test.js).
   여기서 지키는 것은 그대로다 — **번역판 7개 언어는 tr.faq 를 쓴다.** */
t('렌더러가 번역판(ko·en 외)에서 tr.faq 를 쓴다',
  /\(\(tr && tr\.faq\) \|\| null\)/.test(renderer)
  && /\(lang === 'ko'\) \? record\.faq/.test(renderer));
t('en 은 tr 이 아니라 faq_en 칼럼을 본다',
  /lang === 'en'\) \? \(record\.faq_en \|\| null\)/.test(renderer));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ editorial-faq-i18n tests passed');
