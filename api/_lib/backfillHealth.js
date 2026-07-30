/**
 * 서술문 백필 건강도 판정 (2026-07-30 신설)
 *
 * 왜 만들었나 — 두 달간 조용히 새고 있었다:
 *   backfill-meta-desc 는 개별 항목 실패를 catch 로 삼키고 크론 전체는
 *   `ok=true` 로 기록한다. 그래서 이미지 URL 형태 문제로 성공률이 20% 로
 *   떨어져 있었는데도 아무 알림이 없었고, 커버리지가 38% 에서 멈춘 걸
 *   사람이 우연히 들여다볼 때까지 몰랐다. (근본원인: drive.google.com
 *   리다이렉트 링크를 Claude 가 못 가져와 호출 전체가 죽었다 — 커밋 097a427)
 *
 * 그래서 "크론이 돌았는가" 가 아니라 "실제로 텍스트가 생산되는가" 를 본다.
 *   ① 시도는 하는데 성공률이 임계 이하  → 생성 경로가 깨졌다
 *   ② 남은 게 있는데 시도조차 없다      → 크론/선별이 죽었다
 *
 * 순수 함수로 분리한 이유: 실제 실패 상황을 테스트로 재현하려면 DB 없이
 * 판정 로직만 돌려볼 수 있어야 한다.
 */

/** 표본이 이보다 적으면 판정하지 않는다(우연에 알림이 흔들리지 않도록). */
const MIN_SAMPLE = 12;
/** 이 성공률(%) 미만이면 이상. 정상 가동 시엔 70~100% 가 나온다. */
const MIN_SUCCESS_RATE = Number(process.env.BACKFILL_MIN_SUCCESS_RATE || 50);
/** 남은 작업이 있는데 이 시간 동안 시도조차 없으면 이상(크론은 10분 간격). */
const STALL_HOURS = Number(process.env.BACKFILL_STALL_HOURS || 2);

/**
 * @param {object} s
 *  - attempts   최근 창(window)에서 시도된 건수
 *  - successes  그중 서술문을 확보한 건수
 *  - remaining  아직 서술문이 없는 발행분 총계
 *  - lastAttemptAgoMs  마지막 시도가 얼마나 지났는지 (없으면 null)
 *  - windowHours 관측 창 길이(메시지용)
 */
function diagnoseBackfill(s, opts) {
  const o = opts || {};
  const minRate = o.minSuccessRate != null ? o.minSuccessRate : MIN_SUCCESS_RATE;
  const stallMs = (o.stallHours != null ? o.stallHours : STALL_HOURS) * 3600000;
  const minSample = o.minSample != null ? o.minSample : MIN_SAMPLE;

  const attempts = Number(s.attempts || 0);
  const successes = Number(s.successes || 0);
  const remaining = Number(s.remaining || 0);
  const rate = attempts > 0 ? Math.round((successes / attempts) * 1000) / 10 : null;

  // 할 일이 없으면 항상 정상 — 백필 완주 상태에서 알림이 오면 안 된다.
  if (remaining === 0) {
    return { healthy: true, reason: 'done', rate, attempts, successes, remaining };
  }

  // 남은 게 있는데 시도조차 끊겼다 → 크론·선별 함수가 죽었다
  const ago = s.lastAttemptAgoMs;
  if (ago == null || ago > stallMs) {
    return {
      healthy: false, kind: 'stalled', rate, attempts, successes, remaining,
      reason: ago == null ? '시도 기록이 없다' : Math.round(ago / 3600000) + '시간째 시도 없음',
    };
  }

  // 표본이 너무 적으면 판정 보류(정상으로 둔다 — 오탐이 알림 신뢰를 깎는다)
  if (attempts < minSample) {
    return { healthy: true, reason: 'sample<' + minSample, rate, attempts, successes, remaining };
  }

  if (rate < minRate) {
    return {
      healthy: false, kind: 'low_rate', rate, attempts, successes, remaining,
      reason: '성공률 ' + rate + '% (기준 ' + minRate + '%)',
    };
  }
  return { healthy: true, reason: 'ok', rate, attempts, successes, remaining };
}

/** 텔레그램 알림 문안. 원인 후보를 함께 적어 사람이 바로 확인할 수 있게 한다. */
function buildBackfillAlert(d, site) {
  const S = site || 'https://www.pap-magazine.com';
  if (d.kind === 'stalled') {
    return {
      title: '🚧 서술문 백필 정지 — AI 검색 인용 텍스트 생산 중단',
      lines: [
        `남은 발행분 ${d.remaining}건, ${d.reason}`,
        '확인: Vercel 크론 로그 · cron_runs 테이블 · CRON_SECRET',
      ],
      url: `${S}/admin`, urlLabel: '어드민',
    };
  }
  return {
    title: `⚠️ 서술문 백필 성공률 저하 — ${d.rate}%`,
    lines: [
      `최근 시도 ${d.attempts}건 중 ${d.successes}건만 생성 (남은 ${d.remaining}건)`,
      '흔한 원인: ① Anthropic 크레딧 소진 ② 이미지 URL 을 AI 가 못 받음',
      '(2026-07-30 사례: 드라이브 리다이렉트 링크 → base64 전달로 해결)',
    ],
    url: `${S}/admin`, urlLabel: '어드민',
  };
}

module.exports = { diagnoseBackfill, buildBackfillAlert, MIN_SAMPLE, MIN_SUCCESS_RATE, STALL_HOURS };
