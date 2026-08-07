/**
 * 프런트가 필요한 공개 설정 — /api/content/config (2026-08-07 신설)
 *
 * 왜 필요한가 ────────────────────────────────────────────────────────
 * 카카오 JavaScript 키는 SSR 페이지에는 서버가 직접 심어 준다. 그런데
 * SPA(사이트 안에서 클릭해 들어가는 화면)는 정적 HTML 이라 서버가 값을
 * 끼워 넣을 자리가 없다. 그래서 프런트가 물어볼 창구를 하나 만든다.
 *
 * ⚠️ **공개해도 되는 값만 여기 넣는다.** JavaScript 키는 원래 HTML 에
 *    노출되는 공개 키이고, 보안은 카카오 콘솔의 도메인 화이트리스트가
 *    담당한다. 어드민 키·REST 키·시크릿은 절대 여기에 두지 말 것.
 *    이 파일은 인증 없이 누구나 부를 수 있다.
 */

'use strict';

const { handleCors } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  /* 값이 거의 안 바뀌므로 CDN 에 오래 물려 둔다 — 기사마다 부르는 요청이라
     캐시가 없으면 함수 호출이 조회수만큼 늘어난다. */
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({
    kakaoJsKey: process.env.KAKAO_JS_KEY || '',
  });
};
