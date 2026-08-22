/**
 * <title> 은 자르지 않는다 (2026-08-22 되돌림, 도메니코 결정)
 *
 * [무엇을 했었나] 08-21, 번역 제목을 60자(ja 40·zh 32·ru 58)에서 잘라 '…' 를
 *   붙였다. 근거는 8월 fr·it·es·de·ru 974쪽 실측 —
 *     상한 이내 903쪽 CTR 1.74% · 상한 초과 71쪽 CTR 1.17% (순위 9.4 vs 9.6)
 *   기대 클릭 112 대비 실제 75, 3.5σ. "길이가 CTR 을 죽인다"고 읽었다.
 *
 * [무엇이 틀렸나] 상관을 인과로 읽었다. 긴 제목 = 기계 번역이 부풀린 제목이라
 *   길이가 아니라 번역 품질이 원인일 수 있다. 그리고 실제 손해가 났다 —
 *     쿼리 `quando esce animal delle katseye` (it) · 우리 순위 **1.24위**
 *     제목 "KATSEYE annuncia una trasformazione audace con il singolo…"
 *     → 검색어의 핵심 단어 'ANIMAL' 이 잘려 나갔다. CTR 2.33% (258노출 6클릭).
 *   규모: 7,590편이 잘린 채 노출됐다 (fr 1,388·de 1,346·es 1,347·ru 1,302·
 *   it 1,284·ja 462·zh 461). 유럽어 5개는 절반 이상.
 *
 * [왜 되돌리나] 자르기의 목적은 Ahrefs "Title too long" 경고를 없애는 것이었다.
 *   그건 구글 순위 요인이 아니다 — 구글은 긴 제목을 **표시할 때만** 줄이고
 *   태그 전체를 관련성 신호로 읽는다. 태그에서 지우면 둘 다 잃는다.
 *
 * [이 테스트가 지키는 것] 자르기가 다시 들어오지 못하게 막는다.
 *   특히 "꼬리에 있는 키워드가 살아남는가" — 위 ANIMAL 사고의 회귀 고정.
 *   브랜드 접미사는 우리가 덧붙이는 군더더기라 상한을 넘기면 안 붙인다(유지).
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

console.log('\n=== 번역 제목을 자르지 않는다 ===');
for (const lang of ['de','it','fr','es','ru','ja','zh']) {
  const got = titleOf(lang, LONG_DE);
  t(`${lang}: 제목 전문이 남는다 (${got.length}자)`, got.includes(LONG_DE), got);
  t(`${lang}: 말줄임표를 붙이지 않는다`, !/…/.test(got), got);
}

console.log('\n=== 꼬리의 키워드가 살아남는다 (ANIMAL 사고 회귀 고정) ===');
{
  /* 실제 사고 재현: it 1.24위 페이지. 검색어는 'animal' 인데 그 단어가
     제목 맨 끝에 있어서, 60자 자르기가 정확히 그것만 지웠다. */
  const IT_REAL = "KATSEYE annuncia una trasformazione audace con il singolo 'ANIMAL'";
  const it = titleOf('it', IT_REAL);
  t('제목이 66자여도 ANIMAL 이 남는다', it.includes('ANIMAL'), it);
  t('60자 컷이 부활하지 않았다', it.length >= IT_REAL.length, `${it.length}자`);

  /* 상한 자체가 다시 제목 본문에 적용되지 못하게 — 소스 수준 고정 */
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'seoRenderer.js'), 'utf8');
  t('_fitTitle 이 되살아나지 않았다', !/_fitTitle/.test(src));
  t('seoTitle 이 titleMain 을 그대로 쓴다', /_brand\(titleMain, lang\)/.test(src));
}

console.log('\n=== 자르면 안 되는 것 ===');
{
  const ko = titleOf('ko', null);
  t('한국어 원제는 그대로 (사람이 쓴 헤드라인)', ko.includes('짧은 한국어 제목') && !/…/.test(ko), ko);
  const short = titleOf('de', 'Kurzer Titel');
  t('짧은 번역은 브랜드 접미사를 그대로 받는다', short.includes('| PAP Magazine'), short);
  const en = titleOf('en', null);
  t('en 은 번역표가 아니라 title_en 을 쓴다 (경로 불변)', en.includes('Short EN'), en);
}

console.log('\n=== 브랜드 접미사만 언어 상한을 지킨다 ===');
{
  /* 접미사는 제목이 아니라 우리가 덧붙이는 군더더기다. 넘치면 빼는 게 맞다.
     제목 본문은 위에서 확인했듯 절대 안 자른다. */
  for (const [lang, cap] of [['ja',40],['zh',32],['ru',58],['de',60]]) {
    const long = titleOf(lang, LONG_DE);
    t(`${lang}: 긴 제목에는 접미사를 안 붙인다`, !long.includes('| PAP Magazine'), long);
  }
  const shortJa = titleOf('ja', 'ミニ');
  t('ja: 짧으면 접미사를 붙이고 40자 이내', shortJa.includes('| PAP Magazine') && shortJa.length <= 40, shortJa);
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

/* ── LCP 히어로 preload (2026-08-22) ─────────────────────────────────
   Search Console 코어 웹 바이탈(2026-08-21): 모바일 13,207쪽 전부 'LCP 4초 초과',
   '좋음' 0. 히어로 img 에는 이미 eager·fetchpriority=high 가 있지만, 브라우저가
   그 태그를 만나기 전에 렌더 차단 자원 3개(구글폰트 CSS·pap-styles.css 108KB·
   pap-geo-lang.js)를 먼저 받는다. head 의 preload 가 그 대기를 없앤다. */
console.log('\n=== LCP: 히어로 이미지를 head 에서 미리 받는다 ===');
{
  const SB = 'https://igcazquhkwxtqsaqpznx.supabase.co/storage/v1/object/public/media/x.jpg';
  const rec = { ...base, cover_image: SB };
  const h = renderSeoHtml('article', rec, { lang: 'ko' });
  const pre = (h.match(/<link rel="preload" as="image"[^>]*>/) || [''])[0];
  const hero = (h.match(/<div class="seo-hero"><img [^>]*>/) || [''])[0];
  const cnt = (t) => (((t.match(/(?:image)?srcset="([^"]*)"/) || [])[1]) || '').split(',').filter(Boolean).length;
  t('히어로 preload 가 head 에 있다', !!pre, pre);
  t('preload 가 stylesheet 뒤 head 안에 있다', h.indexOf(pre) < h.indexOf('</head>') && !!pre);
  t('fetchpriority=high', /fetchpriority="high"/.test(pre));
  /* 후보가 다르면 브라우저가 다른 이미지를 받아 **두 번** 내려받는다 = 손해. */
  t('preload 와 img 의 후보 목록이 같다 (이중 다운로드 방지)',
    cnt(pre) === cnt(hero) && cnt(pre) > 0, `preload ${cnt(pre)} / img ${cnt(hero)}`);
  t('imagesrcset/imagesizes 로 쓴다 (link 태그 규격)',
    /imagesrcset=/.test(pre) && /imagesizes=/.test(pre));
}
{
  /* 영상 페이지는 iframe 이 히어로다 — 이미지 preload 를 걸면 안 받을 것을 받는다. */
  const vid = renderSeoHtml('short', { ...base, youtube_id: 'abcdefghijk' }, { lang: 'ko' });
  t('영상 페이지에는 이미지 preload 를 걸지 않는다',
    !/<link rel="preload" as="image"/.test(vid));
}
{
  const h = renderSeoHtml('article', base, { lang: 'ko' });
  t('쓰지 않는 Inter 300 을 폰트 요청에서 뺐다 (실사용 0회)',
    !/Inter:wght@300/.test(h) && /Inter:wght@400/.test(h));
}

/* ── pap-styles.css 를 렌더 차단에서 뺀다 (2026-08-22) ────────────────
   108KB 가 head 에서 렌더를 막고 있었다. 그런데 SSR 이 쓰는 클래스 44개 중
   38개가 인라인 <style> 에 이미 있고, 남은 6개는 pap-styles.css 에도 없다.
   body 바탕·글자색·폰트도 인라인의 body.seo-loading 이 준다.
   헤더는 pap-header.js 가 자체 <style> 을 주입한다. 의존이 없다. */
console.log('\n=== pap-styles.css 는 렌더를 막지 않는다 (SSR 전용) ===');
{
  const h = renderSeoHtml('article', base, { lang: 'ko' });
  const head = h.slice(0, h.indexOf('</head>'));
  const noNo = head.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  t('head 에 렌더 차단 stylesheet 가 없다',
    !/<link rel="stylesheet" href="\/pap-styles/.test(noNo));
  t('preload → onload 승격으로 받는다',
    /rel="preload"[^>]*pap-styles[^>]*as="style"[^>]*onload=/.test(head));
  t('JS 없는 환경용 noscript 폴백이 있다',
    /<noscript><link rel="stylesheet" href="\/pap-styles/.test(head));
  /* 인라인이 첫 페인트를 책임진다 — 이게 깨지면 배경 흰 화면이 번쩍인다. */
  t('body 바탕·글자색·폰트를 인라인이 준다',
    /body\.seo-loading\{background:#000;color:#fff;font-family:Inter/.test(h));
  t('그 클래스가 body 에 실제로 붙어 있다', /<body class="seo-loading/.test(h));
  t('히어로·제목 스타일도 인라인에 있다',
    /\.seo-hero img\{/.test(h) && /\.seo-meta h1\{/.test(h));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ seo-title-length tests FAILED'); process.exit(1); }
console.log('✅ seo-title-length tests passed');
