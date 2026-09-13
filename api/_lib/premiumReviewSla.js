'use strict';
/**
 * 프리미엄 우선 심사 SLA (도메니코 2026-09-13 확정).
 *
 *   프리미엄: 제출 후 2영업일 이내 심사 결과 · 그 외: 최대 7영업일.
 *   (실측 120일: 심사 중앙값 0.8일, 느린 10% 는 6일. 종전 공개 문구 "1~3영업일" 은 사이트,
 *    "7영업일" 은 접수 메일로 따로 놀았다 — 이 파일의 숫자가 전 문구의 단일 근거다.)
 *
 * 영업일 = 월~금(UTC 기준 요일). 공휴일은 세지 않는다 — 약속을 보수적으로 지키는 쪽이 안전하다.
 * 이 파일은 순수 계산 + 문구만 둔다. DB 조회는 크론(api/cron/premium-review-sla.js)이 한다.
 */

const PREMIUM_REVIEW_BUSINESS_DAYS = 2;
const STANDARD_REVIEW_BUSINESS_DAYS = 7;

/** from 이후 now 까지 지난 영업일 수(정수, 내림). 같은 날이면 0. */
function businessDaysBetween(from, now) {
  const a = new Date(from), b = new Date(now || Date.now());
  if (isNaN(a) || isNaN(b) || b <= a) return 0;
  // 날짜 단위로 자른다(UTC). 시작일 다음날부터 종료일까지 평일을 센다.
  const start = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const end = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  let n = 0;
  for (let t = start + 86400000; t <= end; t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/** 제출 시각 + N영업일 마감 시각(UTC 자정 기준 그 날의 끝). */
function businessDeadline(from, days) {
  const a = new Date(from);
  let t = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  let left = days;
  while (left > 0) {
    t += 86400000;
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return new Date(t + 86400000 - 1);   // 그 날 23:59:59.999 UTC
}

/** 프리미엄 회원의 pending 서브미션이 SLA 를 넘겼는가. */
function isPremiumOverdue(createdAt, now) {
  return businessDaysBetween(createdAt, now) > PREMIUM_REVIEW_BUSINESS_DAYS;
}

/** 제출 직후 운영자 알림 문구. */
function premiumSubmissionAlertText(submission, submitterLabel) {
  const title = String((submission && submission.title) || '').slice(0, 80);
  const due = businessDeadline((submission && submission.created_at) || Date.now(), PREMIUM_REVIEW_BUSINESS_DAYS);
  return '⭐ 프리미엄 회원 서브미션 — 우선 심사(2영업일 이내 결과 약속)'
    + '\n제목: ' + title
    + '\n제출자: ' + String(submitterLabel || '').slice(0, 80)
    + '\n결과 마감: ' + due.toISOString().slice(0, 10) + ' (UTC)'
    + '\nsubmission=' + ((submission && submission.id) || '');
}

/** 크론용 — 마감 넘긴 목록 문구. rows: [{id,title,created_at,label}] */
function overdueAlertText(rows, now) {
  if (!rows || !rows.length) return '';
  const lines = rows.slice(0, 20).map((r) =>
    '· ' + String(r.title || '').slice(0, 50) + ' — ' + businessDaysBetween(r.created_at, now) + '영업일 경과'
    + (r.label ? ' · ' + String(r.label).slice(0, 40) : '') + ' · submission=' + r.id);
  return '🚨 프리미엄 우선 심사 SLA 초과 ' + rows.length + '건 (약속: 2영업일 이내 결과)\n' + lines.join('\n')
    + (rows.length > 20 ? '\n… 외 ' + (rows.length - 20) + '건' : '');
}

module.exports = {
  PREMIUM_REVIEW_BUSINESS_DAYS,
  STANDARD_REVIEW_BUSINESS_DAYS,
  businessDaysBetween,
  businessDeadline,
  isPremiumOverdue,
  premiumSubmissionAlertText,
  overdueAlertText,
};
