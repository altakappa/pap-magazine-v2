/**
 * PAP Magazine — 네트워크 계정 실시간 팔로워 수
 * Route: GET /api/network-stats   (공개, CDN 6시간 캐시)
 *
 * IG Graph API business_discovery 로 8개 공식 계정의 followers_count 를
 * 한 번에 조회한다. /network 페이지가 소비 — 표시 숫자가 항상 실측치.
 * 토큰/계정 조회 실패 시 해당 핸들만 생략 (프론트는 정적 폴백 유지).
 */

const HANDLES = [
  'pap_magazine', 'pap_celeb', 'papfashion_', 'papbeauty_',
  'pap_trends', 'papstudios_', 'pap_object', 'pap_icons',
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); return res.status(405).end(); }

  const token = process.env.IG_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;
  if (!token || !igUserId) return res.status(503).json({ error: 'IG env 미설정' });

  const out = {};
  // business_discovery 는 핸들당 1콜 — 6시간 캐시라 하루 최대 4회×8콜.
  await Promise.all(HANDLES.map(async (h) => {
    try {
      const u = 'https://graph.facebook.com/v21.0/' + igUserId
        + '?fields=business_discovery.username(' + h + '){followers_count,media_count}'
        + '&access_token=' + encodeURIComponent(token);
      const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return;
      const j = await r.json();
      const bd = j && j.business_discovery;
      if (bd && typeof bd.followers_count === 'number') {
        out[h] = { followers: bd.followers_count, media: bd.media_count || null };
      }
    } catch (_) { /* 개별 실패 무시 */ }
  }));

  // CDN 6시간 + stale 24시간 — 페이지 뜰 때마다 API 호출되지 않게.
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
  return res.status(200).json({ accounts: out, fetched_at: new Date().toISOString() });
};
