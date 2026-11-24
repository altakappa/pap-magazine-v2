/**
 * X 월 예산 상한 (2026-11-24 신설, 도메니코 "한도를 올릴게" + "기사당 1건으로 줄인다")
 *
 * ■ 왜 우리 코드에 상한이 필요한가
 * 지금까지 유일한 천장은 **X 쪽 지출 한도**였다. 그래서 10/23 과 11/12 에 두 번
 * 천장에 머리를 박았고, 그때마다 게시가 전부 멈췄다(10/23~11/02 140건 · 11/13~ 71건).
 * 한도를 $150 로 올리면 그 천장이 사라진다 — 올린 만큼 그대로 청구될 수 있다.
 * 그래서 천장을 우리 쪽으로 옮긴다. X 는 결제 한도, 우리는 **행동 예산**이다.
 *
 * ■ 단가 (2026-11-24 X 개발자 콘솔 청구 내역으로 검산함)
 * 링크가 든 트윗 $0.20 · 링크 없는 트윗 $0.015 · 읽기 $0.
 * 검산: 게시가 살아 있던 11/06~11/12 7일간 X 가 청구한 금액이 US$10.03 이고,
 * 같은 기간 X 가 센 이벤트가 ContentCreateWithUrl 47 · Content Create 42 ·
 * Read 36 이다. 47×0.20 + 42×0.015 = 10.03 — 단가 세 개가 모두 맞는다.
 * (우리 x_posts 의 성공 89건과 X 의 콘텐츠 이벤트 89건도 1:1 로 맞는다.)
 *
 * ■ 주의: 'http 가 들어간 트윗' ≠ 'URL 할증 대상'
 * 그 7일간 우리 기준으로는 89건 전부 본문에 링크가 있었지만, X 가 할증을 매긴
 * 것은 47건(53%)뿐이었다. 할증은 글타래당 한 번만 붙는 것으로 보인다. 그래서
 * priceOf() 로 계산한 사용액은 **실제보다 약 2배 높게** 나온다 — 안전한 방향의
 * 오차이므로 그대로 둔다(과소 추정이 더 위험하다). 예산 금액은 이 점을 감안해
 * 잡았다: 실측 월 $43(11월 속도)·$70(10월 속도) 대비 상한 $75.
 *
 * ■ 세 단계
 *   normal (<90%)  그대로.
 *   trim   (≥90%)  **기사당 트윗 1건** — 답글 트윗을 생략한다(도메니코 선택).
 *                  10/13 A/B 에서 이긴 '본문 링크' 형식은 그대로 두므로 인스타
 *                  유입은 유지되고, 기사당 비용이 $0.47 → $0.20 으로 떨어진다.
 *                  단, 본문에 링크가 없는 갈래는 답글이 유일한 출구라서
 *                  essential 로 표시해 예외를 둔다 — 안 그러면 막다른 트윗이 된다.
 *   stop   (≥100%) 그 달은 더 올리지 않는다. 예산인데 멈추지 않으면 예산이 아니다.
 *
 * ■ 설계 원칙
 *   · 절대 throw 하지 않는다. DB 를 못 읽으면 normal 로 답한다 — 예산 계산이
 *     흔들린다고 게시가 조용히 멈추는 쪽이 더 나쁘다(billingBackoff 와 같은 이유).
 *   · 쓴 돈은 x_posts 의 **성공 행**에서 센다. 거절된 호출은 과금되지 않는다.
 *   · 월 경계는 UTC. X 청구서 기준과 하루 어긋날 수 있지만, 90% 단계가 있어서
 *     그 오차가 천장을 넘기지는 않는다.
 *   · 단계가 바뀌면 한 번만 알린다(월·단계별 1회). 매 트윗마다 알리면 소음이다.
 */

'use strict';

const PRICE_LINK = 0.20;      // 링크가 든 트윗
const PRICE_PLAIN = 0.015;    // 링크 없는 트윗
const TRIM_AT = 0.90;
const DEFAULT_BUDGET_USD = 75;

const ALERT_KEY = 'x_budget_mode';
const CACHE_MS = 5 * 60 * 1000;
let _cache = null;            // { at, state }

function budgetUsd() {
  const n = Number(process.env.X_MONTHLY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET_USD;
}

function db() { return require('./supabase').supabaseAdmin; }

function monthStartIso(now) {
  const d = new Date(now || Date.now());
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** 트윗 한 건의 값 (순수 함수 — 테스트 대상) */
function priceOf(text) {
  return /https?:\/\//i.test(String(text || '')) ? PRICE_LINK : PRICE_PLAIN;
}

/** 쓴 돈에서 단계를 정한다 (순수 함수) */
function modeFor(spent, budget) {
  const b = Number(budget) > 0 ? Number(budget) : DEFAULT_BUDGET_USD;
  const ratio = Number(spent) / b;
  if (ratio >= 1) return 'stop';
  if (ratio >= TRIM_AT) return 'trim';
  return 'normal';
}

/** 이번 달(UTC) 성공한 트윗으로 쓴 돈. 못 읽으면 null. */
async function spentThisMonth() {
  try {
    const { data, error } = await db().from('x_posts')
      .select('text')
      .eq('ok', true).eq('account', 'magazine')
      .gte('created_at', monthStartIso())
      .limit(5000);
    if (error || !data) return null;
    let usd = 0;
    for (const r of data) usd += priceOf(r && r.text);
    return { usd: Math.round(usd * 100) / 100, tweets: data.length };
  } catch (e) {
    console.error('[xBudget] 사용액 조회 실패:', e && e.message);
    return null;
  }
}

/** 지금 상태. DB 를 못 읽으면 normal (게시를 막지 않는다). */
async function state(opts) {
  const fresh = opts && opts.fresh;
  if (!fresh && _cache && Date.now() - _cache.at < CACHE_MS) return _cache.state;
  const budget = budgetUsd();
  const s = await spentThisMonth();
  const st = s
    ? { mode: modeFor(s.usd, budget), spent: s.usd, tweets: s.tweets, budget,
        pct: Math.round((s.usd / budget) * 100), known: true }
    : { mode: 'normal', spent: null, tweets: null, budget, pct: null, known: false };
  _cache = { at: Date.now(), state: st };
  return st;
}

/** 테스트·수동 확인용 — 캐시를 버린다. */
function resetCache() { _cache = null; }

/**
 * 이 트윗을 올려도 되나.
 * @param {{isReply?:boolean, essential?:boolean}} kind
 * @returns {Promise<{allow:boolean, reason:string|null, state:object}>}
 */
async function gate(kind) {
  const st = await state();
  const isReply = !!(kind && kind.isReply);
  const essential = !!(kind && kind.essential);
  if (st.mode === 'stop') {
    await alertOnce(st);
    /* essential 도 멈춘다 — 100% 는 '예산 끝' 이라는 뜻이다. */
    return { allow: false, reason: 'x_budget_stop', state: st };
  }
  if (st.mode === 'trim' && isReply && !essential) {
    await alertOnce(st);
    return { allow: false, reason: 'x_budget_trim_reply', state: st };
  }
  return { allow: true, reason: null, state: st };
}

/** 단계가 바뀐 달에 한 번만 알린다. */
async function alertOnce(st) {
  try {
    const tag = new Date().toISOString().slice(0, 7) + ':' + st.mode;   // 2026-11:trim
    const { data } = await db().from('ops_alert_state')
      .select('last_payload').eq('key', ALERT_KEY).maybeSingle();
    if (data && data.last_payload && data.last_payload.tag === tag) return false;
    const lines = st.mode === 'stop'
      ? ['이번 달 X 게시를 멈춥니다. 다음 달 1일(UTC)에 자동으로 풀립니다.',
         '더 올리려면 X_MONTHLY_BUDGET_USD 를 올리세요.']
      : ['기사당 트윗을 1건으로 줄입니다 — 답글 트윗을 생략합니다.',
         '본문 링크는 그대로이므로 인스타 유입은 유지됩니다.'];
    await require('./pushAlert').pushAlert({
      personalOnly: true,
      title: (st.mode === 'stop' ? '🛑 X 월 예산 100% 도달' : '⚠️ X 월 예산 90% 도달')
        + ' — $' + st.spent + ' / $' + st.budget,
      lines: lines.concat(['이번 달 트윗 ' + st.tweets + '건 · 링크 트윗 $' + PRICE_LINK + ' 기준']),
      url: 'https://www.pap-magazine.com/admin', urlLabel: '어드민',
    });
    await db().from('ops_alert_state').upsert({
      key: ALERT_KEY,
      last_alert_at: new Date().toISOString(),
      last_payload: { tag, mode: st.mode, spent: st.spent, budget: st.budget },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    return true;
  } catch (e) {
    console.error('[xBudget] 단계 알림 실패:', e && e.message);
    return false;
  }
}

module.exports = {
  gate, state, spentThisMonth, modeFor, priceOf, budgetUsd, resetCache,
  PRICE_LINK, PRICE_PLAIN, TRIM_AT, DEFAULT_BUDGET_USD,
};
