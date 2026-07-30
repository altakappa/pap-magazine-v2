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
 *
 * ────────────────────────────────────────────────────────────────
 * 2026-07-30 2차 수정 — 감시가 실제보다 좋게 말하던 문제.
 *
 * 처음 만들 때 successes 를 "이 창에서 시도됐고 지금 설명이 있음" 으로 정의했다.
 * 직접 세는 수단이 없었기 때문인데(백필은 updated_at 을 갱신하지 않는다),
 * 이 간접 정의는 24시간 창에서 699건 성공이라고 말하면서 실제 커버리지는
 * +102 밖에 늘지 않는 상황을 만들었다. 감시가 과대평가하면 고장을 못 잡는다.
 *
 * → editorials.description_filled_at 도장을 새로 두고(migration
 *   editorials_description_filled_at), 이제 filled 가 실제 생산량이다.
 *   판정 기준도 filled 로 옮겼다. 다만 도장은 도입 시점부터 찍히므로
 *   전환기에는 분모를 attempts_since_stamp(첫 도장 이후 시도)로 좁혀
 *   '도장 없이 성공한 과거 시도' 가 오탐을 만들지 않게 한다.
 *   도장 이전(ever_filled=false)에는 구 지표로 판정한다 — 연속성 유지.
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
 *  - successes  그중 지금 설명을 갖고 있는 건수 (간접 지표 — 과대평가 가능)
 *  - filled     그 창에서 실제로 본문이 새로 채워진 건수 (description_filled_at)
 *  - attemptsSinceStamp  filled 의 분모 — 첫 도장 이후의 시도만
 *  - everFilled 도장이 한 번이라도 찍힌 적 있는지 (전환기 오탐 방지 스위치)
 *  - remaining  아직 서술문이 없는 발행분 총계
 *  - lastAttemptAgoMs  마지막 시도가 얼마나 지났는지 (없으면 null)
 */
function diagnoseBackfill(s, opts) {
  const o = opts || {};
  const minRate = o.minSuccessRate != null ? o.minSuccessRate : MIN_SUCCESS_RATE;
  const stallMs = (o.stallHours != null ? o.stallHours : STALL_HOURS) * 3600000;
  const minSample = o.minSample != null ? o.minSample : MIN_SAMPLE;

  const attempts = Number(s.attempts || 0);
  const successes = Number(s.successes || 0);
  const filled = Number(s.filled || 0);
  const attemptsSinceStamp = Number(s.attemptsSinceStamp || 0);
  const everFilled = !!s.everFilled;
  const remaining = Number(s.remaining || 0);

  /* 판정에 쓸 분자·분모를 고른다.
     도장이 있으면 실제 생산량(filled)으로, 없으면 구 지표(successes)로.
     basis 를 결과에 담아 알림에서 "무엇을 근거로 판정했는지" 가 보이게 한다. */
  const useFilled = everFilled && attemptsSinceStamp > 0;
  const num = useFilled ? filled : successes;
  const den = useFilled ? attemptsSinceStamp : attempts;
  const basis = useFilled ? 'filled' : 'successes(간접)';
  const rate = den > 0 ? Math.round((num / den) * 1000) / 10 : null;
  const base = { rate, basis, attempts, successes, filled, attemptsSinceStamp, remaining };

  // 할 일이 없으면 항상 정상 — 백필 완주 상태에서 알림이 오면 안 된다.
  if (remaining === 0) return { healthy: true, reason: 'done', ...base };

  // 남은 게 있는데 시도조차 끊겼다 → 크론·선별 함수가 죽었다
  const ago = s.lastAttemptAgoMs;
  if (ago == null || ago > stallMs) {
    return {
      healthy: false, kind: 'stalled', ...base,
      reason: ago == null ? '시도 기록이 없다' : Math.round(ago / 3600000) + '시간째 시도 없음',
    };
  }

  // 표본이 너무 적으면 판정 보류(정상으로 둔다 — 오탐이 알림 신뢰를 깎는다)
  if (den < minSample) return { healthy: true, reason: 'sample<' + minSample, ...base };

  /* 시도는 계속하는데 생산이 0 — 가장 명확한 고장이다.
     비율 기준과 따로 두는 이유: 0건은 '저하' 가 아니라 '정지' 이고,
     사람이 받는 문안도 달라야 한다(크레딧 소진·키 오류가 이 모양으로 온다). */
  if (useFilled && filled === 0) {
    return {
      healthy: false, kind: 'no_output', ...base,
      reason: `시도 ${attemptsSinceStamp}건 중 실제 생산 0건`,
    };
  }

  if (rate < minRate) {
    return {
      healthy: false, kind: 'low_rate', ...base,
      reason: '성공률 ' + rate + '% (기준 ' + minRate + '%, 근거 ' + basis + ')',
    };
  }
  return { healthy: true, reason: 'ok', ...base };
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
  if (d.kind === 'no_output') {
    return {
      title: '🛑 서술문 백필 생산 0건 — 시도는 하는데 아무것도 채우지 못한다',
      lines: [
        `${d.reason} (남은 ${d.remaining}건)`,
        '먼저 볼 것: Anthropic 크레딧 잔액 · ANTHROPIC_API_KEY',
        '그다음: 이미지 URL 을 AI 가 받는지 (드라이브 링크 → base64 전달)',
      ],
      url: `${S}/admin`, urlLabel: '어드민',
    };
  }
  return {
    title: `⚠️ 서술문 백필 성공률 저하 — ${d.rate}%`,
    lines: [
      `최근 시도 ${d.attemptsSinceStamp || d.attempts}건 중 ${d.filled != null && d.basis === 'filled' ? d.filled : d.successes}건만 생성 (남은 ${d.remaining}건)`,
      '흔한 원인: ① Anthropic 크레딧 소진 ② 이미지 URL 을 AI 가 못 받음',
      '(2026-07-30 사례: 드라이브 리다이렉트 링크 → base64 전달로 해결)',
    ],
    url: `${S}/admin`, urlLabel: '어드민',
  };
}

module.exports = { diagnoseBackfill, buildBackfillAlert, MIN_SAMPLE, MIN_SUCCESS_RATE, STALL_HOURS };
