'use strict';
/**
 * 전체 카탈로그 Cache API 10분 보관 (2026-10-14 건강 점검 후속).
 * 실측: 허브 한 번에 /api/articles 32회 + /api/editorials 24회 = 6.6MB, 매 방문 재전송.
 * fetchAll 블록을 떼어 가짜 caches/fetch 로 실제 실행한다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'frontend/pap-content-api-sync.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

const faStart = src.indexOf('  var FETCH_ALL_CONCURRENCY = ');
const faEnd = src.indexOf("        console.warn('[PAP Sync] Fetch error:', endpoint, err);");
const block = src.slice(faStart, src.indexOf('  }\n', faEnd) + 4);
t('fetchAll 이 두 군데 모두 _catalogJson 을 쓴다 (1쪽 + 나머지 쪽)', (block.match(/_catalogJson\(pageUrl\(/g) || []).length === 2 && !/fetch\(pageUrl\(/.test(block));
t('STAGE 1(최신 12건) 은 캐시를 안 거친다', /fetch\(PAP_API_BASE \+ '\/articles\?status=published&limit=12&page=1'\)/.test(src) && /fetch\(PAP_API_BASE \+ '\/editorials\?status=published&limit=12&page=1&public=1'\)/.test(src));
t('TTL 10분 · 캐시 이름 v1', /CATALOG_TTL_MS = 10 \* 60 \* 1000/.test(block) && /CATALOG_CACHE = 'pap-catalog-v1'/.test(block));

/* 가짜 Cache API */
function makeCaches(now) {
  const store = new Map();
  const cache = {
    match: (u) => Promise.resolve(store.get(u) || undefined),
    put: (u, res) => { store.set(u, res); return Promise.resolve(); },
    keys: () => Promise.resolve([...store.keys()]),
    delete: (u) => { store.delete(u); return Promise.resolve(true); },
  };
  return { caches: { open: () => Promise.resolve(cache) }, store };
}
class FakeHeaders { constructor(o) { this.m = new Map(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase(), String(v)])); } get(k) { return this.m.get(k.toLowerCase()) || null; } }
class FakeResponse { constructor(body, init) { this.body = body; this.headers = (init && init.headers) || new FakeHeaders({}); this.ok = true; } json() { return Promise.resolve(JSON.parse(this.body)); } text() { return Promise.resolve(this.body); } clone() { return new FakeResponse(this.body, { headers: this.headers }); } }

function run({ pages = 3, ttlSkewMs = 0, noCaches = false }) {
  return new Promise((resolve) => {
    let netCalls = 0; const env = makeCaches();
    const fakeFetch = (url) => { netCalls++; const p = Number(url.match(/page=(\d+)/)[1]); return Promise.resolve(new FakeResponse(JSON.stringify({ data: [{ id: 'p' + p }], pagination: { pages } }), { headers: new FakeHeaders({}) })); };
    const boot = new Function('PAP_API_BASE', 'fetch', 'console', 'performance', 'caches', 'Headers', 'Response', 'Date', 'run2',
      block + "\nfetchAll('/x', function(it){ return it.id; }, function(all){ run2(all, function(cb){ fetchAll('/x', function(it){ return it.id; }, cb); }); });");
    let base = 1000000; const FakeDate = { now: () => base };
    boot('/api', fakeFetch, { warn() {} }, { now: () => Number(process.hrtime.bigint() / 1000000n) }, noCaches ? undefined : env.caches, FakeHeaders, FakeResponse, FakeDate,
      (all1, again) => { const n1 = netCalls; base += ttlSkewMs; again((all2) => resolve({ all1, all2, n1, n2: netCalls - n1, stored: env.store.size })); });
  });
}
(async () => {
  const a = await run({ pages: 3 });
  t('첫 실행: 3쪽 전부 네트워크, 캐시에 3개 저장', a.n1 === 3 && a.stored === 3 && a.all1.length === 3, JSON.stringify(a));
  t('10분 안 재실행: 네트워크 0, 같은 결과', a.n2 === 0 && JSON.stringify(a.all2) === JSON.stringify(a.all1), JSON.stringify(a));
  const b = await run({ pages: 3, ttlSkewMs: 11 * 60 * 1000 });
  t('11분 뒤 재실행: 다시 네트워크 3회', b.n2 === 3, JSON.stringify(b));
  const c = await run({ pages: 2, noCaches: true });
  t('Cache API 없는 환경: 그냥 네트워크 (2+2)', c.n1 === 2 && c.n2 === 2 && c.all2.length === 2, JSON.stringify(c));
  const htmls = fs.readdirSync(path.join(ROOT, 'frontend')).filter((f) => f.endsWith('.html')).filter((f) => fs.readFileSync(path.join(ROOT, 'frontend', f), 'utf8').includes('pap-content-api-sync.js?v='));
  t('api-sync 캐시버스트 v=130 (' + htmls.length + '개 HTML)', htmls.length >= 10 && htmls.every((f) => /pap-content-api-sync\.js\?v=130"/.test(fs.readFileSync(path.join(ROOT, 'frontend', f), 'utf8'))));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
