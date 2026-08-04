/**
 * 사이트맵 언어 커버리지 (2026-08-04).
 *
 * [원인] Supabase(PostgREST)는 한 응답에 최대 5,000행만 돌려주고 그 이상은
 * 조용히 자른다 — 에러가 없다. sitemap-editorials.js / sitemap-articles.js 가
 * seo_translations 를 `.limit(20000)` 한 번으로 읽고 있었기 때문에,
 * 라이브 측정 결과 언어별 URL 이 2,29x편 중 67x편만 광고됐다
 * (에디토리얼 기준 약 11,200개 번역 페이지가 검색엔진에 아예 알려지지 않음).
 *
 * [수정] ① fetchAllRows() 로 전량 페이지네이션
 *        ② 한 파일에 다 담으면 ~40MB 라서 ?lang= 으로 언어별 분할
 *        ③ sitemap-index.xml·robots.txt·vercel.json 에 전부 등록
 *
 * 이 테스트는 위 3가지의 재발(=.limit() 단발 조회로 되돌림, 분할 해제,
 * 등록 누락)을 감시한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

const LANGS = ['en','it','fr','es','ja','de','zh','ru'];

console.log('\n=== 5,000행 상한 재발 방지 ===');
{
  const lib = R('api/_lib/fetchAllRows.js');
  t('fetchAllRows 존재 + export', /module\.exports = \{ fetchAllRows \}/.test(lib));
  t('fetchAllRows 가 .range() 로 페이지네이션', /\.range\(from, to\)/.test(lib));
  t('페이지 크기가 5,000 이하로 강제', /Math\.min\([^)]*5000\)/.test(lib));
}
// 주석에 남긴 "옛 버그 설명"까지 잡히면 안 되므로 주석을 제거한 코드만 본다.
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

for (const f of ['api/sitemap-editorials.js','api/sitemap-articles.js']) {
  const s = R(f);
  const code = stripComments(s);
  t(`${f}: fetchAllRows 를 사용`, /require\('\.\/_lib\/fetchAllRows'\)/.test(code));
  t(`${f}: seo_translations 를 fetchAllRows 로 조회`,
    /fetchAllRows\(\(\) => supabaseAdmin\s*\n?\s*\.from\('seo_translations'\)/.test(code.replace(/\r/g,'')));
  t(`${f}: .limit(20000) 단발 조회가 없다`, !/\.limit\(20000\)/.test(code));
  t(`${f}: .limit(5000) 단발 조회가 없다`, !/\.limit\(5000\)/.test(code));
  t(`${f}: 페이지 경계 안정용 id 정렬`, /\.order\('id', \{ ascending: true \}\)/.test(code));
}

console.log('\n=== 언어별 분할 ===');
for (const f of ['api/sitemap-editorials.js','api/sitemap-articles.js']) {
  const s = R(f);
  t(`${f}: ?lang= 파라미터를 읽는다`, /req\.query && req\.query\.lang/.test(s));
  t(`${f}: 기본값이 ko(정본)`, /VALID_LANGS\.includes\(q\) \? q : 'ko'/.test(s));
  t(`${f}: 9개 언어 정의`, /VALID_LANGS = \['ko', 'en', 'it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'\]/.test(s));
  t(`${f}: 해당 언어 번역이 없으면 건너뛴다`, /if \(!langs\.includes\(only\)\) return '';/.test(s));
  t(`${f}: url 하나당 loc 하나(언어 중복 방출 없음)`, !/langs\.filter\(l => l !== 'ko'\)\.map/.test(s));
  t(`${f}: 이미지는 ko 사이트맵에서만`, /only === 'ko'/.test(s));
}

console.log('\n=== 크롤러 등록 ===');
{
  const idx = R('api/sitemap-index.js');
  t('sitemap-index: 언어 목록 정의', /LANG_SITEMAPS = \['en', 'it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'\]/.test(idx));
  t('sitemap-index: 에디토리얼 언어 사이트맵 등록', /sitemap-editorials-' \+ l \+ '\.xml/.test(idx));
  t('sitemap-index: 기사 언어 사이트맵 등록', /sitemap-articles-' \+ l \+ '\.xml/.test(idx));

  const vj = JSON.parse(R('vercel.json'));
  const srcs = (vj.rewrites || []).map(r => r.source);
  const dests = (vj.rewrites || []).map(r => r.destination);
  t('vercel.json: 에디토리얼 언어 rewrite',
    srcs.includes('/sitemap-editorials-:lang(en|it|fr|es|ja|de|zh|ru).xml'), srcs.filter(x=>/editorials/.test(x)).join(', '));
  t('vercel.json: 기사 언어 rewrite',
    srcs.includes('/sitemap-articles-:lang(en|it|fr|es|ja|de|zh|ru).xml'), srcs.filter(x=>/articles/.test(x)).join(', '));
  t('vercel.json: lang 을 그대로 전달', dests.includes('/api/sitemap-editorials?lang=:lang') && dests.includes('/api/sitemap-articles?lang=:lang'));

  const rb = R('frontend/robots.txt');
  for (const l of LANGS) {
    t(`robots.txt: sitemap-editorials-${l}.xml 선언`, rb.includes('Sitemap: https://www.pap-magazine.com/sitemap-editorials-' + l + '.xml'));
    t(`robots.txt: sitemap-articles-${l}.xml 선언`, rb.includes('Sitemap: https://www.pap-magazine.com/sitemap-articles-' + l + '.xml'));
  }
}

console.log('\n=== llms.txt 사실 정합성 ===');
{
  const s = R('frontend/llms.txt');
  t('llms.txt: 9개 언어 명시', /9 languages/.test(s));
  t('llms.txt: 언어 URL 패턴 명시', /\/<lang>\/editorial\/<slug>/.test(s));
  t('llms.txt: 언어별 사이트맵 안내', /sitemap-editorials-<lang>\.xml/.test(s));
  t('llms.txt: 낡은 "bilingual" 표기 제거', !/bilingual/.test(s));
  t('llms.txt: 낡은 팔로워 수(373K) 제거', !/373K/.test(s));
  t('llms.txt: 낡은 에디토리얼 수(2,100+) 제거', !/2,100\+/.test(s));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ sitemap-lang-coverage tests FAILED'); process.exit(1); }
console.log('✅ sitemap-lang-coverage tests passed');
