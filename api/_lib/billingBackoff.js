/**
 * 결제(크레딧·지출한도)로 막힌 외부 API 를 계속 때리지 않게 한다 (2026-11-24 신설).
 *
 * ■ 왜
 * OpenAI 는 2026-11-02 부터 22일, X 는 2026-11-12 부터 12일 동안 "돈이 없다"로
 * 거절했다. 그동안 크론은 같은 호출을 같은 간격으로 반복했다 — 임베딩 약
 * 1,050회(30분마다), X 지표 약 290회(1시간마다). 거절당하는 호출이라 과금은
 * 되지 않지만, **결제가 막힌 것을 이미 알면서 같은 간격으로 계속 묻는 것**은
 * 설계가 빠진 것이다. 도메니코: "헛돌지않게 해주고".
 *
 * ■ 무엇을 하나
 * 크론 주기는 건드리지 않는다(버셀 설정은 그대로). 크론은 계속 깨어나지만,
 * 창이 열릴 때까지 **외부 호출을 하지 않는다**. 창이 열리면 딱 한 번
 * 찔러 보고(probe), 성공하면 줄을 지워 즉시 정상으로 돌아간다.
 *   연속 1회 → 30분 뒤   2회 → 1시간   3회 → 2시간   4회 → 4시간
 *   5회 → 8시간          6회 이상 → 12시간(상한)
 * 22일이면 48회/일 × 22 = 1,056회가 아니라 약 45회로 줄어든다.
 *
 * ■ 왜 상한이 12시간인가
 * 충전은 사람이 한다. 충전 직후 최대 12시간을 기다리면 "고쳤는데 왜 안 도나"가
 * 된다. 그래서 상한을 반나절로 두고, 어드민에서 크론을 수동 호출하면
 * clear() 없이도 창을 무시하도록 force 를 받는다.
 *
 * ■ 설계 원칙
 *   · 절대 throw 하지 않는다. 백오프가 호출부를 죽이면 본말전도다.
 *     DB 를 못 읽으면 "막히지 않았다"로 답한다 — 조용히 멈추는 쪽이 더 나쁘다.
 *   · 3회 연속부터 shouldFail()=true. 호출부는 이때 5xx 를 반환해서
 *     cronGuard 가 ok=false 로 적게 한다. 11/02~11/24 동안 크론은 1,050번
 *     전부 ok=true 로 기록됐다 — 돌았다는 게 한 일은 아니다.
 *   · 상태는 api_billing_block 한 줄. 성공하면 지운다(히스토리는 cron_runs 가 가진다).
 */

'use strict';

const TABLE = 'api_billing_block';

/** 연속 n회째 거절 뒤 다음 시도까지 기다릴 분 */
const STEP_MIN = [30, 60, 120, 240, 480, 720];
const CAP_MIN = 720;          // 12시간
const FAIL_AFTER = 3;         // 연속 3회부터 크론을 실패로 찍는다

function waitMinutes(consecutive) {
  const i = Math.max(1, Number(consecutive) || 1) - 1;
  return i < STEP_MIN.length ? STEP_MIN[i] : CAP_MIN;
}

/* supabase 는 쓸 때만 늦게 부른다 — 이 파일을 require 하는 테스트가 env 없이 돈다
   (aiCreditWatch 가 같은 이유로 CI 를 통째로 죽인 적이 있다, 2026-07-30). */
function db() { return require('./supabase').supabaseAdmin; }

/**
 * 지금 이 자원을 호출해도 되나.
 * @returns {Promise<{skip:boolean, consecutive:number, nextAt:string|null,
 *                    blockedSince:string|null, shouldFail:boolean, waitMin:number}>}
 */
async function check(key) {
  const none = { skip: false, consecutive: 0, nextAt: null, blockedSince: null, shouldFail: false, waitMin: 0 };
  try {
    const { data, error } = await db().from(TABLE)
      .select('consecutive, next_attempt_at, blocked_since, last_status, last_kind')
      .eq('key', key).maybeSingle();
    if (error || !data) return none;
    const nextAt = data.next_attempt_at ? Date.parse(data.next_attempt_at) : 0;
    const consecutive = Number(data.consecutive) || 0;
    return {
      /* 창이 아직 안 열렸으면 건너뛴다. 열렸으면 딱 한 번 찔러 본다. */
      skip: Number.isFinite(nextAt) && Date.now() < nextAt,
      consecutive,
      nextAt: data.next_attempt_at || null,
      blockedSince: data.blocked_since || null,
      shouldFail: consecutive >= FAIL_AFTER,
      waitMin: waitMinutes(consecutive + 1),
      lastStatus: data.last_status || null,
      lastKind: data.last_kind || null,
    };
  } catch (e) {
    console.error('[billingBackoff] check 실패 — 막히지 않은 것으로 본다:', e && e.message);
    return none;
  }
}

/** 또 거절당했다. 연속 횟수를 올리고 다음 창을 뒤로 민다. */
async function recordBlocked(key, status, kind) {
  try {
    const cur = await check(key);
    const consecutive = (cur.consecutive || 0) + 1;
    const wait = waitMinutes(consecutive);
    const nextAt = new Date(Date.now() + wait * 60000).toISOString();
    await db().from(TABLE).upsert({
      key,
      blocked_since: cur.blockedSince || new Date().toISOString(),
      consecutive,
      last_status: Number(status) || null,
      last_kind: kind ? String(kind).slice(0, 24) : null,
      next_attempt_at: nextAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    return { consecutive, waitMin: wait, nextAt, shouldFail: consecutive >= FAIL_AFTER };
  } catch (e) {
    console.error('[billingBackoff] recordBlocked 실패:', e && e.message);
    return { consecutive: 0, waitMin: 0, nextAt: null, shouldFail: false };
  }
}

/** 됐다. 줄을 지워 즉시 정상으로 돌린다. */
async function clear(key) {
  try {
    await db().from(TABLE).delete().eq('key', key);
    return true;
  } catch (e) {
    console.error('[billingBackoff] clear 실패:', e && e.message);
    return false;
  }
}

/** 크론 note 에 그대로 쓸 한 줄 (사유·연속횟수·다음 시도). */
function describe(st) {
  if (!st || !st.consecutive) return '';
  const next = st.nextAt ? new Date(st.nextAt).toISOString().slice(11, 16) + 'Z' : '?';
  const since = st.blockedSince ? new Date(st.blockedSince).toISOString().slice(5, 10) : '?';
  return '결제 막힘 ' + st.consecutive + '회 연속(' + since + '부터) · 다음 시도 ' + next
    + ' · 그때까지 외부 호출 안 함';
}

module.exports = { check, recordBlocked, clear, describe, waitMinutes, STEP_MIN, CAP_MIN, FAIL_AFTER };
