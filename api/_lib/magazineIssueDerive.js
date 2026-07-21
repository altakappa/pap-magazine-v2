/**
 * 발행호 자동 산출 (2026-07-21 도메니코 지시 — 폼 개편).
 * 커버 에디토리얼 하나만 고르면 발행연도·분기 시작월·기간라벨·커버이미지가
 * 그 에디토리얼의 발행일/이미지에서 자동 결정된다.
 */
'use strict';

var MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

/** 주어진 월(1-12)이 속한 분기의 시작월(1/4/7/10). */
function quarterStartMonth(m) {
  m = Math.max(1, Math.min(12, parseInt(m, 10) || 1));
  return m <= 3 ? 1 : m <= 6 ? 4 : m <= 9 ? 7 : 10;
}

/** "JUL–SEP 2026" 형식 분기 라벨. */
function quarterLabel(year, month) {
  var q = quarterStartMonth(month);
  return MON[q - 1] + '–' + MON[q + 1] + ' ' + year; // q, q+1, q+2 → 끝은 q+2 = MON[q+1]
}

/**
 * 커버 에디토리얼 행에서 발행호 자동 필드 산출.
 * @param {object} ed {published_date, cover_image, thumbnail, gallery}
 * @returns {{issue_year:?number, issue_month:?number, month_label:?string, cover_image:string}}
 */
function deriveFromCoverEditorial(ed) {
  if (!ed) return { issue_year: null, issue_month: null, month_label: null, cover_image: '' };
  var d = ed.published_date ? new Date(ed.published_date) : null;
  var valid = d && !isNaN(d.getTime());
  var year = valid ? d.getUTCFullYear() : null;
  var month = valid ? (d.getUTCMonth() + 1) : null;
  var cover = ed.cover_image || ed.thumbnail
    || (Array.isArray(ed.gallery) && ed.gallery.length ? ed.gallery[0] : '') || '';
  return {
    issue_year: year,
    issue_month: month ? quarterStartMonth(month) : null,
    month_label: (year && month) ? quarterLabel(year, month) : null,
    cover_image: String(cover || '').trim(),
  };
}

module.exports = { quarterStartMonth, quarterLabel, deriveFromCoverEditorial };
