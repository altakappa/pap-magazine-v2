/**
 * GET /api/admin/competitor-scan — 경쟁 IG 계정 공개 데이터 수집 (관리자 전용)
 *
 * business_discovery(공개 조회)로 경쟁 매거진 계정의 프로필·최근 게시물
 * 지표를 가져온다. 완전히 공개된 데이터만 사용 (프로페셔널 계정 한정).
 *
 *   ?u=eyesmag,fastpapermag   쉼표 구분 사용자명 (최대 8개)
 *   ?limit=30                 계정당 최근 게시물 수 (기본 30, 최대 50)
 *
 * 반환: 계정별 { profile, media[] } — 분석은 호출자(Claude/운영자)가 수행.
 */

const { requireAdmin } = require('../_lib/auth');

const IG_API = 'https://graph.facebook.com/v25.0';

async function discover(username, limit) {
  const mediaSpec = 'media.limit(' + limit + '){caption,media_type,like_count,comments_count,timestamp,permalink}';
  const fields = 'business_discovery.username(' + username + '){username,name,biography,followers_count,follows_count,media_count,website,' + mediaSpec + '}';
  const url = IG_API + '/' + process.env.IG_USER_ID +
    '?fields=' + encodeURIComponent(fields) + '&access_token=' + process.env.IG_ACCESS_TOKEN;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { username, error: (j.error && j.error.message || ('HTTP ' + r.status)).slice(0, 200) };
  }
  const d = j.business_discovery || {};
  const media = ((d.media && d.media.data) || []).map((m) => ({
    type: m.media_type,
    likes: m.like_count == null ? null : m.like_count,
    comments: m.comments_count == null ? null : m.comments_count,
    ts: m.timestamp,
    permalink: m.permalink,
    caption_head: String(m.caption || '').slice(0, 200),
  }));
  return {
    username: d.username || username,
    name: d.name, biography: d.biography, website: d.website,
    followers: d.followers_count, follows: d.follows_count, media_count: d.media_count,
    media,
  };
}

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    return res.status(503).json({ error: 'IG env 미설정' });
  }
  const names = String((req.query && req.query.u) || '').split(',')
    .map((s) => s.trim().replace(/^@/, '')).filter(Boolean).slice(0, 8);
  if (!names.length) return res.status(400).json({ error: '?u=계정1,계정2 필요' });
  const limit = Math.max(5, Math.min(50, parseInt((req.query && req.query.limit) || '30', 10) || 30));

  const out = [];
  for (const n of names) {
    try { out.push(await discover(n, limit)); }
    catch (e) { out.push({ username: n, error: String(e && e.message || e).slice(0, 200) }); }
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ scanned_at: new Date().toISOString(), accounts: out });
};
