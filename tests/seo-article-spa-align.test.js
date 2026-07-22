/**
 * 기사 SSR ↔ SPA 디자인 통일 회귀 테스트 (2026-07-22, 도메니코 지시)
 *
 * [배경] 링크 직접 진입(SSR) 기사가 "이미지가 크게 나오고 정렬이 뒤죽박죽"으로
 * 보인 실체는 CSS 손상이 아니라 SSR 템플릿(세리프 56px·풀블리드·1200px 갤러리)이
 * SPA 오버레이(artDetail: Montserrat 26px·800px 컨테이너·contained 히어로)와
 * 다른 디자인이었기 때문. 기준은 SPA(도메니코 확정) — articles.html #artDetail*
 * 실측값을 .seo-kind-article 스코프로 SSR 에 이식했다.
 *
 * 검증 방식: renderSeoHtml 을 '실제 실행'해 산출 HTML 을 검사한다.
 *  - article: SPA 수치 적용 + 제목 에코 줄 제거(표시만) + meta/JSON-LD 원본 보존
 *  - editorial: article 스코프 미적용(기존 디자인 영향 없음)
 */
'use strict';
const path = require('path');
const { renderSeoHtml } = require(path.join(__dirname, '..', 'api', '_lib', 'seoRenderer.js'));

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 기사 SSR ↔ SPA 디자인 통일 ===');

const rec = {
  slug: 'align-test', title: '정렬 테스트', title_en: 'Align Test',
  description: '정렬 테스트 — PAP Magazine\n\n첫 문단.', description_en: 'Align Test — PAP Magazine\n\nFirst.',
  created_at: '2026-07-22',
};
const a = renderSeoHtml('article', rec, { lang: 'ko' });
const e = renderSeoHtml('editorial', rec, { lang: 'ko' });

// ── 1) kind 스코프 ──
t('article body 에 seo-kind-article', /<body class="[^"]*seo-kind-article/.test(a));
t('editorial body 에 seo-kind-editorial (article 스코프 아님)', /<body class="[^"]*seo-kind-editorial/.test(e) && !/seo-kind-article/.test(e.match(/<body[^>]*>/)[0]));

// ── 2) SPA 실측값 이식 (articles.html #artDetail* 과 동치) ──
t('제목: Montserrat 26px/700 (SPA artDetailTitle)', /\.seo-kind-article \.seo-meta h1\{font-family:'Montserrat',sans-serif;font-size:26px;font-weight:700/.test(a));
t('제목 모바일 22px (SPA 미디어쿼리와 동일)', /\.seo-kind-article \.seo-meta h1\{font-size:22px\}/.test(a));
t('컨테이너 800px (SPA art-detail-container)', /\.seo-kind-article \.seo-meta\{max-width:800px/.test(a));
t('히어로 contained: max-height 75vh (풀블리드 아님)', /\.seo-kind-article \.seo-hero img\{[^}]*max-height:75vh/.test(a));
t('갤러리 800px + gap 4px (거대 1200px/32px 아님)', /\.seo-kind-article \.seo-gallery\{max-width:800px[^}]*gap:4px/.test(a));
t('본문 16px/1.9 (SPA artDetailDesc)', /\.seo-kind-article \.seo-meta \.seo-desc-primary\{font-size:16px;line-height:1.9/.test(a));
t('Montserrat 폰트 로드', /family=Montserrat/.test(a));

// ── 3) 제목 에코 줄 — 표시에서만 제거, SEO 원본 보존 ──
const descP = (a.match(/<p class="seo-desc-primary">([\s\S]*?)<\/p>/) || ['',''])[1];
t('desc-primary 에서 "제목 — PAP Magazine" 에코 제거', descP.indexOf('— PAP Magazine') === -1);
t('desc-primary 본문은 유지', descP.indexOf('첫 문단.') > -1);
t('meta description 은 원본 유지 (SEO 불변)', /name="description" content="정렬 테스트 — PAP Magazine/.test(a));

// ── 4) editorial 회귀 없음 — 공용 규칙(Playfair 등) 그대로 ──
t('공용 h1 Playfair 규칙 유지 (editorial 용)', /\.seo-meta h1\{font-family:'Playfair Display',serif/.test(e));
t('editorial 에 article 오버라이드가 적용될 스코프 없음', !/<body class="[^"]*seo-kind-article/.test(e));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ seo-article-spa-align tests FAILED'); process.exit(1); }
console.log('✅ seo-article-spa-align tests passed');
