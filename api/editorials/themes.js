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
// Pool the entire (or near-entire) catalogue so theme matching considers
// every editorial, not just the most recent 200. We have 2000+ editorials
// — capping at 200 systematically excluded older work that genuinely
// matched a theme. 3000 leaves headroom and is still a single DB query.
// Since the endpoint is edge-cached for 60s, this DB hit happens at most
// once per minute, well within budget.
const POOL_SIZE = 3000;

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
  // WITHIN a row but not across rows.
  //
  // 3-phase matching so we exhaust the on-topic catalogue (2000+ editorials)
  // before falling back to "latest" filler:
  //   Phase 1 — Exact tag intersection (editorial.tags ∩ theme.tags).
  //             Strongest signal: admin explicitly tagged the piece with
  //             one of the theme's tag tokens.
  //   Phase 2 — Keyword search across title + description. Catches the
  //             majority of the catalogue that doesn't have explicit tags
  //             but whose title or copy mentions theme-related words
  //             ("dreamy", "shadow", "neon" etc.). Each theme tag is
  //             searched as a substring against the pre-lowercased
  //             searchText haystack — handles untagged editorials that
  //             still belong on a theme row. NOTE: this is heuristic
  //             matching; the proper fix is AI-driven semantic tagging
  //             (see HARNESS_CHECKLIST.md → AI tagging mission).
  //   Phase 3 — Latest-editorials padding ONLY if Phase 1 + 2 still under
  //             perRow. Last-resort filler so the row never looks broken.
  //
  // For 2000+ editorials with sparse tags, Phase 2 is what carries most
  // rows to a full 10-card length while staying topically relevant.
  return themes.map(function (theme) {
    const tagSet = new Set(theme.tags);
    // Lowercase versions of the theme's tag tokens for substring search
    // in Phase 2. Skip extremely short tokens (≤2 chars) that would
    // generate noise (e.g. "in", "a") — themes don't actually use any
    // such tokens currently but the filter is cheap insurance.
    const lowerTags = theme.tags
      .map(function (t) { return String(t || '').toLowerCase().trim(); })
      .filter(function (t) { return t.length >= 3; });
    const cards = [];
    const seenIds = new Set();

    // Phase 1: explicit tag-set intersection
    for (let i = 0; i < pool.length && cards.length < perRow; i++) {
      const ed = pool[i];
      const edTags = Array.isArray(ed.tags) ? ed.tags : [];
      let matched = false;
      for (let j = 0; j < edTags.length; j++) {
        if (tagSet.has(edTags[j])) { matched = true; break; }
      }
      if (matched) {
        cards.push(ed);
        seenIds.add(ed.id);
      }
    }

    // Phase 2: keyword search in title + description
    if (cards.length < perRow && lowerTags.length > 0) {
      for (let i = 0; i < pool.length && cards.length < perRow; i++) {
        const ed = pool[i];
        if (seenIds.has(ed.id)) continue;
        const hay = ed.searchText || '';
        if (!hay) continue;
        let matched = false;
        for (let j = 0; j < lowerTags.length; j++) {
          if (hay.indexOf(lowerTags[j]) !== -1) { matched = true; break; }
        }
        if (matched) {
          cards.push(ed);
          seenIds.add(ed.id);
        }
      }
    }

    // Phase 3: top up with latest editorials (last resort filler)
    if (cards.length < perRow) {
      for (let i = 0; i < pool.length && cards.length < perRow; i++) {
        const ed = pool[i];
        if (seenIds.has(ed.id)) continue;
        cards.push(ed);
        seenIds.add(ed.id);
      }
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
      .select('id,title,thumbnail,cover_image,published_date,tags,slug,description')
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .limit(POOL_SIZE);

    if (error) {
      console.error('[themes] pool fetch failed', error);
      return res.status(500).json({ message: 'Theme lookup failed' });
    }

    const normalizedPool = (pool || []).map(function (e) {
      // Pre-compute a single lowercase haystack of title + description so
      // Phase 2 keyword matching is one indexOf per theme tag instead of
      // re-stringifying for every editorial × theme combination.
      const titleStr = String(e.title || '');
      const descStr  = typeof e.description === 'string'
        ? e.description
        : (e.description ? JSON.stringify(e.description) : '');
      return {
        id: e.id,
        title: titleStr,
        img: e.thumbnail || e.cover_image || '',
        date: e.published_date ? String(e.published_date).split('T')[0] : '',
        tags: Array.isArray(e.tags) ? e.tags : [],
        slug: e.slug || '',
        // Lowercase haystack of title + description text. Used by Phase 2
        // keyword matching so editorials without explicit tags can still
        // be classified by their content (e.g. an editorial titled
        // "DREAMY VOYAGE" with no tags will still match the dreamy theme).
        searchText: (titleStr + ' ' + descStr).toLowerCase(),
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
