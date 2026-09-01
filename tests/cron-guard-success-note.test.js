/*
 * cron-guard-success-note.test.js  (2026-09-01)
 *
 * 막는 구멍: **성공했는데 뭘 했는지 모르는 상태.**
 * 2026-08-18 에 막은 건 실패 경로였고, 성공 경로는 그대로 백지였다.
 * 실측(7일): 17,839회 중 4,741회(26.6%)가 ok=true·note 빈칸, 크론 50개 중 15개는 100% 백지.
 * 그 백지 뒤에서 sync-pepperit 이 1,007회 중 1회 죽어 있었다(business_discovery 500).
 * 크론들은 이미 res.json({ imported: 0, message: '게시물 없음' }) 로 결과를 적어 보낸다 —
 * 가드가 heldBody 로 붙잡고도 버렸을 뿐이다. 여기서 꺼내 쓴다.
 * 소스 문자열이 아니라 **실제 동작**을 본다 (cron-guard-5xx-cause 와 같은 방식).
 */
'use strict';
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const GUARD = path.join(ROOT, 'api/_lib/cronGuard.js');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
function eq(a, b, m) { ok(a === b, m + `  (기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)})`); }

// ── 의존성 갈아끼우기 (시작 INSERT → 종료 UPDATE 를 반영하는 가짜 DB) ──
const rows = [];
const alerts = [];
let nextId = 1;
const fakeSupabase = {
  supabaseAdmin: {
    from() {
      const q = {
        _mode: null, _payload: null,
        insert(row) { q._mode = 'insert'; q._payload = Object.assign({ id: nextId++ }, row); rows.push(q._payload); return q; },
        update(patch) { q._mode = 'update'; q._payload = patch; return q; },
        select() { return q; },
        single() { return Promise.resolve({ data: { id: q._payload.id }, error: null }); },
        eq(_col, val) {
          if (q._mode === 'update') {
            const r = rows.find((x) => x.id === val);
            if (r) Object.assign(r, q._payload);
            return Promise.resolve({ error: null });
          }
          return q;
        },
        not() { return q; },
        gte() { return q; },
        limit() { return Promise.resolve({ data: [] }); },
        then(onOk) { return Promise.resolve({ error: null }).then(onOk); },
      };
      return q;
    },
  },
};
const orig = Module._load;
Module._load = function (req) {
  if (req === './supabase' || req === '../_lib/supabase') return fakeSupabase;
  if (req === './email') return { sendEmail: async () => { alerts.push('email'); return { ok: true }; } };
  if (req === './telegram') return { sendTextToTelegramPersonalSafe: async (m) => { alerts.push(String(m || '')); return { ok: true }; } };
  return orig.apply(this, arguments);
};
delete require.cache[require.resolve(GUARD)];
const { withCronGuard } = require(GUARD);
Module._load = orig;

function fakeRes() {
  return {
    statusCode: 200, locals: {}, headersSent: false, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.headersSent = true; return this; },
  };
}
async function run(handler) {
  rows.length = 0; alerts.length = 0;
  const res = fakeRes();
  await withCronGuard('t-cron', handler)({ method: 'GET', headers: {} }, res);
  return { row: rows[0] || null, rowCount: rows.length, res };
}

(async () => {
  console.log('\n=== 1. 백지였던 크론들이 실제로 말을 하기 시작한다 (핵심) ===');
  {
    // sync-pepperit 가 실제로 내보내는 모양 — 7일간 1,006회가 이 모양으로 백지였다
    const { row } = await run(async (req, res) => {
      res.status(200).json({ imported: 0, message: '게시물 없음.' });
    });
    eq(row.ok, true, '200 은 성공 그대로');
    ok(!!row.note, 'note 가 더 이상 비어 있지 않다: ' + JSON.stringify(row.note));
    ok(/자동요약/.test(row.note || ''), '대타가 채웠다는 표식이 있다 (나중에 세어 판정할 근거)');
    ok(/imported 0/.test(row.note || ''), '숫자 결과가 남는다');
    ok(/게시물 없음/.test(row.note || ''), '사람이 읽을 문장이 남는다');
  }
  {
    // send-due-campaigns
    const { row } = await run(async (req, res) => {
      res.status(200).json({ processed: 3, summary: '3건 발송' });
    });
    ok(/processed 3/.test(row.note || ''), 'processed 가 보인다: ' + row.note);
  }
  {
    // sync-pepperit 의 다른 갈래 — 본문이 통째로 배열
    const { row } = await run(async (req, res) => {
      res.status(200).json([{ a: 1 }, { a: 2 }, { a: 3 }]);
    });
    ok(/3건/.test(row.note || ''), '배열 본문은 건수로 요약된다: ' + row.note);
  }

  console.log('\n=== 2. 핸들러가 쓴 문장이 언제나 우선이다 (대타는 대타다) ===');
  {
    const { row } = await run(async (req, res) => {
      res.locals.cronNote = '3건 처리';
      res.status(200).json({ imported: 99, message: '엉뚱한 문장' });
    });
    eq(row.note, '3건 처리', '핸들러 note 를 덮어쓰지 않는다');
    ok(!/자동요약/.test(row.note || ''), '대타 표식이 붙지 않는다');
  }
  {
    // threads-post 는 본문에 note 를 적어 보낸다 — 가공하지 말고 그대로
    const { row } = await run(async (req, res) => {
      res.status(200).json({ ok: true, note: '게시할 기사 없음', articles_found: 0 });
    });
    ok(/게시할 기사 없음/.test(row.note || ''), '본문 note 를 그대로 쓴다: ' + row.note);
    ok(!/articles_found/.test(row.note || ''), '사람이 쓴 문장이 있으면 키·값을 덧붙이지 않는다');
  }

  console.log('\n=== 3. 기존 계약 회귀 금지 ===');
  {
    const { row } = await run(async (req, res) => { res.status(401).json({ error: 'unauthorized' }); });
    eq(row.ok, true, '4xx 는 여전히 실패로 안 올린다');
    ok(/인증 거부일 가능성/.test(row.note || ''), '2026-08-07 4xx 문장 유지: ' + row.note);
    ok(!/자동요약/.test(row.note || ''), '4xx 를 대타가 가로채지 않는다');
  }
  {
    const { row } = await run(async (req, res) => {
      res.status(502).json({ error: 'upload failed', detail: 'quotaExceeded' });
    });
    eq(row.ok, false, '5xx 는 여전히 실패');
    ok(/quotaExceeded/.test(row.error || ''), '2026-08-18 5xx 사유 유지');
    ok(!/자동요약/.test(row.note || ''), '5xx 를 대타가 가로채지 않는다');
  }
  {
    const { row } = await run(async () => { throw new Error('터짐'); });
    eq(row.ok, false, '예외는 실패');
    ok(!/자동요약/.test(row.note || ''), '예외 경로에 대타가 끼어들지 않는다');
  }
  {
    const { row, res } = await run(async (req, res) => { res.status(200).json({ n: 7 }); });
    ok(res.body && res.body.n === 7, '응답 본문은 그대로 호출자에게 나간다 (붙잡아 뒀다가 보낸다)');
  }

  console.log('\n=== 4. 경계값 — 없는 정보를 지어내지 않는다 ===');
  {
    const { row } = await run(async (req, res) => { res.status(200).json({}); });
    ok(!row.note, '빈 본문이면 억지로 채우지 않는다 (빈칸이 정직하다): ' + JSON.stringify(row.note));
  }
  {
    const { row } = await run(async (req, res) => { res.status(200).json({ ok: true }); });
    ok(!row.note, 'ok:true 하나뿐이면 정보가 0 이라 안 적는다: ' + JSON.stringify(row.note));
  }
  {
    // res.json 을 안 쓰는 크론(res.end 류) — 붙잡은 본문이 없다
    const { row } = await run(async (req, res) => { res.statusCode = 200; });
    ok(!row.note, '본문이 없으면 조용히 비운다 (터지지 않는다)');
    eq(row.ok, true, '성공 기록은 정상');
  }
  {
    // 중첩 객체만 있는 본문 — JSON 덩어리를 note 에 쏟지 않는다
    const { row } = await run(async (req, res) => {
      res.status(200).json({ report: { a: 1, b: { c: 2 } } });
    });
    ok(!/\{/.test(row.note || ''), 'JSON 덩어리를 note 에 넣지 않는다: ' + JSON.stringify(row.note));
  }
  {
    // 길이 상한 — DB 컬럼(500)과 가독성을 지킨다
    const { row } = await run(async (req, res) => {
      const big = {};
      for (let i = 0; i < 200; i++) big['k' + i] = i;
      res.status(200).json(big);
    });
    ok((row.note || '').length <= 340, 'note 가 무한정 길어지지 않는다: ' + (row.note || '').length + '자');
  }
  {
    // 긴 id·url 문자열은 소음이다 — 산문 키가 아니면 자른다
    const { row } = await run(async (req, res) => {
      res.status(200).json({ thread_id: 'x'.repeat(200), posted: 2 });
    });
    ok(!/xxxxxxxxxx/.test(row.note || ''), '긴 식별자를 note 에 쏟지 않는다: ' + row.note);
    ok(/posted 2/.test(row.note || ''), '그 옆의 진짜 결과는 살린다');
  }
  {
    // false 는 '안 했다' 라 자리를 안 준다 / true 는 남긴다
    const { row } = await run(async (req, res) => { res.status(200).json({ dry: true, sent: false, n: 1 }); });
    ok(/dry/.test(row.note || ''), 'true 인 플래그는 남는다: ' + row.note);
    ok(!/sent/.test(row.note || ''), 'false 인 플래그는 자리를 안 준다');
  }

  {
    // 비밀은 로그에 남기지 않는다 — 한번 새면 되돌릴 수 없다
    const { row } = await run(async (req, res) => {
      res.status(200).json({ access_token: 'ya29.SECRETVALUE', api_key: 'sk-live-1', posted: 1 });
    });
    ok(!/SECRETVALUE|sk-live/.test(row.note || ''), '토큰·키를 note 에 적지 않는다: ' + row.note);
    ok(/posted 1/.test(row.note || ''), '그 옆의 진짜 결과는 살린다');
  }

  console.log(`\npassed: ${pass} failed: ${fail}`);
  if (fail) process.exit(1);
  console.log('✅ cron-guard-success-note tests passed');
})();
