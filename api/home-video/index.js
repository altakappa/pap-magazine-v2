/**
 * GET /api/home-video
 *
 * 요청(2026-07-21 도메니코): "유튜브에서 홈 영상을 바꿀 때마다 그 영상이
 * 홈페이지 영상으로 대체되게 해줘."
 *
 * PAP 유튜브 채널의 "대표 영상"(비구독자에게 채널 홈에 보이는 트레일러 =
 * brandingSettings.channel.unsubscribedTrailer)을 조회해 그 videoId 를 반환한다.
 * 프론트 홈 메인 플레이어(pap-content-api-sync.js#_papFilmAutoPlay)가 이 값이
 * 있으면 그걸 틀고, 없으면 기존대로 최신 필름을 튼다.
 *
 * 이렇게 하면 도메니코가 유튜브 채널에서 대표 영상만 바꾸면 홈페이지가
 * 자동으로 따라간다 — 사이트 코드나 관리자 조작이 필요 없다.
 *
 * env (youtube-sync 와 공유):
 *   YOUTUBE_API_KEY     — YouTube Data API v3 키
 *   YOUTUBE_CHANNEL_ID  — PAP 채널 ID (UC...)
 *
 * 응답:
 *   { "videoId": "5AvI0PwvMQ8" }   대표 영상이 설정돼 있을 때
 *   { "videoId": null }            미설정 / env 없음 / 조회 실패 (프론트가 폴백)
 *
 * 캐시: s-maxage=1800(30분) + SWR. 유튜브 쿼터를 아끼고, 대표 영상 변경은
 *   최대 30분 안에 반영된다. 채널 조회는 쿼터 1단위라 부담이 없지만, 홈은
 *   트래픽이 많은 페이지라 엣지 캐시로 원본 호출을 줄인다.
 */

const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const YT_API = 'https://www.googleapis.com/youtube/v3';

// 유튜브가 돌려주는 트레일러 값은 videoId 이지만, 과거 데이터나 실수로 전체
// URL 이 들어오는 경우가 있어 방어적으로 id 만 뽑는다.
function extractVideoId(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // 순수 videoId (유튜브 id 는 영숫자·_·- 로 11자 안팎)
  if (/^[A-Za-z0-9_-]{6,20}$/.test(s)) return s;
  const m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{6,20})/);
  return m ? m[1] : null;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // env 미설정이어도 200 + null 로 응답한다 — 프론트가 이걸 신호로 폴백한다.
  // (500 을 주면 프론트가 에러 처리에 빠져 폴백 경로가 흐려진다)
  if (!process.env.YOUTUBE_API_KEY || !process.env.YOUTUBE_CHANNEL_ID) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(200).json({ videoId: null, note: 'env 미설정' });
  }

  try {
    const q = new URLSearchParams({
      key: process.env.YOUTUBE_API_KEY,
      id: process.env.YOUTUBE_CHANNEL_ID,
      part: 'brandingSettings',
    });
    const r = await fetch(YT_API + '/channels?' + q.toString(), {
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const reason = (j.error && j.error.message) || r.status;
      console.warn('[home-video] YouTube API 실패:', String(reason).slice(0, 200));
      // 실패해도 200 + null — 홈이 깨지지 않게 프론트가 폴백한다
      res.setHeader('Cache-Control', 'public, s-maxage=120');
      return res.status(200).json({ videoId: null, note: 'youtube 조회 실패' });
    }

    const item = (j.items && j.items[0]) || null;
    const trailer = item && item.brandingSettings && item.brandingSettings.channel
      && item.brandingSettings.channel.unsubscribedTrailer;
    const videoId = extractVideoId(trailer);

    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({ videoId: videoId || null });
  } catch (err) {
    console.warn('[home-video] uncaught:', err && err.message);
    res.setHeader('Cache-Control', 'public, s-maxage=120');
    return res.status(200).json({ videoId: null, note: '예외' });
  }
};
