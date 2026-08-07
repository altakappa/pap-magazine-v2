/*
 * cron-guard-4xx-note.test.js  (2026-08-07)
 *
 * 가드를 붙였는데도 안 보이던 구멍을 막는다.
 *
 * 예약 실행이 인증에 막히면 핸들러는 401 을 주고 조용히 끝난다.
 * cronGuard 는 5xx 만 실패로 보므로 cron_runs 에는 ok=true / note 빈칸이
 * 남는다 — 겉보기엔 매번 성공이다. '돌았다 ≠ 했다' 가 그대로 재현된다.
 * (celeb-classify 가 신설 첫날 정확히 이걸로 당했다.)
 *
 * 그래서 4xx 로 끝나면 note 를 강제로 남긴다. 실패로 올리지는 않는다 —
 * /api/cron/* 은 외부 스캐너도 두드리는 공개 경로라 알림이 노이즈가 된다.
 *
 * 이 테스트는 소스 문자열이 아니라 **실제 동작**을 본다. supabase·email·
 * telegram 을 가짜로 갈아끼워 cronGuard 를 그대로 실행하고, insert 로
 * 넘어간 값을 확인한다.
 */
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const GUARD = path.join(ROOT, 'api/_lib/cronGuard.js');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
function eq(a, b, m) { ok(a === b, m + `  (기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)})`); }

// ── 의존성 갈아끼우기 ────────────────────────────────────────────────
const inserted = [];
const alerts = [];
const fakeSupabase = {
  supabaseAdmin: {
    from() {
      return {
        insert(row) { inserted.push(row); return Promise.resolve({ error: null }); },
        select() { return this; },
        eq() { return this; },
        gte() { return this; },
        limit() { return Promise.resolve({ data: [] }); },  // 최근 알림 없음
      };
    },
  },
};
const orig = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === './supabase' || req === '../_lib/supabase') return fakeSupabase;
  if (req === './email') return { sendEmail: async () => { alerts.push('email'); return { ok: true }; } };
  if (req === './telegram') return { sendTextToTelegramPersonalSafe: async () => { alerts.push('tg'); return { ok: true }; } };
  return orig.apply(this, arguments);
};
delete require.cache[require.resolve(GUARD)];
const { withCronGuard } = require(GUARD);
Module._load = orig;

function fakeRes() {
  const res = {
    statusCode: 200, locals: {}, headersSent: false, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.headersSent = true; return this; },
  };
  return res;
}
async function run(handler) {
  inserted.length = 0; alerts.length = 0;
  const res = fakeRes();
  await withCronGuard('t-cron', handler)({ method: 'GET', headers: {} }, res);
  return { row: inserted[0] || null, res };
}

(async () => {
  console.log('\n=== 1. 401 로 끝나면 note 가 남는다 (핵심) ===');
  {
    const { row } = await run(async (req, res) => { res.status(401).json({ error: 'unauthorized' }); });
    ok(!!row, 'cron_runs 에 기록이 남는다');
    eq(row.ok, true, '4xx 는 실패로 올리지 않는다 (스캐너 노이즈 방지)');
    ok(/HTTP 401/.test(row.note || ''), 'note 에 상태코드가 남는다: ' + (row.note || '(빈칸)'));
    ok(/아무 일도 안 하고|인증/.test(row.note || ''), 'note 가 사람 말로 사유를 알려준다');
    eq(alerts.length, 0, '4xx 로는 알림을 보내지 않는다');
  }

  console.log('\n=== 2. 핸들러가 직접 남긴 note 는 덮어쓰지 않는다 ===');
  {
    const { row } = await run(async (req, res) => {
      res.locals = res.locals || {};
      res.locals.cronNote = '인증 거부 — 크론 시크릿도 관리자 세션도 아님';
      res.status(401).json({});
    });
    eq(row.note, '인증 거부 — 크론 시크릿도 관리자 세션도 아님', '핸들러 note 가 그대로 보존된다');
  }

  console.log('\n=== 3. 정상 경로는 그대로다 ===');
  {
    const { row } = await run(async (req, res) => {
      res.locals.cronNote = '3건 처리';
      res.status(200).json({ ok: true });
    });
    eq(row.ok, true, '200 은 성공');
    eq(row.note, '3건 처리', 'note 보존');
  }
  {
    const { row } = await run(async (req, res) => { res.status(200).json({ ok: true }); });
    eq(row.note, null, '200 인데 note 가 없으면 억지로 만들지 않는다');
  }

  console.log('\n=== 4. 5xx 는 여전히 실패다 ===');
  {
    const { row } = await run(async (req, res) => { res.status(500).json({ error: 'boom' }); });
    eq(row.ok, false, '5xx 는 실패로 기록');
    ok(/HTTP 500/.test(row.error || ''), 'error 에 사유가 남는다');
    ok(alerts.length > 0, '5xx 는 알림을 보낸다');
  }

  console.log('\n=== 5. 던진 예외도 여전히 실패다 ===');
  {
    const { row } = await run(async () => { throw new Error('터짐'); });
    eq(row.ok, false, '예외는 실패로 기록');
    ok(/터짐/.test(row.error || ''), 'error 에 메시지가 남는다');
  }

  console.log(`\npassed: ${pass} failed: ${fail}`);
  if (fail) process.exit(1);
  console.log('✅ cron-guard-4xx-note tests passed');
})();
