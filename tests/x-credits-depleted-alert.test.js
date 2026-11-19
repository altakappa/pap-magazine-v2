/**
 * X 선불 크레딧 소진(HTTP 402 credits-depleted)도 지출 한도(403)처럼 개인방에 알린다 (2026-11-19)
 *
 * 왜: 11/02 에 만든 xSpendWatch 는 403 spend-cap 한 모양만 봤다. 11/13 부터 X 는 같은 '돈이 없다' 를
 * 402 credits-depleted 로 보냈고, magazine 게시가 11/13~11/19 0/38 로 죽는 동안 알림 0건
 * (ops_alert_state.x_spend_cap 마지막 알림 11/05). src=x 유입 136 → 49, x_body 아웃클릭 516 → 95.
 *
 * 정규식으로 훑지 않고 reportXFailure 를 스텁 supabase·pushAlert 로 실제로 돌린다.
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

const REAL_402 = '{"detail":"credits depleted","status":402,"title":"Payment Required","type":"https://api.x.com/2/problems/credits-depleted"}';
const REAL_403 = '{"detail":"Your monthly spend cap has been reached.","status":403,"title":"Forbidden","type":"https://api.x.com/2/problems/spend-cap-reached"}';

// ── 스텁: ops_alert_state 한 칸 + x_posts 카운트 + pushAlert 기록 ──
const state = { row: null, alerts: [], orArg: null, upserts: [] };
function chain(table) {
  const q = {
    select() { return q; }, eq() { return q; }, ilike() { return q; }, gte() { return q; },
    or(a) { state.orArg = a; return q; },
    maybeSingle: async () => ({ data: state.row, error: null }),
    upsert: async (row) => { state.upserts.push(row); state.row = { last_alert_at: row.last_alert_at }; return { error: null }; },
    then(res) { return Promise.resolve(table === 'x_posts' ? { count: 38, error: null } : { data: null, error: null }).then(res); },
  };
  return q;
}
const supaPath = path.join(ROOT, 'api', '_lib', 'supabase.js');
const pushPath = path.join(ROOT, 'api', '_lib', 'pushAlert.js');
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { supabaseAdmin: { from: chain } } };
require.cache[pushPath] = { id: pushPath, filename: pushPath, loaded: true, exports: { pushAlert: async (a) => { state.alerts.push(a); } } };

const W = require(path.join(ROOT, 'api', '_lib', 'xSpendWatch.js'));

(async () => {
  console.log('\n[1] 판정 (순수 함수 · 경계값)');
  t('실제 402 응답(11/13~)을 크레딧 소진으로 판정', W.isCreditsDepleted(402, REAL_402));
  t('classify: 402 크레딧 → credits', W.classifyXBilling(402, REAL_402) === 'credits');
  t('classify: 403 한도 → spend_cap (종전 동작 보존)', W.classifyXBilling(403, REAL_403) === 'spend_cap');
  t('isSpendCap 은 402 를 여전히 아니라고 한다 (의미 불변)', !W.isSpendCap(402, REAL_402));
  t('크레딧 문구 없는 402 는 아니다 (다른 결제 사유)', W.classifyXBilling(402, '{"title":"Payment Required","detail":"client-not-enrolled"}') === null);
  t('크레딧 문구라도 429 면 아니다', W.classifyXBilling(429, REAL_402) === null);
  t('403 크레딧 문구는 credits 로 오판하지 않는다', W.classifyXBilling(403, REAL_402) === null);
  t('문자열 상태코드 "402" 도 받는다', W.classifyXBilling('402', REAL_402) === 'credits');
  t('빈 detail · undefined 안전', W.classifyXBilling(402, undefined) === null && W.classifyXBilling(undefined, undefined) === null);
  t('200자 잘린 detail 에서도 잡힌다', W.isCreditsDepleted(402, REAL_402.slice(0, 40)), REAL_402.slice(0, 40));

  const oldUrl = process.env.SUPABASE_URL;
  console.log('\n[2] env 없음(테스트·로컬) → 판정만, 알림 없음');
  delete process.env.SUPABASE_URL;
  {
    const r = await W.reportXFailure({ status: 402, detail: REAL_402, account: 'magazine' });
    t('credits=true · alerted=false', r.credits === true && r.alerted === false, r);
    t('알림 0건', state.alerts.length === 0);
  }

  process.env.SUPABASE_URL = 'https://stub.local';
  console.log('\n[3] 402 크레딧 소진 → 개인방 알림 1건');
  {
    const r = await W.reportXFailure({ status: 402, detail: REAL_402, account: 'magazine' });
    t('alerted=true', r.alerted === true && r.credits === true && r.spendCap === false, r);
    const a = state.alerts[0] || {};
    t('개인방 전용', a.personalOnly === true);
    t('제목이 크레딧 소진이라고 말한다', /크레딧 소진/.test(a.title || ''), a.title);
    t('본문이 402 를 말한다 (403 이라고 거짓말하지 않는다)', (a.lines || []).some(l => /402/.test(l)) && !(a.lines || []).some(l => /HTTP 403/.test(l)), a.lines);
    t('실패 건수가 실린다 (38건)', (a.lines || []).some(l => /38건/.test(l)));
    t('실패 집계가 spend·credits 둘 다 센다', /spend/.test(state.orArg || '') && /credits/.test(state.orArg || ''), state.orArg);
    t('쿨다운 칸에 kind=credits · status=402 기록', state.upserts[0] && state.upserts[0].last_payload.kind === 'credits' && state.upserts[0].last_payload.status === 402, state.upserts[0]);
  }

  console.log('\n[4] 쿨다운 12시간 — 하루 20번 실패해도 1통');
  {
    const r = await W.reportXFailure({ status: 402, detail: REAL_402, account: 'magazine' });
    t('두 번째는 알리지 않는다', r.alerted === false && state.alerts.length === 1);
    const r2 = await W.reportXFailure({ status: 403, detail: REAL_403, account: 'magazine' });
    t('같은 칸을 쓰므로 403 이 바로 이어 와도 중복 알림 없음', r2.alerted === false && r2.spendCap === true && state.alerts.length === 1);
    state.row = { last_alert_at: new Date(Date.now() - (W.COOLDOWN_H * 3600000 + 1000)).toISOString() };
    const r3 = await W.reportXFailure({ status: 403, detail: REAL_403, account: 'magazine' });
    t('12시간 지나면 다시 알린다 (403 은 종전 문구)', r3.alerted === true && /지출 한도/.test(state.alerts[1].title) && state.alerts[1].lines.some(l => /HTTP 403/.test(l)), state.alerts[1]);
  }

  console.log('\n[5] 알리면 안 되는 경우');
  {
    state.row = null; const before = state.alerts.length;
    const p = await W.reportXFailure({ status: 402, detail: REAL_402, account: 'pepperit' });
    t('페퍼릿 계정은 알리지 않는다', p.alerted === false && p.credits === true);
    const o = await W.reportXFailure({ status: 500, detail: '{"detail":"oops"}', account: 'magazine' });
    t('일반 5xx 는 알리지 않는다', o.alerted === false && o.credits === false && o.spendCap === false);
    const n = await W.reportXFailure(undefined);
    t('인자 없어도 throw 하지 않는다', n.alerted === false);
    t('위 세 경우 알림 0건 추가', state.alerts.length === before);
  }

  console.log('\n[6] 감시가 터져도 게시 경로를 안 죽인다');
  {
    state.row = null;
    const saved = require.cache[pushPath].exports.pushAlert;
    require.cache[pushPath].exports.pushAlert = async () => { throw new Error('telegram down'); };
    let threw = false, r;
    try { r = await W.reportXFailure({ status: 402, detail: REAL_402, account: 'magazine' }); } catch (_) { threw = true; }
    t('pushAlert 예외에도 throw 없음 · alerted=false', !threw && r && r.alerted === false);
    require.cache[pushPath].exports.pushAlert = saved;
  }

  if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
  console.log('\npassed: ' + pass + '   failed: ' + fail);
  process.exit(fail ? 1 : 0);
})();
