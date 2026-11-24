/**
 * 결제로 막힌 외부 API 를 계속 때리지 않는다 (도메니코 2026-11-24 "헛돌지않게 해주고")
 *
 * 사고: OpenAI 는 11/02 부터 22일, X 는 11/12 부터 12일 동안 '돈이 없다'로 거절했는데
 * 크론은 같은 호출을 같은 간격으로 반복했다 — 임베딩 약 1,050회(30분마다), X 지표
 * 약 290회(1시간마다). 더 나쁜 건 그 1,050회가 전부 cron_runs 에 ok=true 로 남은 것이다.
 * 돌았다는 게 한 일은 아니다.
 *
 * 그래서 이 테스트가 지키는 것은 둘이다:
 *   ① 창이 닫혀 있는 동안 외부 호출이 **나가지 않는다**
 *   ② 연속 3회부터 크론이 **실패로 기록된다**(5xx → cronGuard ok=false)
 * 둘 중 하나만 있으면 반쪽이다. 조용히 멈추면 또 3주를 모르고, 시끄럽게 헛돌면
 * 지금과 같다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

/* ── 가짜 supabase: 한 줄짜리 메모리 테이블. billingBackoff 는 supabase 를
      함수 안에서 늦게 부르므로, require 캐시에 미리 심어 두면 갈아끼워진다. */
const rows = new Map();
function fakeTable() {
  const api = {
    _key: null,
    select() { return api; },
    eq(_col, v) { api._key = v; return api; },
    maybeSingle() { return Promise.resolve({ data: rows.get(api._key) || null, error: null }); },
    upsert(row) { rows.set(row.key, row); return Promise.resolve({ error: null }); },
    delete() { return { eq(_c, v) { rows.delete(v); return Promise.resolve({ error: null }); } }; },
  };
  return api;
}
const fakePath = require.resolve(path.join(ROOT, 'api/_lib/supabase.js'));
require.cache[fakePath] = { id: fakePath, filename: fakePath, loaded: true,
  exports: { supabaseAdmin: { from: fakeTable } } };

const bb = require(path.join(ROOT, 'api/_lib/billingBackoff.js'));

(async () => {
  console.log('\n=== 1) 백오프 단계 ===');
  t('1회 거절 → 30분', bb.waitMinutes(1) === 30);
  t('2회 → 1시간', bb.waitMinutes(2) === 60);
  t('3회 → 2시간', bb.waitMinutes(3) === 120);
  t('6회 → 12시간', bb.waitMinutes(6) === 720);
  t('그 뒤로는 12시간 상한 (무한정 늘지 않는다)', bb.waitMinutes(50) === bb.CAP_MIN);
  /* 상한이 필요한 이유: 충전은 사람이 한다. 24시간씩 밀면 "고쳤는데 왜 안 도나"가 된다. */
  t('상한이 반나절을 넘지 않는다', bb.CAP_MIN <= 720);
  t('연속 3회부터 실패로 찍는다', bb.FAIL_AFTER === 3);

  console.log('\n=== 2) 막힘 → 건너뜀 → 해제 ===');
  rows.clear();
  const first = await bb.check('t');
  t('처음엔 막히지 않았다', first.skip === false && first.consecutive === 0);

  const b1 = await bb.recordBlocked('t', 402, 'credits');
  t('1회 거절을 적는다', b1.consecutive === 1 && b1.waitMin === 30);
  t('1회로는 실패로 찍지 않는다 (일시적일 수 있다)', b1.shouldFail === false);
  const c1 = await bb.check('t');
  t('창이 닫혀 있으면 건너뛴다', c1.skip === true, JSON.stringify(c1));

  const b2 = await bb.recordBlocked('t', 402, 'credits');
  const b3 = await bb.recordBlocked('t', 402, 'credits');
  t('연속 횟수가 쌓인다', b2.consecutive === 2 && b3.consecutive === 3);
  t('3회부터 실패로 찍는다', b3.shouldFail === true);
  t('간격도 함께 벌어진다 (30 → 60 → 120분)', b2.waitMin === 60 && b3.waitMin === 120);
  const c3 = await bb.check('t');
  t('check 도 실패 상태를 알려준다', c3.shouldFail === true && c3.consecutive === 3);
  t('막힌 시점을 기억한다 (언제부터인지 말할 수 있다)', !!c3.blockedSince);

  await bb.clear('t');
  const c4 = await bb.check('t');
  t('한 번 성공하면 즉시 정상으로 돌아간다', c4.skip === false && c4.consecutive === 0);

  console.log('\n=== 3) 창이 열리면 한 번은 찔러 본다 ===');
  rows.clear();
  await bb.recordBlocked('t2', 429, 'credit');
  const r = rows.get('t2');
  r.next_attempt_at = new Date(Date.now() - 1000).toISOString();   // 창이 막 열린 상태
  const c5 = await bb.check('t2');
  t('창이 열렸으면 건너뛰지 않는다 (probe 1회)', c5.skip === false);
  t('그래도 연속 횟수는 유지한다', c5.consecutive === 1);

  console.log('\n=== 4) 호출부 배선 ===');
  const emb = fs.readFileSync(path.join(ROOT, 'api/cron/backfill-embeddings.js'), 'utf8');
  const xm = fs.readFileSync(path.join(ROOT, 'api/cron/x-metrics.js'), 'utf8');
  for (const [label, src, key] of [['backfill-embeddings', emb, 'openai-embeddings'], ['x-metrics', xm, 'x-read']]) {
    t(label + ': billingBackoff 를 쓴다', /require\('\.\.\/_lib\/billingBackoff'\)/.test(src));
    t(label + ": 자원 키가 '" + key + "'", src.indexOf("BB_KEY = '" + key + "'") > -1);
    t(label + ': 창이 닫히면 건너뛴다', /block\.skip && !forced/.test(src));
    t(label + ': 지속 차단이면 5xx (cronGuard 가 실패로 적는다)', /503 : 200/.test(src));
    t(label + ': 성공하면 해제한다', /bb\.clear\(BB_KEY\)/.test(src));
    t(label + ': 충전 직후 즉시 확인용 force 가 있다', /force === '1'/.test(src));
  }
  /* 임베딩은 '계정 고장(credit·auth)' 일 때만 민다 — 글 한 건의 빈 텍스트 같은
     개별 실패까지 밀면 대기열이 멈춘다. */
  t('임베딩: 계정 고장일 때만 창을 민다', /if \(halted && lastFail\)\s*\{\s*\n\s*bbState = await bb\.recordBlocked/.test(emb));
  /* X 는 402·403 만. 일시적 5xx 까지 밀면 잠깐 끊긴 것 때문에 반나절을 쉰다. */
  t('X: 402·403 만 창을 민다', /st0 === 402 \|\| st0 === 403/.test(xm));

  console.log('\n=== 5) 감시가 호출부를 죽이지 않는다 ===');
  /* DB 를 못 읽는 상황에서 '막혔다'고 답하면 멀쩡한 크론이 조용히 멈춘다.
     그래서 모르면 '막히지 않았다'로 답한다. */
  const broken = require.cache[fakePath];
  require.cache[fakePath] = { id: fakePath, filename: fakePath, loaded: true,
    exports: { supabaseAdmin: { from() { throw new Error('DB down'); } } } };
  delete require.cache[require.resolve(path.join(ROOT, 'api/_lib/billingBackoff.js'))];
  const bb2 = require(path.join(ROOT, 'api/_lib/billingBackoff.js'));
  const safe = await bb2.check('whatever');
  t('DB 가 죽어도 던지지 않는다', !!safe);
  t("DB 가 죽으면 '막히지 않았다'로 답한다 (조용한 정지 금지)", safe.skip === false);
  const rb = await bb2.recordBlocked('whatever', 402, 'credits');
  t('기록 실패도 던지지 않는다', rb && rb.shouldFail === false);
  require.cache[fakePath] = broken;

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ billing-backoff tests FAILED'); process.exit(1); }
  console.log('✅ billing-backoff tests passed');
})();
