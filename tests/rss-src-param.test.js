/**
 * 플립보드 버스 (2026-08-17) — /rss.xml?src=<처> 신디케이션 구분 측정 회귀.
 *
 * 핵심 성질 세 가지:
 *   1) src 미지정이면 출력이 기존과 완전히 동일해야 한다 (네이버·구글 제출분 보호)
 *   2) src 가 붙으면 <link> 에만 utm 이 붙고 <guid> 는 순수 링크 유지
 *      (guid 가 흔들리면 피드 소비자가 같은 글을 새 글로 오인)
 *   3) src 는 화이트리스트 형식만 통과 (쿼리 주입 봉쇄)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'rss.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

// 함수만 추출해 실행 (supabase require 없이)
const mSrc = src.match(/function srcParam\(req\)\{?[\s\S]*?\n\}/);
const mUtm = src.match(/function withRssUtm\(link, src\)\{?[\s\S]*?\n\}/);
t('srcParam·withRssUtm 이 존재한다', !!mSrc && !!mUtm);
const srcParam = new Function('req', mSrc[0] + '\nreturn srcParam(req);');
const withRssUtm = new Function('link', 'src', mUtm[0] + '\nreturn withRssUtm(link, src);');

console.log('\n=== srcParam 화이트리스트 ===');
t('flipboard 통과', srcParam({ query: { src: 'flipboard' } }) === 'flipboard');
t('대문자는 소문자로', srcParam({ query: { src: 'FlipBoard' } }) === 'flipboard');
t('미지정 → 빈 문자열 (기존 출력 보존)', srcParam({ query: {} }) === '');
t('주입 시도(&x=1) → 거부', srcParam({ query: { src: 'a&x=1' } }) === '');
t('공백·한글 → 거부', srcParam({ query: { src: '플립 보드' } }) === '');
t('1글자 → 거부(형식: 2~20자)', srcParam({ query: { src: 'a' } }) === '');

console.log('=== withRssUtm ===');
t('utm 이 링크에 붙는다',
  withRssUtm('https://x.com/editorial/a', 'flipboard') === 'https://x.com/editorial/a?utm_source=flipboard&utm_medium=rss');
t('이미 ?가 있으면 & 로', withRssUtm('https://x.com/a?b=1', 'flipboard').includes('?b=1&utm_source=flipboard'));
t('src 없으면 원본 그대로', withRssUtm('https://x.com/a', '') === 'https://x.com/a');

console.log('=== 배선 ===');
t('<link> 에는 utm 이 붙는다', /<link>' \+ xmlEscape\(withRssUtm\(it\.link, src\)\)/.test(src));
t('<guid> 는 순수 링크 유지', /<guid isPermaLink="true">' \+ xmlEscape\(it\.link\)/.test(src));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ rss-src-param tests FAILED'); process.exit(1); }
