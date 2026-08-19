/**
 * aiCrawlLog.js — AI 크롤러가 어떤 글을 읽어 갔는지 기록 (2026-08-19 신설)
 *
 * ■ 왜 필요한가
 * 우리는 지금까지 AI 봇을 **버리기만** 했다. botDetect.isBot 이 조회수 오염을
 * 막으려고 걸러낸다. 맞는 처리다. 그런데 걸러낸 뒤 아무 데도 안 적었다.
 * 그래서 "AI 가 우리 어떤 기사를 읽고 있나" 를 물으면 답이 없었다.
 *
 * 그 답이 곧 시밀러웹이 세 번째 화면에서 팔던 것이다("Top landing pages
 * from chatbots"). 우리 서버 로그에 원본이 있는데 남에게 추정치를 사고 있었다.
 *
 * ■ 무엇을 적는가
 * 날짜 x 플랫폼 x 목적 x 경로 로 hits 만 올린다(ai_crawl_bump).
 * 행마다 INSERT 하지 않는다 — 봇 한 번에 한 행이면 금방 수백만이 된다.
 *
 * ■ 지키는 것
 * - 실패는 전부 삼킨다. 계측이 페이지 렌더를 막으면 안 된다 (ig-out 과 동일).
 * - AI 크롤러가 아니면 아무것도 안 한다. 구글봇·네이버 예티는 대상이 아니다.
 * - 표나 함수가 아직 없어도 안전하다 (RPC 실패 → warn 후 무시).
 *
 * ■ 한계 (G-2)
 * SSR 은 CDN s-maxage=300 이라 같은 URL 반복 요청은 함수에 안 닿는다.
 * 크롤러는 보통 같은 URL 을 연속으로 때리지 않아 영향이 작지만, 이 수치는
 * **하한선**이다. "최소 이만큼은 읽어 갔다" 로 읽는다.
 */

'use strict';

const { supabaseAdmin } = require('./supabase');
const { aiCrawlerInfo } = require('./aiTraffic');

/**
 * @param {object} req  Vercel/Node request
 * @returns {Promise<void>}  항상 조용히 끝난다.
 */
async function logAiCrawl(req) {
  try {
    const headers = (req && req.headers) || {};
    const info = aiCrawlerInfo(headers['user-agent']);
    if (!info) return;

    const path = String((req && req.url) || '').split('?')[0].slice(0, 300);
    if (!path) return;

    // 날짜는 UTC 기준. GSC·크론과 같은 기준을 쓴다 — 기준이 두 벌이면 대조가 깨진다.
    const day = new Date().toISOString().slice(0, 10);

    const { error } = await supabaseAdmin.rpc('ai_crawl_bump', {
      p_day: day,
      p_platform: info.platform,
      p_kind: info.kind,
      p_path: path,
    });
    if (error) console.warn('[ai-crawl] bump failed', error.message);
  } catch (e) {
    console.warn('[ai-crawl] threw', e && e.message);
  }
}

module.exports = { logAiCrawl };
