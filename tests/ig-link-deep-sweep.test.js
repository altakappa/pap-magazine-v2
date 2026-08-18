/*
 * ig-link-deep-sweep.test.js  (2026-08-18)
 *
 * 막는 구멍: **정직하게 돌면서 아무것도 못 하는 크론.**
 *
 * editorial-ig-link 는 6시간마다 최근 2페이지(~200개)만 본다. 새 화보에는
 * 맞는 설계다 (8/08 이후 발행 7편은 7편 다 연결됐다). 그런데 미연결 183편은
 * 2019-08-22 ~ 2026-07-06 구간이라 최근 200개 안에 영영 안 들어온다.
 * 결과: 36회 연속 '연결 0건 · 미연결 173'. 옛 구간 스캔이 '관리자 수동'
 * 이었는데 아무도 안 눌렀다. 사람이 눌러야 도는 자동화는 자동화가 아니다.
 *
 * 그래서 회차마다 아카이브를 조금씩 씹고, 커서를 site_settings 에 남긴다.
 *
 * 이 테스트는 소스 문자열이 아니라 **실제 동작**을 본다. supabase·fetch·
 * 인증을 갈아끼워 핸들러를 그대로 돌리고, 저장된 커서와 연결 결과를 본다.
 */
'use strict';
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'api/editorials/backfill-ig.js');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
function eq(a, b, m) { ok(a === b, m + `  (기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)})`); }

process.env.CRON_SECRET = 'test-secret';
process.env.IG_ACCESS_TOKEN = 'tok';
process.env.IG_USER_ID = '123';

// ── 가짜 DB ──────────────────────────────────────────────────────
const db = {
  editorials: [],       // 미연결 화보
  settings: null,       // site_settings.ig_link_deep_cursor 의 value
  updates: [],          // 연결된 것들
  savedCursor: undefined,
};
function q(table) {
  const st = { table, mode: null, payload: null };
  const self = {
    select() { return self; },
    insert(row) { st.mode = 'insert'; st.payload = row; return self; },
    update(patch) { st.mode = 'update'; st.payload = patch; return self; },
    upsert(row) {
      if (table === 'site_settings') { db.savedCursor = row.value; }
      return Promise.resolve({ error: null });
    },
    eq(col, val) { if (col === 'id') st.id = val; return self; },
    is() { return self; },
    not() { return self; },
    gte() { return self; },
    order() { return self; },
    limit(n) {
      if (table === 'editorials') return Promise.resolve({ data: db.editorials, error: null });
      return Promise.resolve({ data: [], error: null });
    },
    maybeSingle() {
      if (table === 'site_settings') return Promise.resolve({ data: db.settings ? { value: db.settings } : null, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    single() { return Promise.resolve({ data: { id: 1 }, error: null }); },
    then(onOk) {
      if (table === 'editorials' && st.mode === 'update') {
        db.updates.push({ id: st.id, url: st.payload.source_instagram_url });
      }
      return Promise.resolve({ error: null, data: null }).then(onOk);
    },
  };
  return self;
}
const fakeSupabase = { supabaseAdmin: { from: (t) => q(t) } };

const orig = Module._load;
Module._load = function (req) {
  if (req === './supabase' || req === '../_lib/supabase') return fakeSupabase;
  if (req === './email' || req === '../_lib/email') return { sendEmail: async () => ({ ok: true }) };
  if (req === './telegram' || req === '../_lib/telegram') return { sendTextToTelegramPersonalSafe: async () => ({ ok: true }) };
  if (req === '../_lib/cors') return { handleCors: () => false };
  if (req === '../_lib/auth') return { requireAdmin: async () => null };
  return orig.apply(this, arguments);
};
delete require.cache[require.resolve(TARGET)];
const handler = require(TARGET);
Module._load = orig;

// ── 가짜 Graph API ───────────────────────────────────────────────
/* 아카이브를 커서로 나눈 가상의 페이지들. after 가 없으면 최신 페이지부터. */
let PAGES = {};
let fetchLog = [];
global.fetch = async (url) => {
  fetchLog.push(String(url));
  const m = /[&?]after=([^&]*)/.exec(String(url));
  const key = m ? decodeURIComponent(m[1]) : 'HEAD';
  const page = PAGES[key];
  if (!page) throw new Error('테스트: 정의 안 된 페이지 ' + key);
  return {
    ok: true,
    json: async () => ({
      data: page.data,
      paging: page.next ? { next: 'x', cursors: { after: page.next } } : {},
    }),
  };
};

function res() {
  const r = {
    statusCode: 200, locals: {}, headersSent: false, body: null,
    status(c) { r.statusCode = c; return r; },
    json(b) { r.body = b; r.headersSent = true; return r; },
  };
  return r;
}
async function run() {
  db.updates = []; db.savedCursor = undefined; fetchLog = [];
  const r = res();
  await handler({ method: 'GET', query: {}, headers: { authorization: 'Bearer test-secret' } }, r);
  return r;
}
const post = (caption, id) => ({ caption, permalink: 'https://instagram.com/p/' + id, timestamp: '2020-01-01' });

(async () => {
  console.log('\n=== 1. 옛 구간 화보를 깊은 스윕이 찾아 연결한다 (핵심) ===');
  {
    db.editorials = [{ id: 'e-old', title: 'PALE FIRE', slug: 'pale-fire' }];
    db.settings = { after: 'CUR2', sweeps: 0, scanned: 400 };
    PAGES = {
      HEAD: { data: [post('요즘 게시물', 'n1')], next: 'CUR1' },   // 최근 구간 — 없음
      CUR1: { data: [post('또 최근', 'n2')], next: 'CUR2' },
      CUR2: { data: [post("'PALE FIRE' exclusive for @pap_magazine", 'old1')], next: 'CUR3' },
      CUR3: { data: [post('더 옛날', 'old2')], next: 'CUR4' },
    };
    const r = await run();
    eq(r.statusCode, 200, '200 으로 끝난다');
    eq(db.updates.length, 1, '옛 화보 1편이 연결된다');
    ok(db.updates[0] && /old1/.test(db.updates[0].url), '연결된 링크가 옛 게시물이다: ' + JSON.stringify(db.updates[0]));
    ok(/깊은스윕/.test(r.locals.cronNote || ''), 'note 에 깊은 스윕이 보인다: ' + r.locals.cronNote);
  }

  console.log('\n=== 2. 커서가 이어달린다 (다음 회차가 같은 데를 또 안 판다) ===');
  {
    ok(fetchLog.some((u) => /after=CUR2/.test(u)), '저장돼 있던 커서에서 이어서 시작한다');
    ok(fetchLog.some((u) => !/after=/.test(u)), '최근 구간도 여전히 훑는다 (새 화보용)');
    ok(db.savedCursor && db.savedCursor.after === 'CUR3',
      '멈춘 자리(다음에 팔 곳)를 저장한다: ' + JSON.stringify(db.savedCursor));
    /* 남은 미연결이 0이 된 순간 멈춘다 — 2페이지를 채우려고 더 부르지 않는다.
       (붙일 게 없는데 Graph API 를 더 두드리는 건 그냥 비용이다) */
    ok(!fetchLog.some((u) => /after=CUR3/.test(u)), '다 붙였으면 그 회차는 거기서 멈춘다');
    ok(db.savedCursor.scanned > 400, '스캔 누계가 이어진다: ' + db.savedCursor.scanned);
  }

  console.log('\n=== 3. 아카이브 끝에 닿으면 되감는다 ===');
  {
    db.editorials = [{ id: 'e-x', title: 'NEVER MATCHED TITLE', slug: 'x' }];
    db.settings = { after: 'LAST', sweeps: 2, scanned: 900 };
    PAGES = {
      HEAD: { data: [post('최근', 'n1')], next: 'H2' },
      H2:   { data: [post('최근2', 'n2')], next: 'H3' },
      LAST: { data: [post('마지막 페이지', 'z1')], next: null },
    };
    const r = await run();
    eq(r.statusCode, 200, '200 으로 끝난다');
    eq(db.savedCursor.after, null, '끝까지 갔으면 커서를 비운다 (다음 회차는 최신부터)');
    eq(db.savedCursor.sweeps, 3, '한 바퀴 돌았음을 센다');
    ok(/아카이브 끝/.test(r.locals.cronNote || ''), 'note 가 한 바퀴 끝을 알린다: ' + r.locals.cronNote);
  }

  console.log('\n=== 3-b. 되감은 다음 회차는 정말 처음부터 판다 ===');
  {
    /* 커서를 '비웠다' 는 값 검사만으로는 부족하다. 비운 커서를 들고
       다음 회차가 실제로 최신부터 파는지까지 봐야 되감기가 완성이다. */
    db.settings = db.savedCursor;              // 3번이 저장한 것을 그대로 들고
    db.editorials = [{ id: 'e-y', title: 'SOIREE CHIC', slug: 'sc' }];
    PAGES = {
      HEAD: { data: [post('최근', 'n1')], next: 'H2' },
      H2:   { data: [post("'SOIREE CHIC' exclusive for @pap_magazine", 'h2')], next: 'H3' },
      H3:   { data: [post('세번째', 'n3')], next: 'H4' },
    };
    const r = await run();
    eq(db.updates.length, 1, '되감은 회차에서도 연결이 된다');
    ok(!fetchLog.some((u) => /after=LAST/.test(u)), '비운 커서로 옛 자리를 다시 파지 않는다');
    eq(r.statusCode, 200, '200 으로 끝난다');
  }

  console.log('\n=== 4. 연결할 게 없으면 API 를 더 쓰지 않는다 (비용) ===');
  {
    db.editorials = [{ id: 'e-1', title: 'PALE FIRE', slug: 'pale-fire' }];
    db.settings = { after: 'DEEP', sweeps: 0, scanned: 0 };
    PAGES = {
      HEAD: { data: [post("'PALE FIRE' exclusive for @pap_magazine", 'p1')], next: 'H2' },
      H2:   { data: [post('두번째', 'n2')], next: 'H3' },
      DEEP: { data: [post('여긴 안 와야 한다', 'd1')], next: 'D2' },
    };
    const r = await run();
    eq(db.updates.length, 1, '최근 구간에서 이미 붙였다');
    ok(!fetchLog.some((u) => /after=DEEP/.test(u)), '남은 미연결이 없으면 깊은 스윕을 건너뛴다');
    eq(db.savedCursor, undefined, '건너뛰었으면 커서도 안 건드린다');
  }

  console.log('\n=== 5. 커서가 비어 있어도(첫 실행) 죽지 않는다 ===');
  {
    db.editorials = [{ id: 'e-2', title: 'LADY IN RED', slug: 'lady' }];
    db.settings = null;   // 아직 저장된 적 없음
    PAGES = {
      HEAD: { data: [post('최근', 'n1')], next: 'H2' },
      H2:   { data: [post('최근2', 'n2')], next: 'H3' },
    };
    const r = await run();
    eq(r.statusCode, 200, '첫 실행도 200');
    ok(fetchLog.filter((u) => !/after=/.test(u)).length >= 2, '커서가 없으면 최신부터 판다');
  }

  console.log('\n=== 6. 연결은 여전히 빈 칸만 채운다 (덮어쓰기 금지) ===');
  {
    const src = require('fs').readFileSync(TARGET, 'utf8');
    ok(/\.update\(\{ source_instagram_url[\s\S]{0,200}\.is\('source_instagram_url', null\)/.test(src),
      'update 에 is(null) 이중 확인이 남아 있다 (이미 붙은 링크를 덮지 않는다)');
  }

  console.log(`\npassed: ${pass} failed: ${fail}`);
  if (fail) process.exit(1);
  console.log('✅ ig-link-deep-sweep tests passed');
})();
