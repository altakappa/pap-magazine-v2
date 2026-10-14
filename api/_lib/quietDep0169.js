'use strict';
/**
 * DEP0169(url.parse) 경고만 조용히 시킨다 (2026-10-14 건강 점검 후속)
 *
 * Vercel 의 Node 24 런타임 브리지(/opt/rust/nodejs.js)가 요청 URL 을 url.parse 로 읽어
 * 콜드스타트마다 stderr 에 DeprecationWarning 을 찍는다. 우리 코드에는 url.parse 가 없다
 * (nodemailer·web-push 안에 있지만 지연 로드라 이것과 무관).
 * 7일 Vercel "에러" 11,372건 중 사실상 전부가 이 경고라, 진짜 에러가 소음에 묻혔다.
 *
 * 왜 런타임을 22 로 내리지 않나: 8/18 에 CI·빌드·라이브를 Node 24 로 맞췄고
 * (tests/deploy-gate.test.js, ci-node-version.test.js) 되돌릴 이유가 아니다.
 * 왜 NODE_OPTIONS=--no-deprecation 이 아닌가: 다른 폐기 경고까지 전부 묻힌다.
 *
 * 방식: process.emitWarning 을 감싸 code DEP0169 (또는 그 문구) 만 버린다. 나머지는 그대로.
 * 모든 함수가 거치는 공용 모듈(supabase·cors·auth·cronGuard) 맨 위에서 1회 로드.
 * 브리지가 핸들러 로드 전에 먼저 경고를 찍는 구조라면 효과가 없다 → 배포 뒤 로그로 판정.
 */
if (!process.__papQuietDep0169) {
  process.__papQuietDep0169 = true;
  const orig = process.emitWarning;
  process.emitWarning = function (warning, a, b) {
    try {
      const code = (a && typeof a === 'object' && a.code) || (typeof b === 'string' ? b : null);
      const msg = typeof warning === 'string' ? warning : ((warning && warning.message) || '');
      if (code === 'DEP0169' || /url\.parse\(\)`? behavior is not standardized/.test(msg)) return;
    } catch (_) { /* 판정 실패면 그냥 통과시킨다 */ }
    return orig.apply(process, arguments);
  };
}
