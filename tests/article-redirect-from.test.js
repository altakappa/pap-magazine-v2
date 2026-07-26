/**
 * 레거시 슬러그 정리 시 옛 URL 보존 301 (lever ②, 2026-07-26).
 * articles.redirect_from(text[])에 옛 슬러그를 담으면 SSR 리졸버가 해석하고
 * 정규 슬러그로 301 → 264개 레거시 슬러그(categoryfashion…)를 안전하게 정리.
 * 컬럼 미생성 환경에서도 죽지 않아야 한다(try/catch).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const route = fs.readFileSync(path.join(__dirname, '..', 'api', 'seo', 'article', '[slug].js'), 'utf8');

let pass=0, fail=0;
function t(n,c,d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== redirect_from 리졸버 ===');
t('route: redirect_from 조회 단계 존재', /\.contains\('redirect_from'/.test(route));
t('route: decoded 변형도 시도', /contains\('redirect_from', \[decoded\]\)/.test(route));
t('route: 컬럼 미생성 안전(try/catch)', /try \{[\s\S]*redirect_from[\s\S]*\} catch/.test(route));
t('route: status published 필터', /contains\('redirect_from'[\s\S]{0,90}'published'\)/.test(route));
t('route: 기존 정규-슬러그 301 유지', /res\.status\(301\)\.end\(\)/.test(route) && /canonicalSlug !== decoded/.test(route));
t('route: 해석 실패 시 404 유지', /renderNotFoundHtml\('article', slug\)/.test(route));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ article-redirect-from tests FAILED'); process.exit(1); }
console.log('✅ article-redirect-from tests passed');
