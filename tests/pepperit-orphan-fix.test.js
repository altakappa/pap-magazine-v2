/**
 * PEPPERIT 고아 페이지 회귀 (2026-07-29 SEO 감사).
 *
 * 실측(Ahrefs 2026-07-27, project 10126082): pepperitmag 헬스 20점,
 * 크롤 134페이지 중 오류 107건이 전부 'Orphan page (has no incoming internal
 * links)' 한 항목이었다(직전 크롤 대비 +47).
 *
 * 원인 2가지:
 *  1) 홈(frontend/pepperit.html)의 "지금 뜨는 이야기"·"방금 올라온 기사" 섹션이
 *     클라이언트 JS 로만 채워지는 빈 <div> — 크롤러가 받는 HTML 에 기사 링크가
 *     한 줄도 없다. 진입점이 없으니 사이트맵에만 존재하는 페이지가 된다.
 *  2) 기사 상세의 관련 기사가 '최신 4개 고정' 이라, 모든 기사가 같은 4편만
 *     가리켰다. 최신 4편에만 인바운드가 몰리고 나머지는 전부 고아.
 *
 * 조치: SSR 아카이브(/archive) 신설 + 홈 푸터 정적 링크 + 관련 기사를 발행일
 * 인접(앞2+뒤2)으로 교체(PAP 아티클 957e93c 와 같은 방식).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d){ if(cond){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

const home = R('frontend/pepperit.html');
const detail = R('api/seo/pepperit/[slug].js');
const sitemap = R('api/sitemap-pepperit.js');
const vj = JSON.parse(R('vercel.json'));

console.log('\n=== 크롤 진입점 (홈 → 아카이브) ===');
t('홈 푸터에 정적 전체기사 링크 (JS 아님)', /<a href="\/archive">전체 기사<\/a>/.test(home),
  'LATEST 섹션은 JS 로 채워지므로 정적 <a> 가 없으면 크롤러는 기사 링크를 하나도 못 본다');
t('LATEST 섹션이 여전히 JS 채움임을 인지 (구조 변경 시 이 테스트를 다시 볼 것)',
  /id="ppLatest"/.test(home));
t('사이트맵에 /archive 선언', /SITE \+ '\/archive<\/loc>/.test(sitemap));

console.log('=== 라우팅 ===');
const arc = vj.rewrites.filter(r => String(r.destination) === '/api/seo/pepperit-archive');
t('아카이브 라우트 2개(호스트별 /archive + /pepperit/archive)', arc.length === 2);
t('pepperitmag 호스트 게이트', arc.some(r => (r.has || []).some(h => h.type === 'host' && /pepperitmag/.test(h.value))));
const iPep = vj.rewrites.findIndex(r => String(r.source) === '/archive' && (r.has || []).length);
const iPap = vj.rewrites.findIndex(r => String(r.source) === '/archive' && !(r.has || []).length);
t('페퍼릿 /archive 규칙이 PAP 범용 규칙보다 앞 (선착순 매칭)', iPep >= 0 && iPap >= 0 && iPep < iPap,
  '뒤에 있으면 pepperitmag.com/archive 가 PAP 아카이브를 렌더한다');

console.log('=== 관련 기사 = 발행일 인접 (인바운드 분산) ===');
t('최신 4개 고정 쿼리 제거', !/최신 기사 4개/.test(detail));
t('앞(lte, desc 2) + 뒤(gt, asc 2) 조회', /lte\('published_date', _pub\)/.test(detail) && /gt\('published_date', _pub\)/.test(detail));
t('4건 미만이면 최신으로 채움 (초기 기사 보호)', /if \(latest\.length < 4\)/.test(detail));

console.log('=== 아카이브 렌더 실측 ===');
(function () {
  const rows = [
    { title: '뉴진스 컴백 티저 공개', slug: 'newjeans-comeback-teaser', id: '1', thumbnail_url: 'https://x/a.jpg', category: 'NEWS', published_date: '2026-07-28' },
    { title: '공항 룩 </script><b>x</b>', slug: 'airport-look', id: '2', thumbnail_url: null, category: 'LOOK', published_date: '2026-07-27' },
  ];
  const orig = Module._load;
  Module._load = function (req) {
    if (String(req).endsWith('_lib/supabase')) {
      return { supabaseAdmin: { from() { const q = { select: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({ data: rows }) }; return q; } } };
    }
    return orig.apply(this, arguments);
  };
  const handler = require('../api/seo/pepperit-archive.js');
  Module._load = orig;

  const res = { _h: {}, setHeader(k, v) { this._h[k] = v; }, status(c) { this._c = c; return this; }, send(b) { this._b = b; return this; } };
  return handler({ query: {} }, res).then(() => {
    const b = res._b;
    t('200 응답', res._c === 200);
    t('기사 전건이 링크로 렌더', (b.match(/class="it" href="\/article\//g) || []).length === rows.length);
    t('canonical = pepperitmag 절대 URL', /rel="canonical" href="https:\/\/www\.pepperitmag\.com\/archive"/.test(b));
    t('noindex 아님 (색인 대상)', !/noindex/.test(b));
    t('본문 XSS 이스케이프', b.includes('&lt;/script&gt;') && !/<span class="t">[^<]*<\/script>/.test(b));
    t('JSON-LD 탈출 차단 (제목의 </script>)', !/<script type="application\/ld\+json">[^<]*<\/script><b>/.test(b) && b.includes('\\u003c'));
    t('ItemList 개수 = 기사 수', (JSON.parse(b.match(/<script type="application\/ld\+json">(\{"@context[\s\S]*?)<\/script>/)[1]).mainEntity || {}).numberOfItems === rows.length);
    t('PAP 로 나가는 절대 링크 (자매지 신호)', b.includes('https://www.pap-magazine.com/'));

    console.log(`\npassed: ${pass}   failed: ${fail}`);
    if (fail) { console.log('❌ pepperit-orphan-fix tests FAILED'); process.exit(1); }
    console.log('✅ pepperit-orphan-fix tests passed');
  });
})();
