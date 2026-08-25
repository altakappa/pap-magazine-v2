/**
 * 조회를 화면(SSR/SPA)별로 가른다 — IG 재편의 계기 (2026-08-22)
 * ═══════════════════════════════════════════════════════════════════
 * 도메니코: "인스타그램에 가장 많이 되는 유입구조로 바꿔줘."
 * 그 판단에 필요한 숫자를 지금은 반쪽만 갖고 있었다.
 *
 *   분자 — 웹→IG 아웃클릭 30일 1,950건 (ig_outclicks_human, src 별)
 *       ssr_article→post  833  (7일 679 / 그 주 전체 928 = 73%)
 *       ssr→post          473
 *       article (SPA)      68
 *       editorial (SPA)    46
 *   분모 — 그 화면을 몇 명이 봤나
 *       SPA  있음 (pap-content-article/editorial 이 /view 를 쏜다)
 *       SSR  **없음** — seoRenderer 에 비콘이 아예 없었다
 *
 * 그래서 "SSR 이 SPA 보다 12배" 는 절대량 차이일 뿐 전환율이 아니다.
 * 오늘 네 번 헛짚은 게 전부 '재기 전에 고쳐서' 였다. 이번엔 계기부터 만든다.
 *
 * 이 테스트가 지키는 것
 *   1. 두 화면이 각각 자기 라벨로 조회를 남긴다 (surface=ssr / spa)
 *   2. **겹치지 않는다** — 리다이렉트로 SPA 로 넘어갈 사람은 SSR 이 세지 않는다
 *   3. 라벨을 못 믿을 값은 넣지 않는다 (모르면 NULL)
 *   4. 마이그레이션 133 전에도 조회 기록을 잃지 않는다 (42703 폴백)
 *   5. 계측이 화면을 막지 않는다 (실패는 조용히)
 */

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { renderSeoHtml } = require(path.join(ROOT, 'api/_lib/seoRenderer.js'));
const REC = {
  id: '11111111-2222-3333-4444-555555555555',
  title: 't', slug: 's', status: 'published',
  published_date: '2026-08-01', description: 'd', cover_image: 'c.jpg',
};

console.log('\n=== 1. SSR 화면이 자기 조회를 남긴다 ===');
{
  for (const kind of ['article', 'editorial']) {
    const h = renderSeoHtml(kind, REC, { lang: 'ko' });
    t(`${kind}: surface=ssr 비콘이 있다`, h.indexOf('/view?surface=ssr') > -1);
    const seg = kind === 'article' ? '/api/articles/' : '/api/editorials/';
    t(`${kind}: 올바른 엔드포인트로 쏜다`, h.indexOf(seg) > -1);
    t(`${kind}: 그 기사 id 를 싣는다`, h.indexOf(REC.id) > -1);
  }
  const film = renderSeoHtml('film', REC, { lang: 'ko' });
  t('film 은 비콘을 쏘지 않는다 (조회표가 없다)', film.indexOf('surface=ssr') === -1);
  const badId = renderSeoHtml('article', Object.assign({}, REC, { id: 'not-a-uuid' }), { lang: 'ko' });
  t('id 가 UUID 가 아니면 쏘지 않는다 (400 을 만들지 않는다)', badId.indexOf('surface=ssr') === -1);
}

console.log('\n=== 2. 두 화면이 겹치지 않는다 (중복 집계 방지) ===');
{
  const h = renderSeoHtml('article', REC, { lang: 'ko' });
  t('리다이렉트 중이면 SSR 은 세지 않는다',
    /js-redirecting[\s\S]{0,120}?return;/.test(h));
  t('그 가드가 비콘보다 먼저 온다',
    h.indexOf("classList.contains('js-redirecting')") < h.indexOf('/view?surface=ssr'));
  /* SPA 쪽은 자기 라벨로 센다 — 같은 사람을 두 번 세지 않으려면 둘 다 라벨이 있어야 한다 */
  t('SPA 기사 비콘이 surface=spa 를 붙인다',
    /\/view\?surface=spa/.test(read('frontend/pap-content-article.js')));
  t('SPA 화보 비콘이 surface=spa 를 붙인다',
    /\/view\?surface=spa/.test(read('frontend/pap-content-editorial.js')));
}

console.log('\n=== 3. 서버는 아는 값만 저장한다 ===');
{
  for (const f of ['api/articles/[id]/view.js', 'api/editorials/[id]/view.js']) {
    const src = read(f);
    const m = src.match(/function readSurface\(req\)\{?[\s\S]*?\n\}/);
    t(`${f}: readSurface 가 있다`, !!m);
    if (m) {
      const readSurface = new Function('req', m[0] + '; return readSurface(req);');
      t(`${f}: ssr 통과`, readSurface({ query: { surface: 'ssr' } }) === 'ssr');
      t(`${f}: spa 통과`, readSurface({ query: { surface: 'spa' } }) === 'spa');
      t(`${f}: 대소문자 무시`, readSurface({ query: { surface: 'SSR' } }) === 'ssr');
      t(`${f}: 모르는 값은 NULL (틀린 라벨보다 빈 칸)`,
        readSurface({ query: { surface: 'weird' } }) === null);
      t(`${f}: 없으면 NULL`, readSurface({ query: {} }) === null);
      t(`${f}: 쿼리·본문 둘 다 본다`, readSurface({ body: { surface: 'spa' } }) === 'spa');
    }
    t(`${f}: insert 에 surface 를 싣는다`, /user_id: viewerId, surface/.test(src));
    t(`${f}: 익명 강등 경로에도 싣는다`, /user_id: null, surface/.test(src));
  }
}

console.log('\n=== 4. 마이그레이션 전에도 조회를 잃지 않는다 ===');
{
  for (const f of ['api/articles/[id]/view.js', 'api/editorials/[id]/view.js']) {
    const src = read(f);
    /* 2026-08-25 실측 회귀: PostgREST 는 없는 컬럼에 SQL 42703 이 아니라 스키마
       캐시 오류 PGRST204 를 돌려준다("Could not find the 'surface' column").
       42703 만 잡던 첫 구현이 이를 놓쳐 8/23~24 view 비콘이 하루 1,278건 500 —
       두 코드를 모두 잡아야 마이그레이션 133 실행 전에도 조회가 산다. */
    t(`${f}: 42703 과 PGRST204 둘 다 잡고 surface 빼고 재시도`,
      /\(error\.code === '42703' \|\| error\.code === 'PGRST204'\) && surface/.test(src));
    /* 재시도 블록만 잘라서 본다 — 정규식으로 멀리 훑으면 엉뚱한 곳을 집는다
       (오늘 이 실수를 네 번 했다). 블록 안에 surface 가 있으면 재시도 의미가 없다. */
    const i = src.indexOf("error.code === '42703'");
    const ins = i > -1 ? src.indexOf('insert({', i) : -1;
    const call = ins > -1 ? src.slice(ins, src.indexOf('})', ins) + 2) : '';
    t(`${f}: 재시도 블록이 실제로 insert 를 다시 한다`, /^insert\(\{/.test(call), call.slice(0, 120));
    t(`${f}: 그 재시도 insert 에는 surface 가 없다 (없는 컬럼을 또 넣으면 무한 실패)`,
      call.length > 0 && call.indexOf('surface') === -1, call.slice(0, 160));
  }
}

console.log('\n=== 5. 계측이 화면을 막지 않는다 ===');
{
  const h = renderSeoHtml('article', REC, { lang: 'ko' });
  t('비콘 전체가 try/catch 안에 있다', /\(function\(\)\{\s*try \{[\s\S]*?catch\(_\)\{\}\s*\}\)\(\);/.test(h));
  t('fetch 실패를 삼킨다', /\.catch\(function\(\)\{\}\)/.test(h));
  t('페이지 이탈에도 남도록 keepalive', /keepalive: true/.test(h));
}

console.log('\n=== 6. 마이그레이션이 안전한 모양이다 ===');
{
  const sql = read('supabase_migrations/133_view_surface.sql');
  t('컬럼 추가는 if not exists', (sql.match(/add column if not exists surface text/g) || []).length === 2);
  t('두 표 모두 대상', /article_views/.test(sql) && /editorial_views/.test(sql));
  t('삭제·변경이 없다 (추가만)', !/drop |alter column|delete from|truncate/i.test(sql));
  t('판정 쿼리 모양에 맞는 인덱스', (sql.match(/create index if not exists/g) || []).length === 2);
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ view-surface tests FAILED'); process.exit(1); }
console.log('✅ view-surface tests passed');
