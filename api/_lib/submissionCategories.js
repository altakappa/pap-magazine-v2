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
// 2026-09-07 — 브라우저 자동번역 역번역. 프론트는 data-genre 로 원본을 보내지만
// 옛 캐시 페이지·API 직접 호출은 번역된 라벨이 올 수 있다. 번역기가 8개 버튼에
// 내는 대표 표기만 담는다(ru·zh·ja·ko·de·fr·es·it). 키는 정규화된 대문자.
const GENRE_ALIASES = {
  // FASHION
  'МОДА': 'FASHION', '时尚': 'FASHION', '時尚': 'FASHION', 'ファッション': 'FASHION', '패션': 'FASHION',
  'MODE': 'FASHION', 'MODA': 'FASHION',
  // BEAUTY
  'КРАСОТА': 'BEAUTY', '美容': 'BEAUTY', '美': 'BEAUTY', 'ビューティー': 'BEAUTY', '뷰티': 'BEAUTY',
  'SCHÖNHEIT': 'BEAUTY', 'BEAUTÉ': 'BEAUTY', 'BELLEZA': 'BEAUTY', 'BELLEZZA': 'BEAUTY',
  // ART
  'ИСКУССТВО': 'ART', '艺术': 'ART', '藝術': 'ART', 'アート': 'ART', '芸術': 'ART', '아트': 'ART', '예술': 'ART',
  'KUNST': 'ART', 'ARTE': 'ART',
  // PORTRAIT
  'ПОРТРЕТ': 'PORTRAIT', '肖像': 'PORTRAIT', '人像': 'PORTRAIT', 'ポートレート': 'PORTRAIT', '초상': 'PORTRAIT', '인물': 'PORTRAIT',
  'PORTRÄT': 'PORTRAIT', 'RETRATO': 'PORTRAIT', 'RITRATTO': 'PORTRAIT',
  // STREET
  'УЛИЦА': 'STREET', 'СТРИТ': 'STREET', '街头': 'STREET', '街拍': 'STREET', 'ストリート': 'STREET', '스트리트': 'STREET', '거리': 'STREET',
  'STRASSE': 'STREET', 'STRAßE': 'STREET', 'RUE': 'STREET', 'CALLE': 'STREET', 'STRADA': 'STREET',
  // FASHION SHOW
  'ПОКАЗ МОД': 'FASHION SHOW', 'МОДНЫЙ ПОКАЗ': 'FASHION SHOW', '时装秀': 'FASHION SHOW', '時裝秀': 'FASHION SHOW',
  'ファッションショー': 'FASHION SHOW', '패션쇼': 'FASHION SHOW', 'MODENSCHAU': 'FASHION SHOW',
  'DÉFILÉ DE MODE': 'FASHION SHOW', 'DÉFILÉ': 'FASHION SHOW', 'DESFILE DE MODA': 'FASHION SHOW', 'SFILATA DI MODA': 'FASHION SHOW', 'SFILATA': 'FASHION SHOW',
  // BACKSTAGE
  'ЗАКУЛИСЬЕ': 'BACKSTAGE', 'ЗА КУЛИСАМИ': 'BACKSTAGE', '后台': 'BACKSTAGE', '後台': 'BACKSTAGE', 'バックステージ': 'BACKSTAGE', '舞台裏': 'BACKSTAGE',
  '백스테이지': 'BACKSTAGE', '무대 뒤': 'BACKSTAGE', 'HINTER DER BÜHNE': 'BACKSTAGE', 'COULISSES': 'BACKSTAGE', 'ENTRE BASTIDORES': 'BACKSTAGE', 'DIETRO LE QUINTE': 'BACKSTAGE',
  // ARTICLE
  'СТАТЬЯ': 'ARTICLE', '文章': 'ARTICLE', '記事': 'ARTICLE', '기사': 'ARTICLE', 'ARTIKEL': 'ARTICLE', 'ARTÍCULO': 'ARTICLE', 'ARTICOLO': 'ARTICLE',
};

function normalizeGenres(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const g of list) {
    let key = String(g == null ? '' : g).trim().replace(/\s+/g, ' ').toUpperCase();
    if (GENRE_ALIASES[key]) key = GENRE_ALIASES[key];
    if (ALLOWED_CATEGORIES.includes(key) && !out.includes(key)) {
      out.push(key);
    }
  }
  return out;
}

module.exports = { ALLOWED_CATEGORIES, GENRE_ALIASES, normalizeGenres };
