/**
 * Submission category (genre) normalization + whitelist.
 *
 * FIX-1 (2026-07-19) — the selected category used to live ONLY inside the
 * description JSON, so the dedicated `submissions.category` column was NULL for
 * every row and admin analytics (GROUP BY category) was blind. This module is
 * the single source of truth for the 8 categories offered in submission.html
 * (the `.genre-tag` buttons) and the normalization applied before persisting.
 *
 * Extracted from api/submissions/index.js so the rule can be regression-tested
 * directly (see tests/submission-category.test.js) instead of re-implementing
 * the logic in the test — a re-implemented copy would pass while production
 * drifts, which is exactly the blind spot this guards against.
 */

// Whitelist MUST stay in lockstep with the `.genre-tag` buttons in
// frontend/submission.html (currently 8: FASHION … ARTICLE).
const ALLOWED_CATEGORIES = [
  'FASHION', 'BEAUTY', 'ART', 'PORTRAIT',
  'STREET', 'FASHION SHOW', 'BACKSTAGE', 'ARTICLE',
];

/**
 * Normalize a raw `data.genre` array into the canonical, deduplicated,
 * whitelisted category list.
 *   - trim → collapse internal whitespace to a single space → UPPERCASE
 *   - drop anything not on the whitelist
 *   - drop duplicates (first occurrence wins, order preserved)
 *
 * The first surviving element is the "primary" category persisted into the
 * `submissions.category` column; the full list goes into description.genre.
 *
 * @param {*} list  expected to be an array; non-arrays yield [].
 * @returns {string[]} normalized, whitelisted, unique categories.
 */
function normalizeGenres(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const g of list) {
    const key = String(g == null ? '' : g).trim().replace(/\s+/g, ' ').toUpperCase();
    if (ALLOWED_CATEGORIES.includes(key) && !out.includes(key)) {
      out.push(key);
    }
  }
  return out;
}

module.exports = { ALLOWED_CATEGORIES, normalizeGenres };
