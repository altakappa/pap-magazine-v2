/**
 * 브랜드 페이지: 화보 전건 스캔을 인스턴스당 10분에 한 번으로 (2026-11-06)
 *   11/05·11/06 아침 서울발 위장 수집기가 브랜드 페이지 수천 개를 초당 10개씩 열어
 *   "페이지 수 × 2,300행" 이 DB 로 쏟아졌다(5분 2만 6천 건, 메모리 SEVERE).
 *   ① 동시에 20번 열어도 DB 읽기는 한 번(1000행씩 3쪽)  ② 10분 안엔 다시 안 읽음
 *   ③ 결과는 예전과 같다: 최신순 · 브랜드당 300개 · 제목 없는 건 제외 · 구형/신형 크레딧 모두
 *   ④ 덜 읽힌 표(오류)는 저장하지 않고, 직전 표가 있으면 그걸 쓴다
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

/* 가짜 DB: 발행 화보 2,300건 (최신순), 0번은 prada, 짝수는 구형·홀수는 신형 크레딧 */
const N = 2300;
const ROWS = Array.from({ length: N }, (_, i) => ({
  title: i === 5 ? '' : 'T' + i, slug: 's' + i, id: 'e' + i, cover_image: 'c' + i, og_image: null, thumbnail: null,
  published_date: new Date(Date.UTC(2026, 0, 1) - i * 864e5).toISOString().slice(0, 10),
  fashion: i % 2 ? { brands: [{ name: 'Weekday', instagram: '@weekday' }] } : [{ n: 'Prada', id: '@prada' }],
}));
let calls = 0, failAt = -1;
function q() {
  let lo = 0, hi = 0;
  const b = {
    select() { return b; }, eq() { return b; }, neq() { return b; }, not() { return b; }, order() { return b; }, limit() { return b; },
    range(a, z) { lo = a; hi = z; calls++; return b; },
    maybeSingle() { return Promise.resolve({ data: { brand_id: 'prada', display_name: 'Prada', status: 'active' } }); },
    then(ok, ko) {
      const r = (failAt === calls) ? { data: null, error: { message: 'x' } } : { data: ROWS.slice(lo, hi + 1), error: null };
      return Promise.resolve(r).then(ok, ko);
    },
  };
  return b;
}
const abs = path.join(ROOT, 'api', '_lib', 'supabase.js');
require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: { supabaseAdmin: { from: () => q() }, supabase: {} } };
const handler = require(path.join(ROOT, 'api', 'seo', 'brand', '[id].js'));
const X = handler._brandIndex;

(async () => {
  console.log('\n[1] 동시에 몰려도 한 번만 읽는다');
  X.reset(); calls = 0;
  const maps = await Promise.all(Array.from({ length: 20 }, () => X.brandIndex()));
  t('20번 동시 요청 → DB 3쪽(1000행씩)만', calls === 3, calls);
  t('모두 같은 표를 받는다', maps.every((m) => m === maps[0]));
  await X.brandIndex(); await X.brandIndex();
  t('10분 안에는 다시 안 읽는다', calls === 3, calls);
  await X.brandIndex(Date.now() + 11 * 60 * 1000);
  t('10분 지나면 다시 읽는다', calls === 6, calls);

  console.log('\n[2] 결과는 예전과 같다');
  const m = maps[0];
  const prada = m.get('prada'), weekday = m.get('weekday');
  t('브랜드당 300개 상한', prada.length === 300 && weekday.length === 300, [prada.length, weekday.length]);
  t('최신순 그대로 (prada 첫 건 T0)', prada[0].title === 'T0' && prada[1].title === 'T2');
  t('구형 [{n,id}] · 신형 {brands} 둘 다 읽는다', !!prada && !!weekday);
  t('제목 없는 화보는 뺀다 (T5 자리 없음)', !weekday.some((e) => e.slug === 's5'));
  t('카드에 fashion 원본은 안 들고 다닌다 (메모리)', !('fashion' in prada[0]) && prada[0].slug === 's0');

  console.log('\n[3] 오류 처리');
  X.reset(); calls = 0; failAt = 2;
  const partial = await X.brandIndex();
  t('2쪽째 오류 → 있는 만큼으로 이번 응답은 낸다', partial.get('prada').length === 300);
  failAt = -1; await X.brandIndex();
  t('덜 읽힌 표는 저장 안 함 → 다음 요청이 다시 읽는다', calls === 5, calls);
  const before = calls; await X.brandIndex();
  t('완전한 표는 저장된다', calls === before);

  console.log('\n[4] 페이지가 실제로 그 표를 쓴다');
  X.reset(); calls = 0;
  const out = {}; const res = { setHeader(k, v) { out[k] = v; return res; }, status(c) { out.code = c; return res; }, send(b) { out.body = b; return res; }, end() { return res; } };
  const log = console.log; console.log = () => {};
  await handler({ method: 'GET', query: { id: 'prada' }, headers: {}, url: '/brand/prada' }, res);
  await handler({ method: 'GET', query: { id: 'prada' }, headers: {}, url: '/brand/prada' }, res);
  console.log = log;
  t('200 + 화보 카드', out.code === 200 && /\/editorial\/s0/.test(out.body), out.code);
  t('두 번 열어도 화보 스캔은 3쪽', calls === 3, calls);
  t('페이지 캐시 헤더 유지', out['Cache-Control'] === 'public, s-maxage=3600, stale-while-revalidate=86400');

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ brand-index-cache tests FAILED'); process.exit(1); }
  console.log('✅ brand-index-cache tests passed');
})();
