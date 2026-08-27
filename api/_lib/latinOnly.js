'use strict';
/**
 * 라틴 전용 검증 (서버) — 2026-08-26 도메니코 지시: 브랜드명은 영어로만.
 *
 * 왜 서버에도 필요한가
 *   프론트(frontend/pap-name-validator.js)가 이미 제출을 막고 있지만 그것뿐이다.
 *   API 를 직접 호출하면 비라틴 브랜드명이 그대로 저장된다. 브랜드 집계(무료
 *   게재 자격)와 크레딧 수정 기능이 브랜드 문자열에 의존하게 되었으므로
 *   서버가 진실원천이어야 한다.
 *
 * 규칙은 프론트와 **같은 정규식**이다. 두 벌이 되면 화면은 통과인데 서버가
 * 거부하는 상황이 생긴다(이 저장소에서 반복된 사고 유형). 아래 NON_LATIN_RE 는
 * frontend/pap-name-validator.js:45 와 문자 대 문자로 같아야 하며,
 * tests/latin-only-parity.test.js 가 그것을 고정한다.
 *
 * 차단: 한글(자모·완성형)·일본어(히라가나·가타카나)·중국어(CJK)·키릴·히브리·아랍
 * 허용: 영문, 악센트 라틴(Hermès, Café, Niño, über), 숫자, 문장부호, @ _ .
 */

// frontend/pap-name-validator.js 와 동일 (복사 금지 — 바꾸려면 양쪽을 같이)
const NON_LATIN_RE = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u0400-\u052F\u0590-\u05FF\u0600-\u06FF]/;

/** 값이 라틴 전용인가. 빈 값은 통과(다른 검증이 필수 여부를 본다). */
function isLatinOnly(value) {
  return !NON_LATIN_RE.test(String(value == null ? '' : value));
}

/**
 * 여러 값을 한 번에 검사해 위반 목록을 돌려준다.
 * 응답에 "무엇이 문제인지" 담기 위한 것 — 그냥 400 만 주면 사용자가 못 고친다.
 * @param {Array<{label:string, value:string}>} entries
 * @returns {Array<{label:string, value:string}>} 위반 항목 (없으면 빈 배열)
 */
function findNonLatin(entries) {
  const bad = [];
  for (const e of entries || []) {
    if (!e) continue;
    if (!isLatinOnly(e.value)) bad.push({ label: String(e.label || ''), value: String(e.value || '') });
  }
  return bad;
}

module.exports = { NON_LATIN_RE, isLatinOnly, findNonLatin };
