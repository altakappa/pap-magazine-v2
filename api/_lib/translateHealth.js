/**
 * 번역 백필 정체 판정 (2026-07-31 신설) — 의존 없는 순수 규칙.
 *
 * 왜 필요했나:
 *   es 는 7/24, ja 는 7/22 이후 한 건도 안 늘었는데 아무도 몰랐다. 크론은
 *   10분마다 성실히 돌았고 전부 ok 로 기록됐다 — 다만 저장이 0건이었다.
 *   "돌았다" 와 "생산했다" 는 다르고, 감시는 뒤쪽을 봐야 한다.
 *   같은 교훈을 서술문 백필(_lib/backfillHealth.js)에서 이미 한 번 배웠는데
 *   번역에는 적용하지 않았다. 이번엔 붙인다.
 *
 * 판정 기준 — 셋을 구분한다. 뭉뚱그리면 정상을 장애로, 장애를 정상으로 읽는다:
 *   ① 완주      — 잔량 0. 더 할 일이 없으니 생산이 0인 게 맞다.
 *   ② 정체      — 잔량이 있는데 창(window) 안에 생산이 0. 이게 진짜 장애다.
 *   ③ 느림      — 생산은 있으나 목표 속도에 못 미침. 알림 대상은 아니고 참고치.
 *
 * 이 파일은 아무것도 require 하지 않는다 — DB·네트워크 없이 규칙만 검증하기
 * 위해서다 (2026-07-30 에 테스트가 supabase 클라이언트를 만들어 CI 를 깨뜨린 교훈).
 */
'use strict';

/**
 * @param {object}  o
 * @param {number}  o.remaining     남은 번역 건수(전 언어 합)
 * @param {number}  o.producedInWindow  최근 창 안에 실제로 저장된 건수
 * @param {number}  o.windowHours   창 길이(시간)
 * @param {number} [o.runsInWindow] 창 안에 기록된 크론 실행 수 (원인 구분용)
 * @returns {{status:'done'|'stalled'|'slow'|'ok', remaining, perHour, etaHours, reason}}
 */
function judgeTranslateHealth(o) {
  const remaining = Math.max(0, Number(o && o.remaining) || 0);
  const produced = Math.max(0, Number(o && o.producedInWindow) || 0);
  const hours = Math.max(0.25, Number(o && o.windowHours) || 3);
  const runs = o && o.runsInWindow == null ? null : Number(o.runsInWindow);

  const perHour = Math.round((produced / hours) * 10) / 10;
  const etaHours = perHour > 0 ? Math.ceil(remaining / perHour) : null;

  if (remaining === 0) {
    return { status: 'done', remaining, perHour, etaHours: 0, reason: '전 언어 완주.' };
  }

  if (produced === 0) {
    /* 실행 자체가 없었는지, 실행은 했는데 생산이 0이었는지를 구분해 준다.
       전자는 크론·배포 문제, 후자는 번역 호출 문제 — 볼 곳이 다르다. */
    const reason = runs === 0
      ? `최근 ${hours}시간 크론 실행 기록이 없다. 크론 등록·배포를 먼저 본다.`
      : `최근 ${hours}시간 ${runs == null ? '' : runs + '회 실행했는데 '}저장 0건. 잔량 ${remaining}건.`;
    return { status: 'stalled', remaining, perHour: 0, etaHours: null, reason };
  }

  /* 하루 안에 못 끝나면 '느림'. 알림은 안 보낸다 — 느린 건 장애가 아니라
     설정 문제이고, 매번 울리면 진짜 정체 알림이 묻힌다. */
  if (etaHours != null && etaHours > 24) {
    return {
      status: 'slow', remaining, perHour, etaHours,
      reason: `시간당 ${perHour}건 · 잔량 ${remaining}건 → 완주까지 약 ${etaHours}시간.`,
    };
  }

  return {
    status: 'ok', remaining, perHour, etaHours,
    reason: `시간당 ${perHour}건 · 잔량 ${remaining}건 → 약 ${etaHours}시간 남음.`,
  };
}

/** 텔레그램 알림 문안. 정체일 때만 부른다. */
function buildTranslateAlert(d, site) {
  return {
    title: '🚨 번역 백필 정체 — 저장 0건',
    lines: [
      d.reason,
      '',
      '볼 곳: cron_runs 의 note (조합별 저장 건수·실패 사유가 한 줄로 남는다)',
      "  select ran_at, note from cron_runs where cron_name='backfill-translations' order by ran_at desc limit 5;",
      '',
      '흔한 원인: 배치가 호출 타임아웃을 넘김 · 429 · SEO_TRANSLATE_LANGS env 가 코드 기본값을 덮음',
    ],
    url: (site || '') + '/magazine',
    urlLabel: '매거진',
  };
}

module.exports = { judgeTranslateHealth, buildTranslateAlert };
