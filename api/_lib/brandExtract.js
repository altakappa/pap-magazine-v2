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
  var brandTokens = [];   // {raw, normalized, source}
  var seenRoles = [];     // every role label we saw (for stats)

  // Source 1: editorial.fashion[*] — always brand
  var fashion = editorial && editorial.fashion;
  if (Array.isArray(fashion)) {
    for (var i = 0; i < fashion.length; i++) {
      var toks = tokensFromHandle(fashion[i]);
      for (var j = 0; j < toks.length; j++) {
        brandTokens.push({ raw: toks[j].raw, normalized: toks[j].normalized, source: 'fashion' });
      }
    }
  } else if (fashion && typeof fashion === 'object' && Array.isArray(fashion.brands)) {
    // Some entries store fashion as { brands: [{n,id}, ...] } — handle.
    for (var k = 0; k < fashion.brands.length; k++) {
      var toks2 = tokensFromHandle(fashion.brands[k]);
      for (var l = 0; l < toks2.length; l++) {
        brandTokens.push({ raw: toks2[l].raw, normalized: toks2[l].normalized, source: 'fashion' });
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
      var roleSeen = c.r !== undefined ? c.r
                    : (Array.isArray(c.roles) && c.roles.length ? c.roles[0] : c.role);
      if (roleSeen) seenRoles.push(String(roleSeen));

      // Format A: display-shape {r, h}
      if (c.r !== undefined) {
        if (!isBrandRole(c.r)) continue;
        var h = Array.isArray(c.h) ? c.h : [];
        for (var hi = 0; hi < h.length; hi++) {
          var toks3 = tokensFromHandle(h[hi]);
          for (var ti = 0; ti < toks3.length; ti++) {
            brandTokens.push({ raw: toks3[ti].raw, normalized: toks3[ti].normalized, source: 'credits' });
          }
        }
        continue;
      }

      // Format B: admin-shape {roles|role, name, instagram}
      var roles = Array.isArray(c.roles) ? c.roles : (c.role ? [c.role] : []);
      var matchesAny = false;
      for (var ri = 0; ri < roles.length; ri++) {
        if (isBrandRole(roles[ri])) { matchesAny = true; break; }
      }
      if (!matchesAny) continue;
      var toks4 = tokensFromHandle({ n: c.name, id: c.instagram });
      for (var oi = 0; oi < toks4.length; oi++) {
        brandTokens.push({ raw: toks4[oi].raw, normalized: toks4[oi].normalized, source: 'credits' });
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
          brandTokens.push({ raw: toks5[si].raw, normalized: toks5[si].normalized, source: 'credits' });
        }
      } else if (val && typeof val === 'object') {
        var name = val.name || val.n;
        var ig   = val.instagram || val.id;
        var toks6 = tokensFromHandle({ n: name, id: ig });
        for (var ii = 0; ii < toks6.length; ii++) {
          brandTokens.push({ raw: toks6[ii].raw, normalized: toks6[ii].normalized, source: 'credits' });
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

  var aliasMap = new Map();   // normalized → { occurrences, editorialIds:Set, samples:Set, sources:Set }
  var roleStats = new Map();  // role label → count
  var unknownRoles = new Set();
  var scanned = 0;
  var withBrandSignal = 0;

  for (var i = 0; i < editorials.length; i++) {
    scanned++;
    var ed = editorials[i];
    var result = extractFromEditorial(ed);

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
          editorialIds: new Set(),
          samples: new Set(),
          sources: new Set(),
        };
        aliasMap.set(t.normalized, entry);
      }
      entry.occurrences++;
      if (ed && ed.id) entry.editorialIds.add(ed.id);
      if (entry.samples.size < 5) entry.samples.add(t.raw);
      entry.sources.add(t.source);
    }
  }

  // Flatten + sort
  var all = [];
  aliasMap.forEach(function (e, alias) {
    all.push({
      alias: alias,
      occurrences_total: e.occurrences,
      editorials_count: e.editorialIds.size,
      samples: Array.from(e.samples).slice(0, 5),
      sources: Array.from(e.sources).sort(),
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
  };
}

module.exports = {
  BRAND_ROLE_LABELS,
  isBrandRole,
  tokensFromHandle,
  extractFromEditorial,
  aggregate,
};
