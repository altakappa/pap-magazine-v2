/**
 * PAP Magazine — 서버 렌더 페이지(화보·기사·브랜드)를 연 쪽의 이름(User-Agent)을 로그에 한 줄 남긴다 (2026-11-04)
 *
 * 왜: 2026-11-03 10:00~11:57 KST DB 가 멈췄다. 장애 직전 5분 DB 요청 약 1만 1,700건 중
 * Ahrefs 감사(분당 30쪽, 설정 실측) 몫은 약 1,500건 — 나머지 8배를 누가 보냈는지 알 수 없었다.
 * Vercel 런타임 로그에도, Supabase 로그에도 요청자 이름이 안 남았기 때문이다(Supabase 쪽은 우리 서버 'node').
 * 다음 폭주 때 범인을 바로 가리려고, 페이지 함수 맨 앞에서 한 줄만 찍는다.
 *
 * 형식:  [ssr-ua] <kind> <path> | <user-agent 160자>
 * 찾는 법: Vercel 런타임 로그에서 "[ssr-ua]" 검색, 요청 경로로 묶어 보거나 UA 로 센다.
 * 보존: Vercel Pro 런타임 로그는 1일 — 장애가 나면 하루 안에 봐야 한다.
 *
 * DB 에는 쓰지 않는다 — 폭주 순간에 DB 쓰기를 더하면 그게 또 부하다. 개인정보(IP)는 남기지 않는다.
 * 절대 throw 하지 않는다.
 */
'use strict';

function uaOf(req) {
  try {
    const h = (req && req.headers) || {};
    return String(h['user-agent'] || '').replace(/\s+/g, ' ').slice(0, 160) || '(없음)';
  } catch (_) { return '(읽기 실패)'; }
}

/** @param {string} kind 'editorial' | 'article' | 'brand' */
function logSsrUa(kind, req) {
  try {
    const path = String((req && req.url) || '').slice(0, 160);   // ?lang= 까지 (번역판 구분)
    console.log('[ssr-ua] ' + kind + ' ' + path + ' | ' + uaOf(req));
  } catch (_) { /* 로그 실패가 페이지를 막으면 안 된다 */ }
}

module.exports = { logSsrUa, uaOf };
