'use strict';
/**
 * 브랜드명 표기 철칙의 예외 목록 (도메니코 2026-09-14 "이건 예외로 두자").
 *
 * 철칙(brandCase.js)은 글자 덩어리마다 첫 글자만 대문자로 만든다. 그러면 MSGM 은 Msgm, iPhone 은 Iphone 이
 * 되어 인스타그램 태그가 어색해진다. 원래 표기가 약자(MSGM·MM6·SJYP)이거나 낙타 표기(iPhone)인 브랜드는
 * 여기 적힌 **공식 표기 그대로** 저장한다.
 *
 * 규칙:
 *   · 비교는 대소문자 무시(msgm / MSGM / Msgm 전부 → MSGM).
 *   · 한 단어짜리 항목은 브랜드명 안의 단어 단위로도 맞춘다("MM6 Maison Margiela" → MM6 만 예외, 나머지는 철칙).
 *   · 여러 단어짜리 항목은 브랜드명 전체가 맞을 때만("JW Anderson", "A-COLD-WALL*").
 *   · 목록에 없는 브랜드는 예외가 아니다. 추가는 이 파일 한 곳 + frontend/submission.html 의
 *     _PAP_BRAND_CASE_EXCEPTIONS (같은 목록, tests/submission-look-credit 이 두 목록이 같은지 대조).
 *
 * 넣지 않은 것(일부러): 공식 로고는 대문자지만 문장에서는 보통 첫 글자만 대문자로 쓰는 브랜드(Zara·Gucci·
 * Ganni·Amiri·Kenzo 등). 이런 건 철칙대로 간다. "로고가 대문자" 는 예외 사유가 아니다. 약자·낙타 표기만.
 */
const BRAND_CASE_EXCEPTIONS = [
  // 약자·이니셜
  'MSGM', 'MM6', 'SJYP', 'CDG', 'MCM', 'DKNY', 'OAMC', 'GCDS', 'MISBHV', 'IISE', 'ERL', 'COS', 'A.P.C.',
  'JW Anderson', 'Y-3', 'A-COLD-WALL*', 'GmbH', 'LVMH', 'YSL', 'MSCHF', 'TTSWTRS',
  // 낙타 표기·공식 표기가 대소문자 섞임
  'iPhone', 'iPad', 'MoMA', 'ADER error', 'eBay', 'YouTube', 'TikTok',
];

/** 소문자 키 → 공식 표기. 한 단어 항목(공백 없음)과 전체 항목을 따로 둔다. */
const WHOLE = new Map();
const TOKEN = new Map();
for (const b of BRAND_CASE_EXCEPTIONS) {
  const k = b.toLowerCase();
  WHOLE.set(k, b);
  if (!/\s/.test(b)) TOKEN.set(k, b);
}

module.exports = { BRAND_CASE_EXCEPTIONS, WHOLE, TOKEN };
