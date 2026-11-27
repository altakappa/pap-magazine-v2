/**
 * 이관 크론 3단계: 정적 파일에 박힌 구 S3 이미지의 사본 (2026-11-27, AWS 해지)
 *   ① 기사·필름까지 끝나야 들어간다  ② media/s3/<같은 이름> 으로 올린다(호스트만 바꾸면 되게)
 *   ③ 이미 있는 사본·실패 기록은 건너뛴다(멱등)  ④ 죽은 링크는 실패 기록 + 알림
 *   ⑤ 시간 예산을 넘기면 멈추고 완주라 하지 않는다  ⑥ note 에 잔량/전체
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }
const stub = (rel, exports) => { const a = path.join(ROOT, 'api', '_lib', rel); require.cache[a] = { id: a, filename: a, loaded: true, exports }; };

const BASE = 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/';
let mirrored, uploads, failRows, tg, clockStep = 0, fakeNow = 1e12;
function reset(have, fails) { mirrored = new Set(have); uploads = []; failRows = (fails || []).map((u) => ({ url: u, reason: 'HTTP 403' })); tg = []; }
function chain(table) {
  const st = { table, op: 'select' };
  const b = {
    select() { return b; }, or() { return b; }, order() { return b; }, limit() { return b; }, ilike() { return b; },
    lt() { return b; }, gt() { return b; }, in() { return b; }, eq() { return b; },
    update() { st.op = 'update'; return b; }, delete() { st.op = 'delete'; return b; },
    upsert(rows) { failRows.push(...rows); return Promise.resolve({ error: null }); },
    then(ok, ko) {
      let r;
      if (table === 'image_migration_failures') r = { data: failRows.map((f) => ({ url: f.url, reason: f.reason })), error: null };
      else r = { data: [], error: null };                 // 화보·기사·필름은 이미 끝난 상태
      return Promise.resolve(r).then(ok, ko);
    },
  };
  return b;
}
stub('supabase.js', { supabaseAdmin: {
  from: chain,
  rpc: () => Promise.resolve({ data: [], error: null }),
  storage: { from: () => ({
    upload: (p, buf, o) => { uploads.push({ p, o }); mirrored.add(p.replace(/^s3\//, '')); return Promise.resolve({ error: null }); },
    getPublicUrl: (p) => ({ data: { publicUrl: 'https://sb.test/' + p } }),
    list: (folder, o) => { const all = [...mirrored].sort(); return Promise.resolve({ data: all.slice(o.offset, o.offset + o.limit).map((name) => ({ name })), error: null }); },
  }) },
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
const M = cron._mirror;
async function run() {
  const out = {}; const res = { locals: {}, status(c) { out.code = c; return res; }, json(j) { out.json = j; return res; } };
  await cron({ headers: { authorization: 'Bearer x' }, query: {} }, res);
  return out;
}

(async () => {
  console.log('\n[1] 기사·필름이 끝나면 3단계 — 같은 이름으로 s3/ 에 사본');
  M._setKeysForTest(['a.jpg', 'b.png', 'have.jpg', 'dead1.jpg', 'old-fail.jpg']);
  reset(['have.jpg'], [BASE + 'old-fail.jpg']);
  let fetched = []; const f0 = global.fetch; global.fetch = async (u) => { fetched.push(u); return f0(u); };
  const o = await run();
  global.fetch = f0;
  t('phase s3-static-mirror', o.json && o.json.phase === 's3-static-mirror', o.json);
  t('같은 이름으로 올림: s3/a.jpg · s3/b.png', uploads.some((u) => u.p === 's3/a.jpg') && uploads.some((u) => u.p === 's3/b.png'), uploads.map((u) => u.p));
  t('긴 캐시 + 덮어쓰기 허용', uploads.every((u) => u.o.upsert === true && u.o.cacheControl === '31536000'));
  t('이미 있는 사본·실패 기록은 내려받지 않음', !fetched.some((u) => /have\.jpg|old-fail\.jpg/.test(u)), fetched);
  t('S3 원본 주소에서 받음', fetched.every((u) => u.startsWith(BASE)), fetched);
  t('죽은 링크는 실패 기록 + 알림', failRows.some((f) => f.url === BASE + 'dead1.jpg' && /404/.test(f.reason)) && tg.length === 1 && /정적 파일/.test(tg[0]), tg);
  t('잔량 0 이지만 이번 회차에 일했으니 완주 아님', o.json.remaining === 0 && o.json.done === false, o.json);
  t('note: 2장 복사 · 실패 1건 · 잔량 0장 / 전체 5장', /2장 복사/.test(o.json.note) && /실패 1건/.test(o.json.note) && /잔량 0장 \/ 전체 5장/.test(o.json.note), o.json.note);

  console.log('\n[2] 다음 회차 — 할 게 없으면 완주');
  const o2 = await run();
  t('done + 완주', o2.json.done === true && /완주/.test(o2.json.note), o2.json);
  t('아무것도 다시 올리지 않음(멱등)', uploads.length === 2, uploads.length);

  console.log('\n[3] 시간이 모자라면 멈추고 완주라 하지 않는다');
  M._setKeysForTest(['p1.jpg', 'p2.jpg', 'p3.jpg']);
  reset([], []);
  clockStep = 50000;
  const o3 = await run();
  clockStep = 0;
  t('예산 안에서만 복사 (3장 다 못 함)', uploads.length < 3 && uploads.length >= 1, uploads.length);
  t('done=false · 잔량 표시', o3.json.done === false && o3.json.remaining === 3 - uploads.length, o3.json);

  console.log('\n[4] 1,000개 넘는 목록도 끝까지 넘겨 본다');
  const many = Array.from({ length: 2500 }, (_, i) => 'k' + String(i).padStart(5, '0') + '.jpg');
  M._setKeysForTest(many);
  reset(many, []);
  const o4 = await run();
  t('2,500개 사본 전부 인식 → 완주', o4.json.done === true && uploads.length === 0, o4.json);

  console.log('\n[5] 대상 고르기');
  const pend = M.pendingMirrorKeys(['x.jpg', 'y.jpg', 'z.jpg'], new Set(['x.jpg']), new Set([BASE + 'z.jpg']));
  t('사본 있음·실패 기록 제외', pend.join() === 'y.jpg', pend);
  t('키 목록 파일이 실제로 있고 비어 있지 않다', require(path.join(ROOT, 'api', '_data', 's3-legacy-keys.json')).length > 1000);

  M._setKeysForTest(null);
  Date.now = realNow;
  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ s3-static-mirror tests FAILED'); process.exit(1); }
  console.log('✅ s3-static-mirror tests passed');
})().catch((e) => { Date.now = realNow; console.log('❌ crashed', e); process.exit(1); });
