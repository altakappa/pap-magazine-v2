/**
 * 홈 CLS — 테마 행이 0 높이에서 튀어나오던 것 (2026-08-22)
 * ═══════════════════════════════════════════════════════════════════
 * 필드(CrUX) 홈: CLS 0.4. 같은 시점 기사 페이지(SSR)는 CLS 0.01 — 40배.
 *
 * [무엇이었나] index.html 에 이렇게 있었다:
 *     <div id="aiThemeRows1"></div>
 *     <div id="aiThemeRows2"></div>
 *   둘 다 완전히 비어 있고 CSS 에 예약 높이가 없다. 그 뒤
 *   pap-content-api-sync.js#_renderThemeRows() 가 /api/editorials/themes 를
 *   받아 각 컨테이너에 **에디토리얼 행 2개씩**을 innerHTML 로 넣는다.
 *   한 행 = 제목 + 카드 줄(카드 이미지 aspect-ratio 3/4). 즉 높이 0 이던
 *   자리에 수백 px 이 갑자기 생기고, 그 아래 화면 전체가 밀린다. 두 군데서.
 *
 * [왜 다른 데는 괜찮은가] 세어 봤다.
 *   · .hero            height:calc(100vh - 72px) — 예약됨
 *   · .fashion-card-img aspect-ratio:4/5          — 예약됨
 *   · .shorts-carousel  height:520px              — 예약됨
 *   · 최신 에디토리얼 행 → 정적 HTML 에 스켈레톤 카드가 이미 실려 있다
 *   비어 있던 건 aiThemeRows1/2 와 ccaThumbs 뿐이고,
 *   ccaThumbs 는 모바일에서 display:none 이라 모바일 CLS 와 무관하다.
 *   → 남는 용의자는 테마 행 둘.
 *
 * [고침] 위쪽 '최신 에디토리얼' 행과 **같은 방식**을 쓴다 — 같은 구조의
 *   스켈레톤을 정적 HTML 에 실어 첫 페인트부터 높이를 잡는다.
 *   카드 CSS(aspect-ratio:3/4)가 높이를 정하므로 하드코딩한 px 이 없다.
 *   그래서 카드 크기를 바꿔도 예약 높이가 저절로 따라온다.
 *
 * [고착 방지] API 가 빈 응답이거나 실패하면 _clearThemeSkeleton 이 컨테이너를
 *   비운다. 가짜 카드가 영원히 남는 것보다 빈 자리가 낫다.
 *
 * ⚠ 이 테스트는 "CLS 가 0.4 에서 얼마로 내렸다"를 증명하지 않는다.
 *   CrUX 는 28일 롤링이라 3~4주 뒤에 판정된다(예약: 2026-09-22).
 *   여기서 지키는 건 "높이를 예약하는 구조가 유지되는가"뿐이다.
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const html = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
const js   = fs.readFileSync(path.join(ROOT, 'frontend/pap-content-api-sync.js'), 'utf8');
const css  = fs.readFileSync(path.join(ROOT, 'frontend/pap-styles.css'), 'utf8');

/** id="X" 의 여는 태그부터 짝 맞는 </div> 까지를 잘라낸다. */
function blockOf(id) {
  const m = html.match(new RegExp('<div id="' + id + '"[^>]*>'));
  if (!m) return null;
  let i = m.index + m[0].length, depth = 1;
  while (i < html.length && depth > 0) {
    const nx = html.indexOf('<div', i), nc = html.indexOf('</div>', i);
    if (nc === -1) break;
    if (nx !== -1 && nx < nc) { depth++; i = nx + 4; }
    else { depth--; i = nc + 6; }
  }
  return html.slice(m.index, i);
}

console.log('\n=== 1. 테마 행 컨테이너가 비어 있지 않다 (회귀 고정) ===');
for (const id of ['aiThemeRows1', 'aiThemeRows2']) {
  t(`${id} 가 빈 div 로 되돌아가지 않았다`,
    !new RegExp('<div id="' + id + '"[^>]*>\\s*</div>').test(html));
  const b = blockOf(id);
  t(`${id} 블록을 찾았다`, !!b);
  if (!b) continue;
  const rowCount  = (b.match(/class="ed-row"/g) || []).length;
  const cardCount = (b.match(/ed-row-card is-skeleton/g) || []).length;
  t(`${id}: 실제로 채워질 개수(2행)만큼 스켈레톤 행이 있다`, rowCount === 2, `행 ${rowCount}`);
  t(`${id}: 행마다 카드가 충분하다 (가장 넓은 브레이크포인트 7칸)`,
    cardCount >= 14, `카드 ${cardCount}`);
  t(`${id}: 카드가 실제 렌더와 같은 클래스 구조다 (높이가 같아진다)`,
    b.includes('ed-row-card-img') && b.includes('ed-row-card-info') && b.includes('ed-row-card-title'));
  t(`${id}: 스켈레톤은 크롤러·스크린리더에서 숨긴다`,
    (b.match(/aria-hidden="true"/g) || []).length >= cardCount);
  t(`${id}: 스켈레톤에 링크가 없다 (가짜 내부링크 금지)`, !/<a\s/.test(b), b.slice(0, 120));
  t(`${id}: 스켈레톤 표시 클래스가 붙어 있다`, /class="ed-rows-skeleton"/.test(
    (html.match(new RegExp('<div id="' + id + '"[^>]*>')) || [''])[0]));
}

console.log('\n=== 2. 높이를 하드코딩한 px 으로 잡지 않는다 ===');
{
  /* px 로 잡으면 카드 크기를 바꿀 때 조용히 어긋난다.
     실제 카드와 같은 마크업을 쓰면 CSS 가 알아서 같은 높이를 만든다. */
  const b = blockOf('aiThemeRows1') || '';
  t('컨테이너에 인라인 min-height/height 가 없다', !/style="[^"]*height/.test(b));
  t('카드 이미지 높이는 aspect-ratio 가 정한다',
    /\.ed-row-card-img\{[^}]*aspect-ratio:\s*3\/4/.test(css));
}

console.log('\n=== 3. 스켈레톤이 고착되지 않는다 ===');
t('_clearThemeSkeleton 이 있다', /function _clearThemeSkeleton/.test(js));
t('빈 응답이면 비운다', /rows\.length === 0\)\{[\s\S]{0,200}?_clearThemeSkeleton/.test(js));
t('요청 실패면 비운다', /\.catch\(function\(\)\{[\s\S]{0,200}?_clearThemeSkeleton/.test(js));
t('실제 데이터가 오면 표시 클래스를 뗀다',
  /classList\.remove\('ed-rows-skeleton'\)/.test(js));
t('비울 때 표시 클래스가 붙은 컨테이너만 건드린다 (실데이터 삭제 방지)',
  /contains\('ed-rows-skeleton'\)/.test(js));

console.log('\n=== 4. 이미 예약돼 있던 것들이 계속 예약돼 있다 ===');
t('.hero 는 뷰포트 기준 고정 높이', /\.hero\{[^}]*height:calc\(100vh - 72px\)/.test(css));
t('.shorts-carousel 은 고정 높이', /\.shorts-carousel\{[^}]*height:520px/.test(css));
t('.fashion-card-img 는 aspect-ratio', /\.fashion-card-img\{[^}]*aspect-ratio:\s*4\/5/.test(css));
t('최신 에디토리얼 행 스켈레톤이 그대로 있다',
  (html.match(/ed-row-card is-skeleton/g) || []).length >= 24);
t('ccaThumbs 는 비어 있어도 자리를 안 먹는다 (:empty → display:none)',
  /\.community-cta-thumbs:empty\s*\{\s*display:\s*none/.test(html));

console.log('\n=== 5. 캐시버스트 ===');
{
  const cssVers = new Set(), jsVers = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'frontend')).filter((x) => x.endsWith('.html'))) {
    const h = fs.readFileSync(path.join(ROOT, 'frontend', f), 'utf8');
    const c = h.match(/pap-styles\.css\?v=(\d+)/); if (c) cssVers.add(Number(c[1]));
    const j = h.match(/pap-content-api-sync\.js\?v=(\d+)/); if (j) jsVers.add(Number(j[1]));
  }
  t('pap-styles.css 버전이 HTML 전부에서 같다', cssVers.size === 1, [...cssVers].join(','));
  t('pap-styles.css 버전이 42 보다 크다 (이 CSS 추가 이후)',
    [...cssVers].every((v) => v > 42), [...cssVers].join(','));
  t('pap-content-api-sync.js 버전이 122 보다 크다', [...jsVers].every((v) => v > 122), [...jsVers].join(','));

  /* SSR 렌더러도 같은 CSS 파일을 싣는다 — 버전이 갈라지면 한쪽만 옛 CSS 를 본다 */
  const seo = fs.readFileSync(path.join(ROOT, 'api/_lib/seoRenderer.js'), 'utf8');
  const sv = Number((seo.match(/PAP_STYLES_VERSION = (\d+)/) || [])[1]);
  t('seoRenderer 의 CSS 버전이 HTML 과 같다', sv === [...cssVers][0], `seo ${sv} vs html ${[...cssVers][0]}`);
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ home-cls-theme-rows tests FAILED'); process.exit(1); }
console.log('✅ home-cls-theme-rows tests passed');
