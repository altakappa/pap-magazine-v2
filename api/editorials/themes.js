/**
 * GET /api/editorials/themes?lang=ko&perRow=10
 *
 * Returns 3 personalized theme rows for the home page. Each row contains the
 * theme metadata + a slice of editorials that match that theme's tags.
 *
 * Personalisation rules:
 *   - Anonymous: deterministic day-of-year rotation across the 7 themes
 *     (api/_lib/themes.js → pickAnonymousThemes). Same anonymous visitor
 *     gets the same picks all day, picks rotate at midnight UTC.
 *   - Logged in: top-3 themes ranked by the user's accumulated tag weights
 *     (user_preferences table, populated by /api/users/preferences). Falls
 *     back to the anonymous rotation if the user has zero tracked opens
 *     (= empty preferences → no signal yet).
 *
 * Response shape:
 *   {
 *     "personalized": boolean,           // true = derived from user prefs
 *     "rows": [
 *       {
 *         "themeId":  "dreamy",
 *         "label":    "몽환적이고 로맨틱한",
 *         "cards": [
 *           { "id":"<uuid>","title":"...","img":"<url>","date":"YYYY-MM-DD","tags":[...] },
 *           ...
 *         ]
 *       }, ... 3 rows
 *     ]
 *   }
 *
 * 60s edge cache; Vary on Authorization so authenticated users don't share
 * the anonymous-rotation cache entry.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { verifyToken } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { THEMES, THEME_BY_ID, safeLang, pickAnonymousThemes } = require('../_lib/themes');

// Home page splits theme rows across two containers (#aiThemeRows1 between
// Film and Shorts, #aiThemeRows2 below Shorts), 2 rows each per the
// "에디토리얼은 2/2/2 짝지어 노출" design rule. So the endpoint must return
// exactly 4 rows: 2 for the upper container, 2 for the lower one.
const ROW_COUNT = 4;
const DEFAULT_PER_ROW = 10;
const MAX_PER_ROW = 20;
// Pull a generous slice of recent published editorials in one shot, then
// bucket client-side per theme. Keeps the endpoint to a single DB round-trip.
// 200 is comfortably more than 3 themes × ~10 cards even with low overlap.
const POOL_SIZE = 200;

async function topUserThemes(userId) {
  // Aggregate weights per theme by summing across the user's tag rows that
  // intersect each theme's tag bundle. Done client-side because PG-side would
  // need an unnested-array join that's awkward with our schema.
  const { data, error } = await supabaseAdmin
    .from('user_preferences')
    .select('tag,weight')
    .eq('user_id', userId);
  if (error) {
    console.error('[themes] prefs read failed', error);
    return [];
  }
  if (!data || data.length === 0) return [];

  const tagWeight = {};
  data.forEach(function (row) { tagWeight[row.tag] = row.weight; });

  const scored = THEMES.map(function (theme) {
    let total = 0;
    theme.tags.forEach(function (t) { total += (tagWeight[t] || 0); });
    return { theme: theme, score: total };
  }).filter(function (s) { return s.score > 0; });

  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, ROW_COUNT).map(function (s) { return s.theme; });
}

function bucketCards(pool, themes, perRow) {
  // Each editorial can appear in multiple theme rows (e.g. a "dreamy +
  // surreal" piece). That's fine — natural cross-pollination. We dedupe
  // WITHIN a row (no card listed twice in the same row) but not across rows.
  return themes.map(function (theme) {
    const tagSet = new Set(theme.tags);
    const cards = [];
    for (let i = 0; i < pool.length && cards.length < perRow; i++) {
      const ed = pool[i];
      const edTags = Array.isArray(ed.tags) ? ed.tags : [];
      let matched = false;
      for (let j = 0; j < edTags.length; j++) {
        if (tagSet.has(edTags[j])) { matched = true; break; }
      }
      if (matched) cards.push(ed);
    }
    return { themeId: theme.id, cards: cards };
  });
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const lang = safeLang(String(req.query.lang || 'ko'));
  let perRow = parseInt(req.query.perRow, 10);
  if (!Number.isFinite(perRow) || perRow < 1) perRow = DEFAULT_PER_ROW;
  if (perRow > MAX_PER_ROW) perRow = MAX_PER_ROW;

  const user = verifyToken(req);
  let chosenThemes = [];
  let personalized = false;

  if (user && user.id) {
    chosenThemes = await topUserThemes(user.id);
    personalized = chosenThemes.length > 0;
  }
  if (chosenThemes.length === 0) {
    chosenThemes = pickAnonymousThemes();
  }
  // If personalized but fewer than ROW_COUNT themes have any signal, top up
  // from the anonymous rotation so the home always renders 3 rows.
  if (chosenThemes.length < ROW_COUNT) {
    const fillers = pickAnonymousThemes();
    for (let i = 0; i < fillers.length && chosenThemes.length < ROW_COUNT; i++) {
      const f = fillers[i];
      if (!chosenThemes.find(function (t) { return t.id === f.id; })) {
        chosenThemes.push(f);
      }
    }
  }

  try {
    const { data: pool, error } = await supabaseAdmin
      .from('editorials')
      .select('id,title,thumbnail,cover_image,published_date,tags,slug')
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .limit(POOL_SIZE);

    if (error) {
      console.error('[themes] pool fetch failed', error);
      return res.status(500).json({ message: 'Theme lookup failed' });
    }

    const normalizedPool = (pool || []).map(function (e) {
      return {
        id: e.id,
        title: e.title || '',
        img: e.thumbnail || e.cover_image || '',
        date: e.published_date ? String(e.published_date).split('T')[0] : '',
        tags: Array.isArray(e.tags) ? e.tags : [],
        slug: e.slug || '',
      };
    }).filter(function (e) { return e.title && e.img; });

    const buckets = bucketCards(normalizedPool, chosenThemes, perRow);

    const rows = buckets.map(function (b) {
      const theme = THEME_BY_ID[b.themeId];
      return {
        themeId: b.themeId,
        label: (theme && theme.labels[lang]) || (theme && theme.labels.en) || b.themeId,
        cards: b.cards,
      };
    });

    // Edge cache 60s, vary by Authorization so anon and logged-in don't share.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    res.setHeader('Vary', 'Authorization');
    res.status(200).json({ personalized: personalized, lang: lang, rows: rows });
  } catch (err) {
    console.error('[themes] uncaught', err);
    res.status(500).json({ message: 'Theme lookup failed' });
  }
};
