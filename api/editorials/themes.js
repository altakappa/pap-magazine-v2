/**
 * GET /api/editorials/themes?lang=ko&perRow=10
 *
 * Returns 4 personalized theme rows for the home page (split 2/2 across
 * the #aiThemeRows1 and #aiThemeRows2 containers per the "에디토리얼은
 * 2/2/2 짝지어 노출" design rule). Each row has theme metadata + a slice
 * of editorials matching that theme.
 *
 * Personalisation rules:
 *   - Anonymous: deterministic day-of-year rotation across the 7 themes
 *     (api/_lib/themes.js → pickAnonymousThemes). Same anonymous visitor
 *     gets the same picks all day, picks rotate at midnight UTC.
 *   - Logged in: top themes ranked by the user's accumulated tag weights
 *     (user_preferences table, populated by /api/users/preferences).
 *     Falls back to the anonymous rotation if the user has zero tracked
 *     opens (= empty preferences → no signal yet).
 *
 * Card scoring path (auto-selected per request):
 *   - SEMANTIC mode: when every chosen theme has a row in `theme_embeddings`,
 *     each row is filled by a `match_editorials_by_embedding` RPC call
 *     ranked by cosine similarity. Best quality, language-agnostic, plays
 *     nicely with sparse tags. Requires the migration + the
 *     /api/admin/backfill-embeddings endpoint to have run.
 *   - TAGS mode: graceful fallback when embeddings aren't present yet.
 *     The original 3-phase tag/keyword/filler bucketing — works without
 *     OpenAI and stays useful even on a dud OPENAI_API_KEY.
 *
 * Response shape:
 *   {
 *     "personalized": boolean,
 *     "mode":         "semantic" | "tags",
 *     "lang":         "ko",
 *     "rows": [{ themeId, label, cards: [{id,title,img,date,tags,slug,...}] }]
 *   }
 *
 * 60s edge cache; Vary: Authorization so anon + logged-in don't share.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { verifyToken } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { THEMES, THEME_BY_ID, safeLang, pickAnonymousThemes } = require('../_lib/themes');

// Home splits across two containers, 2 rows each → 4 rows total.
const ROW_COUNT = 4;
const DEFAULT_PER_ROW = 10;
const MAX_PER_ROW = 20;
// Pool the (near-)entire catalogue so theme matching considers every
// editorial — capping at 200 systematically excluded older work that
// genuinely matched. 60s edge cache makes the broader query cheap.
const POOL_SIZE = 3000;

async function topUserThemes(userId) {
  // Aggregate weights per theme by summing across the user's tag rows that
  // intersect each theme's tag bundle.
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

// 3-phase tag/keyword bucketing. Used as the TAGS-mode fallback when
// theme_embeddings aren't populated yet. Same logic as before pgvector
// landed; kept verbatim for graceful degradation.
function bucketCards(pool, themes, perRow) {
  return themes.map(function (theme) {
    const tagSet = new Set(theme.tags);
    const keywordSource = Array.isArray(theme.keywords) && theme.keywords.length > 0
      ? theme.keywords
      : theme.tags;
    const lowerTags = keywordSource
      .map(function (t) { return String(t || '').toLowerCase().trim(); })
      .filter(function (t) {
        if (t.length < 2) return false;
        const hasCJK = /[^\x00-\x7F]/.test(t);
        return hasCJK ? t.length >= 2 : t.length >= 3;
      });
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
      if (matched) { cards.push(ed); seenIds.add(ed.id); }
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
        if (matched) { cards.push(ed); seenIds.add(ed.id); }
      }
    }

    // Phase 3: top up with latest editorials (last-resort filler)
    if (cards.length < perRow) {
      for (let i = 0; i < pool.length && cards.length < perRow; i++) {
        const ed = pool[i];
        if (seenIds.has(ed.id)) continue;
        cards.push(ed); seenIds.add(ed.id);
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

  // QA #186 — themes refresh slowly (curation level). 5-min edge cache.
  // Personalized themes (auth'd users) bypass the cache by varying on
  // Authorization header — Vercel honours that automatically.
  // QA #294 — Disk IO 경고 대응. themes는 큐레이션 단위로 매우 안정적이라
  // 30분 Edge cache + 2시간 SWR로 강화. Vector RPC 호출 빈도 ~6배 감소.
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=7200');

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
  // Top up to ROW_COUNT from the anonymous rotation if the user-pref signal
  // was thin (covers the "1-2 themes weight, want 4 rows" case).
  if (chosenThemes.length < ROW_COUNT) {
    const fillers = pickAnonymousThemes();
    for (let i = 0; i < fillers.length && chosenThemes.length < ROW_COUNT; i++) {
      const f = fillers[i];
      if (!chosenThemes.find(function (t) { return t.id === f.id; })) {
        chosenThemes.push(f);
      }
    }
    // pickAnonymousThemes only returns 3; if we still need a 4th, walk the
    // global theme list in order to find one not already chosen.
    for (let i = 0; i < THEMES.length && chosenThemes.length < ROW_COUNT; i++) {
      const t = THEMES[i];
      if (!chosenThemes.find(function (c) { return c.id === t.id; })) {
        chosenThemes.push(t);
      }
    }
  }

  try {
    // ── Try SEMANTIC path ────────────────────────────────────────────────
    // Look up precomputed theme vectors. If we have one for every chosen
    // theme, use the pgvector RPC; otherwise fall back to TAGS mode.
    const { data: themeVecs } = await supabaseAdmin
      .from('theme_embeddings')
      .select('theme_id,embedding')
      .in('theme_id', chosenThemes.map(function (t) { return t.id; }));

    const vecByThemeId = {};
    (themeVecs || []).forEach(function (row) { vecByThemeId[row.theme_id] = row.embedding; });
    const haveAllVecs = chosenThemes.length > 0
      && chosenThemes.every(function (t) { return vecByThemeId[t.id]; });

    let buckets;
    let mode;

    if (haveAllVecs) {
      mode = 'semantic';
      // One RPC per theme, run in parallel. Each returns rows already
      // ranked by cosine similarity, so no client-side scoring.
      const results = await Promise.all(chosenThemes.map(function (t) {
        return supabaseAdmin.rpc('match_editorials_by_embedding', {
          query_embedding: vecByThemeId[t.id],
          match_count: perRow,
        }).then(function (r) {
          if (r.error) {
            console.error('[themes] match RPC failed for', t.id, r.error.message);
            return { themeId: t.id, cards: [] };
          }
          const cards = (r.data || []).map(function (e) {
            return {
              id: e.id,
              title: e.title || '',
              img: e.thumbnail || e.cover_image || '',
              date: e.published_date ? String(e.published_date).split('T')[0] : '',
              tags: Array.isArray(e.tags) ? e.tags : [],
              slug: e.slug || '',
            };
          }).filter(function (c) { return c.title && c.img; });
          return { themeId: t.id, cards: cards };
        });
      }));
      buckets = results;
    } else {
      mode = 'tags';
      console.warn('[themes] missing theme embeddings — falling back to tag bucketing. Hit /api/admin/backfill-embeddings.');
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
          searchText: (titleStr + ' ' + descStr).toLowerCase(),
        };
      }).filter(function (e) { return e.title && e.img; });

      buckets = bucketCards(normalizedPool, chosenThemes, perRow);
    }

    const rows = buckets.map(function (b) {
      const theme = THEME_BY_ID[b.themeId];
      return {
        themeId: b.themeId,
        label: (theme && theme.labels[lang]) || (theme && theme.labels.en) || b.themeId,
        cards: b.cards,
      };
    });

    // QA #294 — 중요 fix: 이전 코드는 여기서 Cache-Control을 60초로 덮어써서
    // line 148의 300초 설정이 무효화됐음. 결과적으로 Vector embedding RPC가
    // 1시간 분당 480회 호출되어 Disk IO 1/4를 차지. 캐시 헤더를 제거해서
    // line 148의 5분 캐시(SWR 30분)가 그대로 적용되도록.
    res.setHeader('Vary', 'Authorization');
    res.status(200).json({
      personalized: personalized,
      mode: mode,
      lang: lang,
      rows: rows
    });
  } catch (err) {
    console.error('[themes] uncaught', err);
    res.status(500).json({ message: 'Theme lookup failed' });
  }
};
