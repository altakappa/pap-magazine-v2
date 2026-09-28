/*
 * drive-tiktok-dup-unblock.test.js  (2026-09-28, 도메니코 "틱톡에 영상 업로드가 안되고있어")
 *
 * 실측: drive-tiktok-post 가 9/23 ~ 9/28 780회 같은 파일에서 멈췄다.
 *   예전 'failed' 줄이 있는 파일 → 기사 중복 → skipped insert 가 drive_file_id 유니크에
 *   부딪혀 조용히 실패 → return. 뒤에 있던 새 영상(0926_보테가 성찬)까지 막혔다.
 * 지키는 것: 중복 파일은 기존 줄을 skipped 로 바꾸고, 같은 회차에 다음 영상을 올린다.
 */
'use strict';
const path = require('path');
const Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

/* ── 메모리 DB: tiktok_posts 만 흉내 낸다 (drive_file_id · article_id 유니크) ── */
function makeDb(rows) {
  let seq = 100;
  function q(table) {
    const st = { filters: [], op: 'select', payload: null, notNull: null };
    const match = (r) => st.filters.every(([c, v]) => r[c] === v) && (!st.notNull || r[st.notNull] != null);
    const api = {
      select() { return api; },
      not(c) { st.notNull = c; return api; },
      eq(c, v) { st.filters.push([c, v]); return api; },
      limit() { return api; },
      maybeSingle() { return Promise.resolve({ data: rows.find(match) || null, error: null }); },
      update(p) { st.op = 'update'; st.payload = p; return api; },
      insert(p) {
        const clash = rows.some((r) => (p.drive_file_id && r.drive_file_id === p.drive_file_id) || (p.article_id && r.article_id === p.article_id));
        if (clash) return Promise.resolve({ error: { message: 'duplicate key value violates unique constraint' } });
        rows.push(Object.assign({ id: 'r' + (seq++), created_at: new Date().toISOString() }, p));
        return Promise.resolve({ error: null });
      },
      then(res, rej) {
        let out;
        if (st.op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, st.payload)); out = { error: null }; }
        else out = { data: rows.filter(match), error: null };
        return Promise.resolve(out).then(res, rej);
      },
    };
    return api;
  }
  return {
    from: q,
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (p) => ({ data: { publicUrl: 'https://x/' + p } }) }) },
  };
}

(async function () {
  const rows = [
    { id: 'reel', drive_file_id: null, article_id: 'A', status: 'submitted', detail: 'reels:A' },
    { id: 'old', drive_file_id: 'D', article_id: null, status: 'failed', detail: '재시도: 파일명 교정' },
  ];
  const db = makeDb(rows);
  const files = [{ id: 'D', name: '0922_윤호가 다시 찾은 디젤.mp4', bytes: 1000 }, { id: 'N', name: '0926_보테가 성찬 영상.mp4', bytes: 1000 }];
  const arts = { D: { id: 'A', title: '윤호가 다시 찾은 디젤', slug: 'a' }, N: { id: 'B', title: '보테가 성찬', slug: 'b' } };
  const posts = [];
  const mocks = {
    secretCompare: { bearerOk: () => true },
    stripHtml: { HTML_TAG_RE: /<[^>]+>/g, dropKnownTags: () => ' ' },
    supabase: { supabaseAdmin: db },
    auth: { requireAdmin: async () => ({ id: 'a' }) },
    cronGuard: { withCronGuard: (_n, fn) => fn },
    youtubeMeta: { buildHashtags: () => [] },
    igFirstLink: { IG_HANDLE_URL: 'instagram.com/pap_magazine' },
    driveVideos: { isConfigured: () => true, listVideos: async () => files, downloadVideo: async () => Buffer.from('v') },
    buffer: { isConfigured: () => true, findChannelId: async () => 'ch', createVideoPost: async (o) => { posts.push(o); return { id: 'P1', status: 'sending' }; } },
    koMatch: { matchArticle: (name) => { const f = files.find((x) => x.name === name); return { matched: arts[f.id], score: 0.9, reason: '' }; }, groupUnmatched: () => '', fileCore: (n) => n },
    igSubPosts: { loadSubPosts: async () => [], findSubPost: () => null, subPostAsArticle: () => null, subPostUrl: () => '' },
    driveClaim: {
      claimDriveFile: async (_t, id) => { rows.push({ id: 'c' + id, drive_file_id: id, status: 'claimed' }); return { ok: true }; },
      finishClaim: async (_t, id, p) => { Object.assign(rows.find((r) => r.drive_file_id === id), p); return { ok: true }; },
      doneIdsFrom: (rs) => new Set(rs.filter((r) => r.drive_file_id && r.status !== 'failed').map((r) => r.drive_file_id)),
    },
    tiktokDrive: {
      MAX_BYTES: 1e9, ART_COLS: '', LOOKBACK_DAYS: 30,
      pickViable: (fs, done) => ({ candidates: fs.filter((f) => !done.has(f.id)), skipped: [] }),
      recentArticles: async () => Object.values(arts),
    },
  };
  const orig = Module._load;
  Module._load = function (req) {
    const m = /_lib\/([A-Za-z]+)$/.exec(req);
    if (m && mocks[m[1]]) return mocks[m[1]];
    return orig.apply(this, arguments);
  };
  const handler = require(path.join(ROOT, 'api/cron/drive-tiktok-post.js'));
  Module._load = orig;

  const run = async (query) => {
    let code = 0, out = null;
    const res = { locals: {}, status(c) { code = c; return this; }, json(o) { out = o; return this; } };
    await handler({ headers: { authorization: 'Bearer x' }, query: query || {} }, res);
    return { code, out, note: res.locals.cronNote };
  };

  const dry = await run({ dry: '1' });
  ok(rows.find((r) => r.id === 'old').status === 'failed', 'dry=1 은 DB 를 바꾸지 않는다');
  ok(dry.out && dry.out.dry && /보테가 성찬/.test(dry.note), 'dry 에서도 중복을 건너뛰고 다음 영상을 고른다');

  const r1 = await run();
  ok(rows.find((r) => r.id === 'old').status === 'skipped', '예전 failed 줄을 skipped 로 바꾼다 (insert 충돌로 조용히 실패하지 않는다)');
  ok(r1.out.publish_id === 'P1' && posts.length === 1, '같은 회차에 다음 영상을 실제로 올린다');
  ok(/0926_보테가 성찬/.test(r1.note) && /중복 방지 1건/.test(r1.note), '노트에 게시 영상과 중복 건수가 같이 남는다');
  ok(!rows.some((r) => r.id !== 'old' && r.drive_file_id === 'D'), '중복 파일에 줄을 새로 만들지 않는다');

  const r2 = await run();
  ok(posts.length === 1, '두 번째 회차는 아무것도 다시 올리지 않는다');
  ok(!/윤호/.test(String(r2.note)), '두 번째 회차에 중복 파일을 다시 집지 않는다 (무한 반복 끝)');

  console.log('\ndrive-tiktok-dup-unblock: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
})().catch((e) => { console.log('  ✗ 실행 오류 ' + (e && e.stack || e)); process.exit(1); });
