/**
 * 홈 슬라이드 좌우 화살표 — 썸네일 박스 중앙 정렬 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA(🐛 수정 완료 보고 항목 부분 미해결): 최신기사는 미세하게 어긋나고,
 * 필름은 썸네일 박스가 아닌 엉뚱한 기준으로 정렬돼 있다.
 *
 * 원인이 두 개였고 서로 성격이 다르다. 라이브 실측으로 확인함.
 *
 * ── (1) 최신기사 — 상수 보정으로는 애초에 맞출 수 없는 구조 ──────────
 * 이전 값: .carousel-arrow{top:calc(50% - 28px)}
 *   = "카드 전체 높이의 절반에서 텍스트 블록 절반(28px 가정)을 뺀다"
 * 그런데
 *   ① .fashion-card-info 높이가 제목 줄 수에 따라 다르다 (실측 54.3 /
 *      68.6 / 80.6px — 같은 화면 안에서도 카드마다 다르다)
 *   ② 50% 의 기준인 트랙 높이는 "가장 키 큰 카드"가 정한다
 * 그래서 어떤 상수를 넣어도 어긋난다. 실측 오차(아래로 치우침):
 *   768px:+15.5  480px:+19.0  390px:+19.5  320px:+26.5
 *
 * 수정: 트랙 상단(=이미지 박스 상단)에서부터 잡는다.
 *   이미지 박스 aspect-ratio:4/5 → 높이 = 카드폭 × 5/4, 중앙 = 그 절반.
 *   카드폭은 breakpoint 마다 고정 px 이라 정확히 떨어진다.
 *   (에디토리얼 .ed-row-arrow 가 이미 쓰는 방식과 같은 원리)
 *
 * ── (2) 필름 — 터치 기기에서만 재현되는 버그 ────────────────────────
 * @media(hover:none) and (pointer:coarse) 블록 안에 있던
 *   .nf-nav{width:44px;height:44px}
 * 가 문제였다. .nf-nav 는 기본이 `top:0;height:100%` 인 세로 바라서,
 * height 만 44px 로 줄이면 top:0 이 남아 화살표가 썸네일 행 "맨 위"에
 * 붙는다. 실측(314px): 화살표 중앙 22px vs 이미지 중앙 90px → -68px.
 *
 * 이 블록은 hover:none + pointer:coarse — 즉 실제 터치 기기에서만
 * 적용된다. 데스크톱 브라우저(개발자 도구 폭 조절 포함)로는 재현되지
 * 않는다. 이전 정렬 수정이 "완료"로 보고됐는데 폰에서만 계속 어긋나
 * 보였던 이유가 정확히 이것이다. → height 를 주지 않으면 height:100%
 * 가 유지되어 썸네일 박스 정중앙이 된다(탭 타깃 44px 는 width 로 충족).
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 화살표 top 이 "카드폭 기반 이미지 중앙"과 계속 일치할 것
 *     — 카드폭을 CSS 에서 읽어와 검산한다. 카드폭만 바꾸고 화살표를
 *       안 고치면 실패한다(드리프트 검출).
 *  2. 계산의 전제인 aspect-ratio 가 바뀌면 실패할 것
 *  3. `calc(50% - Npx)` 상수 보정 방식으로 되돌아가지 않을 것
 *  4. 터치 블록이 다시 .nf-nav 높이를 건드리지 않을 것
 *  5. 에디토리얼(.ed-row-arrow)의 올바른 방식이 깨지지 않을 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const css = fs.readFileSync(path.join(ROOT, 'frontend/pap-styles.css'), 'utf8');

/** 같은 max-width 의 @media 블록이 여러 개 있을 수 있어 전부 이어붙인다. */
function blockOf(maxWidth) {
  const re = new RegExp('@media\\s*\\(max-width:\\s*' + maxWidth + 'px\\)\\s*\\{', 'g');
  let m, out = '';
  while ((m = re.exec(css))) {
    let depth = 1, i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out += css.slice(m.index, i);
  }
  return out;
}
/* 같은 선택자가 한 블록 안에 여러 번 나온다(예: 터치 블록의 .nf-nav 는
   opacity 용과 탭타깃 용으로 두 번). 첫 개만 읽으면 엉뚱한 걸 검사하게
   되므로 전부 이어붙인다. */
function ruleIn(block, selector) {
  const re = new RegExp(selector.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}', 'g');
  let m, out = null;
  while ((m = re.exec(block))) out = (out === null ? '' : out + ';') + m[1];
  return out;
}

console.log('\n=== 0. 계산의 전제 (aspect-ratio) 가 유지되는가 ===');
/* ⚠ "어딘가에 4/5 가 있다"로 검사하면 안 된다. .fashion-card-img 는
   기본 규칙 외에 모바일 오버라이드(@768)에도 있어서, 한쪽을 다른 비율로
   바꿔도 나머지 하나 때문에 통과해버린다(실제로 역검증에서 놓쳤다).
   → 선언된 모든 aspect-ratio 가 4/5 인지 전수 확인한다. */
const fcImgRatios = [...css.matchAll(/\.fashion-card-img\{([^}]*)\}/g)]
  .map((m) => (m[1].match(/aspect-ratio:\s*([\d/]+)/) || [])[1])
  .filter(Boolean);
t(`.fashion-card-img 의 모든 aspect-ratio 가 4/5 (선언 ${fcImgRatios.length}개)`,
  fcImgRatios.length > 0 && fcImgRatios.every((r) => r === '4/5'),
  `발견: ${fcImgRatios.join(', ')} — 비율이 바뀌면 화살표 top 공식(× 5 / 4)도 함께 고쳐야 한다`);
t('.ed-row-card-img 는 3/4 (높이 = 폭 × 4/3)',
  /\.ed-row-card-img\{[^}]*aspect-ratio:\s*3\/4/.test(css));
t('.nf-card 는 이미지 한 덩어리 (썸네일 박스 = 카드 = wrap 높이)',
  /\.nf-card-img\{[^}]*aspect-ratio/.test(css) &&
  !/\.nf-card-(info|title|meta)\s*\{/.test(css),
  '필름 카드에 텍스트 블록이 생기면 .nf-nav{height:100%} 전제가 깨진다');

console.log('\n=== 1. 최신기사 — 화살표 중앙 = 이미지 박스 중앙 (breakpoint 별) ===');
const BPS = [768, 480, 390, 320];
BPS.forEach((bp) => {
  const b = blockOf(bp);
  const cardM = (ruleIn(b, '.fashion-card') || '').match(/min-width:\s*(\d+)px/);
  const arrowBody = ruleIn(b, '.carousel-arrow') || '';
  const arrowM = arrowBody.match(/top:\s*calc\(\s*(\d+)px\s*\*\s*5\s*\/\s*4\s*\/\s*2\s*\)/);
  const cardW = cardM ? parseInt(cardM[1], 10) : null;
  const usedW = arrowM ? parseInt(arrowM[1], 10) : null;
  t(`≤${bp}px — 카드폭 ${cardW}px 기준으로 계산 (화살표 중앙 ${usedW ? usedW * 0.625 : '?'}px)`,
    cardW !== null && usedW !== null && cardW === usedW,
    usedW === null ? '화살표 top 규칙을 못 찾음 (또는 공식이 다름)'
                   : `카드폭 ${cardW}px 인데 화살표는 ${usedW}px 기준 — 카드폭만 바꾸고 화살표를 안 고쳤다`);
});

console.log('\n=== 2. 상수 보정 방식으로 되돌아가지 않았는가 ===');
BPS.forEach((bp) => {
  const body = ruleIn(blockOf(bp), '.carousel-arrow') || '';
  t(`≤${bp}px — top:calc(50% - Npx) 를 쓰지 않는다`,
    !/top:\s*calc\(\s*50%/.test(body),
    '카드 텍스트 높이는 제목 줄 수에 따라 달라져 상수로는 맞출 수 없다');
});
t('translateY(-50%) 로 화살표 자신의 중앙을 맞춘다',
  /\.carousel-arrow\{[^}]*transform:translateY\(-50%\)/.test(blockOf(768)));

console.log('\n=== 3. 필름 — 터치 블록이 .nf-nav 높이를 건드리지 않는가 ===');
const touch = (() => {
  const m = css.match(/@media\(hover:none\) and \(pointer:coarse\)\{/);
  if (!m) return '';
  let depth = 1, i = m.index + m[0].length;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  return css.slice(m.index, i);
})();
t('터치 기기 블록을 찾았다', touch.length > 0);
const nfTouch = ruleIn(touch, '.nf-nav') || '';
t('터치 블록의 .nf-nav 에 height 가 없다 (있으면 top:0 때문에 상단에 붙는다)',
  !/height\s*:/.test(nfTouch), `현재: .nf-nav{${nfTouch.trim()}}`);
t('탭 타깃은 width 로 확보한다 (44px 이상)',
  (() => { const m = nfTouch.match(/width:\s*(\d+)px/); return m && parseInt(m[1], 10) >= 44; })(),
  `현재: .nf-nav{${nfTouch.trim()}}`);
t('.nf-nav 기본형은 top:0 + height:100% 인 세로 바다',
  /\.nf-nav\{[^}]*top:0[^}]*height:100%/.test(css),
  '이 전제가 깨지면 위 두 검사의 근거가 사라진다');

console.log('\n=== 4. 에디토리얼 — 이미 올바른 방식이 유지되는가 ===');
t('.ed-row-arrow 는 top:0 + 이미지 높이만큼의 세로 바',
  /\.ed-row-arrow\{[^}]*top:0[^}]*height:calc\(/.test(css));
[768, 480, 390, 375, 320].forEach((bp) => {
  const b = blockOf(bp);
  const cardM = (ruleIn(b, '.ed-row-card') || '').match(/min-width:\s*(\d+)px/);
  const arrM = (ruleIn(b, '.ed-row-arrow') || '').match(/height:calc\(\s*(\d+)px\s*\*\s*4\s*\/\s*3\s*\)/);
  if (!cardM && !arrM) { return; }   // 해당 breakpoint 에 규칙이 없으면 건너뜀
  t(`≤${bp}px — 에디토리얼 카드폭 ${cardM && cardM[1]}px = 화살표 기준 ${arrM && arrM[1]}px`,
    !!cardM && !!arrM && cardM[1] === arrM[1]);
});
t('터치 블록은 .ed-row-arrow 높이를 건드리지 않는다 (min-width 만)',
  !/height\s*:/.test(ruleIn(touch, '.ed-row-arrow') || ''));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ carousel-arrow-align tests FAILED'); process.exit(1); }
console.log('✅ carousel-arrow-align tests passed');
