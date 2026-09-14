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

/* ── 우리 방화벽이 우리 검사를 막는다 (2026-09-14) ────────────────────────
 *
 * 실측. 이 파일은 헤더를 하나도 안 보내고 `fetch` 만 했다. 그 결과
 *   attempt 1..60: fetch error: HTTP 429 /pap-i18n.js?v=1
 * 5분 내내 429 만 받고 타임아웃으로 죽었다 (런 #1261·#1262·#1263).
 *
 * 마커가 없어서가 아니다. **파일을 아예 못 받았다.** 같은 시각 브라우저로
 * https://www.pap-magazine.com/pap-i18n.js 를 열면 마커가 멀쩡히 있었다.
 * 배포는 정상이었다.
 *
 * 429 를 낸 건 레이트리밋이 아니라 **Vercel 봇 보호의 챌린지**다:
 *   Rate Limit 규칙 0/40 · 실제 Rate Limited 없음 · Attack Mode 꺼짐
 *   Bot Protection Active · 지난 하루 Challenged 2.3k (실패 시각에 스파이크)
 * 봇 챌린지는 JS 를 풀어야 통과한다. 깃허브 러너는 브라우저가 아니라 못 푼다.
 * 데이터센터 IP + 브라우저 아닌 클라이언트 + 같은 URL 60회 = 봇으로 보인다.
 *
 * 해결: 브라우저인 척하지 않는다. **우리라고 밝힌다.**
 * 전용 비밀 헤더를 보내고, Vercel 방화벽에 그 헤더면 봇 검사를 건너뛰는
 * System Bypass 규칙을 하나 둔다. 봇 보호 자체는 그대로 살아 있다.
 *   · 값은 GitHub Secret `PAP_SMOKE_TOKEN` (도메니코가 직접 등록)
 *   · 워크플로가 같은 이름의 env 로 넘긴다 (.github/workflows/test.yml)
 *
 * 토큰이 없으면 조용히 브라우저 흉내로 떨어지지 않는다 — 5분을 기다렸다가
 * 알 수 없는 이유로 죽는 게 제일 나쁘다. 시작하자마자 크게 경고한다. */
const SMOKE_TOKEN = (process.env.PAP_SMOKE_TOKEN || '').trim();
const SMOKE_HEADER = 'x-pap-smoke';

function smokeHeaders() {
  return SMOKE_TOKEN ? { [SMOKE_HEADER]: SMOKE_TOKEN } : {};
}

function warnIfNoToken() {
  if (SMOKE_TOKEN) return;
  console.log(`\n⚠  ${SMOKE_HEADER} 토큰이 없다 (env PAP_SMOKE_TOKEN 미설정).`);
  console.log('   봇 보호가 이 검사를 챌린지해서 429 로 막을 수 있다.');
  console.log('   GitHub Secret 등록 + Vercel System Bypass 규칙을 확인할 것.');
}

async function getText(path) {
  const res = await fetch(`${PROD}${path}`, { redirect: 'follow', headers: smokeHeaders() });
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
  // Match both relative (legacy) and absolute (post-cleanup) script src.
  const re = /src="\/?(pap-[a-z0-9-]+)\.js/g;
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
  // /api/auth/google should 302 straight to Google (자체 처리 전환, 8883c16 —
  // 동의 화면에 pap-magazine.com 표시. Supabase authorize 경유는 폐기됨)
  try {
    const res = await fetch(`${PROD}/api/auth/google`, { redirect: 'manual', headers: smokeHeaders() });
    const loc = res.headers.get('location') || '';
    const looksRight = res.status === 302 &&
      loc.includes('accounts.google.com/o/oauth2/v2/auth') &&
      loc.includes('redirect_uri=') && loc.includes('google-callback');
    ok('/api/auth/google → 302 to Google OAuth (self-hosted flow)', looksRight,
       looksRight ? '' : `status=${res.status} location=${loc.slice(0, 80)}`);
  } catch (e) {
    ok('/api/auth/google reachable', false, e.message);
  }
  // / should 200
  try {
    const res = await fetch(`${PROD}/`, { redirect: 'follow', headers: smokeHeaders() });
    ok('/ (homepage) → 200', res.status === 200, `status=${res.status}`);
  } catch (e) {
    ok('/ reachable', false, e.message);
  }
}

(async () => {
  console.log(`Production smoke test — ${PROD}`);
  warnIfNoToken();
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
