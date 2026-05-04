/**
 * PAP Magazine — Affiliate system Phase 0 unit tests.
 *
 * Two surfaces:
 *
 *   1. brandAlias.js  — 7-step normalisation (SPEC §1.4). Pure function;
 *                       just feed strings, assert outputs.
 *   2. clickGuard.js  — IP extraction, SHA256(ip+salt) hashing, device
 *                       detection, referrer sanitisation. We mock
 *                       process.env.PAP_IP_HASH_SALT to test the
 *                       missing-salt skip path (Phase 0 conf option A).
 *
 * The 24h dedupe rule itself lives at the Postgres layer (composite index
 * + a SELECT in api/go/[id].js). Testing it requires a live DB and we
 * defer that to production-smoke.test.js. Here we exercise the inputs
 * the dedupe relies on.
 *
 * No test framework — minimal node script with assert. Same style as
 * tests/harness-integration.test.js so npm test stays consistent.
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { normaliseAlias, firstToken } = require(path.join(ROOT, 'api/_lib/brandAlias.js'));
const { hashIp, detectDeviceType, sanitizeReferrer, extractClientIp } =
  require(path.join(ROOT, 'api/_lib/clickGuard.js'));

let pass = 0, fail = 0;
function it(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); fail++; }
}

// ── brandAlias.normaliseAlias ───────────────────────────────────────────
console.log('\n=== brandAlias: 7-step normalisation ===');

it('lowercase: PAT McGRATH LABS → pat_mcgrath_labs', () => {
  assert.strictEqual(normaliseAlias('PAT McGRATH LABS'), 'pat_mcgrath_labs');
});

it('strip _official suffix: muglerofficial → mugler', () => {
  assert.strictEqual(normaliseAlias('mugler_official'), 'mugler');
});

it('strip _norway suffix: janeiredale_norway → janeiredale', () => {
  assert.strictEqual(normaliseAlias('janeiredale_norway'), 'janeiredale');
});

it('strip _nordics suffix: maccosmeticsnordics handle → keeps "nordics" run-on (no underscore)', () => {
  // The seed alias for this exact handle is registered as-is. Suffix
  // stripping only fires on _-prefixed suffixes by design (so we don't
  // chop substrings out of compound brand names).
  assert.strictEqual(normaliseAlias('maccosmeticsnordics'), 'maccosmeticsnordics');
});

it('strip stacked suffixes: chloe_norway_official → chloe', () => {
  assert.strictEqual(normaliseAlias('chloe_norway_official'), 'chloe');
});

it('collapse hyphens + underscores: rick---owens___store → rick_owens_store', () => {
  assert.strictEqual(normaliseAlias('rick---owens___store'), 'rick_owens_store');
});

it('trim leading/trailing separators: __balenciaga-- → balenciaga', () => {
  assert.strictEqual(normaliseAlias('__balenciaga--'), 'balenciaga');
});

it('drop dots: M.A.C. → mac', () => {
  assert.strictEqual(normaliseAlias('M.A.C.'), 'mac');
});

it('spaces → underscore: Maison Margiela → maison_margiela', () => {
  assert.strictEqual(normaliseAlias('Maison Margiela'), 'maison_margiela');
});

it('strip leading @: @balenciaga → balenciaga', () => {
  assert.strictEqual(normaliseAlias('@balenciaga'), 'balenciaga');
});

it('handle nullish: undefined → "" (empty)', () => {
  assert.strictEqual(normaliseAlias(undefined), '');
  assert.strictEqual(normaliseAlias(null), '');
  assert.strictEqual(normaliseAlias(''), '');
});

it('preserve numerics: 455emble stays 455emble', () => {
  assert.strictEqual(normaliseAlias('455EMBLE'), '455emble');
});

it('full chain: " @Makeup BY MARIO_Official " → makeup_by_mario', () => {
  // outer-trim + @-strip + lowercase + spaces→_ + suffix-strip(_official) + collapse + end-trim
  assert.strictEqual(normaliseAlias(' @Makeup BY MARIO_Official '), 'makeup_by_mario');
});

it('dots are dropped (no separator inserted): M.A.C. → mac', () => {
  // Reaffirms SPEC §1.4 step 5: dots are removed, NOT replaced. So
  // "official.cosmetics" stays a single run "officialcosmetics" (which
  // is fine for the lookup table — alias rows are stored in the same
  // already-normalised form).
  assert.strictEqual(normaliseAlias('M.A.C.'), 'mac');
});

it('does not over-strip a brand whose name ends in a suffix-like token: stripped only when _-prefixed', () => {
  // `eu` would be a 2-char suffix when prefixed; bare ending shouldn't fire.
  assert.strictEqual(normaliseAlias('hermesleu'), 'hermesleu');
});

// ── brandAlias.firstToken ───────────────────────────────────────────────
console.log('\n=== brandAlias.firstToken ===');

it('takes everything before whitespace', () => {
  assert.strictEqual(firstToken('@balenciaga / Stylist by Stella'), '@balenciaga');
});
it('takes everything before slash', () => {
  assert.strictEqual(firstToken('mac/cosmetics/nordics'), 'mac');
});
it('takes everything before comma', () => {
  assert.strictEqual(firstToken('Mugler, FW26'), 'Mugler');
});
it('handles empty input', () => {
  assert.strictEqual(firstToken(''), '');
  assert.strictEqual(firstToken(null), '');
});

// ── clickGuard.hashIp ───────────────────────────────────────────────────
console.log('\n=== clickGuard.hashIp ===');

it('returns null when PAP_IP_HASH_SALT is unset (Phase 0 conf option A)', () => {
  const oldSalt = process.env.PAP_IP_HASH_SALT;
  delete process.env.PAP_IP_HASH_SALT;
  assert.strictEqual(hashIp('1.2.3.4'), null);
  if (oldSalt !== undefined) process.env.PAP_IP_HASH_SALT = oldSalt;
});

it('returns 64-char hex when salt is set', () => {
  process.env.PAP_IP_HASH_SALT = 'test-salt-please-rotate';
  const h = hashIp('203.0.113.42');
  assert.ok(typeof h === 'string', 'hash should be a string');
  assert.strictEqual(h.length, 64, 'sha256 hex = 64 chars');
  assert.ok(/^[0-9a-f]+$/.test(h), 'hex only');
});

it('different IPs produce different hashes (same salt)', () => {
  process.env.PAP_IP_HASH_SALT = 'test-salt';
  assert.notStrictEqual(hashIp('1.1.1.1'), hashIp('2.2.2.2'));
});

it('same IP, different salts → different hashes (salt rotation invalidates old)', () => {
  process.env.PAP_IP_HASH_SALT = 'salt-A';
  const a = hashIp('192.0.2.1');
  process.env.PAP_IP_HASH_SALT = 'salt-B';
  const b = hashIp('192.0.2.1');
  assert.notStrictEqual(a, b);
});

it('returns null on empty IP even with salt', () => {
  process.env.PAP_IP_HASH_SALT = 'any';
  assert.strictEqual(hashIp(''), null);
  assert.strictEqual(hashIp(null), null);
});

// ── clickGuard.detectDeviceType ─────────────────────────────────────────
console.log('\n=== clickGuard.detectDeviceType ===');

it('iPhone UA → mobile', () => {
  assert.strictEqual(
    detectDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'),
    'mobile'
  );
});
it('iPad UA → tablet (priority over mobile)', () => {
  assert.strictEqual(
    detectDeviceType('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'),
    'tablet'
  );
});
it('Android phone UA → mobile', () => {
  assert.strictEqual(
    detectDeviceType('Mozilla/5.0 (Linux; Android 14; SM-S928U) AppleWebKit/537.36 Mobile Safari/537.36'),
    'mobile'
  );
});
it('Android tablet UA → tablet', () => {
  assert.strictEqual(
    detectDeviceType('Mozilla/5.0 (Linux; Android 14; SM-X910 Tablet) AppleWebKit/537.36'),
    'tablet'
  );
});
it('desktop Chrome on macOS → desktop', () => {
  assert.strictEqual(
    detectDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/127'),
    'desktop'
  );
});
it('empty UA → desktop default', () => {
  assert.strictEqual(detectDeviceType(''), 'desktop');
  assert.strictEqual(detectDeviceType(null), 'desktop');
});

// ── clickGuard.sanitizeReferrer ─────────────────────────────────────────
console.log('\n=== clickGuard.sanitizeReferrer ===');

it('absolute URL → path only', () => {
  assert.strictEqual(
    sanitizeReferrer('https://www.pap-magazine.com/editorial/folie?utm_source=ig&utm_campaign=launch'),
    '/editorial/folie'
  );
});
it('bare path → path only (query stripped)', () => {
  assert.strictEqual(sanitizeReferrer('/editorial/folie?ref=abc'), '/editorial/folie');
});
it('null → null', () => {
  assert.strictEqual(sanitizeReferrer(null), null);
  assert.strictEqual(sanitizeReferrer(''), null);
});
it('homepage URL → "/"', () => {
  assert.strictEqual(sanitizeReferrer('https://www.pap-magazine.com'), '/');
  assert.strictEqual(sanitizeReferrer('https://www.pap-magazine.com/'), '/');
});

// ── clickGuard.extractClientIp ──────────────────────────────────────────
console.log('\n=== clickGuard.extractClientIp ===');

it('takes first hop from x-forwarded-for', () => {
  const fakeReq = { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' } };
  assert.strictEqual(extractClientIp(fakeReq), '203.0.113.7');
});
it('falls back to x-real-ip', () => {
  const fakeReq = { headers: { 'x-real-ip': '198.51.100.5' } };
  assert.strictEqual(extractClientIp(fakeReq), '198.51.100.5');
});
it('returns empty string when nothing is available', () => {
  const fakeReq = { headers: {} };
  assert.strictEqual(extractClientIp(fakeReq), '');
});

// ── Done ────────────────────────────────────────────────────────────────
console.log('\n=== SUMMARY ===');
console.log('passed: ' + pass + '   failed: ' + fail);
if (fail > 0) {
  console.error('\n✗ affiliate-phase0 tests FAILED');
  process.exit(1);
}
console.log('✓ affiliate-phase0 tests passed');
