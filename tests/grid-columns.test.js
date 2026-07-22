/**
 * 목록 그리드 열 수 고정 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * 요청(도메니코): 아티클 페이지 3열 → 4열, 에디토리얼 페이지도 4열 고정.
 *
 * ── 실측 (Chrome iframe, 뷰포트 고정) ───────────────────────────────
 *   뷰포트   에디토리얼  아티클페이지  필름(유지)  아티클오버레이(유지)
 *   1440       4          4           5          4
 *   1200       4          4           4          4
 *    800       2          2           2          2
 *
 * ── 스코프 주의 ─────────────────────────────────────────────────────
 * 에디토리얼 목록(#edAllGrid)은 필름·아티클 홈 오버레이와 .ed-all-grid
 * 클래스를 공유한다. 그래서 클래스가 아니라 ID(#edAllGrid)로만 4열을 건다.
 * ID(1,0,0)는 .film-all-grid(0,1,0)보다 세지만, film/art 컨테이너의 ID 는
 * #filmAllGrid / #artAllGrid 라 #edAllGrid 규칙이 애초에 안 걸린다.
 * → 필름·아티클 오버레이는 auto-fill 그대로 유지(위 표에서 확인).
 *
 * 아티클 "페이지"(/article = articles.html 의 .card-grid)와 아티클 홈
 * "오버레이"(#artAllGrid)는 별개다. 요청은 페이지 쪽이라 .card-grid 만 바꿨다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 아티클 페이지 그리드가 데스크톱 4열일 것
 *  2. 에디토리얼 그리드가 데스크톱 4열, 모바일 2열일 것
 *  3. 에디토리얼 규칙이 ID 로 스코프돼 필름/아티클 오버레이를 안 건드릴 것
 *  4. 캐시버스트(프론트 ?v= 와 SSR 상수)가 어긋나지 않을 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const articles = fs.readFileSync(path.join(ROOT, 'frontend/articles.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend/pap-styles.css'), 'utf8');

console.log('\n=== 1. 아티클 페이지 4열 ===');
/* articles.html 인라인 .card-grid 의 base(미디어쿼리 밖) 정의를 본다. */
const cardBase = (articles.match(/\.card-grid \{[\s\S]*?\}/) || [''])[0];
t('.card-grid base 를 찾았다', cardBase.length > 0);
t('데스크톱 4열이다',
  /grid-template-columns:\s*repeat\(4,\s*1fr\)/.test(cardBase),
  '3열이면 요청 미반영. 실제=' + (cardBase.match(/grid-template-columns:[^;]*/) || [''])[0]);
t('모바일(≤900)은 2열 유지',
  /@media\(max-width:900px\)[^{]*\{[^}]*\.card-grid\{grid-template-columns:repeat\(2,1fr\)/.test(articles));

console.log('\n=== 2. 에디토리얼 4열 (ID 스코프) ===');
t('#edAllGrid 데스크톱 4열 규칙이 있다',
  /#edAllGrid\{grid-template-columns:repeat\(4,1fr\)\}/.test(css),
  'ID 로 걸어야 필름/아티클 오버레이를 안 건드린다');
t('#edAllGrid 모바일(≤900) 2열 규칙이 있다',
  /@media\(max-width:900px\)\{#edAllGrid\{grid-template-columns:repeat\(2,1fr\)\}\}/.test(css),
  '없으면 ID 규칙이 옛 @480 .ed-all-grid 를 이겨 모바일에서도 4열이 된다');
/* ID 규칙이 클래스 base 규칙보다 소스에서 뒤에 와야(또는 ID 니까 항상) 이긴다.
   순서보다 specificity 가 결정하지만, 정의가 base 근처에 있는지 확인. */
t('에디토리얼 base(.ed-all-grid)는 그대로 auto-fill 이다 (공유 클래스 훼손 금지)',
  /\.ed-all-grid\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(200px,1fr\)\)/.test(css),
  '.ed-all-grid 자체를 4열로 바꾸면 필름/아티클 오버레이까지 끌려간다');

console.log('\n=== 3. 필름·아티클 오버레이는 안 건드렸는가 ===');
t('.film-all-grid override 가 유지된다',
  /\.film-all-grid\{grid-template-columns:repeat\(auto-fill,minmax\(240px,1fr\)\)\}/.test(css));
t('.art-all-grid override 가 유지된다',
  /\.art-all-grid\{grid-template-columns:repeat\(auto-fill,minmax\(260px,1fr\)\)\}/.test(css));
/* 이 둘의 컨테이너 ID(#filmAllGrid/#artAllGrid)에 4열을 박은 실수가 없어야 한다. */
t('#filmAllGrid / #artAllGrid 에 열 고정을 걸지 않았다',
  !/#filmAllGrid\{grid-template-columns/.test(css) && !/#artAllGrid\{grid-template-columns/.test(css));

console.log('\n=== 4. 캐시버스트 (프론트 ↔ SSR 일치) ===');
const seo = fs.readFileSync(path.join(ROOT, 'api/_lib/seoRenderer.js'), 'utf8');
const htmlDir = path.join(ROOT, 'frontend');
const vers = fs.readdirSync(htmlDir).filter((f) => f.endsWith('.html'))
  .map((f) => (fs.readFileSync(path.join(htmlDir, f), 'utf8').match(/pap-styles\.css\?v=(\d+)/) || [])[1])
  .filter(Boolean);
t('모든 HTML 의 pap-styles ?v= 가 동일 (' + [...new Set(vers)].join(', ') + ')',
  new Set(vers).size === 1);
const ssrV = (seo.match(/PAP_STYLES_VERSION = (\d+)/) || [])[1];
t('SSR PAP_STYLES_VERSION 이 프론트와 같다 (SSR=' + ssrV + ' / 프론트=' + vers[0] + ')',
  ssrV === vers[0],
  '어긋나면 SSR 페이지만 옛 CSS 를 받아 이 변경이 딥링크에서 안 보인다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ grid-columns tests FAILED'); process.exit(1); }
console.log('✅ grid-columns tests passed');
