/**
 * IG 팔로워 유출입(flux) — 이탈을 재는 계기 (2026-08-22)
 * ────────────────────────────────────────────────────────────────────
 * 도메니코: "이탈자가 매일 100-200명인데 이탈하지 않게 하는 방법이 있을까?"
 *
 * ■ 먼저 정직하게 — API 가 안 알려주는 것
 *   · 누가 떠났는지 (팔로워 목록 diff 는 Graph API 에 없다)
 *   · 어느 게시물 때문인지 (게시물별 언팔 지표 없음)
 * 그래서 "이탈 방지"는 게시물·편성 판단이고 그건 도메니코 몫이다.
 * 코드가 할 수 있는 건 **언제 얼마나 떠났고, 그 직전 24시간에 무엇을
 * 올렸는지**를 나란히 보여주는 것까지다. 그게 이 모듈이다.
 *
 * ■ 산수
 *   API follower_count(period=day) = 그날 신규 팔로워(gains)
 *   스냅샷 일별 증감              = net
 *   이탈(unfollows)              = gains − net
 *
 * ■ 검증 전 상태 (2026-08-22, 솔직 고지)
 *   follower_count 지표는 문서 기준으로 넣었고 **실제 응답은 첫 크론 실행이
 *   확인한다.** 실패하면 로그에 'unsupported' 로 남고 아무것도 저장하지
 *   않는다 — igSnapshot 의 전환지표 커버리지와 같은 원칙(조용한 사각지대 금지).
 *
 * 순수 계산(computeUnfollows·isSpike)과 조회/저장을 분리 — 테스트가
 * supabase·fetch 없이 계산을 실행한다.
 */

'use strict';

const { supabaseAdmin } = require('./supabase');

const GRAPH = 'https://graph.facebook.com/v21.0';
const HANDLE = 'pap_magazine';

/** API follower_count 시계열 → [{day(KST 아님 — API 가 주는 date), gains}] */
function parseFollowerCountSeries(json) {
  const metric = json && Array.isArray(json.data)
    ? json.data.find((d) => d && d.name === 'follower_count') : null;
  if (!metric || !Array.isArray(metric.values)) return [];
  const out = [];
  for (const v of metric.values) {
    if (!v || v.value == null || !v.end_time) continue;
    /* end_time 은 그 날의 끝(자정 직후, 계정 시간대 기준). 하루 전 날짜가 그 값의 날이다. */
    const t = new Date(v.end_time).getTime();
    if (isNaN(t)) continue;
    out.push({ day: new Date(t - 12 * 3600 * 1000).toISOString().slice(0, 10), gains: Number(v.value) || 0 });
  }
  return out;
}

/**
 * 이탈 도출 — gains(API)와 net(장부 일별 증감)을 날짜로 맞춘다.
 * gains 가 없는 날은 이탈을 **모른다**고 한다(null). 0 이라고 지어내지 않는다.
 * gains < net 이면(이론상 불가, 실측 오차) 음수 이탈 대신 0 + 플래그.
 */
function computeUnfollows(fluxRows, ledgerDays) {
  const gainsBy = new Map((fluxRows || []).map((f) => [f.day, f.gains]));
  return (ledgerDays || []).map((d) => {
    const gains = gainsBy.has(d.day) ? gainsBy.get(d.day) : null;
    let unfollows = null, anomaly = false;
    if (gains != null) {
      unfollows = gains - d.delta;
      if (unfollows < 0) { unfollows = 0; anomaly = true; }
    }
    return { ...d, gains, unfollows, fluxAnomaly: anomaly };
  });
}

/**
 * 이탈 급증 판정 — 최근 값이 과거 분포의 (P50 + k×IQR) 를 넘으면 spike.
 * 과거 표본 8일 미만이면 판정하지 않는다(null) — 잡음으로 경보 울리지 않는다.
 */
function isSpike(history, todayValue, k) {
  const hist = (history || []).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (hist.length < 8 || typeof todayValue !== 'number') return null;
  const q = (p) => hist[Math.min(hist.length - 1, Math.max(0, Math.round((hist.length - 1) * p)))];
  const p50 = q(0.5), iqr = Math.max(1, q(0.75) - q(0.25));
  const threshold = p50 + (k || 2) * iqr;
  return { spike: todayValue > threshold, threshold: Math.round(threshold), p50 };
}

/** API 에서 최근 30일 gains 를 받아 upsert. 하루 1회면 충분 — 호출부가 가드. */
async function captureFlux() {
  const token = process.env.IG_ACCESS_TOKEN;
  const userId = process.env.IG_USER_ID;
  if (!token || !userId) return { status: 'skipped', detail: 'IG env 없음' };

  const url = `${GRAPH}/${userId}/insights?metric=follower_count&period=day`
    + `&access_token=${encodeURIComponent(token)}`;
  let json = null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    json = await r.json().catch(() => ({}));
    if (!r.ok) {
      /* 조용한 사각지대 금지 — 지표가 폐기됐으면 여기 로그가 알려준다 */
      console.warn('[igFlux] follower_count 미지원/실패:', r.status,
        JSON.stringify(json && json.error ? json.error : json).slice(0, 200));
      return { status: 'unsupported', detail: 'HTTP ' + r.status };
    }
  } catch (e) {
    return { status: 'failed', detail: String(e && e.message || e).slice(0, 200) };
  }
  const series = parseFollowerCountSeries(json);
  if (!series.length) return { status: 'empty', detail: 'follower_count 값 0건' };

  const rows = series.map((s) => ({ day: s.day, handle: HANDLE, gains: s.gains }));
  const { error } = await supabaseAdmin.from('ig_follower_flux')
    .upsert(rows, { onConflict: 'day,handle' });
  if (error) {
    /* 마이그레이션 134 미실행(42P01) — 계측 하나 때문에 크론을 붉게 만들지 않는다 */
    if (error.code === '42P01') return { status: 'no_table', detail: '마이그레이션 134 미실행' };
    return { status: 'failed', detail: error.message };
  }
  return { status: 'ok', days: rows.length };
}

/** 오늘(KST) 이미 gains 를 저장했으면 true — 시간당 크론에서 하루 1회 가드 */
async function fluxCapturedToday() {
  const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin.from('ig_follower_flux')
    .select('day').eq('handle', HANDLE).eq('day', todayKst)
    .gte('captured_at', new Date(Date.now() - 20 * 3600 * 1000).toISOString())
    .limit(1);
  if (error) return false;   // 표가 없거나 오류 → 캡처를 시도하게 둔다
  return !!(data && data.length);
}

module.exports = {
  parseFollowerCountSeries, computeUnfollows, isSpike,
  captureFlux, fluxCapturedToday, HANDLE,
};
