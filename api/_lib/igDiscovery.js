/**
 * Instagram business_discovery 공용 헬퍼 — 타 프로페셔널 계정의 공개
 * 프로필·게시물 지표 조회. (경쟁 분석·페퍼릿 수집 등에서 사용)
 * 완전히 공개된 데이터만 접근하며, PAP 비즈니스 계정 토큰을 사용한다.
 */

const IG_API = 'https://graph.facebook.com/v25.0';

/**
 * @param {string} username  조회할 공개 프로페셔널 계정
 * @param {number} limit     최근 게시물 수 (기본 30)
 */
async function discoverAccount(username, limit) {
  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    throw new Error('IG_ACCESS_TOKEN/IG_USER_ID 환경변수 미설정');
  }
  const n = Math.max(5, Math.min(50, limit || 30));
  const mediaSpec = 'media.limit(' + n + '){caption,media_type,like_count,comments_count,timestamp,permalink}';
  const fields = 'business_discovery.username(' + username + '){username,name,biography,followers_count,follows_count,media_count,website,' + mediaSpec + '}';
  const url = IG_API + '/' + process.env.IG_USER_ID +
    '?fields=' + encodeURIComponent(fields) + '&access_token=' + process.env.IG_ACCESS_TOKEN;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { username, error: (j.error && j.error.message || ('HTTP ' + r.status)).slice(0, 200) };
  }
  const d = j.business_discovery || {};
  return {
    username: d.username || username,
    name: d.name, biography: d.biography, website: d.website,
    followers: d.followers_count, follows: d.follows_count, media_count: d.media_count,
    media: ((d.media && d.media.data) || []).map((m) => ({
      type: m.media_type,
      likes: m.like_count == null ? null : m.like_count,
      comments: m.comments_count == null ? null : m.comments_count,
      ts: m.timestamp,
      permalink: m.permalink,
      caption_head: String(m.caption || '').slice(0, 200),
    })),
  };
}

module.exports = { discoverAccount };
