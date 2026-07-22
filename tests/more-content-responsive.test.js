/**
 * More Content 캐러셀 모바일 반응형 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA: 에디토리얼 상세 하단 "More Content" 카드가 모바일에서 지나치게
 * 작게 보인다. 메인홈 에디토리얼 슬라이드 카드 정도로 키워달라.
 *
 * ── 원인 ────────────────────────────────────────────────────────────
 * QA 는 "모바일 전용 반응형 스타일이 누락된 것"으로 보셨는데, 실제로는
 * 모바일 breakpoint 에 규칙이 "있었고 값이 데스크톱과 똑같았다".
 *   데스크톱  .ed-more-card{flex:1 1 0;min-width:0}
 *   @768px    .ed-more-card{flex:1 1 0;min-width:0}   ← 그대로 재선언
 *
 * flex:1 1 0 은 트랙 폭을 "카드 개수"로 나눈다. 이 캐러셀은 카드가 8장
 * 이라, 414px 화면에서 카드 한 장이 35px 까지 쪼그라들었다.
 * (라이브에서 폭을 414px 로 강제해 실측한 값이다. 4장 기준으로 어림한
 *  90px 보다 훨씬 심각했다 — 개수를 확인하지 않았으면 놓쳤을 부분)
 *
 * ── 수정 ────────────────────────────────────────────────────────────
 * 트랙은 이미 overflow-x:auto 라 가로 스크롤이 된다. 카드에 고정 폭을
 * 주고 넘치는 건 스와이프로 보게 한다. 폭은 QA 요청대로 메인홈
 * 에디토리얼 슬라이드(.ed-row-card)와 breakpoint 별로 동일하게 맞췄다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. More Content 카드 폭이 메인홈 슬라이드와 계속 같을 것
 *  2. 모바일에서 flex:1 1 0 (개수 균등분할)로 되돌아가지 않을 것
 *  3. 가로 스크롤 캐러셀에 같은 함정이 새로 생기지 않을 것
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

// breakpoint 별 규칙을 뽑는다.
// ⚠ 같은 max-width 의 @media 블록이 파일 안에 여러 개 있다(예: 353행의
//   1줄짜리 블록과 888행의 큰 블록). 첫 번째만 보면 엉뚱한 걸 읽어
//   "규격을 못 찾음"이 된다 — 전부 훑어서 px 값이 있는 것을 채택한다.
function rulesInMedia(maxWidth, selector) {
  const re = new RegExp('@media\\s*\\(max-width:\\s*' + maxWidth + 'px\\)\\s*\\{', 'g');
  const selRe = new RegExp('\\' + selector + '\\s*\\{([^}]*)\\}');
  let m, found = null;
  while ((m = re.exec(css))) {
    let depth = 1, i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const rm = css.slice(m.index, i).match(selRe);
    if (rm) {
      found = rm[1];
      if (/min-width:\s*\d+px/.test(found)) return found;   // px 규격이면 확정
    }
  }
  return found;   // px 가 없으면(calc 등) 마지막으로 찾은 것
}

function widthOf(body) {
  if (body == null) return null;
  const m = body.match(/min-width:\s*(\d+)px/);
  return m ? parseInt(m[1], 10) : null;
}

console.log('\n=== 메인홈 슬라이드와 폭이 일치하는가 (QA 요청 기준) ===');
const BPS = [768, 480, 390, 375, 320];
BPS.forEach((bp) => {
  const row = widthOf(rulesInMedia(bp, '.ed-row-card'));
  const more = widthOf(rulesInMedia(bp, '.ed-more-card'));
  t(`≤${bp}px — 메인홈 ${row}px / More ${more}px`, row !== null && row === more,
    row === null ? '메인홈 규격을 못 찾음' : `불일치 (${row} vs ${more})`);
});

console.log('\n=== 모바일에서 균등분할로 되돌아가지 않았는가 ===');
const m768 = rulesInMedia(768, '.ed-more-card') || '';
t('≤768px 에서 flex:1 1 0 이 아니다 (개수 균등분할 금지)',
  !/flex\s*:\s*1\s+1\s+0/.test(m768), m768.trim().slice(0, 60));
t('≤768px 에서 고정 폭을 갖는다', widthOf(m768) !== null);
/* QA(2026-07-22 갱신) — 데스크톱 균등분할(flex:1 1 0)도 같은 버그였음이
   확인됨(8장이 96px 로 수축, scrollWidth==clientWidth → 좌우 버튼 무반응).
   데스크톱은 4장 고정 폭 + 초과분 가로 스크롤이 정답.
   상세는 tests/more-content-carousel.test.js */
t('데스크톱은 4장 고정 폭 (균등분할 금지)',
  /\.ed-more-card\{flex:0 0 calc\(\(100% - 30px\)\/4\)/.test(css));

console.log('\n=== 모바일 캐러셀 마무리 ===');
t('화살표는 모바일에서 숨김 (터치는 스와이프)',
  /\.ed-more-arrow\{display:none\}/.test(m768) || /\.ed-more-arrow\{display:none\}/.test(css));
t('좌우 여백을 메인홈 트랙과 정렬 (--pad-x)',
  /\.ed-more-carousel\s*\{\s*padding:\s*0\s+var\(--pad-x\)/.test(
    rulesInMedia(768, '.ed-more-carousel') !== null
      ? '.ed-more-carousel{' + rulesInMedia(768, '.ed-more-carousel') + '}'
      : ''));
t('트랙이 가로 스크롤 가능 (스와이프 전제)',
  /\.ed-more-track\{[^}]*overflow-x:auto/.test(css));

console.log('\n=== 같은 함정이 다른 캐러셀에 생기지 않았는가 ===');
// overflow-x 트랙의 카드가 flex:1 1 0 인데 모바일 고정폭이 없으면 같은 버그
const offenders = [];
const re = /([^{}\n]*card[^{}\n]*)\{([^}]*flex\s*:\s*1\s+1\s+0[^}]*)\}/gi;
let mm;
while ((mm = re.exec(css))) {
  const sel = mm[1].trim();
  const base = sel.split(/\s+/).pop();
  const hasFixed = new RegExp('\\' + base + '\\{[^}]*min-width:\\s*\\d+px').test(css);
  if (!hasFixed) offenders.push(sel);
}
t('모바일 고정폭 없는 균등분할 카드가 없다', offenders.length === 0, offenders.join(', '));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ more-content-responsive tests FAILED'); process.exit(1); }
console.log('✅ more-content-responsive tests passed');
