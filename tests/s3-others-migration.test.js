/**
 * 이관 크론 2단계: 기사·필름의 구 S3 이미지 (2026-11-06, AWS 해지 준비)
 *   크론은 화보만 보고 "완주 0건" 이라 했지만 기사 317행 3,611장 · 필름 141장이 구 S3 에 남아 있었다.
 *   ① 화보 큐가 비면 기사·필름으로 넘어간다  ② 갤러리 먼저, 대표 이미지는 갤러리를 다 훑은 뒤에만 교체
 *   ③ 죽은 링크는 원본 유지 + 실패 기록, 전부 실패한 행은 건너뜀(막힘 방지)  ④ note 에 잔량
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }
const stub = (rel, exports) => { const a = path.join(ROOT, 'api', '_lib', rel); require.cache[a] = { id: a, filename: a, loaded: true, exports }; };

const S3 = (n) => 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/' + n + '.jpg';
let DB, updates, failRows, tg, clockStep = 0, fakeNow = 1e12;
function reset(articles, films, fails) {
  DB = { articles, films }; updates = []; failRows = (fails || []).map((u) => ({ url: u, reason: 'HTTP 404' })); tg = [];
}
function chain(table) {
  const st = { table, op: 'select' };
  const b = {
    select() { return b; }, or() { return b; }, order() { return b; }, limit() { return b; }, ilike() { return b; },
    lt() { return b; }, gt() { return b; }, in() { return b; },
    eq(k, v) { st.eqv = v; return b; },
    update(p) { st.op = 'update'; st.patch = p; return b; },
    delete() { st.op = 'delete'; return b; },
    upsert(rows) { failRows.push(...rows); return Promise.resolve({ error: null }); },
    then(ok, ko) {
      let r;
      if (st.op === 'update') { updates.push({ table, id: st.eqv, patch: st.patch }); r = { error: null }; }
      else if (table === 'image_migration_failures') r = { data: failRows.map((f) => ({ url: f.url, reason: f.reason })), error: null };
      else r = { data: JSON.parse(JSON.stringify(DB[table] || [])), error: null };
      return Promise.resolve(r).then(ok, ko);
    },
  };
  return b;
}
stub('supabase.js', { supabaseAdmin: {
  from: chain,
  rpc: () => Promise.resolve({ data: [], error: null }),
  storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), getPublicUrl: (p) => ({ data: { publicUrl: 'https://sb.test/' + p } }) }) },
}, supabase: {} });
stub('cronGuard.js', { withCronGuard: (n, fn) => fn });
stub('secretCompare.js', { bearerOk: () => true });
stub('auth.js', { requireAdmin: async () => ({ id: 'a' }) });
stub('telegram.js', { sendTextToTelegramSafe: async (m) => { tg.push(m); } });
stub('imageShrink.js', { shrinkImageBuffer: async (buf) => ({ shrunk: false, buf }), shrinkNote: () => '' });
global.fetch = async (url) => {
  fakeNow += clockStep;
  if (/dead/.test(url)) return { ok: false, status: 404, headers: { get: () => '' } };
  return { ok: true, status: 200, headers: { get: () => 'binary/octet-stream' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
};
const realNow = Date.now;
Date.now = () => fakeNow;
const cron = require(path.join(ROOT, 'api', 'cron', 'migrate-external-images.js'));
async function run() {
  const out = {}; const res = { locals: {}, status(c) { out.code = c; return res; }, json(j) { out.json = j; return res; } };
  await cron({ headers: { authorization: 'Bearer x' }, query: {} }, res);
  return out;
}

(async () => {
  console.log('\n[1] 화보 큐가 비면 기사·필름으로 넘어간다');
  reset([
    { id: 'a1', status: 'published', thumbnail_url: S3('t1'), hero_image_url: S3('h1'), gallery: [S3('g1'), S3('dead1'), 'https://sb.test/keep.jpg', S3('g1')] },
    { id: 'a2', status: 'published', thumbnail_url: S3('dead2'), hero_image_url: 'https://sb.test/x.jpg', gallery: [] },
  ], [{ id: 'f1', thumbnail_url: S3('f1') }], [S3('dead2')]);
  let fetched = 0; const f0 = global.fetch; global.fetch = async (u) => { fetched++; return f0(u); };
  const o = await run();
  global.fetch = f0;
  const a1 = updates.find((u) => u.table === 'articles' && u.id === 'a1');
  t('2단계로 들어갔다 (phase s3-others)', o.json && o.json.phase === 's3-others', o.json);
  t('갤러리: 옮긴 건 새 주소, 죽은 링크·자사 주소는 그대로, 중복도 같이 바뀜', a1 && a1.patch.gallery[0].startsWith('https://sb.test/migrated/articles/a1/')
    && a1.patch.gallery[1] === S3('dead1') && a1.patch.gallery[2] === 'https://sb.test/keep.jpg' && a1.patch.gallery[3] === a1.patch.gallery[0], a1 && a1.patch);
  t('대표 이미지(썸네일·히어로)도 교체', a1 && /migrated\/articles\/a1\//.test(a1.patch.thumbnail_url) && /migrated\/articles\/a1\//.test(a1.patch.hero_image_url));
  t('필름 썸네일 교체', updates.some((u) => u.table === 'films' && u.id === 'f1' && /migrated\/films\/f1\//.test(u.patch.thumbnail_url)));
  t('남은 S3 가 전부 실패 기록인 행(a2)은 손대지 않음 · 다운로드도 안 함', !updates.some((u) => u.id === 'a2') && fetched === 5, fetched);
  t('죽은 링크는 실패 기록 + 알림', failRows.some((f) => f.url === S3('dead1') && /404/.test(f.reason)) && tg.length === 1 && /구 S3/.test(tg[0]));
  t('잔량 0 (실패 기록분 제외)', o.json.remaining === 0, o.json.remaining);
  t('note: 기사 1편 · 필름 1편 · 이미지 4장', /기사 1편 · 필름 1편 · 이미지 4장/.test(o.json.note), o.json.note);

  console.log('\n[2] 시간이 모자라면 대표 이미지는 다음 회차로');
  reset([{ id: 'b1', status: 'published', thumbnail_url: S3('bt'), hero_image_url: S3('bh'), gallery: [S3('b1'), S3('b2'), S3('b3')] }], [], []);
  clockStep = 50000;                      // 다운로드 한 번에 50초 → 두 장째에서 90초 예산 초과
  const o2 = await run();
  clockStep = 0;
  const b1 = updates.find((u) => u.id === 'b1');
  t('옮긴 갤러리만 저장', b1 && /migrated/.test(b1.patch.gallery[0]) && b1.patch.gallery[2] === S3('b3'), b1 && b1.patch);
  t('대표 이미지는 안 바꿈 (그래야 다음 회차에도 큐에 남는다)', b1 && !('thumbnail_url' in b1.patch) && !('hero_image_url' in b1.patch));
  t('완주라고 하지 않는다', o2.json.done === false);

  console.log('\n[3] 전부 끝나면 완주');
  reset([], [], []);
  const o3 = await run();
  t('done + "완주" note', o3.json.done === true && /완주/.test(o3.json.note), o3.json);

  console.log('\n[4] 대상 고르기');
  const X = cron._s3; const fs0 = new Set([S3('x')]);
  const tg1 = X.articleS3Targets({ thumbnail_url: S3('a'), hero_image_url: S3('a'), gallery: [S3('a'), S3('x'), 'https://other/y.jpg'] }, fs0);
  t('갤러리 고유값 먼저, 갤러리에 이미 있는 대표는 중복 안 함', tg1.gallery.join() === S3('a') && tg1.heads.length === 0, tg1);
  t('구 S3 판정은 pap-korea-bucket 만', X.pendingS3(S3('q'), new Set()) && !X.pendingS3('https://drive.google.com/x', new Set()));

  Date.now = realNow;
  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ s3-others-migration tests FAILED'); process.exit(1); }
  console.log('✅ s3-others-migration tests passed');
})().catch((e) => { Date.now = realNow; console.log('❌ crashed', e); process.exit(1); });
