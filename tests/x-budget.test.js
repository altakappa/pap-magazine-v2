/**
 * X 월 예산 상한 (도메니코 2026-11-24 "한도를 올릴게" · "기사당 1건으로 줄인다")
 *
 * 왜 이 테스트가 있나: 지금까지 유일한 천장이 X 쪽 지출 한도였고, 그래서 10/23 과
 * 11/12 에 두 번 천장에 박아 게시가 통째로 멈췄다. 한도를 $150 으로 올리면 그
 * 천장이 사라지므로 천장을 우리 쪽으로 옮긴 것이다. 이 테스트가 지키는 것:
 *   ① 90% 에서 **답글만** 줄고 본문은 계속 나간다 (유입을 유지하면서 비용만 깎는다)
 *   ② 본문에 링크가 없는 갈래의 답글은 줄이지 않는다 (막다른 트윗 금지)
 *   ③ 100% 에서는 멈춘다 (멈추지 않으면 예산이 아니다)
 *   ④ 예산 계산이 흔들려도 게시를 막지 않는다 (조용한 정지 금지)
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

/* 가짜 supabase — x_posts 성공 행과 ops_alert_state 한 줄만 흉내 낸다. */
let fakeRows = [];
let alertRow = null;
let alertsSent = 0;
function fakeFrom(table) {
  if (table === 'x_posts') {
    const api = { select() { return api; }, eq() { return api; }, gte() { return api; },
      limit() { return Promise.resolve({ data: fakeRows.map((text) => ({ text })), error: null }); } };
    return api;
  }
  const api = { select() { return api; }, eq() { return api; },
    maybeSingle() { return Promise.resolve({ data: alertRow, error: null }); },
    upsert(row) { alertRow = row; return Promise.resolve({ error: null }); } };
  return api;
}
const sbPath = require.resolve(path.join(ROOT, 'api/_lib/supabase.js'));
require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true,
  exports: { supabaseAdmin: { from: fakeFrom } } };
const paPath = require.resolve(path.join(ROOT, 'api/_lib/pushAlert.js'));
require.cache[paPath] = { id: paPath, filename: paPath, loaded: true,
  exports: { pushAlert: async () => { alertsSent++; return { ok: true }; } } };

const xb = require(path.join(ROOT, 'api/_lib/xBudget.js'));
const LINK = 'https://www.pap-magazine.com/article/x';

function fillTo(usd) {           // 링크 트윗으로 usd 근처까지 채운다
  fakeRows = [];
  const n = Math.round(usd / xb.PRICE_LINK);
  for (let i = 0; i < n; i++) fakeRows.push('본문 ' + LINK);
  xb.resetCache();
}

(async () => {
  process.env.X_MONTHLY_BUDGET_USD = '150';

  console.log('\n=== 1) 단가와 단계 (순수 함수) ===');
  t('링크 든 트윗은 $0.20', xb.priceOf('보기 ' + LINK) === 0.20);
  t('링크 없는 트윗은 $0.015', xb.priceOf('그냥 본문') === 0.015);
  t('13배 차이가 단가의 핵심이다', xb.PRICE_LINK / xb.PRICE_PLAIN > 10);
  t('89% 는 normal', xb.modeFor(133.5, 150) === 'normal');
  t('90% 에서 trim', xb.modeFor(135, 150) === 'trim');
  t('100% 에서 stop', xb.modeFor(150, 150) === 'stop');
  t('초과해도 stop', xb.modeFor(999, 150) === 'stop');
  t('기본 예산은 $150 (도메니코 선택)', xb.DEFAULT_BUDGET_USD === 150);
  t('예산은 env 로 바꾼다', xb.budgetUsd() === 150);

  console.log('\n=== 2) normal — 그대로 ===');
  fillTo(100);
  const st1 = await xb.state({ fresh: true });
  t('쓴 돈을 센다 (약 $100)', Math.abs(st1.spent - 100) < 0.5, String(st1.spent));
  t('단계는 normal', st1.mode === 'normal');
  t('본문 트윗 허용', (await xb.gate({ isReply: false })).allow === true);
  t('답글도 허용', (await xb.gate({ isReply: true })).allow === true);

  console.log('\n=== 3) trim(90%) — 답글만 줄인다 ===');
  fillTo(136);
  xb.resetCache();
  const st2 = await xb.state({ fresh: true });
  t('단계는 trim', st2.mode === 'trim', st2.mode + ' / $' + st2.spent);
  const main = await xb.gate({ isReply: false });
  t('본문 트윗은 계속 나간다 (유입 유지)', main.allow === true);
  const rep = await xb.gate({ isReply: true });
  t('답글 트윗은 생략한다 (기사당 1건)', rep.allow === false && rep.reason === 'x_budget_trim_reply');
  const ess = await xb.gate({ isReply: true, essential: true });
  t('본문에 링크 없는 갈래의 답글은 예외 (막다른 트윗 금지)', ess.allow === true);

  console.log('\n=== 4) stop(100%) — 멈춘다 ===');
  fillTo(151);
  xb.resetCache();
  const st3 = await xb.state({ fresh: true });
  t('단계는 stop', st3.mode === 'stop', st3.mode + ' / $' + st3.spent);
  t('본문도 멈춘다', (await xb.gate({ isReply: false })).allow === false);
  t('essential 도 멈춘다 (100% 는 끝이라는 뜻)', (await xb.gate({ isReply: true, essential: true })).allow === false);

  console.log('\n=== 5) 알림은 월·단계별 한 번만 ===');
  alertRow = null; alertsSent = 0;
  xb.resetCache(); await xb.gate({ isReply: false });
  const after1 = alertsSent;
  xb.resetCache(); await xb.gate({ isReply: false });
  await xb.gate({ isReply: false });
  t('같은 달·같은 단계는 한 번만 알린다', after1 === 1 && alertsSent === 1, '보낸 수 ' + alertsSent);

  console.log('\n=== 6) 계산이 흔들려도 게시를 막지 않는다 ===');
  const saved = require.cache[sbPath];
  require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true,
    exports: { supabaseAdmin: { from() { throw new Error('DB down'); } } } };
  delete require.cache[require.resolve(path.join(ROOT, 'api/_lib/xBudget.js'))];
  const xb2 = require(path.join(ROOT, 'api/_lib/xBudget.js'));
  const st4 = await xb2.state({ fresh: true });
  t('DB 가 죽으면 normal 로 답한다', st4.mode === 'normal' && st4.known === false);
  t('그래도 게시는 허용한다 (조용한 정지 금지)', (await xb2.gate({ isReply: true })).allow === true);
  require.cache[sbPath] = saved;

  console.log('\n=== 7) 배선 ===');
  const xp = fs.readFileSync(path.join(ROOT, 'api/_lib/xPost.js'), 'utf8');
  t('게이트가 postTweet 한 곳에 있다 (호출부마다 달지 않는다)',
    /require\('\.\/xBudget'\)\.gate\(\{ isReply: !!c\.replyToId, essential: !!c\.essential \}\)/.test(xp));
  t('게이트가 네트워크 호출보다 먼저다',
    xp.indexOf("require('./xBudget')") < xp.indexOf("'https://api.twitter.com/2/tweets'"));
  t('페퍼릿(c.token)은 게이트 대상이 아니다 (이미 따로 막혀 있다)', /if \(!c\.token\) \{\s*\n\s*try \{\s*\n\s*const g = await require\('\.\/xBudget'\)/.test(xp));
  t('예산 때문에 건너뛴 것은 skipped 로 돌려준다 (실패 행을 쌓지 않는다)',
    /return \{ ok: false, skipped: g\.reason, budget: g\.state \}/.test(xp));
  const si = fs.readFileSync(path.join(ROOT, 'api/cron/sync-instagram.js'), 'utf8');
  t('본문에 링크 없는 갈래의 답글만 essential 로 보낸다',
    /\{ replyToId: tw\.id, essential: !abBody \}/.test(si));

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ x-budget tests FAILED'); process.exit(1); }
  console.log('✅ x-budget tests passed');
})();
