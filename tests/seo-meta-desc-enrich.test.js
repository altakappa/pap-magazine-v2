/**
 * meta description 보강 회귀 (Ahrefs 감사 2026-07-23: too short 3,261건).
 *
 * 온페이지 표시(descDisplay)는 그대로, <meta name="description"> 만 짧을 때
 * 실제 맥락(브랜드·태그) + 유니크 제목 서명으로 110자↑ 보강. AI·크론·DB
 * 쓰기 없이 렌더 시점 조립 → Vercel 부하 0. 실측: bare 레거시 2,349편이
 * 이 폴백으로 개선.
 */
'use strict';
const path = require('path');
const { renderSeoHtml } = require(path.join(__dirname, '..', 'api', '_lib', 'seoRenderer.js'));
function meta(html){ const m = html.match(/<meta name="description" content="([^"]*)"/); return m ? m[1] : ''; }
function ogd(html){ const m = html.match(/<meta property="og:description" content="([^"]*)"/); return m ? m[1] : ''; }

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

const bare = { title:'HIJA', slug:'hija', status:'published', published_date:'2026-01-01', description:'', cover_image:'x.jpg' };
const brands = { title:'ASIATOPIA', slug:'asiatopia', status:'published', published_date:'2026-07-22', description:'짧은 설명.', fashion:{brands:[{name:'MIAOYAN'},{name:'TUYUE'}]}, tags:['FASHION'], cover_image:'x.jpg' };
const longDesc = 'ASIATOPIA는 Asia와 Utopia의 합성어로, 아시아 문화의 무한한 본질과 미래에 대한 영향력을 반영한다. 아시아는 우리를 둘러싸고 있는데 그것은 부정적인 것이 아니라 새로운 의미와 가능성을 만들어내는 공간으로서의 몰입감을 형성한다.';
const long = { title:'ASIATOPIA', slug:'asiatopia', status:'published', published_date:'2026-07-22', description:longDesc, cover_image:'x.jpg' };

console.log('\n=== meta description 길이 (too short 해소) ===');
t('bare 레거시(제목만) ko ≥ 110자', meta(renderSeoHtml('editorial', bare, {lang:'ko'})).length >= 110);
t('bare 레거시 en ≥ 110자', meta(renderSeoHtml('editorial', bare, {lang:'en'})).length >= 110);
t('brands 케이스에 실제 브랜드명 포함(SEO 키워드)', /MIAOYAN/.test(meta(renderSeoHtml('editorial', brands, {lang:'ko'}))));
t('article kind 도 보강', renderSeoHtml('article', {title:'뉴스', slug:'n', status:'published', published_date:'2026-01-01', content:'짧음', cover_image:'x.jpg'}, {lang:'ko'}).includes('name="description"'));

console.log('--- 회귀 방지 ---');
t('bare 에 제목 중복 없음(HIJA…HIJA 금지)',
  (meta(renderSeoHtml('editorial', bare, {lang:'ko'})).match(/HIJA/g) || []).length === 1,
  '제목 에코 폴백을 안 비우면 제목이 두 번 나온다');
t('이미 긴 설명은 보강하지 않고 원문 유지',
  meta(renderSeoHtml('editorial', long, {lang:'ko'})).startsWith('ASIATOPIA는 Asia와 Utopia'));
t('og:description 도 같은 보강값 사용', ogd(renderSeoHtml('editorial', bare, {lang:'ko'})).length >= 110);

/* 2026-07-29 (GSC 실측) — 스니펫이 태그 나열로 시작하던 문제.
 * 설명이 비어 있으면 보강이 태그부터 붙어 SERP 스니펫이
 *   "waterbomb · waterbomb seoul 2026 · music festival. 제목 — PAP MAGAZINE 뉴스…"
 * 로 나왔다(라이브 실측). 정작 본문 첫 문장은 훨씬 낫다.
 * GSC 7월: 노출 27,646(4월 596 대비 46배)인데 클릭 826 으로 감소, CTR 12.6%→3.0%. */
console.log('--- 본문 첫 문장 우선 (스니펫 품질) ---');
const withBody = {
  slug: 'w', title: '워터밤 서울 2026 최종 라인업', status: 'published',
  content: '올여름 가장 뜨거운 음악 축제가 돌아온다. 워터밤 서울 2026이 7월 24일부터 26일까지 일산 킨텍스에서 개최되며, 최종 라인업을 공식 발표했다.<br><br>태민과 카리나 등이 출연한다.',
  tags: ['waterbomb', 'waterbomb seoul 2026', 'music festival'],
  cover_image: 'https://x/y.jpg', gallery: [], published_date: '2026-07-08', category: 'news',
};
const mBody = meta(renderSeoHtml('article', withBody, { lang: 'ko' }));
t('본문 첫 문장으로 시작', mBody.startsWith('올여름 가장 뜨거운'));
t('태그 나열로 시작하지 않는다', !/^waterbomb/.test(mBody));
t('<br> 를 공백으로 처리 (단어 붙음 방지)', !/했다\.태민/.test(mBody));
t('본문이 없으면 기존 폴백 유지 (회귀 방지)',
  meta(renderSeoHtml('article', Object.assign({}, withBody, { content: '' }), { lang: 'ko' })).length >= 100);
t('EN 페이지에 한국어 본문을 넣지 않는다',
  !/올여름/.test(meta(renderSeoHtml('article', withBody, { lang: 'en' }))),
  '언어 신호가 섞이면 EN 색인 품질이 떨어진다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ seo-meta-desc-enrich tests FAILED'); process.exit(1); }
console.log('✅ seo-meta-desc-enrich tests passed');
