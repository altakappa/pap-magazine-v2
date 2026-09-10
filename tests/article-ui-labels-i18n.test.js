/**
 * 기사 화면의 영어·한글 잔존 (도메니코 2026-09-10, 일본어 스크린샷):
 *   FAQ 가 한국어, ON INSTAGRAM 퍼널 카피·VIEW ON INSTAGRAM·FOLLOW·SHARE 가 영어,
 *   MORE ARTICLES 헤딩·PREVIOUS/RELATED 라벨이 영어, 관련 카드 제목이 한국어.
 * 원인: SPA(pap-content-article.js)가 ko/en 2분기였고, 라벨은 영어 고정, 상세 API 는 언어별
 * FAQ·관련 제목을 실어 보내지 않았다. SSR 도 라벨이 영어 고정이었다.
 * 규칙: 한국어 모드는 종전대로 영어 디자인 라벨. 다른 8개 언어는 번역.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { passed++; console.log('  ✓ ' + l); } else { failed++; console.log('  ✗ ' + l + (d ? ' — ' + d : '')); } }
const LANGS8 = ['en', 'ja', 'zh', 'de', 'fr', 'it', 'es', 'ru'];

console.log('\n=== SPA: pap-content-article.js ===');
const spa = fs.readFileSync(path.join(ROOT, 'frontend', 'pap-content-article.js'), 'utf8');
ok('IG 퍼널이 ko/en 2분기가 아니라 _papUiL 로 나간다', !/var _ko=\(localStorage\.getItem\('pap-lang'\)\|\|'ko'\)==='ko';/.test(spa) && /_papUiL\('PAP의 화보와 필름/.test(spa));
ok('퍼널 kicker·Follow·Share·View 가 전부 _papUiL', ["_papUiL('On Instagram'", "_papUiL('Follow @pap_magazine'", "_papUiL('이 기사 공유'", "_papUiL('인스타그램에서 보기 ↗'"].every((s) => spa.includes(s)));
ok('FAQ 가 언어별(faqI18n[L] → en → ko)', /var src=\(fi\[L\]\) \|\| \(L!=='ko' && fi\.en\) \|\| a\.faq;/.test(spa) && /_papUiL\('자주 묻는 질문','FAQ'\)/.test(spa));
ok('MORE ARTICLES 헤딩·라벨이 _papUiL', ["_papUiL('More Articles'", "_papUiL('Previous'", "_papUiL('Related'", "_papUiL('Next'"].every((s) => spa.includes(s)));
ok('관련 카드 제목이 언어별(title_i18n[L] → en → ko)', /ti\[L\] \|\| ti\.en \|\| e\.title_en \|\| e\.title/.test(spa));
ok('상세 GET 의 faq_i18n 을 병합한다', /a\.faqI18n = fullA\.faq_i18n/.test(spa));
const ed = fs.readFileSync(path.join(ROOT, 'frontend', 'pap-content-editorial.js'), 'utf8');
ok('에디토리얼 중간 CTA 도 _papUIL', /window\._papUIL\('인스타그램에서 보기 ↗','View on Instagram ↗'\)/.test(ed));

console.log('\n=== API: /api/articles/[id] ===');
const api = fs.readFileSync(path.join(ROOT, 'api', 'articles', '[id].js'), 'utf8');
ok('seo_translations 에서 faq 도 읽는다', /select\('lang, title, body, faq'\)/.test(api));
ok('faq_i18n(ko=faq, en=faq_en, 그 외=번역) 을 내려준다', /data\.faq_i18n = _fi;/.test(api) && /_fi\.en = _pf\(data\.faq_en\)/.test(api));
ok('관련 카드에 title_i18n 을 붙인다 (한 번의 조회)', /e\.title_i18n = t;/.test(api) && /select\('content_id, lang, title'\)/.test(api));

console.log('\n=== 런타임 사전(_shared) — 영어 디자인 라벨 키 8개 언어 ===');
for (const k of ['More Articles', 'Previous', 'Related', 'Next', 'On Instagram', 'Follow @pap_magazine']) {
  ok('"' + k + '" 8개 언어', LANGS8.every((l) => {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend', 'i18n', 'ui', '_shared.' + l + '.json'), 'utf8'));
    return typeof d[k] === 'string' && d[k].length > 0;
  }));
}
const rt = fs.readFileSync(path.join(ROOT, 'frontend', 'pap-ui-i18n.js'), 'utf8');
ok('_papUIL 이 영어 키를 정확 일치로 찾는다 (DOM 스캔은 한글 게이트 유지)', /\(d\.map && d\.map\[norm\(ko\)\]\) \|\| translate\(d, ko\)/.test(rt));

console.log('\n=== 정적 Follow 버튼 (index·articles) ===');
const t9 = fs.readFileSync(path.join(ROOT, 'frontend', 'pap-i18n.js'), 'utf8');
ok('pap-i18n.js igFollowPap 9개 언어', (t9.match(/igFollowPap:'/g) || []).length === 9);
for (const f of ['index.html', 'articles.html']) {
  const h = fs.readFileSync(path.join(ROOT, 'frontend', f), 'utf8');
  ok(f + ' Follow 버튼에 data-i18n="igFollowPap"', /data-i18n="igFollowPap">Follow @pap_magazine<\/a>/.test(h) && !/rel="noopener">Follow @pap_magazine<\/a>/.test(h));
}

console.log('\n=== SSR: seoRenderer 라벨 9개 언어 ===');
const { renderSeoHtml } = require(path.join(ROOT, 'api', '_lib', 'seoRenderer'));
const base = { id: 'a1', title: '제목', slug: 's', status: 'published', published_date: '2026-09-01', content: '본문'.repeat(40), cover_image: 'x.jpg', source_instagram_url: 'https://www.instagram.com/p/abc/',
  more_articles: { prev: { title: '이전', slug: 'p', id: 'p1' }, related: [{ title: '관련', slug: 'r', id: 'r1' }], next: null } };
const ja = renderSeoHtml('article', base, { lang: 'ja', translation: { title: 'タイトル', description: 'd', body: '本文' } });
ok('ja: More Articles → その他の記事', ja.includes('その他の記事') && !/<h2>More Articles<\/h2>/.test(ja));
ok('ja: PREVIOUS/RELATED → 前の記事/関連', ja.includes('前の記事') && ja.includes('>関連<'));
ok('ja: On Instagram → Instagramで, Follow → をフォロー', ja.includes('Instagramで') && ja.includes('@pap_magazine をフォロー') && !/>Follow @pap_magazine</.test(ja));
const ko = renderSeoHtml('article', base, { lang: 'ko' });
ok('ko: 종전대로 영어 디자인 라벨 (More Articles·Previous·On Instagram)', /<h2>More Articles<\/h2>/.test(ko) && ko.includes('>Previous<') && ko.includes('>On Instagram<'));
for (const l of ['zh', 'de', 'fr', 'it', 'es', 'ru']) {
  const h = renderSeoHtml('article', base, { lang: l, translation: { title: 't', description: 'd', body: 'b' } });
  ok(l + ': 영어 고정 라벨 없음', !/<h2>More Articles<\/h2>/.test(h) && !/>Follow @pap_magazine</.test(h) && !/>On Instagram</.test(h));
}

console.log('\npassed: ' + passed + '   failed: ' + failed);
if (failed) { console.log('❌ article-ui-labels-i18n FAILED'); process.exit(1); }
console.log('✅ article-ui-labels-i18n passed');
