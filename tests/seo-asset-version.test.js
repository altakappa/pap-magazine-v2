/**
 * SSR 페이지의 자산 버전·경로 드리프트 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA(🚨): 아티클 상세에서 언어를 바꾼 뒤 새로고침하면 "레이아웃과 폰트가
 * 완전히 붕괴"된다.
 *
 * ── 원인 ────────────────────────────────────────────────────────────
 * 기사·에디토리얼 상세는 SSR 페이지가 곧 실제 화면이다(SPA 셸이 아니다).
 * 그런데 seoRenderer 가 자산 버전을 하드코딩하고 있었고, 프론트 HTML 만
 * 캐시버스트가 올라가면서 둘이 갈라져 있었다.
 *     pap-styles.css   SSR v=15  vs  프론트 v=39   (24개 버전 차이)
 *     pap-header.js    SSR v=19  vs  프론트 v=23
 * SPA 안에서 기사를 열면 최신 CSS 로 보이다가, 새로고침해 SSR 페이지에
 * 직접 착지하면 24버전 옛 CSS 로 그려진다 — 그게 "붕괴"의 정체다.
 * 캐시버스트를 올릴 때 프론트 HTML 만 고치고 SSR 을 잊는 구조라서,
 * 시간이 지날수록 반드시 벌어지게 돼 있었다.
 *
 * 함께 발견: 주입 헤더의 로고가 상대경로('pap-logo.png')여서 중첩 경로
 * (/en/article/{slug}, /ja/article/{slug})에서 404 였다. 실측으로
 * naturalWidth 0 확인 — 로고 자리에 alt 텍스트만 보였다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. SSR 이 참조하는 자산 버전이 프론트 HTML 과 항상 같을 것
 *     (숫자를 베껴 적지 않고 양쪽에서 읽어 비교한다 — 그래야 드리프트를 잡는다)
 *  2. 버전을 다시 하드코딩으로 되돌리지 않을 것
 *  3. 모든 경로 깊이에서 깨지지 않도록 자산 경로가 절대경로일 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const seo = fs.readFileSync(path.join(ROOT, 'api/_lib/seoRenderer.js'), 'utf8');
const header = fs.readFileSync(path.join(ROOT, 'frontend/pap-header.js'), 'utf8');

/** 프론트 HTML 들이 쓰는 캐시버스트 버전을 모아 온다(전부 같아야 정상). */
function frontVersions(asset) {
  const dir = path.join(ROOT, 'frontend');
  const re = new RegExp(asset.replace('.', '\\.') + '\\?v=(\\d+)', 'g');
  const found = new Set();
  fs.readdirSync(dir).filter((f) => f.endsWith('.html')).forEach((f) => {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    let m; while ((m = re.exec(s))) found.add(parseInt(m[1], 10));
  });
  return [...found];
}

console.log('\n=== 1. 프론트 HTML 안에서 버전이 일관된가 ===');
[['pap-styles.css'], ['pap-header.js']].forEach(([asset]) => {
  const vs = frontVersions(asset);
  t(`${asset} — HTML 전체가 같은 버전 (${vs.join(', ') || '없음'})`, vs.length === 1,
    'HTML 마다 버전이 다르면 일부 페이지에 옛 파일이 서빙된다');
});

console.log('\n=== 2. SSR 과 프론트의 자산 버전이 일치하는가 (이번 붕괴의 원인) ===');
const pairs = [
  ['pap-styles.css', /const PAP_STYLES_VERSION = (\d+);/],
  ['pap-header.js', /const PAP_HEADER_VERSION = (\d+);/],
];
pairs.forEach(([asset, re]) => {
  const m = seo.match(re);
  const ssrV = m ? parseInt(m[1], 10) : null;
  const frontV = frontVersions(asset)[0];
  t(`${asset} — SSR ${ssrV} = 프론트 ${frontV}`,
    ssrV !== null && ssrV === frontV,
    ssrV === null ? '버전 상수를 못 찾음 (구조가 바뀌었나?)'
                  : '캐시버스트를 올릴 때 seoRenderer 의 상수도 함께 올려야 한다');
});

console.log('\n=== 3. 버전이 다시 하드코딩으로 돌아가지 않았는가 ===');
t('pap-styles.css 참조가 상수를 쓴다',
  /pap-styles\.css\?v=\$\{PAP_STYLES_VERSION\}/.test(seo),
  '숫자를 직접 박으면 다시 드리프트한다');
t('pap-header.js 참조가 상수를 쓴다',
  /pap-header\.js\?v=\$\{PAP_HEADER_VERSION\}/.test(seo));
t('SSR 안에 숫자 하드코딩된 ?v= 자산이 남아있지 않다',
  !/(pap-styles\.css|pap-header\.js)\?v=\d/.test(seo),
  (seo.match(/(pap-styles\.css|pap-header\.js)\?v=\d+/g) || []).join(', '));

console.log('\n=== 4. 자산 경로가 경로 깊이에 안전한가 (중첩 URL 404 방지) ===');
/* /en/article/{slug} 같은 중첩 경로에서 상대경로는 /en/article/xxx 로 해석돼 404.
   헤더는 모든 페이지에 주입되므로 절대경로여야 한다. */
t('주입 헤더의 로고가 절대경로', /<img src="\/pap-logo\.png"/.test(header),
  '상대경로면 /en/article/{slug} 에서 404 → 로고 자리에 alt 텍스트만 남는다');
/* 주석 안의 사용 예시(` *   <script src="pap-header.js">`)까지 잡혀서
   오탐이 났다 — 실제 주입 코드만 보도록 주석을 걷어내고 검사한다. */
const headerCode = header
  .replace(/\/\*[\s\S]*?\*\//g, '')   // 블록 주석
  .replace(/^\s*\/\/.*$/gm, '');      // 줄 주석
const relAssets = [...headerCode.matchAll(/src="(?!https?:|\/|data:)([^"]+\.(?:png|jpg|svg|js|css))"/g)].map((m) => m[1]);
t('주입 헤더에 상대경로 자산이 없다', relAssets.length === 0, relAssets.join(', '));
const seoRel = [...seo.matchAll(/(?:href|src)="(?!https?:|\/|data:|#|\$\{)([^"]+\.(?:png|jpg|svg|js|css))"/g)].map((m) => m[1]);
t('SSR 템플릿에도 상대경로 자산이 없다', seoRel.length === 0, seoRel.join(', '));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ seo-asset-version tests FAILED'); process.exit(1); }
console.log('✅ seo-asset-version tests passed');
