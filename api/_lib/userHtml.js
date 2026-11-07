'use strict';
/**
 * userHtml — 회원이 보낸 텍스트·HTML 의 **저장 단계 관문** (2026-11-07 보안감사 H-1·H-2)
 *
 * 왜 생겼나 — 커뮤니티 글 본문은 설계상 HTML 이다. 글쓰기 창이 contenteditable 이고
 * 그 `.innerHTML` 을 그대로 제출한다. 그런데 저장(`api/community/posts`)에도, 출력
 * (`frontend/community.html`)에도 검증이 하나도 없었다. 무료 회원 1명이 글 하나로
 * 커뮤니티를 보는 모든 방문자(관리자 포함) 브라우저에서 스크립트를 돌릴 수 있었다.
 * CSP 에 'unsafe-inline' 이 있어 CSP 도 이걸 막지 못한다.
 *
 * **역할 분담을 분명히 해 둔다 — 이 파일은 보증이 아니다.**
 *   · 진짜 보증은 출력 단계의 `papSanitizeHtml()` (frontend/community.html) 이다.
 *     브라우저 파서(DOMParser)로 파싱하고 **허용 목록**으로 태그·속성을 걸러낸다.
 *     정규식으로 HTML 을 파싱하는 살균기는 반드시 뚫리므로 파싱은 파서에 맡겼다.
 *   · 이 파일은 그 앞단의 **거부 목록 트립와이어**다. 정상 서식(b·i·a·img)에는 절대
 *     나오지 않는 패턴만 보고 **400 으로 되돌린다**. 조용히 깎아내지 않는 이유:
 *     깎아낸 결과가 여전히 위험한 '중간 상태'를 만들지 않기 위해서다. 걸리면 거부다.
 *   · 프런트는 anon 키로 DB 에 직접 INSERT 하는 경로도 갖고 있어(`SB.createPost`)
 *     이 API 를 건너뛸 수 있다. 그래서 이 층만으로는 부족하고, 출력 살균이 필수다.
 *     (제출 시점에도 프런트가 `papSanitizeHtml` 을 한 번 통과시킨다.)
 *
 * 길이 상한도 여기서 한 곳에 모은다 — 상한이 두 벌이면 한쪽만 고쳐진다.
 */

const MAX = {
  title: 200,
  content: 50000,   // data: 이미지가 본문에 들어갈 수 있어 넉넉히. 그래도 무한은 아니다.
  name: 60,
  bio: 500,
  website: 300,
  location: 80,
};

/* 실행 경로를 만드는 패턴만. 정상적인 리치텍스트 서식에는 나오지 않는다. */
const DANGEROUS = [
  // 태그 자체가 실행·탈취 수단인 것들 (텍스트로 쓰고 싶으면 &lt; 로 쓰면 된다)
  /<\s*\/?\s*(script|iframe|frame|frameset|object|embed|applet|form|input|button|textarea|select|base|meta|link|style|svg|math|template|noscript|portal)\b/i,
  // 태그 안의 이벤트 핸들러 속성. `<` 와 `>` 사이로 한정해 본문 산문의 오탐을 줄인다.
  /<[a-z][^>]*\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /data\s*:\s*text\s*\/\s*html/i,
  /<\s*!\s*\[\s*CDATA\s*\[/i,
];

function hasDangerousHtml(v) {
  const s = String(v == null ? '' : v);
  if (!s) return false;
  return DANGEROUS.some((re) => re.test(s));
}

/** 제어문자 제거 — 로그·이메일·CSV 로 흘러갈 때 줄을 깨거나 숨기는 데 쓰인다. */
function stripControl(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** 평문 필드(이름·소개·도시) 공통 정리: 제어문자 제거 → 양끝 공백 → 길이 상한. */
function cleanText(v, max) {
  const n = (typeof max === 'number' && max > 0) ? max : 200;
  return stripControl(v).trim().slice(0, n);
}

/**
 * 회원이 적은 URL — http/https 만 통과. 그 외(javascript:, data:, mailto:, 상대경로)는
 * 빈 문자열. 저장된 값이 프로필 패널에서 `<a href>` 로 렌더되므로 **저장 단계에서** 막는다
 * (api/_lib 규칙 '업로드 검증 규칙' 의 스킴 검증과 같은 취지).
 */
function safeHttpUrl(v) {
  const s = stripControl(v).trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (_) { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  return u.toString().slice(0, MAX.website);
}

module.exports = { MAX, DANGEROUS, hasDangerousHtml, stripControl, cleanText, safeHttpUrl };
