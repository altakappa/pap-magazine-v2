'use strict';
/**
 * 서브미션 "전부 영어로" 규칙 — 신규 제출(POST /api/submissions)과 재제출(PUT /api/submissions/[id])이
 * 같은 함수를 쓴다 (2026-09-10).
 *
 * 배경(도메니코): "서브미션시 모든 크레딧은 영어로만 써야 하는데 적용이 안 된 것 같아."
 * 조사 결과 두 구멍이 있었다.
 *   1) 서버는 브랜드명·핸들만 막고 있었다(8/26 결정 당시 대상이 브랜드). 팀 이름·역할·모델·
 *      에이전시·제목·아티스트 스테이트먼트·연락 이름은 프론트(pap-name-validator.js)만 막았다.
 *   2) 재제출(PUT) 경로에는 그 브랜드 검사조차 없었고, 9/5 에 넣은 자동번역 방어
 *      (품목 type·역할 role 표준화)도 없었다. 수정 요청 뒤 다시 올리는 판은 무엇이든 통과했다.
 *
 * 규칙은 프론트와 같은 정규식(latinOnly.NON_LATIN_RE). 두 벌이 되면 화면은 통과인데
 * 서버가 거부하는 상황이 생기므로, 여기 한 곳에서만 목록을 만든다.
 *
 * normalize(data): 자동번역 방어 — looks[].items[].type / team[].role / credits 키를 표준 영어값으로.
 * violations(data): 비라틴 문자가 든 항목 목록 [{label, value}]. 비어 있으면 통과.
 */
const { findNonLatin } = require('./latinOnly');
const { normalizeRole } = require('./creditRoles');
const { normalizeItemType } = require('./itemTypes');

function normalize(data) {
  if (!data || typeof data !== 'object') return data;
  const looks = Array.isArray(data.looks) ? data.looks : [];
  looks.forEach(function (lk) {
    if (!lk || !Array.isArray(lk.items)) return;
    lk.items.forEach(function (it) { if (it && it.type) it.type = normalizeItemType(it.type); });
  });
  const team = Array.isArray(data.team) ? data.team : [];
  team.forEach(function (m) { if (m && m.role) m.role = normalizeRole(m.role); });
  if (data.credits && typeof data.credits === 'object' && !Array.isArray(data.credits)) {
    const fixed = {};
    Object.keys(data.credits).forEach(function (k) {
      const nk = (normalizeRole(k) || k).toLowerCase().replace(/\s+/g, '_');
      fixed[nk] = (fixed[nk] || []).concat(data.credits[k]);
    });
    data.credits = fixed;
  }
  return data;
}

/** 검사 대상 전부를 {label, value} 로 편다. 라벨은 400 응답에 실려 "무엇이 문제인지" 알려준다. */
function entries(data) {
  const out = [];
  if (!data || typeof data !== 'object') return out;
  const looks = Array.isArray(data.looks) ? data.looks : [];
  looks.forEach(function (lk, li) {
    const items = (lk && Array.isArray(lk.items)) ? lk.items : [];
    items.forEach(function (it, ii) {
      if (!it) return;
      const label = 'Look ' + ((lk && lk.n) || (li + 1)) + ' item ' + (ii + 1);
      if (it.brand) out.push({ label: label + ' brand', value: it.brand });
      if (it.instagram) out.push({ label: label + ' handle', value: it.instagram });
    });
  });
  (Array.isArray(data.team) ? data.team : []).forEach(function (m, i) {
    if (!m) return;
    if (m.name) out.push({ label: 'Team ' + (i + 1) + ' name', value: m.name });
    if (m.role) out.push({ label: 'Team ' + (i + 1) + ' role', value: m.role });
    if (m.instagram) out.push({ label: 'Team ' + (i + 1) + ' handle', value: m.instagram });
  });
  (Array.isArray(data.models) ? data.models : []).forEach(function (m, i) {
    if (!m) return;
    if (m.name) out.push({ label: 'Model ' + (i + 1) + ' name', value: m.name });
    if (m.agency) out.push({ label: 'Model ' + (i + 1) + ' agency', value: m.agency });
    if (m.instagram) out.push({ label: 'Model ' + (i + 1) + ' handle', value: m.instagram });
    if (m.agencyInstagram) out.push({ label: 'Model ' + (i + 1) + ' agency handle', value: m.agencyInstagram });
  });
  if (data.title) out.push({ label: 'Title', value: data.title });
  if (data.artistStatement) out.push({ label: 'Artist statement', value: data.artistStatement });
  if (data.contactName) out.push({ label: 'Contact name', value: data.contactName });
  return out;
}

function violations(data) {
  return findNonLatin(entries(data));
}

/** 400 응답 본문. 코드는 BRAND_LATIN_ONLY 를 유지한다 — 프론트 _localizeApiError 와 테스트가 이 코드를 본다. */
function rejection(bad) {
  return {
    code: 'BRAND_LATIN_ONLY',
    message: 'All credits (names, roles, brands, handles), the title and the statement must be written in English (Latin letters): '
      + bad.map(function (x) { return x.value; }).join(', '),
    violations: bad,
  };
}

module.exports = { normalize, entries, violations, rejection };
