// PAP Magazine — 언어판 관련 카드 제목 현지화 회귀 테스트 (2026-08-25)
//
// [왜] GSC "중복 페이지, Google 이 다른 표준 선택" 1,655건(전부 언어판) 진단:
// /it 기사·화보의 관련 카드 제목이 한국어 원제로 나가고 있었다. 언어판의
// 한국어 텍스트는 ko 정본과의 중복 신호다(수리 3편의 후속 — 4편).
//
// Run with `node tests/related-title-i18n.test.js` (wired into `npm test`).

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('\n=== 순수 헬퍼 실행 검증 (overlayRelatedTitles) ===');
{
  const { overlayRelatedTitles } = require(path.join(ROOT, 'api', '_lib', 'relatedI18n'));
  // en: title_en 있으면 교체, 없으면 ko 유지
  const en = [{ id: 1, title: '한국어 제목', title_en: 'English Title' }, { id: 2, title: '원제만', title_en: '' }, null];
  overlayRelatedTitles(en, 'en', null);
  ok('en: title_en 으로 교체', en[0].title === 'English Title');
  ok('en: title_en 없으면 ko 원제 유지 (빈 제목 금지)', en[1].title === '원제만');
  // 비-en: titleById 로 교체
  const it = [{ id: 'a', title: '한국어' }, { id: 'b', title: '번역 없음' }];
  overlayRelatedTitles(it, 'it', { a: 'Titolo Italiano', b: '  ' });
  ok('it: 번역 제목으로 교체', it[0].title === 'Titolo Italiano');
  ok('it: 공백 번역은 무시하고 ko 유지', it[1].title === '번역 없음');
  // ko / 비배열은 무변경·무예외
  const ko = [{ id: 1, title: 'ㄱ' }];
  overlayRelatedTitles(ko, 'ko', { 1: 'X' });
  ok('ko 는 아무것도 바꾸지 않는다', ko[0].title === 'ㄱ');
  let threw = false;
  try { overlayRelatedTitles(null, 'it', {}); } catch (_) { threw = true; }
  ok('null 입력에도 던지지 않는다', !threw);
}

console.log('\n=== 라우트 배선 (editorial · article) ===');
for (const f of ['api/seo/editorial/[slug].js', 'api/seo/article/[slug].js']) {
  const src = R(f);
  ok(`${f}: 헬퍼를 공용 lib 에서 가져온다`, /require\('\.\.\/\.\.\/_lib\/relatedI18n'\)/.test(src));
  ok(`${f}: en 분기에서 제목 오버레이`, /overlayRelatedTitles\(_items, 'en', null\)/.test(src));
  ok(`${f}: 번역 조회가 title 까지 받는다 (존재 확인 전용이 아님)`,
     /from\('seo_translations'\)\.select\('content_id, title'\)/.test(src));
  ok(`${f}: 비-en 분기에서 titleById 오버레이`, /overlayRelatedTitles\(_items, lang, _titleById\)/.test(src));
}
ok('editorial sel 에 title_en (en 오버레이 재료)',
   /'title, title_en, slug, id, published_date, thumbnail, cover_image, og_image'/.test(R('api/seo/editorial/[slug].js')));
ok('moreArticles sel 에 title_en',
   /'title, title_en, slug, id, published_date, thumbnail_url/.test(R('api/_lib/moreArticles.js')));
ok('moreArticles _norm 이 title_en 을 살린다',
   /title_en: a\.title_en \|\| ''/.test(R('api/_lib/moreArticles.js')));

console.log('\n=== SUMMARY ===');
console.log(`passed: ${passed}   failed: ${failed}`);
if (failed > 0) process.exit(1);
console.log('✓ related-title-i18n tests passed');
process.exit(0);
