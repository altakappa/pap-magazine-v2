/**
 * 부스트 재시도 성공을 실패로 세던 구멍 — tests/boost-retry-count.test.js (2026-09-24 신설)
 *
 * 왜 ─────────────────────────────────────────────────
 * 9/17 재시도 도입 뒤 7일 실측: ig_boosts 스레드 7/7 성공인데, 그중 5건의
 * sync-instagram note 는 '스레드 0/1 [ok(재시도)]' 로 찍혔다. note 의 성공 판정이
 * v !== 'ok' 라 'ok(재시도)' 를 실패로 셌다. 기록이 "했는데 못 했다" 고 말한다.
 * 또 재시도로 건지면 첫 시도의 사유가 버려졌다 — 첫 시도 실패율 71%(5/7)의
 * 원인을 볼 길이 없었다.
 *
 * 지키는 것 (함수를 실제로 돌린다):
 *   1. 재시도 성공 시 첫 사유(firstErr)가 반환된다
 *   2. note 표식 'ok(재시도: 첫 사유)' — 60자 제한 · 토큰 가림
 *   3. isBoostOk: 'ok'·'ok(재시도…)' 만 성공, 'okay'·'실패: ok' 등은 성공 아님
 *   4. note 블록을 실제로 돌려 '스레드 1/1' 로 세는지
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.error('  ✗ ' + name); } }

const gb = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/goldenBoost.js'), 'utf8');
const sync = fs.readFileSync(path.join(__dirname, '..', 'api/cron/sync-instagram.js'), 'utf8');
const pick = (s, re, label) => {
  const m = s.match(re);
  if (!m) { console.error('  ✗ 소스에서 ' + label + ' 를 찾지 못했다'); process.exit(1); }
  return m[0];
};

// eslint-disable-next-line no-new-func
const { isTransientFailure, postWithTransientRetry } = new Function('RATE_LIMIT_CODES', 'waitBeforeRetry',
  pick(gb, /function isTransientFailure\(msg\)[\s\S]*?\n\}/, 'isTransientFailure') + '\n'
  + pick(gb, /async function postWithTransientRetry\(attempt, opts\)[\s\S]*?\n\}/, 'postWithTransientRetry')
  + '\nreturn { isTransientFailure, postWithTransientRetry };')([4, 17, 32, 613], () => Promise.resolve());

const fnScrub = pick(sync, /function scrubSecret\(s\)\{[\s\S]*?\n\}/, 'scrubSecret');
const fnRecord = pick(sync, /function recordBoost\(results, b\)\{[\s\S]*?\n\}/, 'recordBoost');
const fnOk = pick(sync, /function isBoostOk\(v\)\{[\s\S]*?\n\}/, 'isBoostOk');
// eslint-disable-next-line no-new-func
const lib = new Function(fnScrub + '\n' + fnRecord + '\n' + fnOk + '\nreturn { recordBoost, isBoostOk };')();

/* note 의 부스트 블록을 그대로 떼어 돌린다 */
const noteBlock = pick(sync, /\(function \(\)\{\s*const T = results\.boost_threads[\s\S]*?\}\)\(\)/, '부스트 note 블록');
// eslint-disable-next-line no-new-func
const renderNote = new Function('results', 'isBoostOk', 'return ' + noteBlock + ';');

const TRANSIENT = '게시 실패: {"error":{"message":"An unexpected error","is_transient":true,"code":2}}';

(async function run() {
  /* 1. firstErr */
  let n = 0;
  let r = await postWithTransientRetry(async () => { n++; if (n === 1) throw new Error(TRANSIENT); return true; }, {});
  t('재시도로 건지면 ok·retried·firstErr(첫 사유) 가 온다',
    r.ok === true && r.retried === true && r.firstErr === TRANSIENT && n === 2);
  r = await postWithTransientRetry(async () => true, {});
  t('첫 시도 성공이면 firstErr 가 없다', r.ok === true && r.retried === false && !r.firstErr);
  n = 0;
  r = await postWithTransientRetry(async () => { n++; throw new Error(TRANSIENT); }, {});
  t('두 번 다 실패하면 종전대로 재시도 후에도 실패 사유', r.ok === false && /재시도 후에도 실패/.test(r.err) && !r.firstErr);

  /* 2. 표식 */
  const a = {};
  lib.recordBoost(a, { boosted: true, threadsOk: true, threadsRetried: true, threadsFirstErr: TRANSIENT, xOk: true });
  t('표식이 ok(재시도: 첫 사유…) 로 남는다', /^ok\(재시도: 게시 실패/.test(a.boost_threads[0]) && a.boost_x[0] === 'ok');
  t('경계: 첫 사유는 60자에서 잘린다', a.boost_threads[0].length === 'ok(재시도: '.length + 60 + 1);
  const b = {};
  lib.recordBoost(b, { boosted: true, threadsOk: true, threadsRetried: true, threadsFirstErr: '토큰 {"access_token":"EAAGabcdef1234567890"}', xOk: true });
  t('보안: 첫 사유의 토큰도 가려진다', !/EAAG[A-Za-z0-9]{10,}/.test(b.boost_threads[0]));
  const c = {};
  lib.recordBoost(c, { boosted: true, threadsOk: true, threadsRetried: true, xOk: true });
  t('경계: firstErr 가 없으면 종전 표식 ok(재시도) 그대로', c.boost_threads[0] === 'ok(재시도)');

  /* 3. isBoostOk 경계 */
  t('ok → 성공', lib.isBoostOk('ok') === true);
  t('ok(재시도) → 성공', lib.isBoostOk('ok(재시도)') === true);
  t('ok(재시도: …) → 성공', lib.isBoostOk('ok(재시도: 게시 실패 …)') === true);
  t('실패: … → 실패', lib.isBoostOk('실패: ok 아님') === false);
  t('경계: okay 는 성공이 아니다', lib.isBoostOk('okay') === false);
  t('경계: 빈값·null → 실패', lib.isBoostOk('') === false && lib.isBoostOk(null) === false);

  /* 4. note 블록 실제 렌더 */
  const note = renderNote({ boost_threads: a.boost_threads, boost_x: a.boost_x }, lib.isBoostOk);
  t('note: 재시도 성공을 1/1 로 센다 (종전 0/1)', /스레드 1\/1/.test(note) && /X 1\/1/.test(note));
  t('note: 재시도 증거(첫 사유)가 note 에 남는다', /\[ok\(재시도: 게시 실패/.test(note));
  const note2 = renderNote({ boost_threads: ['실패: HTTP 500', 'ok'], boost_x: ['ok', 'ok'] }, lib.isBoostOk);
  t('note: 진짜 실패는 여전히 실패로 센다', /스레드 1\/2 \[실패: HTTP 500\]/.test(note2) && /X 2\/2\)/.test(note2));
  t('note: 부스트 없으면 빈 문자열', renderNote({}, lib.isBoostOk) === '');
  t('배선: 옛 판정(v !== \'ok\')이 남아 있지 않다', !/v !== 'ok'/.test(sync));

  if (fail) { console.error('boost-retry-count: ' + pass + ' pass, ' + fail + ' FAIL'); process.exit(1); }
  console.log('boost-retry-count: ' + pass + '검사 통과');
})();
