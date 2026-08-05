/**
 * 네이버 초안 — 큐 상한 · TTL 만료 · 최신 우선 (2026-08-05 신설)
 *
 * 왜 필요했나 — 14일 실측:
 *   생성 124건 / 발행 76건 → 하루 +3.4건씩 쌓여 대기 58건.
 *   가장 오래된 초안은 16일 묵었다. 네이버는 글쓰기 API 가 없어 붙여넣기가
 *   사람 손이라, 넘치는 만큼은 **처음부터 돈만 쓰고 버려지는 초안**이었다.
 *
 * 도메니코 지시(2026-08-05): 7일 만료 · 큐 차면 생성 중단 · 최신 기사부터.
 *
 * 여기서 지키는 것:
 *   ① 만료를 생성보다 **먼저** 돌 것 (자리를 비운 뒤 상한을 잰다)
 *   ② 만료는 DELETE 가 아니라 status='expired' UPDATE 일 것 (되돌릴 수 있게)
 *   ③ 만료는 status='draft' 인 것만 건드릴 것 (posted 를 지우면 대형 사고)
 *   ④ 큐가 상한 이상이면 생성 0건 + skipped='queue_full'
 *   ⑤ 상한까지 남은 자리보다 많이 만들지 말 것
 *   ⑥ TTL=0 이면 만료하지 않을 것 (끌 수 있어야 한다)
 *   ⑦ 선정 순서가 '최신부터'일 것 · NAVER_DRAFT_ORDER=oldest 로 복귀 가능
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CRON = path.join(ROOT, 'api', 'cron', 'naver-draft-sweep.js');
const ADMIN = path.join(ROOT, 'api', 'admin', 'naver-blog-draft.js');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}
function inject(p, exports) {
  const m = new Module(p, null);
  m.filename = p; m.loaded = true; m.exports = exports;
  require.cache[p] = m;
}

/* ── supabase 목 — 체인이 thenable 이라 실제 호출 순서를 기록한다 ────── */
function makeSupabase(state) {
  const calls = state.calls = [];
  return {
    from(table) {
      const ctx = { table, op: null, eq: {}, lt: null, payload: null, _done: false };
      let resolver = () => ({ data: null, error: null });
      const chain = {
        select(_col, opt) {
          if (opt && opt.head) { ctx.op = 'count'; resolver = () => ({ count: state.queue }); }
          else {
            const n = state.expirable || 0;
            resolver = () => ({ data: Array.from({ length: n }, (_, k) => ({ id: k + 1 })), error: null });
          }
          return chain;
        },
        update(payload) { ctx.op = 'update'; ctx.payload = payload; return chain; },
        delete() { ctx.op = 'delete'; return chain; },
        eq(k, v) { ctx.eq[k] = v; return chain; },
        lt(k, v) { ctx.lt = { k, v }; return chain; },
        then(onOk, onErr) {
          if (!ctx._done) { ctx._done = true; calls.push(ctx); }   // await 시점 = 실제 실행 순서
          try { return Promise.resolve(resolver()).then(onOk, onErr); }
          catch (e) { return Promise.reject(e).then(onOk, onErr); }
        },
      };
      return chain;
    },
  };
}

function loadCron(state, genImpl) {
  delete require.cache[CRON];
  inject(path.join(ROOT, 'api', '_lib', 'supabase.js'), { supabaseAdmin: makeSupabase(state) });
  inject(path.join(ROOT, 'api', '_lib', 'cronGuard.js'), { withCronGuard: (_n, h) => h });
  inject(ADMIN, { generateNext: genImpl });
  return require(CRON);
}

function runHandler(handler, env) {
  const saved = {};
  Object.keys(env).forEach((k) => { saved[k] = process.env[k]; process.env[k] = env[k]; });
  process.env.CRON_SECRET = 'S';
  const req = { headers: { authorization: 'Bearer S' } };
  let body = null;
  const res = { locals: {}, status() { return res; }, json(b) { body = b; return res; } };
  return handler(req, res).then(() => {
    Object.keys(saved).forEach((k) => {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    });
    return { body, note: res.locals.cronNote };
  });
}

(async function main() {
  console.log('[1] 만료 — 순서·방식·대상');
  {
    const state = { queue: 5, expirable: 3 };
    let made = 0;
    const cron = loadCron(state, async () => { made++; return { done: false, slug: 's' + made, draft: { title: 'T' } }; });
    const r = await runHandler(cron, { NAVER_DRAFT_TTL_DAYS: '7', NAVER_DRAFT_QUEUE_MAX: '30' });

    const ops = state.calls.map((c) => c.op);
    t('만료(update)가 큐 세기(count)보다 먼저 온다', ops.indexOf('update') >= 0 && ops.indexOf('update') < ops.indexOf('count'), ops);
    const up = state.calls.find((c) => c.op === 'update');
    t('DELETE 가 아니라 UPDATE 다', !ops.includes('delete'), ops);
    t("status='expired' 로 내린다", up && up.payload && up.payload.status === 'expired', up && up.payload);
    t("status='draft' 인 것만 대상", up && up.eq.status === 'draft', up && up.eq);
    t('brand/kind 로 좁힌다', up && up.eq.brand === 'pap' && up.eq.kind === 'article', up && up.eq);
    t('created_at 기준 cutoff 를 쓴다', !!(up && up.lt && up.lt.k === 'created_at'), up && up.lt);
    t('만료 건수가 응답에 실린다', r.body.expired === 3, r.body.expired);
    t('note 에 만료가 보인다', /만료 3건/.test(r.note), r.note);
  }

  console.log('[2] TTL=0 이면 만료하지 않는다');
  {
    const state = { queue: 5, expirable: 3 };
    const cron = loadCron(state, async () => ({ done: true }));
    const r = await runHandler(cron, { NAVER_DRAFT_TTL_DAYS: '0', NAVER_DRAFT_QUEUE_MAX: '30' });
    t('update 호출 없음', !state.calls.some((c) => c.op === 'update'), state.calls.map((c) => c.op));
    t('expired 0', r.body.expired === 0, r.body.expired);
  }

  console.log('[3] 큐 상한 — 가득 차면 생성을 건너뛴다');
  {
    const state = { queue: 30, expirable: 0 };
    let made = 0;
    const cron = loadCron(state, async () => { made++; return { done: false, slug: 'x', draft: { title: 'T' } }; });
    const r = await runHandler(cron, { NAVER_DRAFT_TTL_DAYS: '7', NAVER_DRAFT_QUEUE_MAX: '30' });
    t('생성 함수를 한 번도 안 부른다', made === 0, made);
    t("skipped='queue_full'", r.body.skipped === 'queue_full', r.body.skipped);
    t('note 에 상한 도달이 보인다', /상한 도달/.test(r.note), r.note);
  }

  console.log('[4] 상한까지 남은 자리만큼만 만든다');
  {
    const state = { queue: 28, expirable: 0 };   // 상한 30 → 남은 자리 2, 회당 상한 4
    let made = 0;
    const cron = loadCron(state, async () => { made++; return { done: false, slug: 'x' + made, draft: { title: 'T' } }; });
    const r = await runHandler(cron, { NAVER_DRAFT_TTL_DAYS: '7', NAVER_DRAFT_QUEUE_MAX: '30', NAVER_DRAFT_DAILY_MAX: '4' });
    t('4건이 아니라 2건만 만든다', made === 2, made);
    t('응답 generated 도 2', r.body.generated === 2, r.body.generated);
  }

  console.log('[5] 상한 여유가 충분하면 회당 상한(4건)까지 만든다');
  {
    const state = { queue: 0, expirable: 0 };
    let made = 0;
    const cron = loadCron(state, async () => { made++; return { done: false, slug: 'x' + made, draft: { title: 'T' } }; });
    await runHandler(cron, { NAVER_DRAFT_TTL_DAYS: '7', NAVER_DRAFT_QUEUE_MAX: '30', NAVER_DRAFT_DAILY_MAX: '4' });
    t('4건 만든다', made === 4, made);
  }

  console.log('[6] 선정 순서 — 소스에서 실제 식을 꺼내 평가한다');
  {
    const src = fs.readFileSync(ADMIN, 'utf8');
    const m = src.match(/const oldestFirst = ([^;]+);[\s\S]*?const next = ([^;]+);/);
    t('선정 식을 찾았다', !!m, m && m[2]);
    if (m) {
      const pick = new Function('process', 'pending',
        'const oldestFirst = ' + m[1] + '; const next = ' + m[2] + '; return next;');
      const pending = [{ slug: 'oldest' }, { slug: 'mid' }, { slug: 'newest' }]; // 발행 오름차순
      t('기본값은 최신부터', pick({ env: {} }, pending).slug === 'newest', pick({ env: {} }, pending));
      t('ORDER=oldest 면 옛 동작', pick({ env: { NAVER_DRAFT_ORDER: 'oldest' } }, pending).slug === 'oldest');
      t('대문자도 먹는다', pick({ env: { NAVER_DRAFT_ORDER: 'OLDEST' } }, pending).slug === 'oldest');
      t('1건뿐이면 그걸 고른다', pick({ env: {} }, [{ slug: 'only' }]).slug === 'only');
    }
  }

  console.log('\n' + (fail ? '✗' : '✓') + ' naver-draft-queue: ' + pass + ' passed / ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
