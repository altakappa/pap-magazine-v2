/**
 * PAP STUDIO 도메인 일원화 회귀 (2026-07-29, 도메니코 지시).
 *
 * 배경: pap-studios.com 은 라이브에서 이미 죽어 있다 —
 *   https://www.pap-studios.com/  → 404 (Ahrefs 크롤 실측, 헬스 0점 / 2페이지)
 *   http://www.pap-studios.com/   → 301 → https 로만 넘어가고 그 끝이 404
 * 스튜디오 콘텐츠(프로젝트 50건)는 이미 우리 DB·스토리지로 이관을 마쳤고
 * pap-magazine.com/studio 에서 서빙된다. 도메인을 접고 /studio 로 일원화한다.
 *
 * 다만 /studio 자체가 색인 경로 밖에 있었다 — 사이트맵 미등재 + 내부 링크 0건.
 * 도메인만 접으면 스튜디오가 검색에서 통째로 사라지므로 함께 고친다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d){ if(cond){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

const vj = JSON.parse(R('vercel.json'));
const sm = R('api/sitemap.js');
const renderer = R('api/_lib/seoRenderer.js');
const sub = R('frontend/pap-subscription.js');

console.log('\n=== pap-studios.com → /studio 301 ===');
const studioRedirects = (vj.redirects || []).filter(r =>
  (r.has || []).some(h => h.type === 'host' && /pap-studios/.test(h.value)));
t('리다이렉트 2건 (루트 + 하위 전체 경로)', studioRedirects.length === 2);
t('전부 301 영구 이동', studioRedirects.every(r => r.statusCode === 301 && r.permanent === true));
t('목적지는 절대 URL /studio', studioRedirects.every(r => r.destination === 'https://www.pap-magazine.com/studio'));
t('apex·www 양쪽 매칭', studioRedirects.every(r => /\(www\\\.\)\?pap-studios\\\.com/.test(r.has[0].value)));
t('하위 경로 와일드카드 존재 (구 URL 전부 회수)', studioRedirects.some(r => r.source === '/:path*'));
// 다른 규칙이 먼저 잡으면 리다이렉트가 안 걸린다 — 최상단이어야 한다
const firstIdx = (vj.redirects || []).findIndex(r =>
  (r.has || []).some(h => h.type === 'host' && /pap-studios/.test(h.value)));
t('redirects 최상단에 위치 (선착순 매칭)', firstIdx === 0);

console.log('=== /studio 색인 경로 ===');
t('사이트맵에 /studio 등재', /path: '\/studio'/.test(sm));
t('모든 SSR 페이지 하단 내비에 Studio 링크', /\$\{SITE\}\/studio">Studio<\/a>/.test(renderer),
  '내부 링크가 0이면 /studio 는 고아 페이지가 된다');

console.log('=== 코드 내 옛 도메인 잔존 ===');
// 경위를 적은 주석에는 도메인이 남아도 된다 — 살아있는 http 링크만 본다
t('구독 배너 링크가 /studio 로 교체',
  /link:'\/studio'/.test(sub) && !/https?:\/\/(www\.)?pap-studios\.com/.test(sub));
(function () {
  // 프런트·API 코드에 살아있는 pap-studios.com 링크가 남아 있으면 404 로 보낸다.
  // (guide/ 문서와 vercel.json 리다이렉트 규칙 자체는 제외)
  const roots = ['frontend', 'api'];
  const hits = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true })) {
      const rel = dir + '/' + f.name;
      if (f.isDirectory()) { walk(rel); continue; }
      if (!/\.(js|html)$/.test(f.name)) continue;
      const src = R(rel);
      // 주석에 적힌 경위 설명은 링크가 아니므로 http(s) 링크 형태만 본다
      if (/https?:\/\/(www\.)?pap-studios\.com/.test(src)) hits.push(rel);
    }
  })(roots[0]);
  (function walk(dir) {
    for (const f of fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true })) {
      const rel = dir + '/' + f.name;
      if (f.isDirectory()) { walk(rel); continue; }
      if (!/\.js$/.test(f.name)) continue;
      if (/https?:\/\/(www\.)?pap-studios\.com/.test(R(rel))) hits.push(rel);
    }
  })(roots[1]);
  t('frontend·api 에 살아있는 pap-studios.com 링크 0건', hits.length === 0, hits.join(', '));
})();

console.log('=== 기존 studio 라우팅 보존 ===');
t('/studio → studio.html 유지', vj.rewrites.some(r => r.source === '/studio' && r.destination === '/studio.html'));
t('/studio.html → /studio 301 유지', (vj.redirects || []).some(r => r.source === '/studio.html' && r.statusCode === 301));
t('관리자 /admin/studio 유지', vj.rewrites.some(r => r.source === '/admin/studio'));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ studio-domain-consolidation tests FAILED'); process.exit(1); }
console.log('✅ studio-domain-consolidation tests passed');
