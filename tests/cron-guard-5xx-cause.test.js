/*
 * cron-guard-5xx-cause.test.js  (2026-08-18)
 *
 * 막는 구멍: **실패한 건 아는데 왜 실패했는지는 모르는 상태.**
 *
 * 실측 — drive-youtube-post 가 2026-08-15~08-18 에 38회 연속 죽었다.
 * cron_runs 에 남은 문장은 매번 이것 하나뿐이었다:
 *
 *   HTTP 500 (핸들러가 예외를 자체 처리하고 5xx 반환)
 *
 * 상태코드는 있는데 사유가 없다. 사흘을 눈먼 채로 보냈다.
 * 그런데 핸들러는 사유를 분명히 적어 보내고 있었다 —
 *   res.status(502).json({ error: 'upload failed', detail: '...' })
 * 가드가 그 본문(heldBody)을 손에 쥐고도 버렸을 뿐이다.
 *
 * 이 테스트는 소스 문자열이 아니라 **실제 동작**을 본다. supabase·email·
 * telegram 을 가짜로 갈아끼워 cronGuard 를 그대로 돌리고, cron_runs 로
 * 넘어간 최종 값을 확인한다. (cron-guard-4xx-note.test.js 와 같은 방식)
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
  console.log('\n=== 1. 자체 처리 5xx — 본문의 사유가 기록에 남는다 (핵심) ===');
  {
    // drive-youtube-post 가 실제로 내보내는 모양
    const { row } = await run(async (req, res) => {
      res.status(502).json({ ok: false, error: 'upload failed', file: 'a.mp4', detail: 'quotaExceeded: youtube upload limit' });
    });
    eq(row.ok, false, '5xx 는 실패로 기록');
    ok(/HTTP 502/.test(row.error || ''), '상태코드는 그대로 남는다: ' + (row.error || ''));
    ok(/upload failed/.test(row.error || ''), 'error 키의 사유가 남는다');
    ok(/quotaExceeded/.test(row.error || ''), 'detail 키의 진짜 원인이 남는다 — 이게 없으면 사흘을 또 눈먼 채로 보낸다');
  }

  console.log('\n=== 2. 알림에도 같은 사유가 실린다 ===');
  {
    const { row } = await run(async (req, res) => {
      res.status(500).json({ error: 'drive youtube cron failed', detail: 'invalid_grant' });
    });
    ok(row.ok === false, '실패로 기록');
    ok(alerts.some((a) => /invalid_grant/.test(a)), '텔레그램 알림 본문에 원인이 들어간다');
  }

  console.log('\n=== 3. 본문이 비어 있으면 종전 문장 그대로 (회귀 금지) ===');
  {
    const { row } = await run(async (req, res) => { res.status(500).json({}); });
    eq(row.ok, false, '실패로 기록');
    ok(/HTTP 500 \(핸들러가 예외를 자체 처리하고 5xx 반환\)$/.test(row.error || ''),
      '붙일 사유가 없으면 군더더기를 만들지 않는다: ' + (row.error || ''));
  }
  {
    // res.json 을 아예 안 쓰는 크론(res.end 류) — 본문을 붙잡지 못한다
    const { row } = await run(async (req, res) => { res.statusCode = 503; });
    eq(row.ok, false, 'json 없이 5xx 도 실패로 기록');
    ok(/HTTP 503/.test(row.error || ''), '상태코드만이라도 남는다');
  }

  console.log('\n=== 4. 던진 예외의 메시지를 사유로 덮어쓰지 않는다 ===');
  {
    // 가드 자신이 500 본문을 만들어 보내지만, 원본 예외 메시지가 우선이다
    const { row } = await run(async () => { throw new Error('터짐: 스키마 불일치'); });
    eq(row.ok, false, '예외는 실패로 기록');
    ok(/터짐: 스키마 불일치/.test(row.error || ''), '예외 메시지가 그대로 남는다');
    ok(!/^HTTP /.test(row.error || ''), '가드가 만든 HTTP 문장으로 갈아치우지 않는다: ' + (row.error || ''));
  }

  console.log('\n=== 5. 4xx — 종전 문장 + 사유 (기존 계약 유지) ===');
  {
    const { row } = await run(async (req, res) => { res.status(401).json({ error: 'unauthorized' }); });
    eq(row.ok, true, '4xx 는 실패로 올리지 않는다 (스캐너 노이즈 방지)');
    ok(/HTTP 401/.test(row.note || ''), '상태코드가 남는다');
    ok(/아무 일도 안 하고|인증/.test(row.note || ''), '2026-08-07 계약 문장이 남아 있다');
    ok(/unauthorized/.test(row.note || ''), '본문 사유도 함께 남는다: ' + (row.note || ''));
    eq(alerts.length, 0, '4xx 로는 알림을 보내지 않는다');
  }
  {
    const { row } = await run(async (req, res) => {
      res.locals = res.locals || {};
      res.locals.cronNote = '인증 거부 — 크론 시크릿도 관리자 세션도 아님';
      res.status(401).json({ error: 'unauthorized' });
    });
    eq(row.note, '인증 거부 — 크론 시크릿도 관리자 세션도 아님', '핸들러가 직접 쓴 note 는 건드리지 않는다');
  }

  console.log('\n=== 6. 정상 경로 무변화 ===');
  {
    const { row, res } = await run(async (req, res) => {
      res.locals.cronNote = '3건 처리';
      res.status(200).json({ ok: true, n: 3 });
    });
    eq(row.ok, true, '200 은 성공');
    eq(row.note, '3건 처리', 'note 보존');
    eq(row.error, null, 'error 없음');
    ok(res.body && res.body.n === 3, '응답 본문은 그대로 호출자에게 나간다 (붙잡아 뒀다가 보낸다)');
  }

  console.log('\n=== 7. 사유 추출기의 경계값 ===');
  {
    // 길이 상한 — DB 컬럼과 알림을 지킨다
    /* 상한은 _bodyCause 안에서 300자다. _logRun 의 800자 자르기에 기대면
       상한을 지워도 테스트가 안 죽는다 — 그래서 380자로 조인다. */
    const long = 'x'.repeat(1000);
    const { row } = await run(async (req, res) => { res.status(500).json({ detail: long }); });
    ok((row.error || '').length <= 380, 'error 가 무한정 길어지지 않는다: ' + (row.error || '').length + '자');
    ok(/xxxx/.test(row.error || ''), '그래도 사유의 앞부분은 보인다');
  }
  {
    // error 와 message 가 같은 문장 — 두 번 적지 않는다
    const { row } = await run(async (req, res) => { res.status(500).json({ error: 'boom', message: 'boom' }); });
    const hits = (row.error || '').split('boom').length - 1;
    eq(hits, 1, '같은 문장을 중복해서 적지 않는다: ' + (row.error || ''));
  }
  {
    // 아는 키가 하나도 없는 본문 — 통째로라도 남긴다
    const { row } = await run(async (req, res) => { res.status(500).json({ weird: 'nope', code: 7 }); });
    ok(/weird/.test(row.error || ''), '모르는 모양의 본문도 버리지 않는다: ' + (row.error || ''));
  }
  {
    /* 크론들은 { ok: false, error: ... } 를 쓴다. 불리언이 사유 자리에 들어오면
       'false' 라는 쓸모없는 단어가 원인 앞에 붙는다. 문자열만 사유다. */
    const { row } = await run(async (req, res) => { res.status(500).json({ error: false, detail: 'token expired' }); });
    ok(!/false/.test(row.error || ''), '불리언을 사유 문장으로 쓰지 않는다: ' + (row.error || ''));
    ok(/token expired/.test(row.error || ''), '그 옆의 진짜 사유는 살린다');
  }
  {
    const { row } = await run(async (req, res) => { res.status(500).json({ ok: false }); });
    ok(/HTTP 500/.test(row.error || ''), '사유로 쓸 문자열이 없어도 상태코드는 남는다: ' + (row.error || ''));
  }

  console.log(`\npassed: ${pass} failed: ${fail}`);
  if (fail) process.exit(1);
  console.log('✅ cron-guard-5xx-cause tests passed');
})();
