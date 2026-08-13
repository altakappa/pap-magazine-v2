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
    // 웹 푸시 (B-7) — VAPID 공개키는 이름 그대로 공개용. 개인키는 절대 서버 밖으로 안 나간다.
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    /* 네이버 애널리틱스 계정번호 (2026-08-13 추가).
       왜 여기냐 — NAVER_ANALYTICS_ID 는 seoRenderer(SSR)에만 심겨 있었다.
       그런데 SSR 은 **봇에게만** 나간다. 사람은 정적 HTML 을 받으므로
       키를 넣어도 사람은 한 명도 측정되지 않았다. 카카오 키가 이미
       이 통로로 SPA 에 전달되고 있으니 같은 길을 쓴다.
       계정번호는 페이지 소스에 그대로 노출되는 공개값이다(카카오 JS 키와 같은 층). */
    naverAnalyticsId: process.env.NAVER_ANALYTICS_ID || '',
  });
};
