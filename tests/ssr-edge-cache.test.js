/**
 * 기사·화보·필름·쇼츠 SSR 의 엣지 캐시 신선도 (2026-09-14 전송량 초과 후속).
 *
 * [왜 올렸나] 같은 URL 을 반복해 긁는 함대가 5분(s-maxage=300)마다 DB 를 한 번씩
 * 깨우고 있었다. 기사는 발행 뒤 거의 안 바뀌므로 1시간이면 충분하다.
 * 5분 → 1시간이면 반복 요청이 만드는 원본 조회가 12분의 1 이 된다.
 *
 * [수정이 급하면] 재배포하면 즉시 반영된다. Vercel 엣지 캐시는 배포마다 새로 시작한다.
 * 이게 안전핀이라 신선도를 1시간까지 올릴 수 있었다.
 *
 * [지키는 것]
 *  1) 네 경로 전부 s-maxage=3600 (한 곳만 올리면 사람은 못 알아챈다)
 *  2) stale-while-revalidate 는 유지 — 만료 직후 독자가 기다리지 않게
 *  3) max-age=0 유지 — 브라우저에는 캐시 안 시킨다 (관리자가 새로고침하면 최신)
 *  4) vercel.json 의 라우트 헤더도 같은 값 (두 벌이면 한쪽만 고쳐진다)
 *  5) 404/410/301 분기의 값은 건드리지 않았다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

const SSR = [
  ['api/seo/article/[slug].js', '/article/(.*)'],
  ['api/seo/editorial/[slug].js', '/editorial/(.*)'],
  ['api/seo/film/[slug].js', '/film/(.*)'],
  ['api/seo/short/[slug].js', '/short/(.*)']
];
const WANT = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';

console.log('\n=== 핸들러 성공 경로 ===');
for (const [f] of SSR) {
  const s = R(f);
  t(f + ' — s-maxage=3600 + SWR', s.includes("'" + WANT + "'"));
  t(f + ' — 옛 5분 값이 남아 있지 않다',
    !s.includes("'public, max-age=0, s-maxage=300, stale-while-revalidate=86400'"));
  t(f + ' — 왜 올렸는지 주석이 있다', /전송량|s-maxage/.test(s) && s.includes('2026-09-14'));
}

console.log('\n=== vercel.json 라우트 헤더 ===');
const vj = JSON.parse(R('vercel.json'));
for (const [, route] of SSR) {
  const h = (vj.headers || []).find(x => x.source === route);
  t(route + ' — 헤더 블록이 있다', !!h);
  const cc = h && (h.headers || []).find(x => x.key === 'Cache-Control');
  t(route + ' — Cache-Control 이 핸들러와 같은 값', !!cc && cc.value === WANT, cc && cc.value);
  const xr = h && (h.headers || []).find(x => x.key === 'X-Robots-Tag');
  t(route + ' — index, follow 유지 (캐시 손보다 색인 지시를 잃으면 안 된다)',
    !!xr && /index, follow/.test(xr.value));
}

console.log('\n=== 건드리지 말아야 할 것 ===');
{
  const art = R('api/seo/article/[slug].js');
  t('410(내려간 기사) 분기의 s-maxage=86400 은 그대로', /max-age=0, s-maxage=86400/.test(art));
  t('404 분기는 짧게 유지 (max-age=60, s-maxage=300)', /max-age=60, s-maxage=300/.test(art));
  t('언어 리다이렉트 분기도 그대로 (s-maxage=1800)', /max-age=300, s-maxage=1800/.test(art));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ssr-edge-cache tests FAILED'); process.exit(1); }
console.log('✅ ssr-edge-cache tests passed');
