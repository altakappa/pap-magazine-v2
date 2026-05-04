/**
 * PAP Magazine — Brand alias canonicaliser.
 *
 * Implements the 7-step normalisation rule from AFFILIATE_SPEC.md §1.4 so
 * any string we see in the wild — credit-line text, an `@instagram_handle`,
 * an admin paste — collapses to the same key the brand_aliases table is
 * stored under.
 *
 * The seed migration (018_seed_brands.sql) writes aliases ALREADY in this
 * normalised form, so a lookup is one indexed PK fetch — no LIKE, no
 * UNICODE folding, no expression index needed.
 *
 * Pure functions only. No DB / network here — the caller decides whether
 * to hit `brand_aliases` after normalising. Tests in
 * tests/affiliate-phase0.test.js cover every step independently.
 */

// Region / official suffixes per SPEC §1.4 step 2. Order matters slightly:
// longer suffixes first so e.g. "_official" is stripped before "_kr" can
// match "_unofficial_kr" wrongly. We don't have such overlaps today but
// the longer-first ordering is a cheap defensive pattern.
const SUFFIXES = [
  '_official', '_online',
  '_korea', '_norway', '_nordics',
  '_kr', '_uk', '_us', '_jp', '_eu',
];

/**
 * Run the full 7-step rule on a raw string.
 *
 * 1. lowercase
 * 2. strip region/official suffixes
 * 3. collapse runs of `_` or `-` into a single `_`
 * 4. trim leading/trailing `_` or `-`
 * 5. drop dots
 * 6. spaces → `_`
 * 7. (caller does the lookup)
 *
 * Returns '' for nullish / non-string input so callers can safely chain
 * `if (!normalise(x)) skip`.
 */
function normaliseAlias(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw);

  // Outer whitespace trim — not formally one of the 7 steps but every
  // realistic source (admin paste, credit-line scraper) hands us
  // padding that would otherwise let a leading space pre-empt the
  // "@" strip below.
  s = s.trim();

  // 1) lowercase
  s = s.toLowerCase();

  // Strip a leading "@" if someone passed an Instagram handle verbatim.
  // Not in the spec's 7 steps, but it falls out of normal user behaviour
  // (admin pastes "@balenciaga" expecting it to match). Cheaper here than
  // repeating the trim everywhere.
  if (s.charAt(0) === '@') s = s.slice(1);

  // 6) spaces → underscore. Done early so suffix-stripping can match
  //    "Mac Cosmetics Norway" the same as "mac_cosmetics_norway".
  s = s.replace(/\s+/g, '_');

  // 5) drop dots. Done before suffix strip so "M.A.C." becomes "mac" ready
  //    for an "_official" check (none in seed, but symmetric with §1.4).
  s = s.replace(/\./g, '');

  // 2) strip region / official suffixes — repeatedly, in case of stacked
  //    suffixes like "_norway_official". Length-bounded loop so a maliciously
  //    long input can't spin indefinitely.
  for (let i = 0; i < SUFFIXES.length * 2; i++) {
    let stripped = false;
    for (const suf of SUFFIXES) {
      if (s.endsWith(suf) && s.length > suf.length) {
        s = s.slice(0, -suf.length);
        stripped = true;
        break;
      }
    }
    if (!stripped) break;
  }

  // 3) collapse runs of _ or - into a single _
  s = s.replace(/[-_]+/g, '_');

  // 4) trim leading/trailing _ or -
  s = s.replace(/^[_-]+|[_-]+$/g, '');

  return s;
}

/**
 * Convenience for credit-line tokens that may include trailing role text:
 *   "@balenciaga / Stylist by Stella"  →  "balenciaga"
 *
 * Splits on the first whitespace or "/" or ","; keeps the first token.
 * Useful when the auto-extraction job (Phase 1) processes raw credit
 * strings rather than already-tokenised handles.
 */
function firstToken(raw) {
  if (raw === null || raw === undefined) return '';
  const m = String(raw).match(/[^\s,/]+/);
  return m ? m[0] : '';
}

module.exports = { normaliseAlias, firstToken, SUFFIXES };
