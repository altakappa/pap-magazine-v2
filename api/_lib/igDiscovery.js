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


/**
 * 공개 프로 계정의 최근 미디어를 **이미지 URL 까지** 가져온다 (2026-08-23).
 *
 * discoverAccount() 는 지표(좋아요·댓글)용이라 media_url 을 안 받는다.
 * 셀럽 속보는 이미지 자체가 필요해서 필드가 다르다.
 * children{media_url,media_type} 로 캐러셀 자식까지 편다
 * (pepperitImport.js 가 2026-07-06 에 실측으로 확인한 필드 조합).
 *
 * @param {string} username
 * @param {{maxCount?: number}} opts
 * @returns {Promise<Array>} media 배열 (실패 시 throw)
 */
async function discoverMediaWithImages(username, opts) {
  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    throw new Error('IG_ACCESS_TOKEN/IG_USER_ID 환경변수 미설정');
  }
  const maxCount = Math.max(1, Math.min(50, (opts && opts.maxCount) || 25));
  const out = [];
  let after = '';
  let guard = 0;
  while (out.length < maxCount && guard < 5) {
    guard++;
    // limit 12 — 25 는 Graph API 가 간헐적으로 "Please reduce the amount of data"
    // 와 20초 타임아웃을 내던 값이다 (pepperitImport.js 2026-07-12 기록).
    const mediaSpec = 'media.limit(12)' + (after ? '.after(' + after + ')' : '')
      + '{caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_url,media_type}}';
    const fields = 'business_discovery.username(' + username + '){username,name,' + mediaSpec + '}';
    const url = IG_API + '/' + process.env.IG_USER_ID
      + '?fields=' + encodeURIComponent(fields) + '&access_token=' + process.env.IG_ACCESS_TOKEN;
    let r;
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        r = await fetch(url, { signal: AbortSignal.timeout(25000) });   // 콜드 1회 재시도
      } else { throw e; }
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) {
      throw new Error('business_discovery 실패 (' + r.status + '): '
        + String((j.error && j.error.message) || '').slice(0, 200));
    }
    const media = j.business_discovery && j.business_discovery.media;
    const rows = (media && media.data) || [];
    out.push(...rows);
    const next = media && media.paging && media.paging.cursors && media.paging.cursors.after;
    if (!next || rows.length === 0) break;
    after = next;
  }
  return out.slice(0, maxCount);
}

/**
 * shortcode 로 특정 게시물 하나를 찾는다.
 * business_discovery 는 **최근 목록**만 준다 — 오래된 게시물은 못 찾는다.
 * 못 찾으면 null 을 돌려주고, 호출부가 사람에게 그 사실을 알린다(조용히 삼키지 않는다).
 */
async function findPostByShortcode(username, shortcode, opts) {
  const media = await discoverMediaWithImages(username, opts);
  const needle = '/' + String(shortcode) + '/';
  return media.find((m) => m.permalink && m.permalink.includes(needle)) || null;
}

module.exports = { discoverAccount, discoverMediaWithImages, findPostByShortcode };
