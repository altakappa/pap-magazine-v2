/**
 * PAP Magazine — Brand alias auto-extraction (Phase 0.5).
 *
 * Walks the credits + fashion fields of published editorials and harvests
 * every brand mention, runs each through brandAlias.normaliseAlias(), and
 * aggregates frequencies so admin can rubber-stamp the top-N into the
 * brands table.
 *
 * Two brand sources, both surveyed against the production-shape static
 * snapshot to confirm what the data actually looks like:
 *
 *   1. editorial.fashion[*]        — 2369/2374 editorials carry this; it's
 *                                    the canonical brand list and is brand-
 *                                    only by definition (no role filter).
 *   2. editorial.credits[*]        — credits is mixed crew (Photography,
 *                                    Hair, Stylist, …) + brand roles
 *                                    (Fashion by, Beauty by, 함께한 브랜드, …).
 *                                    Filter to the brand subset only.
 *
 * Three storage shapes seen in the wild — handle all of them defensively:
 *
 *   A. Display format:  { r: 'Fashion by', h: [{n: 'Brand', id: '@x'}] }
 *      (most common today; matches _normalizeCreditsForDisplay output)
 *   B. New admin form:  { roles: ['Fashion by'], name: 'Brand', instagram: '@x' }
 *      (newer admin saves)
 *   C. Legacy dict:     { 'Fashion by': '...', 'Photography': '...' }
 *      (oldest editorial entries before the array refactor)
 *
 * Output ranks aliases by total occurrences AND distinct-editorial count
 * so a single editorial that lists the same brand five times can't
 * dominate the leaderboard.  The endpoint also surfaces every role label
 * encountered (`role_stats`) and any role label NOT in BRAND_ROLE_LABELS
 * (`unknown_roles`) so we can iteratively widen the filter when running
 * against the live corpus reveals a label we missed.
 */

const { normaliseAlias } = require('./brandAlias');

// Roles in credits[] that signal brand entries. Spec §1.4 list + the
// "Beauty by" label observed in the static snapshot. Compared lowercased.
const BRAND_ROLE_LABELS = [
  // English
  'Brand', 'Brands',
  'Fashion', 'Fashion by', 'Fashion By',
  'Beauty', 'Beauty by', 'Beauty By',
  'Cosmetics', 'Cosmetics by',
  'Branded', 'Branded content',
  'Wearing', 'Outfit', 'Outfit by',
  // Korean
  '함께한 브랜드', '브랜드', '옷',
];

const BRAND_ROLES_LC = new Set(BRAND_ROLE_LABELS.map(function (s) { return s.toLowerCase(); }));

function isBrandRole(role) {
  if (!role) return false;
  return BRAND_ROLES_LC.has(String(role).trim().toLowerCase());
}

// Generic-noun tokens that appear in credit fields as placeholders or
// section labels (e.g. "@brand", "Wearing"). Live extraction surfaced
// `brand` 1563× — pure noise, never a real brand. Compared against the
// already-normalised alias key.
const STOP_ALIASES = new Set([
  'brand', 'brands',
  'wearing', 'outfit', 'outfits',
  'fashion', 'cosmetics',
  'beauty',
  'branded', 'branded_content',
  '함께한_브랜드', '브랜드', '옷',
  'na', 'none', 'tbd', 'unknown',
]);

function isStopAlias(normalized) {
  return STOP_ALIASES.has(normalized);
}

/**
 * Take a {n, id}-style entry and split-+-normalise into 0..N tokens.
 * The split handles the rare case where an admin pasted multiple brands
 * comma/semicolon/slash/pipe-separated into a single name field.
 *
 * Returns an array of {raw, normalized} so the caller can keep BOTH the
 * pre-normalisation sample (handy for "is this really balenciaga?" review)
 * AND the canonical key.
 */
function tokensFromHandle(handleObj) {
  if (!handleObj || typeof handleObj !== 'object') return [];
  // Prefer Instagram handle (more reliable than the human-typed display
  // name); fall back to display name when handle is absent.
  var raw = handleObj.id || handleObj.n || '';
  if (!raw) return [];
  var parts = String(raw).split(/[,;/|]/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var trimmed = parts[i].trim();
    if (!trimmed) continue;
    var norm = normaliseAlias(trimmed);
    if (!norm) continue;
    if (isStopAlias(norm)) continue;
    out.push({ raw: trimmed, normalized: norm });
  }
  return out;
}

/**
 * One editorial in, an array of brand-token records out. Also returns
 * every role label seen in credits so the aggregator can build a "what
 * else is in the corpus that we might be missing" report.
 */
function extractFromEditorial(editorial) {
  // {raw, normalized, source, role}
  //   source: 'fashion' (top-level fashion[] field) | 'credits' (credits[].r/role)
  //   role:   'fashion-field' for source=fashion, otherwise the literal role
  //           label (e.g. 'Fashion by', 'Beauty by'). Used by category
  //           inference + editorial_brands link table.
  var brandTokens = [];
  var seenRoles = [];     // every role label we saw (for stats)

  // Source 1: editorial.fashion[*] — always brand
  var fashion = editorial && editorial.fashion;
  if (Array.isArray(fashion)) {
    for (var i = 0; i < fashion.length; i++) {
      var toks = tokensFromHandle(fashion[i]);
      for (var j = 0; j < toks.length; j++) {
        brandTokens.push({ raw: toks[j].raw, normalized: toks[j].normalized, source: 'fashion', role: 'fashion-field' });
      }
    }
  } else if (fashion && typeof fashion === 'object' && Array.isArray(fashion.brands)) {
    // Some entries store fashion as { brands: [{n,id}, ...] } — handle.
    for (var k = 0; k < fashion.brands.length; k++) {
      var toks2 = tokensFromHandle(fashion.brands[k]);
      for (var l = 0; l < toks2.length; l++) {
        brandTokens.push({ raw: toks2[l].raw, normalized: toks2[l].normalized, source: 'fashion', role: 'fashion-field' });
      }
    }
  }

  // Source 2: editorial.credits[*] — only entries whose role is brand-y
  var credits = editorial && editorial.credits;

  if (Array.isArray(credits)) {
    for (var ci = 0; ci < credits.length; ci++) {
      var c = credits[ci];
      if (!c || typeof c !== 'object') continue;

      // Track ALL role labels for the stats report (even non-brand ones).
      // QA #302 — 다중 역할 모두 통계에 반영 (한 인물에 5개 역할이면 5건).
      if (c.r !== undefined) {
        if (c.r) seenRoles.push(String(c.r));
      } else if (Array.isArray(c.roles) && c.roles.length) {
        c.roles.forEach(function (r) { if (r) seenRoles.push(String(r)); });
      } else if (c.role) {
        seenRoles.push(String(c.role));
      }

      // Format A: display-shape {r, h}
      if (c.r !== undefined) {
        if (!isBrandRole(c.r)) continue;
        var h = Array.isArray(c.h) ? c.h : [];
        for (var hi = 0; hi < h.length; hi++) {
          var toks3 = tokensFromHandle(h[hi]);
          for (var ti = 0; ti < toks3.length; ti++) {
            brandTokens.push({ raw: toks3[ti].raw, normalized: toks3[ti].normalized, source: 'credits', role: String(c.r) });
          }
        }
        continue;
      }

      // Format B: admin-shape {roles|role, name, instagram}
      var roles = Array.isArray(c.roles) ? c.roles : (c.role ? [c.role] : []);
      var matchedRole = null;
      for (var ri = 0; ri < roles.length; ri++) {
        if (isBrandRole(roles[ri])) { matchedRole = String(roles[ri]); break; }
      }
      if (!matchedRole) continue;
      var toks4 = tokensFromHandle({ n: c.name, id: c.instagram });
      for (var oi = 0; oi < toks4.length; oi++) {
        brandTokens.push({ raw: toks4[oi].raw, normalized: toks4[oi].normalized, source: 'credits', role: matchedRole });
      }
    }
  } else if (credits && typeof credits === 'object') {
    // Format C: legacy dict {role: value}
    var keys = Object.keys(credits);
    for (var ki = 0; ki < keys.length; ki++) {
      var role = keys[ki];
      seenRoles.push(role);
      if (!isBrandRole(role)) continue;
      var val = credits[role];
      if (typeof val === 'string') {
        var toks5 = tokensFromHandle({ n: val });
        for (var si = 0; si < toks5.length; si++) {
          brandTokens.push({ raw: toks5[si].raw, normalized: toks5[si].normalized, source: 'credits', role: role });
        }
      } else if (val && typeof val === 'object') {
        var name = val.name || val.n;
        var ig   = val.instagram || val.id;
        var toks6 = tokensFromHandle({ n: name, id: ig });
        for (var ii = 0; ii < toks6.length; ii++) {
          brandTokens.push({ raw: toks6[ii].raw, normalized: toks6[ii].normalized, source: 'credits', role: role });
        }
      }
    }
  }

  return { brandTokens: brandTokens, seenRoles: seenRoles };
}

/**
 * Aggregate across the whole corpus. Output shape is exactly what the
 * /api/admin/extract-brand-aliases endpoint returns and what the CLI
 * script writes to disk.
 *
 * `frequent_threshold` defaults to 3 occurrences — anything ≥3 is
 * "worth registering as a brand", anything 1–2 goes to rare list for
 * manual review.
 */
function aggregate(editorials, opts) {
  opts = opts || {};
  var frequentThreshold = typeof opts.frequentThreshold === 'number' ? opts.frequentThreshold : 3;
  var collectLinks      = opts.collectLinks !== false;   // default ON; off saves memory
  // Caller decides which field to use as the editorial title — DB rows have
  // .title; static-snapshot entries have title injected as the dict key.
  var titleOf = typeof opts.titleOf === 'function'
    ? opts.titleOf
    : function (ed) { return (ed && ed.title) ? String(ed.title) : null; };

  var aliasMap = new Map();   // normalized → { occurrences, editorialKeys:Set, samples:Set, sources:Set, roles:Map<role,count> }
  var roleStats = new Map();  // role label → count
  var unknownRoles = new Set();
  var scanned = 0;
  var withBrandSignal = 0;
  var links = [];             // {editorial_title, alias, role, source} — duplicates collapsed downstream

  for (var i = 0; i < editorials.length; i++) {
    scanned++;
    var ed = editorials[i];
    var result = extractFromEditorial(ed);
    var edTitle = titleOf(ed);
    // Stable key for editorials_count: prefer title, fall back to id.
    var edKey = edTitle || (ed && ed.id) || null;

    // Record role stats
    for (var rsi = 0; rsi < result.seenRoles.length; rsi++) {
      var r = result.seenRoles[rsi];
      roleStats.set(r, (roleStats.get(r) || 0) + 1);
      if (!isBrandRole(r)) unknownRoles.add(r);
    }

    if (result.brandTokens.length > 0) withBrandSignal++;

    for (var bi = 0; bi < result.brandTokens.length; bi++) {
      var t = result.brandTokens[bi];
      var entry = aliasMap.get(t.normalized);
      if (!entry) {
        entry = {
          occurrences: 0,
          editorialKeys: new Set(),
          samples: new Set(),
          sources: new Set(),
          roles: new Map(),
        };
        aliasMap.set(t.normalized, entry);
      }
      entry.occurrences++;
      if (edKey) entry.editorialKeys.add(edKey);
      if (entry.samples.size < 5) entry.samples.add(t.raw);
      entry.sources.add(t.source);
      entry.roles.set(t.role, (entry.roles.get(t.role) || 0) + 1);

      if (collectLinks && edTitle) {
        links.push({
          editorial_title: edTitle,
          alias: t.normalized,
          role: t.role,
          source: t.source,
        });
      }
    }
  }

  // Flatten + sort
  var all = [];
  aliasMap.forEach(function (e, alias) {
    var roleObj = {};
    e.roles.forEach(function (count, role) { roleObj[role] = count; });
    all.push({
      alias: alias,
      occurrences_total: e.occurrences,
      editorials_count: e.editorialKeys.size,
      samples: Array.from(e.samples).slice(0, 5),
      sources: Array.from(e.sources).sort(),
      roles: roleObj,
    });
  });
  all.sort(function (a, b) {
    if (b.occurrences_total !== a.occurrences_total) return b.occurrences_total - a.occurrences_total;
    return b.editorials_count - a.editorials_count;
  });

  var frequent = all.filter(function (x) { return x.occurrences_total >= frequentThreshold; });
  var rare     = all.filter(function (x) { return x.occurrences_total <  frequentThreshold; });

  // Sort role_stats descending by count
  var roleStatsObj = {};
  Array.from(roleStats.entries())
    .sort(function (a, b) { return b[1] - a[1]; })
    .forEach(function (kv) { roleStatsObj[kv[0]] = kv[1]; });

  return {
    summary: {
      editorials_scanned: scanned,
      editorials_with_brand_signal: withBrandSignal,
      unique_aliases: all.length,
      frequent_count: frequent.length,
      rare_count: rare.length,
      frequent_threshold: frequentThreshold,
    },
    frequent_aliases: frequent,
    rare_aliases: rare,
    role_stats: roleStatsObj,
    unknown_roles: Array.from(unknownRoles).sort(),
    editorial_brand_links: collectLinks ? links : null,
  };
}

// ── Category inference ───────────────────────────────────────────────────
// Three-layer classifier (most specific signal wins):
//   1. role label    e.g. "Beauty by"      → 'beauty'
//   2. name keyword  e.g. *_cosmetics      → 'beauty'
//   3. hardcoded     e.g. tiffany          → 'jewelry'
//   default          → 'fashion'

// Role → category overrides. Anything not listed defaults to 'fashion'
// (since "Fashion by", "Wearing", "Outfit by", "함께한 브랜드" are all fashion).
var ROLE_TO_CATEGORY = {
  'beauty': 'beauty',
  'beauty by': 'beauty',
  'cosmetics': 'beauty',
  'cosmetics by': 'beauty',
};

// Substring keywords in the normalised alias. Order matters: first hit wins.
var KEYWORD_TO_CATEGORY = [
  // beauty
  ['cosmetics', 'beauty'], ['beauty', 'beauty'], ['makeup', 'beauty'],
  ['skincare', 'beauty'], ['fragrance', 'beauty'], ['perfume', 'beauty'],
  // jewelry
  ['jewelry', 'jewelry'], ['jewellery', 'jewelry'], ['bijoux', 'jewelry'],
  // footwear
  ['footwear', 'footwear'], ['sneakers', 'footwear'], ['_shoes', 'footwear'],
  ['boots', 'footwear'],
  // bag
  ['handbag', 'bag'], ['handbags', 'bag'],
];

// Hand-curated overrides for famous brands whose name carries no
// keyword signal. Keep small — admin curation will catch the rest.
var HARDCODED_CATEGORY = {
  // jewelry
  tiffany: 'jewelry', cartier: 'jewelry', boucheron: 'jewelry',
  swarovski: 'jewelry', davidyurman: 'jewelry', vancleefarpels: 'jewelry',
  bulgari: 'jewelry', mikimoto: 'jewelry', chaumet: 'jewelry',
  // footwear
  jimmychoo: 'footwear', christianlouboutin: 'footwear',
  drmartens: 'footwear', converse: 'footwear', vans: 'footwear',
  birkenstock: 'footwear', uggs: 'footwear', crocs: 'footwear',
  newbalance: 'footwear', salomon: 'footwear', hoka: 'footwear',
  // bag
  goyard: 'bag', longchamp: 'bag', mansurgavriel: 'bag',
  staud: 'bag', thejacquemus: 'bag',
  // beauty (no keyword in name)
  charlottetilbury: 'beauty', glossier: 'beauty', rarebeauty: 'beauty',
  fentybeauty: 'beauty', tartecosmetics: 'beauty', kosas: 'beauty',
  ilia: 'beauty', merit: 'beauty', tower28: 'beauty',
};

/**
 * Pick the best category for a brand given its normalized alias and the
 * role distribution observed during extraction.
 *
 * @param {string} alias                normalized brand_id
 * @param {Object} [rolesObj]           {roleLabel: count} — output of aggregate()
 * @returns {string}                    one of: fashion | beauty | jewelry | footwear | bag
 */
function inferCategory(alias, rolesObj) {
  // Layer 1: role label (most reliable when present)
  if (rolesObj) {
    var topRole = null, topCount = 0;
    Object.keys(rolesObj).forEach(function (r) {
      if (rolesObj[r] > topCount) { topRole = r; topCount = rolesObj[r]; }
    });
    if (topRole) {
      var roleCat = ROLE_TO_CATEGORY[String(topRole).toLowerCase()];
      if (roleCat) return roleCat;
    }
  }

  // Layer 2: hardcoded (specific brands we know)
  if (HARDCODED_CATEGORY[alias]) return HARDCODED_CATEGORY[alias];

  // Layer 3: keyword in name
  for (var i = 0; i < KEYWORD_TO_CATEGORY.length; i++) {
    if (alias.indexOf(KEYWORD_TO_CATEGORY[i][0]) !== -1) {
      return KEYWORD_TO_CATEGORY[i][1];
    }
  }

  return 'fashion';
}

module.exports = {
  BRAND_ROLE_LABELS,
  STOP_ALIASES,
  ROLE_TO_CATEGORY,
  KEYWORD_TO_CATEGORY,
  HARDCODED_CATEGORY,
  isBrandRole,
  isStopAlias,
  inferCategory,
  tokensFromHandle,
  extractFromEditorial,
  aggregate,
};
