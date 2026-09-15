/**
 * SoV 프로브 — 검색 콜 상한·순서·경과 기록 (2026-09-15 화요일 견고화)
 *
 * 실측(회차 3번 전부 같은 모양): claude/search 8칸 중 4·4·6칸이
 * 'The operation was aborted due to timeout' 로 죽었다. 그런데 같은 회차의
 * 총 실행시간은 133·120·139초이고 **예산은 270초**다 — 137초를 안 쓰고 남기면서
 * 콜은 100초에서 잘렸다. 예산이 모자란 게 아니라 **배치형 상한을 배치 아닌 일에
 * 빌려 쓴 것**이다 (SoV 는 질문 하나 = 답 하나라 줄일 배치가 없다).
 *
 * 지키는 것 — 되돌리면 그때 그 자리로 돌아간다: ①상한이 문턱보다 크고 예산
 * 안이다 ②문턱 100초는 그대로(못 끝낼 콜을 시작해 돈만 태우지 않는다)
 * ③budgetFor 는 남은 시간을 안 넘는다 ④느린 검색을 먼저 돈다(뒤면 굶는다)
 * ⑤실패 행에 경과/예산이 남는다(상한 부족인지 매달림인지 가르는 유일한 근거)
 * ⑥note 가 실패를 개수 아닌 사유로 적는다 ⑦실패한 칸을 빼지 않는다
 *
 * analyze 처럼 **실제로 돌려서** 검사한다 — fetch·supabase 를 가짜로 끼우고
 * runSovProbe 를 진짜 실행한다. 정규식으로 코드를 훑는 것보다 강하다.
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const vercel = JSON.parse(rd('vercel.json'));
const cron = rd('api/cron/ai-sov-probe.js');

const B = require('../api/_lib/callBudget.js');

/* 크론 예산은 코드에서 읽는다 — 여기 또 적으면 규칙이 두 벌이 된다(교훈 2). */
const budgetMs = Number((cron.match(/runSovProbe\(\{\s*timeoutMs:\s*(\d+)/) || [])[1] || 0);
const maxDuration = ((vercel.functions || {})['api/cron/ai-sov-probe.js'] || {}).maxDuration;

console.log('=== ① 검색 콜 상한 (배치형 상한을 빌려 쓰지 않는다) ===');
t('크론 예산을 코드에서 읽어 왔다', budgetMs > 0, budgetMs);
t('검색 상한이 문턱보다 크고 옛 100초보다 크다 (되돌리면 시작한 콜이 반드시 죽는다)',
  B.capFor('ai-search') > B.floorFor('ai-search') && B.capFor('ai-search') > 100000,
  B.capFor('ai-search') + ' vs ' + B.floorFor('ai-search'));
t('상한 + 마무리 여유가 크론 예산 안에 들어간다',
  B.capFor('ai-search') + B.RESERVE_MS <= budgetMs,
  B.capFor('ai-search') + '+' + B.RESERVE_MS + ' vs ' + budgetMs);
t('크론 예산이 maxDuration 보다 작다 (여유를 남긴다)',
  maxDuration * 1000 > budgetMs, maxDuration + 's vs ' + budgetMs + 'ms');
/* 상한을 예산 끝까지 올리면 한 콜이 회차를 통째로 삼킨다. */
t('한 콜이 예산의 80% 를 넘게 가져가지 않는다',
  B.capFor('ai-search') <= budgetMs * 0.8, B.capFor('ai-search') + ' / ' + budgetMs);

console.log('\n=== ②③ 문턱은 그대로 · 예산은 남은 시간을 안 넘는다 ===');
{
  const now = 1000000;
  t('검색 문턱이 일반 ai 보다 높다', B.floorFor('ai-search') > B.floorFor('ai'));
  t('99초 남으면 시작 안 한다 · 100초면 시작한다',
    B.canStart(now + 99000, 'ai-search', now) === false
    && B.canStart(now + 100000, 'ai-search', now) === true);
  for (const left of [100000, 200000, 600000]) {
    const got = B.budgetFor(now + left, 'ai-search', now);
    t('남은 ' + left / 1000 + '초 → 예산 ' + got / 1000 + '초 (남은 시간·상한 이하)',
      got <= left && got <= B.capFor('ai-search'), got);
  }
}

/* fetch·supabase 를 가짜로 끼운다. 키가 없으면 엔진이 통째로 건너뛰어진다. */
function withFakes(plan, fn) {
  const origFetch = global.fetch;
  const origA = process.env.ANTHROPIC_API_KEY;
  const origO = process.env.OPENAI_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.OPENAI_API_KEY = 'test-key';

  const calls = [];
  global.fetch = function (url, opts) {
    const body = JSON.parse(opts.body);
    const engine = /anthropic/.test(url) ? 'claude' : 'chatgpt';
    const searchMode = Array.isArray(body.tools) && body.tools.length > 0;
    calls.push({ engine, mode: searchMode ? 'search' : 'pretrain' });
    return plan({ engine, mode: searchMode ? 'search' : 'pretrain' });
  };

  // supabase 는 지연 로드라 require.cache 에 가짜를 꽂으면 된다.
  const supaPath = require.resolve('../api/_lib/supabase.js');
  const origMod = require.cache[supaPath];
  const inserted = [];
  require.cache[supaPath] = {
    id: supaPath, filename: supaPath, loaded: true, exports: {
      supabaseAdmin: { from: () => ({ insert: async (rows) => { inserted.push(...rows); return { error: null }; } }) },
    },
  };

  return Promise.resolve()
    .then(() => fn({ calls, inserted }))
    .finally(() => {
      global.fetch = origFetch;
      if (origA === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = origA;
      if (origO === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = origO;
      if (origMod) require.cache[supaPath] = origMod; else delete require.cache[supaPath];
    });
}

function okClaude() {
  return { ok: true, status: 200, json: async () => ({ content: [
    { type: 'web_search_tool_result', content: [] },
    { type: 'text', text: 'PAP MAGAZINE 은 서울 기반 디지털 패션 매거진입니다.', citations: [] },
  ] }) };
}
function okOpenAi() {
  return { ok: true, status: 200, json: async () => ({ output: [
    { type: 'web_search_call' },
    { type: 'message', content: [{ text: 'Dazed Korea 를 보세요.', annotations: [] }] },
  ] }) };
}
function timeoutErr() {
  const e = new Error('The operation was aborted due to timeout');
  e.name = 'TimeoutError';
  return Promise.reject(e);
}

const V = require('../api/_lib/aiVisibility.js');
const PROBES2 = [
  { key: 'q1', lang: 'ko', q: '질문 하나' },
  { key: 'q2', lang: 'en', q: 'question two' },
];

(async function main() {
  console.log('\n=== ④ 느린 검색 모드를 먼저 돈다 (뒤에 깔면 굶는다) ===');
  await withFakes(
    ({ engine }) => Promise.resolve(engine === 'claude' ? okClaude() : okOpenAi()),
    async ({ calls }) => {
      await V.runSovProbe({ timeoutMs: budgetMs, probes: PROBES2, concurrency: 1 });
      const firstPretrain = calls.findIndex((c) => c.mode === 'pretrain');
      const lastSearch = calls.map((c) => c.mode).lastIndexOf('search');
      t('검색 칸이 전부 학습 칸보다 먼저 시작된다',
        firstPretrain > lastSearch, JSON.stringify(calls.map((c) => c.mode)));
      t('그래도 모든 조합을 다 돈다 (순서를 바꾼 것이지 빼먹은 게 아니다)',
        calls.length === PROBES2.length * 2 * 2, calls.length);
    });

  console.log('\n=== ⑤ 실패 행에 경과/예산이 남는다 ===');
  await withFakes(
    ({ engine }) => (engine === 'claude' ? timeoutErr() : Promise.resolve(okOpenAi())),
    async ({ inserted }) => {
      const out = await V.runSovProbe({ timeoutMs: budgetMs, probes: PROBES2, concurrency: 4 });
      const failedRows = inserted.filter((r) => r.error && /timeout/i.test(r.error));
      t('타임아웃 행이 실제로 생겼다', failedRows.length === PROBES2.length * 2, failedRows.length);
      t('실패 사유 뒤에 경과/예산이 붙는다',
        failedRows.every((r) => /\(경과 \d+초\/예산 \d+초\)/.test(r.error)),
        failedRows[0] && failedRows[0].error);
      t('원래 사유를 지우지 않고 덧붙인다 · 컬럼 한도(200자) 안이다',
        failedRows.every((r) => /aborted due to timeout/.test(r.error) && r.error.length <= 200));
      /* ⑦ 분모 보존 — 실패해도 행은 남는다. */
      t('실패한 칸을 빼지 않고 present=null 로 남긴다 (분모가 줄면 점유율이 부풀려진다)',
        inserted.length === PROBES2.length * 2 * 2
        && failedRows.every((r) => r.present === null), inserted.length);

      console.log('\n=== ⑥ note 가 실패를 개수가 아니라 사유로 적는다 ===');
      t('note 에 실패 사유 딱지가 들어간다', /\[타임아웃 \d+/.test(out.note), out.note);
      t('note 에 검색 최장 시간이 들어간다', /검색 최장 성공 \d+초\/실패 \d+초/.test(out.note), out.note);
      t('SoV 본문은 그대로다', /^SoV \d+\/\d+/.test(out.note), out.note);
    });

  console.log('\n=== 사유 딱지 (reasonOf) ===');
  t('타임아웃', V.reasonOf('The operation was aborted due to timeout (경과 200초/예산 200초)') === '타임아웃');
  t('웹검색 미실행', V.reasonOf('웹검색 미실행 — 답변 레이어로 세지 않음') === '웹검색 미실행');
  t('HTTP 상태는 엔진과 함께 묶는다', V.reasonOf('anthropic 429 (경과 3초)') === 'anthropic 429');
  // 모르는 실패를 '기타' 로 뭉뚱그리면 새 고장이 옛 고장 뒤에 숨는다.
  t('모르는 사유는 원문 앞부분 · 빈 사유도 딱지가 있다',
    V.reasonOf('fetch failed ECONNRESET').startsWith('fetch failed')
    && V.reasonOf('') === '사유없음');

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail > 0) process.exit(1);
  console.log('✓ ai-sov-timeout-budget tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
