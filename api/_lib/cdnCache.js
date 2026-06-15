/**
 * QA #220 — shared CDN cache helper for public list endpoints.
 *
 * Sets a Cache-Control header that:
 *   - Lets Vercel's edge CDN serve the same response for 60 seconds to
 *     anonymous visitors, dramatically reducing the per-POP query rate
 *     on hot lists (editorials / articles / films / shorts) that the
 *     homepage and feed pages re-fetch on every visit.
 *   - Keeps `stale-while-revalidate` window open for 5 minutes so the
 *     next request triggers a background refresh without making the
 *     visitor wait.
 *   - Forces no-store for anything with an Authorization header so
 *     admin/staff never see a stale list right after they publish.
 *
 * Call this at the top of a GET handler BEFORE the supabase query so
 * the header is set even on the cached path. The header writes do not
 * change function behaviour for non-GET requests.
 *
 * Usage:
 *   const { setListCacheHeader } = require('../_lib/cdnCache');
 *   setListCacheHeader(req, res, { isPublic: requestedStatus === 'published' });
 */

function setListCacheHeader(req, res, opts) {
  opts = opts || {};
  const isPublic = !!opts.isPublic;
  const hasAuth = !!(req.headers && req.headers.authorization);
  const isGet = !req.method || req.method === 'GET';
  if (isPublic && !hasAuth && isGet) {
    // 60s edge cache + 5min stale-while-revalidate. max-age=0 keeps the
    // BROWSER from caching (so an admin's freshly published row shows
    // up after a hard refresh) while the edge POP keeps the burden
    // off Supabase.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  } else {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  }
}

module.exports = { setListCacheHeader };
