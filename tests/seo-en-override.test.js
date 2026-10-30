/**
 * 영어판 검색 스니펫 오버라이드 — seo_title_en / seo_description_en (2026-10-30, 마이그레이션 180)
 *
 * GSC 9/27~10/24: /en 기사 페이지 노출 1위, CTR 0.1~1.5% (ja 10~18%).
 * 영어판은 <title> 이 H1(title_en) 그대로라 검색 문구를 따로 둘 수 없었다.
 * 규칙: 오버라이드는 title/og/twitter/meta description/JSON-LD 에만. H1·리드·본문은 불변.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { renderSeoHtml } = require(path.join(__dirname, '..', 'api', '_lib', 'seoRenderer.js'));
const { ARTICLE_COLUMNS } = require(path.join(__dirname, '..', 'api', '_lib', 'articleCols.js'));

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',String(d).slice(0,300));} }
const pick = (html, re) => { const m = re.exec(html); return m ? m[1] : null; };

const base = {
  id: '00000000-0000-0000-0000-000000000001', slug: 'lisa-press-play-sawadika-merchandise-release', status: 'published',
  published_date: '2026-10-20', category: 'News', tags: ['lisa', 'sawadika'],
  title: '리사, 사와디카로 새 장을 연다', title_en: "LISA Opens a New Chapter with 'SaWaDiKa'",
  content: '<p>리사가 9월 3일 새 싱글을 낸다.</p>',
  content_en: "<p>LISA is releasing her new single 'SaWaDiKa' on September 3, followed by her six-track EP on October 23. The title comes from 'Sawasdee ka', a Thai greeting used by women.</p>",
  cover_image: 'https://example.com/x.jpg',
};
const OV_T = "What 'SaWaDiKa' Means: LISA's Single and Press Play Merch";
const OV_D = "'SaWaDiKa' comes from 'Sawasdee ka', the Thai greeting used by women. LISA's single is out Sept 3, the EP Oct 23, with HELLO SAWADIKA tees, a zip hoodie and a red marble vinyl.";

console.log('\n=== 오버라이드 없음 (기존 동작) ===');
const en0 = renderSeoHtml('article', base, { lang: 'en' });
t('<title> 이 title_en 기반', (pick(en0, /<title>([^<]*)<\/title>/) || '').startsWith(base.title_en));
t('meta description 이 content_en 첫 문장 기반', /LISA is releasing her new single/.test(pick(en0, /<meta name="description" content="([^"]*)"/) || ''));

console.log('=== 오버라이드 있음 ===');
const rec = { ...base, seo_title_en: OV_T, seo_description_en: OV_D };
const en1 = renderSeoHtml('article', rec, { lang: 'en' });
const title1 = pick(en1, /<title>([^<]*)<\/title>/) || '';
t('<title> 이 오버라이드로 바뀐다', title1.includes('What &#39;SaWaDiKa&#39; Means') || title1.includes("What 'SaWaDiKa' Means"), title1);
t('og:title 도 바뀐다', /property="og:title" content="What/.test(en1));
t('twitter:title 도 바뀐다', /name="twitter:title" content="What/.test(en1));
t('meta description 이 오버라이드', /comes from &#39;Sawasdee ka&#39;|comes from 'Sawasdee ka'/.test(pick(en1, /<meta name="description" content="([^"]*)"/) || ''), pick(en1, /<meta name="description" content="([^"]*)"/));
t('JSON-LD headline 이 오버라이드와 같은 말을 한다', /"headline":"What 'SaWaDiKa' Means|"headline":"What \\u0027SaWaDiKa|"headline":"What &#39;SaWaDiKa/.test(en1.replace(/\s+/g, '')) || /headline[^\n]{0,20}What/.test(en1), (en1.match(/"headline":[^,]{0,120}/) || [''])[0]);
t('H1 은 그대로 title_en (헤드라인 불변)', new RegExp('<h1[^>]*>[\\s\\S]{0,40}' + 'LISA Opens a New Chapter').test(en1), (en1.match(/<h1[^>]*>[\s\S]{0,120}/) || [''])[0]);
t('H1 에 오버라이드 문구가 들어가지 않는다', !/<h1[^>]*>[\s\S]{0,200}What 'SaWaDiKa' Means/.test(en1) && !/<h1[^>]*>[\s\S]{0,200}What &#39;SaWaDiKa/.test(en1));
t('본문(content_en)은 그대로 나간다', /LISA is releasing her new single/.test(en1));

console.log('=== 다른 언어엔 영향 없음 ===');
const ko1 = renderSeoHtml('article', rec, { lang: 'ko' });
t('ko 페이지 <title> 은 영어 오버라이드를 쓰지 않는다', !(pick(ko1, /<title>([^<]*)<\/title>/) || '').includes('SaWaDiKa Means'));
const es1 = renderSeoHtml('article', rec, { lang: 'es', translation: { title: 'Qué significa SaWaDiKa', description: 'Desc es', body: '<p>cuerpo</p>' } });
t('es 페이지는 seo_translations 경로 그대로', (pick(es1, /<title>([^<]*)<\/title>/) || '').startsWith('Qué significa SaWaDiKa'));

console.log('=== 빈 값·공백은 없는 것으로 ===');
const en2 = renderSeoHtml('article', { ...base, seo_title_en: '   ', seo_description_en: '' }, { lang: 'en' });
t('공백만 있으면 기존 동작', (pick(en2, /<title>([^<]*)<\/title>/) || '').startsWith(base.title_en));

console.log('=== 배선 ===');
t('ARTICLE_SELECT 에 두 열이 들어 있다 (없으면 렌더러에 undefined 로 온다)', ARTICLE_COLUMNS.includes('seo_title_en') && ARTICLE_COLUMNS.includes('seo_description_en'));
const mig = fs.readFileSync(path.join(__dirname, '..', 'supabase_migrations', '180_articles_seo_en_override.sql'), 'utf8');
t('마이그레이션 180 이 두 열을 추가한다', /seo_title_en\s+TEXT/.test(mig) && /seo_description_en\s+TEXT/.test(mig) && /IF NOT EXISTS/.test(mig));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ seo-en-override tests FAILED'); process.exit(1); }
console.log('✅ seo-en-override tests passed');
