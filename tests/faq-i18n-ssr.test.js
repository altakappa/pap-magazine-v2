/**
 * GEO — FAQ 다국어 SSR (2026-08-17 신설)
 *
 * [왜] Ahrefs 실측: AI Overview 가 뜨는 검색어 중 PAP 이 상위 20위 안인
 * 키워드 30+개 — 그중 다수가 ja/fr/en 페이지다 (워터밤 ja 5위, sukeban fr 1위).
 * 그런데 FAQ 블록(FAQPage 스키마 + 화면 답변형 블록)은 ko 전용이었다.
 * 정작 AIO 에 인용될 페이지에 '질문에 답하는 형태'가 없던 것.
 *
 * [무엇을 지키나] ① 렌더러가 번역 FAQ(tr.faq)를 비-ko 언어에서 렌더한다
 * ② ko 는 종전대로 record.faq ③ FAQ 제목이 9개 언어로 로컬라이즈된다
 * ④ 기사 핸들러가 seo_translations 에서 faq 컬럼을 가져와 전달한다
 * ⑤ 원문 FAQ 를 다른 언어에 섞는 폴백은 금지 (언어 신호 혼선 방지)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const seo = R('api/_lib/seoRenderer.js');
const handler = R('api/seo/article/[slug].js');

console.log('\n[1] 렌더러 — 번역 FAQ 다국어 렌더');
{
  t('ko 전용 하드블록이 사라졌다', !/if \(lang !== 'ko'\) return \[\];\s*\n\s*let f = record\.faq/.test(seo));
  t('비-ko 는 번역 FAQ(tr.faq)를 쓴다', /\(lang === 'ko'\) \? record\.faq : \(\(tr && tr\.faq\) \|\| null\)/.test(seo));
  t('번역이 없으면 렌더하지 않는다 — ko 원문 폴백 금지',
    !/tr\.faq\) \|\| record\.faq/.test(seo) && !/tr\.faq \|\| record\.faq/.test(seo));
  t('q/a 형태 검증은 그대로 살아 있다', /typeof x\.q === 'string' && typeof x\.a === 'string'/.test(seo));
}

console.log('\n[2] FAQ 제목 로컬라이즈');
{
  t('FAQ_HEADING 맵이 있다', /const FAQ_HEADING = \{/.test(seo));
  const langs = ['ko', 'en', 'ja', 'fr', 'es', 'it', 'de', 'zh', 'ru'];
  t('9개 언어 전부 정의', langs.every(l => new RegExp(l + ":\\s*'").test(seo.slice(seo.indexOf('const FAQ_HEADING'), seo.indexOf('const FAQ_HEADING') + 400))));
  t('화면 블록이 로컬라이즈 제목을 쓴다 (하드코딩 아님)', /FAQ_HEADING\[lang\] \|\| 'FAQ'/.test(seo));
  t('ja 제목이 일본어다', /ja: 'よくある質問'/.test(seo));
}

console.log('\n[3] 기사 핸들러 — faq 전달');
{
  t('seo_translations select 에 faq 포함', /select\('lang, title, description, body, faq'\)/.test(handler));
  t('translation 객체에 faq 전달', /faq: t\.faq/.test(handler));
}

console.log('\n=== SUMMARY ===');
console.log('passed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ faq-i18n-ssr tests passed');
