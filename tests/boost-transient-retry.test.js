/**
 * 부스트 일시 오류 재시도 — tests/boost-transient-retry.test.js (2026-09-17 신설)
 *
 * 왜 ─────────────────────────────────────────────────
 * 9/10 에 부스트 실패 사유를 남기게 한 뒤 처음 잡힌 스레드 실패가
 * `is_transient:true, code:2` — 메타가 "나중에 다시 시도하라"고 직접 적어
 * 보낸 오류였다. 그런데 부스트 경로에는 재시도가 없었다. ig_boosts 는
 * 선점(claim-first) 구조라 한 번 실패하면 다음 크론도 dup 으로 물러나고
 * 그 화보는 영영 스레드에 안 나간다.
 *
 * 이 테스트가 지키는 것 — **소스를 정규식으로 훑지 않고 함수를 실제로 돌린다**:
 *   1. 메타가 일시적이라고 말한 실패만 재시도한다
 *   2. 레이트리밋은 일시 오류여도 재시도하지 않는다 (즉시 재시도가 악화시킨다)
 *   3. 판단 못 하는 문자열은 재시도하지 않는다 (보수적 기본값)
 *   4. 재시도는 정확히 1회 — 무한 재시도 사고(2026-07-23) 재발 금지
 *   5. 두 번 다 실패하면 두 번째 사유가 남고 재시도 사실이 보인다
 *   6. 재시도로 건진 건은 note 에 'ok(재시도)' 로 구분돼 남는다
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  \u2717 ' + name); }
}

/* goldenBoost 는 최상단에서 supabase 클라이언트를 만든다(env 필요).
   테스트는 판정·재시도 함수만 보므로 그 두 함수만 떼어 평가한다. */
const src = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/goldenBoost.js'), 'utf8');
const pick = (re, label) => {
  const m = src.match(re);
  if (!m) { console.error('  \u2717 소스에서 ' + label + ' 를 찾지 못했다'); process.exit(1); }
  return m[0];
};
const sandbox = {
  RATE_LIMIT_CODES: [4, 17, 32, 613],
  RETRY_WAIT_MS: 0,
  waitBeforeRetry: () => Promise.resolve(),
};
const fnTransient = pick(/function isTransientFailure\(msg\)[\s\S]*?\n\}/, 'isTransientFailure');
const fnRetry = pick(/async function postWithTransientRetry\(attempt, opts\)[\s\S]*?\n\}/, 'postWithTransientRetry');
// eslint-disable-next-line no-new-func
const load = new Function('RATE_LIMIT_CODES', 'waitBeforeRetry',
  fnTransient + '\n' + fnRetry + '\nreturn { isTransientFailure, postWithTransientRetry };');
const { isTransientFailure, postWithTransientRetry } = load(sandbox.RATE_LIMIT_CODES, sandbox.waitBeforeRetry);

/* ── 1. 실제로 잡힌 원문 (2026-09-14 sync-instagram note) ───────────── */
const REAL = '게시 실패: {"error":{"message":"An unexpected error has occurred. '
  + 'Please retry your request later.","type":"OAuthException","is_transient":true,'
  + '"code":2,"fbtrace_id":"Axxxx"}}';
t('실측 원문(is_transient:true, code 2)을 일시 오류로 본다', isTransientFailure(REAL) === true);

/* ── 2. 레이트리밋은 일시여도 재시도 금지 ─────────────────────────── */
[4, 17, 32, 613].forEach((c) => {
  t('레이트리밋 code ' + c + ' 은 재시도하지 않는다',
    isTransientFailure('{"is_transient":true,"code":' + c + '}') === false);
});
t('경계: code 41 은 레이트리밋 4 가 아니다 (접두 오매칭 금지)',
  isTransientFailure('{"is_transient":true,"code":41}') === true);
t('경계: code 6130 은 레이트리밋 613 이 아니다',
  isTransientFailure('{"is_transient":true,"code":6130}') === true);

/* ── 3. 보수적 기본값 ──────────────────────────────────────────────── */
t('is_transient:false 는 영구 오류 — 재시도 안 함',
  isTransientFailure('{"is_transient":false,"code":190}') === false);
t('is_transient 가 없으면 재시도 안 함 (추측 금지)',
  isTransientFailure('{"code":2,"message":"something"}') === false);
t('경계: 빈 문자열', isTransientFailure('') === false);
t('경계: null', isTransientFailure(null) === false);
t('경계: undefined', isTransientFailure(undefined) === false);
t('경계: 공백 변형(is_transient : true)도 잡는다',
  isTransientFailure('{"is_transient" : true}') === true);

/* ── 4~6. 재시도 동작 ──────────────────────────────────────────────── */
(async function run() {
  // 첫 시도 성공 → 재시도 없음
  let calls = 0;
  let r = await postWithTransientRetry(async () => { calls++; return 'id123'; }, { retryWaitMs: 0 });
  t('첫 시도 성공이면 재시도하지 않는다', r.ok === true && r.retried === false && calls === 1);

  // 일시 오류 → 1회 재시도 후 성공
  calls = 0;
  r = await postWithTransientRetry(async () => {
    calls++;
    if (calls === 1) throw new Error(REAL);
    return 'id456';
  }, { retryWaitMs: 0 });
  t('일시 오류면 1회 재시도하고, 성공하면 ok', r.ok === true && r.retried === true && calls === 2);
  t('재시도로 건졌으면 사유는 비운다', r.err === '');

  // 영구 오류 → 재시도 없음
  calls = 0;
  r = await postWithTransientRetry(async () => {
    calls++; throw new Error('{"is_transient":false,"code":190,"message":"token expired"}');
  }, { retryWaitMs: 0 });
  t('영구 오류는 재시도하지 않는다 (무한 재시도 사고 재발 금지)',
    r.ok === false && r.retried === false && calls === 1);
  t('영구 오류의 사유는 그대로 남는다', /token expired/.test(r.err));

  // 일시 오류 두 번 → 재시도는 정확히 1회까지만
  calls = 0;
  r = await postWithTransientRetry(async () => { calls++; throw new Error(REAL); }, { retryWaitMs: 0 });
  t('일시 오류가 반복돼도 시도는 총 2회에서 멈춘다', calls === 2);
  t('두 번 다 실패하면 재시도 사실이 사유에 남는다',
    r.ok === false && r.retried === true && /재시도 후에도 실패/.test(r.err));
  t('두 번째 사유도 함께 남는다', /Please retry your request later|OAuthException/.test(r.err));
  t('사유는 160자에서 자른다', r.err.length <= 160);

  // 던지지 않고 거짓값을 돌려주는 경로
  calls = 0;
  r = await postWithTransientRetry(async () => { calls++; return null; }, { retryWaitMs: 0 });
  t('경계: 게시 id 가 없으면 실패로 보고, 사유를 남긴다',
    r.ok === false && r.err === '게시 id 없음' && calls === 1);

  /* ── note 표기: 재시도로 건진 건이 구분돼 보인다 ──────────────── */
  const sync = fs.readFileSync(path.join(__dirname, '..', 'api/cron/sync-instagram.js'), 'utf8');
  const m = sync.match(/function recordBoost\(results, b\)\{[\s\S]*?\n\}/);
  t('sync-instagram: recordBoost 를 찾았다', !!m);
  if (m) {
    // eslint-disable-next-line no-new-func
    const mk = new Function('scrubSecret', m[0] + '\nreturn recordBoost;')((v) => v);
    const r1 = {};
    mk(r1, { boosted: true, threadsOk: true, threadsRetried: true, xOk: true, xRetried: false });
    t('재시도로 성공한 스레드는 ok(재시도) 로 남는다', r1.boost_threads[0] === 'ok(재시도)');
    t('재시도 없이 성공한 X 는 그냥 ok', r1.boost_x[0] === 'ok');

    const r2 = {};
    mk(r2, { boosted: true, threadsOk: false, threadsErr: '재시도 후에도 실패: 게시 실패', xOk: true });
    t('두 번 다 실패하면 사유가 note 에 그대로 실린다',
      /재시도 후에도 실패/.test(r2.boost_threads[0]));

    const r3 = {};
    mk(r3, { boosted: false });
    t('경계: 부스트 안 했으면 아무것도 안 적는다', r3.boosted === undefined);

    const r4 = {};
    mk(r4, { boosted: true, threadsOk: false, xOk: false });
    t('경계: 실패인데 사유가 비면 "사유 없음" 자리를 남긴다 (조용한 실패 금지)',
      r4.boost_threads[0] === '실패: 사유 없음' && r4.boost_x[0] === '실패: 사유 없음');
  }

  /* ── 배선 확인 ────────────────────────────────────────────────── */
  t('goldenBoost: 스레드가 재시도 경로를 탄다',
    /postWithTransientRetry\(async \(\) => \{\s*const threads = require/.test(src));
  t('goldenBoost: X 도 같은 재시도 경로를 탄다 (규칙 두 벌 금지 — 교훈 2)',
    /postWithTransientRetry\(async \(\) => \{\s*const tr = await x\.postTweet/.test(src));
  t('goldenBoost: 반환값에 재시도 여부가 실린다',
    /threadsRetried, xRetried/.test(src));
  t('goldenBoost: 판정 함수를 내보낸다 (테스트가 직접 돌린다)',
    /isTransientFailure, postWithTransientRetry/.test(src));

  if (fail) { console.error('boost-transient-retry: ' + pass + ' pass, ' + fail + ' FAIL'); process.exit(1); }
  console.log('boost-transient-retry: ' + pass + '검사 통과');
})();
