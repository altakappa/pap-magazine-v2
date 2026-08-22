/**
 * <title> 길이 — 번역 제목만 줄인다 (2026-08-22)
 *
 * [측정] 8월 fr·it·es·de·ru 페이지 974개. **순위가 같은데 CTR 이 다르다.**
 *     상한 이내  903쪽 · 노출 122,221 · 클릭 2,128 · CTR 1.74% · 순위 9.4
 *     상한 초과   71쪽 · 노출   6,416 · 클릭    75 · CTR 1.17% · 순위 9.6
 *   기대 클릭 112 대비 실제 75 — 3.5σ. 우연이 아니다.
 *
 * [원인] 08-20 에 번역 생성기에 길이 상한을 넣었지만 그 전 번역이 남아 있다.
 *   상한 초과 1,590건 (fr 340·es 304·ru 299·de 279·it 259·zh 78·ja 31),
 *   최장 133자. 재번역은 Claude 호출 1,590회 — 렌더 시점에 자르면 비용 0 이다.
 *
 * [경계] 한국어 원제는 자르지 않는다. 사람이 쓴 헤드라인이고 실측 60자 초과 0건이다.
 */
'use strict';
const path = require('path');
const { renderSeoHtml } = require(path.join(__dirname, '..', 'api', '_lib', 'seoRenderer.js'));

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

const LONG_DE = 'Mithridate präsentiert die Frühjahr/Sommer 2025 Kollektion – eine Neuinterpretation der Kultur ethnischer Minderheiten aus Yunnan';
const base = { title:'짧은 한국어 제목', title_en:'Short EN', slug:'x', status:'published',
  published_date:'2026-08-01', description:'d', cover_image:'c.jpg' };
const titleOf = (lang, tr, rec) => {
  const h = renderSeoHtml('article', rec || base, { lang, translation: tr ? { title: tr, description:'d' } : null });
  const m = h.match(/<title>([^<]*)<\/title>/);
  return m ? m[1] : '';
};

console.log('\n=== 번역 제목이 상한 안으로 들어온다 ===');
for (const [lang, cap] of [['de',60],['it',60],['fr',60],['es',60],['ru',58],['ja',40],['zh',32]]) {
  const got = titleOf(lang, LONG_DE);
  t(`${lang}: ${cap}자 이하 (실제 ${got.length}자)`, got.length <= cap, got);
}

console.log('\n=== 자르는 방식 ===');
{
  const de = titleOf('de', LONG_DE);
  t('말줄임표로 끝난다 (잘렸음을 사람이 안다)', /…$/.test(de), de);
  t('첫 고유명사가 남는다 (앞에서 자르지 않는다)', de.startsWith('Mithridate'), de);
  t('단어 중간에서 끊지 않는다', !/\S…$/.test(de) || de.split(' ').length >= 3, de);
  t('구두점이 말줄임표 앞에 남지 않는다', !/[\s,;:·–—-]…$/.test(de), de);
}

console.log('\n=== 자르면 안 되는 것 ===');
{
  const ko = titleOf('ko', null);
  t('한국어 원제는 그대로 (사람이 쓴 헤드라인)', ko.includes('짧은 한국어 제목') && !/…/.test(ko), ko);
  const short = titleOf('de', 'Kurzer Titel');
  t('짧은 번역은 브랜드 접미사를 그대로 받는다', short.includes('| PAP Magazine'), short);
  t('짧은 번역에 말줄임표를 붙이지 않는다', !/…/.test(short), short);
  const en = titleOf('en', null);
  t('en 은 번역표가 아니라 title_en 을 쓴다 (경로 불변)', en.includes('Short EN'), en);
}

console.log('\n=== 브랜드 접미사도 언어 상한을 지킨다 ===');
{
  /* 08-22 실측 버그: ja 로 27자까지 자른 뒤 접미사(14자)를 붙여 42자가 됐다.
     60 기준만 보던 _brand 가 원인. 언어별 상한을 넘기면 접미사를 안 붙인다. */
  const ja = titleOf('ja', LONG_DE);
  t('ja: 접미사 포함 40자 이하', ja.length <= 40, ja);
  const zh = titleOf('zh', LONG_DE);
  t('zh: 접미사 포함 32자 이하', zh.length <= 32, zh);
}

/* ── Organization 노드 속성 타입 (2026-08-22) ────────────────────────
   Ahrefs 가 'schema.org validation error' 를 10,001페이지 **전부**에 띄웠다.
   전 페이지에 실리는 노드는 Organization 하나뿐이라는 게 힌트였다.
   inLanguage·publisher 는 둘 다 CreativeWork 속성이고 Organization 에는 없다.
   → knowsLanguage · parentOrganization 으로 바꿨다. */
console.log('\n=== Organization 노드는 자기 타입의 속성만 쓴다 ===');
{
  const h = renderSeoHtml('article', base, { lang: 'ko' });
  const blocks = [...h.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch (_) { return null; } }).filter(Boolean);
  const org = blocks.map((x) => x.publisher).find(Boolean);
  t('Organization 노드를 찾았다', !!org);
  t('inLanguage 를 쓰지 않는다 (CreativeWork 속성)', !org || org.inLanguage === undefined);
  t('publisher 를 쓰지 않는다 (CreativeWork 속성)', !org || org.publisher === undefined);
  t('knowsLanguage 로 9개 언어를 선언한다',
    !!org && Array.isArray(org.knowsLanguage) && org.knowsLanguage.length === 9);
  t('법인은 parentOrganization 으로 건다',
    !!org && org.parentOrganization && /ALTAKAPPA/.test(org.parentOrganization.name));
  t('JSON-LD 가 전부 파싱된다', blocks.length >= 2);
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ seo-title-length tests FAILED'); process.exit(1); }
console.log('✅ seo-title-length tests passed');
