/**
 * DB 장애를 404 가 아니라 503 으로 말한다 (2026-09-14 사고 회귀).
 *
 * [사건] 2026-09-14 새벽 Supabase 가 전송량 초과로 프로젝트를 잠갔다
 * (exceed_egress_quota · exceed_cached_egress_quota). 라이브 실측:
 *   기사 URL          → 404 Not Found   (기사는 DB 에 있다)
 *   /api/articles     → 500
 *   sitemap-articles  → <urlset></urlset> 을 **200** 으로
 *   크론              → 2시간 46분째 기록 0건
 *
 * [왜 치명적인가] 404 는 구글에게 "이 페이지는 없어졌다" 다. 기사 URL 이 26,703개인데
 * 며칠 이어지면 색인이 통째로 빠진다. 빈 사이트맵 200 은 "기사가 0편" 이라는 정상
 * 응답이라 더 나쁘다. 503 은 "지금 잠깐 고장" 이라 색인을 지키고 재방문하게 한다.
 *
 * [원인] supabase-js 는 실패를 throw 하지 않고 { data:null, error } 로 준다.
 * SSR 경로가 error 를 안 보고 !data 만 봐서 장애와 '없음' 이 같은 404 가 됐다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const { isOutageError, anyOutage, RETRY_AFTER } = require(path.join(__dirname, '..', 'api', '_lib', 'dbOutage'));

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

console.log('\n=== 판별 ===');
t('전송량 초과는 장애', isOutageError({ message: 'Service for this project is restricted due to the following violations: exceed_egress_quota' }));
t('연결 실패도 장애', isOutageError({ message: 'fetch failed' }));
t("행 0개(PGRST116)는 장애가 아니다 — 진짜 404 다", !isOutageError({ code: 'PGRST116', message: 'no rows' }));
t('error 가 없으면 장애가 아니다', !isOutageError(null) && !isOutageError(undefined));
/* 애매하면 장애로 본다: 404 로 잘못 말하는 손해(색인 소실)가 훨씬 크다. */
t('모르는 코드는 장애로 본다 (보수적)', isOutageError({ code: 'XX999', message: '?' }));

console.log('\n=== anyOutage ===');
t('{data,error} 모양을 받는다', anyOutage({ data: null, error: { message: 'boom' } }));
t('error 자체도 받는다', anyOutage({ message: 'boom' }));
t('정상 결과는 false', !anyOutage({ data: [{ id: 1 }], error: null }));
t('여럿 중 하나만 장애여도 true', anyOutage({ data: [], error: null }, { error: { message: 'boom' } }));
t('빈 입력은 false', !anyOutage() && !anyOutage(null, undefined));

console.log('\n=== 응답 규약 ===');
const lib = R('api/_lib/dbOutage.js');
t('503 을 준다', /res\.status\(503\)/.test(lib));
t('Retry-After 를 붙인다', /Retry-After/.test(lib) && RETRY_AFTER >= 60);
/* 캐시하면 복구된 뒤에도 503 이 남는다. */
t('장애 응답을 캐시하지 않는다', (lib.match(/Cache-Control', 'no-store'/g) || []).length >= 2);
/* 503 의 목적은 색인 보존이다. noindex 헤더를 같이 주면 목적이 무너진다.
   (주석에 단어가 나오는 것은 상관없다 — 실제로 헤더를 세우는지만 본다.) */
t('503 에 noindex 헤더를 세우지 않는다',
  !/setHeader\([^)]*Robots-Tag/i.test(lib) && !/'noindex/i.test(lib));

console.log('\n=== SSR 경로 배선 ===');
for (const f of ['api/seo/article/[slug].js', 'api/seo/editorial/[slug].js',
                 'api/seo/film/[slug].js', 'api/seo/short/[slug].js']) {
  const s = R(f);
  t(f.split('/')[2] + ' — dbOutage 를 읽는다', /require\('\.\.\/\.\.\/_lib\/dbOutage'\)/.test(s));
  t(f.split('/')[2] + ' — 404 앞에 장애 검사가 있다', /if \(anyOutage\(r\)\) return sendOutage\(res/.test(s));
}
/* 조회 뒤의 404 보다 장애 검사가 앞에 있어야 한다. 뒤면 의미가 없다.
   파일 맨 앞의 404(슬러그 자체가 없는 요청)는 DB 를 안 읽으므로 대상이 아니다. */
const art = R('api/seo/article/[slug].js');
t('검사가 조회 뒤 404 보다 먼저 온다',
  art.indexOf('if (anyOutage(r))') > 0
  && art.indexOf('if (anyOutage(r))') < art.indexOf("renderNotFoundHtml('article', slug)"));
t('슬러그 없는 요청의 404 는 그대로 404 다 (DB 를 안 읽는다)',
  art.indexOf("renderNotFoundHtml('article', '')") < art.indexOf('if (anyOutage(r))'));

console.log('\n=== 사이트맵 배선 ===');
for (const f of ['api/sitemap-articles.js', 'api/sitemap-editorials.js', 'api/sitemap-films.js']) {
  const s = R(f);
  t(f.replace('api/', '') + ' — 빈 urlset 200 을 더는 안 준다',
    !/status\(200\)\.send\('<\?xml[^']*<urlset[^']*><\/urlset>/.test(s));
  t(f.replace('api/', '') + ' — 장애면 sendOutageXml', /sendOutageXml\(res/.test(s));
}
t('sitemap-articles: 원본 0건도 장애로 본다 (발행 기사가 0일 수 없다)',
  /if \(!arts \|\| arts\.length === 0\) return sendOutageXml/.test(R('api/sitemap-articles.js')));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ db-outage-503 tests FAILED'); process.exit(1); }
console.log('✅ db-outage-503 tests passed');
