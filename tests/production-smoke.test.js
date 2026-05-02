// PAP Magazine — Production smoke test
//
// Runs AFTER Vercel finishes deploying main and verifies that every harness
// module is actually being served, contains the expected canonical marker
// (so we know the deploy didn't lose half a file or roll back a mission), and
// that the homepage references all 15 modules in the right order.
//
// What this catches that the vm integration test doesn't:
//   - Vercel deploy partial failure (one file missing, others present)
//   - Vercel rewrite / CDN config drift
//   - Source vs. deployed mismatch (someone hand-edited prod via Vercel UI)
//   - Cache poisoning (stale module cached at edge)
//
// Wait strategy: poll for the canonical marker of pap-i18n.js's most recent
// consolidation (mission 10 → `_interstitialUpsellTexts`). If that string
// isn't in production within 5 minutes, the deploy is stuck or rolled back.
//
// Run with `npm run smoke` (uses Node 20 built-in fetch).

'use strict';

const PROD = 'https://www.pap-magazine.com';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000; // 5 min ceiling for Vercel deploy

// Each module mapped to a canonical marker string that MUST be present in
// the served file. Markers are picked to be distinctive — losing the marker
// implies the file was truncated, replaced, or rolled back.
const MODULES = [
  ['pap-utils.js',                    'function lockScroll'],
  ['pap-i18n.js',                     '_interstitialUpsellTexts'],   // mission 10 marker
  ['pap-auth.js',                     '_papUpdateAuthDropdown'],
  ['pap-search.js',                   'function searchEditorials'],
  ['pap-static.js',                   'function openPage'],
  ['pap-subscription.js',             'function showPremiumInterstitial'],
  ['pap-home.js',                     'function _resetCursorForModal'],
  ['pap-content-editorial.js',        'function openEditorial'],
  ['pap-content-film.js',             'function openFilmDetail'],
  ['pap-content-article.js',          'function openArticleDetail'],
  ['pap-content-creator-shorts.js',   'function openCreatorPopup'],
  ['pap-content-api-sync.js',         '_papShortsRender'],
  ['pap-content-seo.js',              'function _updateEditorialMeta'],
  ['pap-shell-bootstrap.js',          'function isBetaActive'],
  ['pap-app.js',                      'HISTORY'],   // stub marker
];

// Expected order for the <script> tags inside index.html.
const EXPECTED_SCRIPT_ORDER = MODULES.map(([f]) => f.replace(/\.js$/, ''));

let passed = 0;
let failed = 0;

function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else      { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

function group(name) { console.log(`\n${name}`); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getText(path) {
  const res = await fetch(`${PROD}${path}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.text();
}

// Phase 0 — poll until pap-i18n.js contains the mission-10 marker.
//
// `_interstitialUpsellTexts` is the most recent consolidation. If it's
// already there, every prior mission is also there (Vercel doesn't deploy
// out of order). If it's missing, deploy is stuck or rolled back to before
// mission 10.
async function waitForDeploy() {
  group('=== Phase 0: wait for Vercel deploy ===');
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts++;
    try {
      const body = await getText('/pap-i18n.js?v=1');
      if (body.includes('_interstitialUpsellTexts')) {
        ok(`deploy ready after ${attempts} attempt(s)`, true);
        return;
      }
      console.log(`  · attempt ${attempts}: marker not yet present, retrying in ${POLL_INTERVAL_MS/1000}s…`);
    } catch (e) {
      console.log(`  · attempt ${attempts}: fetch error: ${e.message}, retrying…`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  ok('deploy ready before timeout', false, `gave up after ${POLL_TIMEOUT_MS/1000}s`);
  // Continue running to surface any other issues, but flag this as a fail.
}

// Phase 1 — every module returns 200 and contains its canonical marker.
async function checkModules() {
  group('=== Phase 1: every module served + canonical marker present ===');
  for (const [file, marker] of MODULES) {
    try {
      const body = await getText(`/${file}?v=1`);
      const has = body.includes(marker);
      const detail = has ? '' : `marker "${marker}" missing from served body (${body.length} bytes)`;
      ok(`${file} (${body.length} bytes, marker "${marker}")`, has, detail);
    } catch (e) {
      ok(file, false, e.message);
    }
  }
}

// Phase 2 — index.html script tags are in the expected order.
async function checkScriptOrder() {
  group('=== Phase 2: index.html script-tag chain ===');
  let html;
  try {
    html = await getText('/');
  } catch (e) {
    ok('index.html fetched', false, e.message);
    return;
  }
  const found = [];
  const re = /src="(pap-[a-z0-9-]+)\.js/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (EXPECTED_SCRIPT_ORDER.includes(m[1])) found.push(m[1]);
  }
  const ordered =
    found.length === EXPECTED_SCRIPT_ORDER.length &&
    found.every((t, i) => t === EXPECTED_SCRIPT_ORDER[i]);
  ok(`index.html: 15 script tags in correct order`, ordered,
     ordered ? '' : `got [${found.join(', ')}]`);
}

// Phase 3 — key API endpoint sanity.
async function checkAPIEndpoints() {
  group('=== Phase 3: API endpoints reachable ===');
  // /api/auth/google should 302 to Supabase
  try {
    const res = await fetch(`${PROD}/api/auth/google`, { redirect: 'manual' });
    const loc = res.headers.get('location') || '';
    const looksRight = res.status === 302 && loc.includes('supabase.co/auth/v1/authorize') && loc.includes('redirect_to=');
    ok('/api/auth/google → 302 to Supabase OAuth', looksRight,
       looksRight ? '' : `status=${res.status} location=${loc.slice(0, 80)}`);
  } catch (e) {
    ok('/api/auth/google reachable', false, e.message);
  }
  // / should 200
  try {
    const res = await fetch(`${PROD}/`, { redirect: 'follow' });
    ok('/ (homepage) → 200', res.status === 200, `status=${res.status}`);
  } catch (e) {
    ok('/ reachable', false, e.message);
  }
}

(async () => {
  console.log(`Production smoke test — ${PROD}`);
  await waitForDeploy();
  await checkModules();
  await checkScriptOrder();
  await checkAPIEndpoints();

  console.log(`\n=== SUMMARY ===\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\n⚠  Production has drifted from source. Investigate.');
    process.exit(1);
  }
  console.log('\n✓ Production smoke clean.');
  process.exit(0);
})().catch(e => {
  console.error('\nUNEXPECTED:', e);
  process.exit(2);
});
