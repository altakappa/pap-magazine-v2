/**
 * PAP Magazine — Buffer 429 차단기 (circuit breaker)  2026-10-30 신설
 *
 * 왜 필요했나:
 *   Buffer 무료 플랜은 30일 롤링 3,000 요청이 상한이다(buffer.js 머리말).
 *   2026-10-23~28 에 drive-tiktok-post 가 같은 손상 영상을 10분마다 재시도하며
 *   (10-25 의 포기 로직 085e59a 가 **푸시되지 않아** 프로덕션엔 없었다)
 *   요청을 태웠고, 10-28 11:31 부터 모든 Buffer 호출이 429 로 죽었다.
 *   drive-tiktok-post 57회 연속, tiktok-reels 18회 연속, tiktok-post 까지 전멸.
 *
 *   429 를 "잠시 후 재시도" 로만 다루면 10분마다 또 한 요청을 태운다 →
 *   롤링 윈도가 비워질 틈이 없다. 연속 실패가 스스로 못 빠져나오는 구조.
 *
 * 하는 일:
 *   · check(): 쿨다운 중이면 {cooling:true, until} — 호출부는 Buffer 를 아예 부르지 않는다.
 *   · trip():  429 를 맞으면 ops_alert_state(key=buffer_rate_limit) 에
 *              until = now + BUFFER_429_COOLDOWN_MIN(기본 360분) 을 적는다.
 *              처음 걸릴 때만 {newly:true} 를 돌려줘 사람에게 한 번 알리게 한다.
 *
 * 설계 원칙:
 *   · DB 는 함수 안에서 늦게 require 한다 — 테스트가 env 없이 buffer.js 를
 *     require 해도 죽지 않게. DB 가 없거나 실패하면 '쿨다운 아님' 으로 본다
 *     (차단기 고장이 게시를 영구히 막는 일은 없게. 실패 모드가 안전한 쪽).
 *   · 쿨다운은 6시간이 기본이다. 24h 250 · 30일 3,000 상한 어느 쪽에 걸렸든
 *     6시간이면 하루 4번만 두드린다. 끝나면 자동으로 다시 시도한다.
 */

const KEY = 'buffer_rate_limit';
const COOLDOWN_MS = Math.max(5, Number(process.env.BUFFER_429_COOLDOWN_MIN || 360)) * 60 * 1000;

// 워밍된 람다 안에서 DB 를 매번 읽지 않기 위한 짧은 캐시
const _mem = { until: 0, at: 0 };
const MEM_TTL_MS = 60 * 1000;

function _db() {
  try { return require('./supabase').supabaseAdmin; } catch (_) { return null; }
}

/** @returns {Promise<{cooling:boolean, until:string|null}>} */
async function check() {
  const now = Date.now();
  if (_mem.until > now && now - _mem.at < MEM_TTL_MS) {
    return { cooling: true, until: new Date(_mem.until).toISOString() };
  }
  const db = _db();
  if (!db) return { cooling: false, until: null };
  try {
    const { data } = await db.from('ops_alert_state').select('last_payload').eq('key', KEY).maybeSingle();
    const until = Date.parse((data && data.last_payload && data.last_payload.until) || '') || 0;
    _mem.until = until; _mem.at = now;
    if (until > now) return { cooling: true, until: new Date(until).toISOString() };
  } catch (e) {
    console.warn('[bufferBreaker] check 실패 (쿨다운 아님으로 진행):', (e && e.message) || e);
  }
  return { cooling: false, until: null };
}

/**
 * 429 를 맞았을 때 호출. 쿨다운을 (재)설정한다.
 * @returns {Promise<{until:string, newly:boolean, n:number}>}
 */
async function trip(reason) {
  const now = Date.now();
  const until = now + COOLDOWN_MS;
  const wasCooling = _mem.until > now;
  _mem.until = until; _mem.at = now;
  const db = _db();
  if (!db) return { until: new Date(until).toISOString(), newly: !wasCooling, n: 1 };
  let prevUntil = 0; let n = 0;
  try {
    const { data } = await db.from('ops_alert_state').select('last_payload').eq('key', KEY).maybeSingle();
    prevUntil = Date.parse((data && data.last_payload && data.last_payload.until) || '') || 0;
    n = (data && data.last_payload && Number(data.last_payload.n)) || 0;
  } catch (_) { /* 읽기 실패해도 쓰기는 시도 */ }
  try {
    await db.from('ops_alert_state').upsert({
      key: KEY, updated_at: new Date(now).toISOString(),
      last_payload: { until: new Date(until).toISOString(), n: n + 1, last: String(reason || '').slice(0, 200), at: new Date(now).toISOString() },
    });
  } catch (e) {
    console.warn('[bufferBreaker] trip 기록 실패:', (e && e.message) || e);
  }
  return { until: new Date(until).toISOString(), newly: !(prevUntil > now) && !wasCooling, n: n + 1 };
}

/** 테스트/수동 복구용 — 메모리 캐시만 비운다 (DB 행은 사람이 지운다). */
function _reset() { _mem.until = 0; _mem.at = 0; }

module.exports = { check, trip, KEY, COOLDOWN_MS, _reset };
