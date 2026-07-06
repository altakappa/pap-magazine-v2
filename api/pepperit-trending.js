/**
 * GET /api/pepperit-trending — "지금 페퍼릿에서 뜨는 이야기" 자동 선정.
 *
 * business_discovery 로 @pepperitmag 최근 25개 게시물의 좋아요·댓글 수를
 * 조회해 최근 7일 내 게시물 중 반응 점수(좋아요 + 댓글×3) 상위 3개의
 * permalink 를 반환한다. CDN 6시간 캐시 → 하루 최대 4회 갱신 = 매일 새 구성.
 * 랜딩(pepperit.html)이 이 목록으로 IG 임베드를 렌더링.
 */

const _IG_API = 'https://graph.facebook.com/v25.0';
const USERNAME = process.env.PEPPERIT_IG_USERNAME || 'pepperitmag';

module.exports = async function handler(req, res) {
  try {
    if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
      return res.status(503).json({ error: 'IG env 미설정' });
    }
    const fields = 'business_discovery.username(' + USERNAME +
      '){media.limit(25){permalink,like_count,comments_count,timestamp,media_type}}';
    const url = _IG_API + '/' + process.env.IG_USER_ID +
      '?fields=' + encodeURIComponent(fields) + '&access_token=' + process.env.IG_ACCESS_TOKEN;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error('business_discovery ' + r.status + ': ' + body.slice(0, 200));
    }
    const j = await r.json();
    const rows = (j.business_discovery && j.business_discovery.media && j.business_discovery.media.data) || [];

    const cutoff = Date.now() - 7 * 86400000;
    const scored = rows
      .filter((m) => m.permalink && m.timestamp && new Date(m.timestamp).getTime() >= cutoff)
      .map((m) => ({
        permalink: m.permalink,
        score: (m.like_count || 0) + (m.comments_count || 0) * 3,
        likes: m.like_count || 0,
        comments: m.comments_count || 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    // 7일 내 게시물이 없으면 최신 3개로 폴백
    const out = scored.length ? scored : rows.slice(0, 3).map((m) => ({ permalink: m.permalink, score: 0 }));

    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=21600, stale-while-revalidate=43200');
    return res.status(200).json({ data: out.filter((x) => x.permalink) });
  } catch (err) {
    console.error('[pepperit-trending] error:', err);
    return res.status(500).json({ error: 'trending failed' });
  }
};
