/**
 * productionHealth.js — "돌았다 ≠ 했다" 를 크론 전체에 대해 한 번에 (2026-09-03 신설)
 *
 * ■ 왜 만들었나
 * 이 교훈으로 만든 건강검사가 이미 다섯 개다 — faqHealth · backfillHealth ·
 * translateHealth · cronDurationHealth · aiCreditWatch. 전부 **사고가 난 뒤에
 * 그 크론 전용으로** 만들었다. 사고당 하나씩 만드는 구조라 새 크론은 언제나
 * 무방비다. 2026-08-28 에 새로 만든 faqEnBackfill 이 그 증거고, 같은 함정을
 * 전부 밟았다(조용한 0건 · 잘린 응답 · 끝낼 수 없는 콜).
 *
 * 그리고 그 검사들은 cron_runs.note **문자열을 정규식으로 파싱**한다.
 * ('FAQ 7/10 · 잔여 227') note 문구를 바꾸면 감시가 조용히 눈이 먼다.
 *
 * ■ 이 파일이 하는 일
 * 크론이 신고한 숫자(produced / remaining, 마이그레이션 142)만 본다.
 * 질문은 크론 종류와 무관하게 하나다:
 *
 *   "생산 0이 N회 연속인데 잔여가 0이 아니다" → 앞이 막혔다.
 *
 * 잔여도 0이면 **완주**다. 정상이고 알리지 않는다 — 완주한 크론이 매일
 * 알림을 보내면 사람이 이 경보 전체를 무시하게 된다.
 *
 * ■ 아무것도 require 하지 않는다
 * DB·네트워크 없이 규칙만 검증할 수 있어야 한다. 2026-07-30 에 테스트가
 * supabase 클라이언트를 만들어 CI 를 깨뜨린 교훈을 faqHealth 가 적어 뒀고,
 * 나도 8/28 에 aiVisibility 에서 같은 데 걸렸다. 여기서는 처음부터 안 만든다.
 *
 * ■ 신고하지 않는 크론은 판단하지 않는다
 * produced 가 null 이면 "0건" 이 아니라 "모른다" 다. 모르는 걸 막혔다고
 * 부르면 헛알림이 되고, 헛알림은 진짜 경보를 죽인다.
 * 미신고 크론 목록은 **부채로 따로 센다** — 줄어야 할 숫자다.
 */

'use strict';

/* 이 횟수 이상 연속 0이어야 '막혔다' 고 부른다. 표본이 적으면 우연히 0일 수
   있다(마침 배치가 다 실패). 크론 주기가 다양하므로 회차로 센다. */
const MIN_ZERO_RUNS = 6;

/**
 * 한 크론의 최근 실행들(최신순) → 판정.
 * @param {Array<{produced:?number, remaining:?number, ok:boolean}>} runs 최신순
 * @returns {{status:'막힘'|'완주'|'생산중'|'미신고'|'잔여미상'|'표본부족',
 *            zeroStreak:number, remaining:?number, reported:number}}
 */
function judgeCron(runs) {
  const list = Array.isArray(runs) ? runs : [];
  /* 신고한 실행만 본다. 미신고 실행은 분모에서 뺀다 — 섞으면 "0건" 과
     "모른다" 가 한 통에 담겨 둘 다 의미를 잃는다. */
  const reported = list.filter((r) => r && typeof r.produced === 'number');
  if (!reported.length) return { status: '미신고', zeroStreak: 0, remaining: null, reported: 0 };

  // 최신부터 연속 0 이 몇 회인지
  let zeroStreak = 0;
  for (const r of reported) {
    if (r.produced === 0) zeroStreak++;
    else break;
  }

  // 잔여는 가장 최근에 신고된 값을 쓴다.
  const withRem = reported.find((r) => typeof r.remaining === 'number');
  const remaining = withRem ? withRem.remaining : null;

  if (zeroStreak === 0) return { status: '생산중', zeroStreak, remaining, reported: reported.length };
  if (remaining === 0) return { status: '완주', zeroStreak, remaining, reported: reported.length };
  /* 잔여를 모르면 **판단하지 않는다.** 0건이 계속돼도 그게 완주인지 막힘인지
     가를 근거가 없다. 여기서 '막힘' 이라고 부르면 완주한 크론이 매번 알림을
     보내고, 헛알림은 진짜 경보를 죽인다. 대신 부채로 세어 보이게 한다 —
     remaining 을 신고하도록 고치면 그때부터 판단할 수 있다. */
  if (remaining === null) {
    return { status: '잔여미상', zeroStreak, remaining, reported: reported.length };
  }
  if (reported.length < MIN_ZERO_RUNS) {
    return { status: '표본부족', zeroStreak, remaining, reported: reported.length };
  }
  if (zeroStreak >= MIN_ZERO_RUNS) {
    return { status: '막힘', zeroStreak, remaining, reported: reported.length };
  }
  return { status: '생산중', zeroStreak, remaining, reported: reported.length };
}

/**
 * 크론별 실행 묶음 → 막힌 것들.
 * @param {Object<string, Array>} byCron  { cronName: runs[] }  (각 배열은 최신순)
 */
function findStalled(byCron) {
  const stalled = [];
  const silent = [];    // 신고 자체를 안 하는 크론 — 감시 사각지대(부채)
  const unknown = [];   // 생산은 신고하는데 잔여를 안 줘서 판단 못 하는 크론(부채)
  for (const [name, runs] of Object.entries(byCron || {})) {
    const v = judgeCron(runs);
    if (v.status === '막힘') stalled.push({ cron: name, ...v });
    else if (v.status === '미신고') silent.push(name);
    else if (v.status === '잔여미상') unknown.push(name);
  }
  // 잔여가 많은 쪽이 급하다.
  stalled.sort((a, b) => (b.remaining || 0) - (a.remaining || 0));
  return { stalled, silent, unknown };
}

/** 텔레그램 문구. 새벽에 받아도 바로 판단되게 다음 행동까지 적는다. */
function buildStalledAlert(stalled) {
  if (!stalled || !stalled.length) return null;
  const lines = ['🔴 크론이 돌지만 생산이 0입니다 (' + stalled.length + '건)', ''];
  for (const s of stalled.slice(0, 6)) {
    lines.push('· ' + s.cron + ' — ' + s.zeroStreak + '회 연속 0건'
      + (s.remaining != null ? ' · 잔여 ' + s.remaining : ''));
  }
  if (stalled.length > 6) lines.push('… 외 ' + (stalled.length - 6) + '건');
  lines.push('');
  lines.push('잔여가 있는데 생산이 0이면 앞이 막힌 것입니다.');
  lines.push('먼저 볼 것: 해당 크론의 최근 로그에서 파싱 실패·타임아웃·필터 조건.');
  return lines.join('\n');
}

module.exports = { judgeCron, findStalled, buildStalledAlert, MIN_ZERO_RUNS };
