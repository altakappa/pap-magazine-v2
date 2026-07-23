/**
 * 에디토리얼 내부링크 그래프 (2026-07-22 Ahrefs 감사: 고아 페이지 1,378).
 *
 * [배경] 상세 SSR 에 다른 에디토리얼로 가는 본문 링크가 0개였다. /archive 허브가
 * 발견(디스커버리)은 보장하지만, 순위에 기여하는 본문 내 링크·에쿼티 분배는 없었다.
 *
 * [수정 계약 — 이 테스트가 지키는 것]
 *  1. [slug].js 가 이전/다음(발행일 체인) + 태그 관련 4건을 조회해 record 에 탑재
 *  2. 렌더러가 More Editorials 섹션으로 <a href="/editorial/..."> 를 서버 렌더
 *  3. 이전/다음 체인 = 전 에디토리얼 연결 보장 (고아 방지 핵심)
 *  4. /editorial 봇 분기 · 허브(archive/listing)의 아티클 링크 slug 우선
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const handler = R('api/seo/editorial/[slug].js');
const renderer = R('api/_lib/seoRenderer.js');
const { renderSeoHtml } = require(path.join(__dirname, '..', 'api', '_lib', 'seoRenderer.js'));
const vercel = JSON.parse(R('vercel.json'));

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 에디토리얼 본문 내 내부링크 ===');
t('핸들러: 이전/다음 체인 조회 (published_date lt/gt + created_at 타이브레이크)',
  /published_date\.lt\./.test(handler) && /published_date\.gt\./.test(handler) && /created_at\.lt\./.test(handler));
t('핸들러: 태그 관련(overlaps) 조회 + 무태그 폴백', /\.overlaps\('tags'/.test(handler));
t('핸들러: more_editorials 를 record 에 탑재', /data\.more_editorials\s*=/.test(handler));
t('핸들러: best-effort (실패해도 렌더 진행)', /more_editorials[\s\S]{0,900}catch \(_\)/.test(handler) || /try \{[\s\S]{0,1500}more_editorials/.test(handler));
t('렌더러: More Editorials 섹션 존재', /More Editorials/.test(renderer));
// 2026-07-23 — 카드 링크가 kind별로 일반화됨(_moreBase: /editorial/ | /article/).
// 소스 문자열 대신 실제 에디토리얼 렌더 출력이 /editorial/ 링크를 내는지로 검증.
t('렌더러: 에디토리얼은 /editorial/ 링크로 카드 렌더',
  renderer.includes('${_moreBase}${escAttr(e.slug || e.id)}')
  && renderSeoHtml('editorial', { title:'ED', slug:'ed-x', status:'published', published_date:'2026-07-22', description:'짧', cover_image:'c.jpg',
       more_editorials:{ prev:{title:'P',slug:'p-x',thumbnail:'t.jpg'}, next:null, related:[] } }, {lang:'ko'}).includes('href="/editorial/p-x"'));
t('렌더러: 템플릿에 moreEditorialsHtml 삽입', /\$\{moreEditorialsHtml\}/.test(renderer));

console.log('\n=== 허브·라우팅 ===');
const rw = vercel.rewrites || [];
t('/editorial 봇 분기 → listing?kind=magazine',
  rw.some(r => r.source === '/editorial' && r.has && /kind=magazine/.test(r.destination || '')));
t('/editorial 봇 분기가 index.html rewrite 보다 앞',
  rw.findIndex(r => r.source==='/editorial' && r.has) < rw.findIndex(r => r.source==='/editorial' && !r.has));
t('archive.js 아티클 링크 slug 우선', /a\.slug \|\| a\.custom_url \|\| a\.id/.test(R('api/seo/archive.js')));
t('listing.js 아티클 링크 slug 우선', /a\.slug \|\| a\.custom_url \|\| a\.id/.test(R('api/seo/listing.js')));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ editorial-internal-links tests FAILED'); process.exit(1); }
console.log('✅ editorial-internal-links tests passed');
