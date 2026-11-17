/**
 * OpenAI 크레딧 소진이 '0건' 에 묻히지 않게 (2026-11-17 화요일 견고화).
 *
 * 사고: 11/02~11/17 임베딩 0건·SoV chatgpt 칸 100% 'openai 429' 가 ok=true 로 쌓였다.
 * 원인은 OpenAI 크레딧 소진(429 insufficient_quota). 감시는 Anthropic 만 봤고 429 를 rate 로 읽었다.
 *
 * 지키는 것:
 *   ① OpenAI 의 429 크레딧 본문은 credit — 진짜 레이트리밋은 여전히 rate
 *   ② 공급자별 쿨다운 칸 분리 (OpenAI 알림이 Anthropic 칸을 먹지 않는다)
 *   ③ embed() 는 여전히 null 로 폴백하되, 실패 종류를 남기고 감시에 알린다
 *   ④ 크론은 계정 고장(credit·auth)이면 첫 실패에서 멈추고 note 에 사유 (network 는 안 멈춤)
 *   ⑤ SoV 사유 딱지가 'openai 429 credit' 로 갈린다 (종전 딱지 보존)
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service';

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

// 2026-11-17 Vercel 런타임 로그 실측 본문 (들여쓰기까지 그대로)
const REAL_OPENAI_CREDIT = '{\n    "error": {\n        "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",\n        "type": "insufficient_quota",\n        "param": null,\n        "code": "credit_balance_exhausted"\n    }\n}';
const REAL_OPENAI_RATE = '{"error":{"message":"Rate limit reached for text-embedding-3-small","type":"requests","code":"rate_limit_exceeded"}}';

const W = require(path.join(ROOT, 'api/_lib/aiCreditWatch'));

console.log('\n=== ① 판정 ===');
t('OpenAI 429 크레딧 본문 → credit', W.classifyAiFailure(429, REAL_OPENAI_CREDIT) === 'credit');
t('본문 앞 200자만 와도 credit (문구가 앞에 있다)', W.classifyAiFailure(429, REAL_OPENAI_CREDIT.slice(0, 200)) === 'credit');
t('insufficient_quota 만 있어도 credit', W.classifyAiFailure(429, '{"error":{"type":"insufficient_quota"}}') === 'credit');
t('진짜 레이트리밋은 여전히 rate', W.classifyAiFailure(429, REAL_OPENAI_RATE) === 'rate');
t('본문 없는 429 는 rate (종전 동작)', W.classifyAiFailure(429, '') === 'rate');
t('Anthropic 크레딧 문구는 그대로 credit', W.classifyAiFailure(400, 'Your credit balance is too low to access the Anthropic API.') === 'credit');
t('일시적 500 은 여전히 무시', W.classifyAiFailure(500, 'server error') === null);

console.log('=== ② 쿨다운 칸 분리 ===');
t('OpenAI 칸이 따로 있다', W.OPENAI_ALERT_KEY && W.OPENAI_ALERT_KEY !== W.ALERT_KEY, W.OPENAI_ALERT_KEY);
t('Anthropic 칸 이름은 그대로 (기존 상태 행 유지)', W.ALERT_KEY === 'anthropic-api-health');

/* ── 감시를 가짜로 바꿔 끼운다 (판정은 진짜, 알림만 기록) ── */
const watchPath = require.resolve(path.join(ROOT, 'api/_lib/aiCreditWatch'));
const reports = [];
require.cache[watchPath].exports = Object.assign({}, W, {
  reportAiFailure: async (status, body, where, provider) => { reports.push({ status, where, provider, kind: W.classifyAiFailure(status, body) }); return { kind: null, alerted: false }; },
});

/* supabase 가짜 — 체인 어디서 끝나도 await 하면 결과가 나온다 */
function chain(result) {
  const c = {};
  for (const k of ['select', 'eq', 'is', 'order', 'limit', 'update']) c[k] = () => c;
  c.then = (res, rej) => Promise.resolve(result).then(res, rej);
  return c;
}
const supaPath = require.resolve(path.join(ROOT, 'api/_lib/supabase'));
let QUEUE = { editorials: [], articles: [] };
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { supabaseAdmin: {
  from: (table) => ({
    select: (_cols, opts) => (opts && opts.head)
      ? chain({ count: QUEUE[table].length, error: null })
      : chain({ data: QUEUE[table], error: null }),
    update: () => chain({ error: null }),
  }),
} } };
/* cronGuard 는 통과시킨다 — 여기서 보는 건 핸들러의 note 다 */
const guardPath = require.resolve(path.join(ROOT, 'api/_lib/cronGuard'));
require.cache[guardPath] = { id: guardPath, filename: guardPath, loaded: true, exports: { withCronGuard: (_n, h) => h } };

const E = require(path.join(ROOT, 'api/_lib/embeddings'));
const origFetch = global.fetch;
let fetchCalls = 0;
function fakeFetch(mode) {
  return async () => {
    fetchCalls += 1;
    if (mode === 'credit') return { ok: false, status: 429, text: async () => REAL_OPENAI_CREDIT };
    if (mode === 'network') throw new Error('fetch failed ECONNRESET');
    return { ok: true, status: 200, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.1) }] }) };
  };
}

(async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  console.log('=== ③ embed() 실패 종류 기록 ===');
  global.fetch = fakeFetch('credit');
  t('크레딧 소진이어도 null 폴백 (호출부 약속 유지)', (await E.embed('hello')) === null);
  t('실패 종류 credit 이 남는다', E.lastEmbedFailure() && E.lastEmbedFailure().kind === 'credit', E.lastEmbedFailure());
  t('계정 고장으로 판정', E.isFatalEmbedFailure(E.lastEmbedFailure()) === true);
  t('감시에 openai 공급자로 알렸다', reports.length === 1 && reports[0].provider === 'openai' && reports[0].where === 'embeddings', reports);
  global.fetch = fakeFetch('ok');
  const v = await E.embed('hello');
  t('성공하면 지난 실패를 지운다', Array.isArray(v) && E.lastEmbedFailure() === null);
  global.fetch = fakeFetch('network');
  await E.embed('hello');
  t('네트워크 실패는 network · 계정 고장 아님', E.lastEmbedFailure().kind === 'network' && !E.isFatalEmbedFailure(E.lastEmbedFailure()));
  t('null·빈 값은 계정 고장 아님', !E.isFatalEmbedFailure(null) && !E.isFatalEmbedFailure({ kind: 'rate' }));

  console.log('=== ④ 크론: 계정 고장이면 멈추고 사유를 싣는다 ===');
  process.env.CRON_SECRET = 'cron-test';
  const cron = require(path.join(ROOT, 'api/cron/backfill-embeddings'));
  async function run() {
    const res = { locals: {}, statusCode: 200, body: null,
      status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await cron({ method: 'GET', headers: { authorization: 'Bearer cron-test' } }, res);
    return res;
  }
  const ed = (i) => ({ id: 'ed-' + i, title: 'T' + i, description: 'd', tags: [] });
  const art = (i) => ({ id: 'art-' + i, title: 'A' + i, content: 'body' });
  QUEUE = { editorials: [ed(1), ed(2), ed(3)], articles: [art(1), art(2)] };
  global.fetch = fakeFetch('credit'); fetchCalls = 0;
  let r = await run();
  const n = r.locals.cronNote || '';
  t('첫 실패에서 멈춘다 (5건 대기인데 OpenAI 호출 1번)', fetchCalls === 1, fetchCalls);
  t('note 에 사유 딱지', /\[openai 429 크레딧 소진\]/.test(n), n);
  t('note 에 중단 표시와 남은 대기', /계정 고장이라 이번 회차 중단\(남은 대기 5\)/.test(n), n);
  t('응답에 failure·halted', r.body.halted === true && r.body.failure && r.body.failure.kind === 'credit');
  t('HTTP 200 유지 (알림은 감시가 따로 — 이중 알림 방지)', r.statusCode === 200);

  global.fetch = fakeFetch('network'); fetchCalls = 0;
  r = await run();
  t('네트워크 실패는 멈추지 않는다 (5건 전부 시도)', fetchCalls === 5, fetchCalls);
  t('네트워크 사유도 note 에', /\[openai - 네트워크\]/.test(r.locals.cronNote), r.locals.cronNote);
  t('halted=false', r.body.halted === false);

  global.fetch = fakeFetch('ok'); fetchCalls = 0;
  r = await run();
  t('정상이면 사유 딱지 없음 (종전 note 모양)', /^임베딩 5건 \(에디토리얼 3 · 기사 2\)/.test(r.locals.cronNote) && !/\[/.test(r.locals.cronNote), r.locals.cronNote);

  QUEUE = { editorials: [], articles: [] };
  r = await run();
  t('대기 없으면 종전대로 완주', r.locals.cronNote === '임베딩 대기 없음 — 완주', r.locals.cronNote);

  console.log('=== ⑤ SoV 사유 딱지 ===');
  delete require.cache[supaPath];
  const V = require(path.join(ROOT, 'api/_lib/aiVisibility'));
  t('openai 429 credit 은 credit 까지 딱지에', V.reasonOf('openai 429 credit (경과 1초/예산 55초)') === 'openai 429 credit', V.reasonOf('openai 429 credit (경과 1초/예산 55초)'));
  t('종류 없는 429 는 종전 딱지', V.reasonOf('openai 429 (경과 1초)') === 'openai 429');
  t('anthropic 딱지 보존', V.reasonOf('anthropic 429 (경과 3초)') === 'anthropic 429');

  // 프로브 실제 경로: 429 크레딧 본문 → 행 error 가 'openai 429 credit' 으로 남는다
  const inserted = [];
  require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { supabaseAdmin: {
    from: () => ({ insert: async (rows) => { inserted.push(...rows); return { error: null }; } }) } } };
  reports.length = 0;
  global.fetch = async () => ({ ok: false, status: 429, text: async () => REAL_OPENAI_CREDIT, json: async () => ({}) });
  try {
    await V.runSovProbe({ probes: V.PROBES.slice(0, 1), engines: ['chatgpt'], timeoutMs: 60000 });
  } catch (_) { /* 반환 모양은 여기서 안 본다 */ }
  const errs = inserted.map((x) => x.error).filter(Boolean);
  t('프로브 행 error 가 openai 429 credit', errs.length > 0 && errs.every((e) => /^openai 429 credit/.test(e)), errs);
  let stateReads = 0; require.cache[supaPath].exports = { supabaseAdmin: { from: () => { stateReads += 1; return {}; } } };
  await Promise.all([1, 2, 3].map(() => W.reportAiFailure(429, REAL_OPENAI_CREDIT, 'x', 'openai'))); // 진짜 감시
  t('동시 실패 3건이어도 알림 시도는 1번 (프로세스 메모)', stateReads === 1, stateReads);
  t('프로브도 감시에 openai 로 알렸다', reports.some((x) => x.where === 'ai-sov-probe' && x.provider === 'openai' && x.kind === 'credit'), reports);

  global.fetch = origFetch;
  console.log(`\n${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { global.fetch = origFetch; console.error(e); process.exit(1); });
