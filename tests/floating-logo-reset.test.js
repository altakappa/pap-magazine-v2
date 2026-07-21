/**
 * 플로팅 로고 원위치 복귀 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA: 히어로 배너의 마우스 추적 로고가 헤더로 복귀하지 않고 배너 중앙에 큰
 * 사이즈로 고정돼, 헤더의 작은 로고와 동시에 보인다.
 *
 * ── 실측 (Chrome, 라이브) ───────────────────────────────────────────
 *   정상        : .in-header  / img 32px / 헤더 위치(574,20)
 *   커서 추적 중: .on-cursor  / img 96px / 화면 중앙(523,379)
 *   게임 닫은 뒤: .on-cursor  / img 96px / 중앙 그대로  ← QA 가 본 화면
 *   리셋 호출 후: .in-header  / img 32px / 헤더 복귀
 *
 * ── 원인 ────────────────────────────────────────────────────────────
 * 로고를 더블클릭하면 미니 게임이 열린다(initGame). 게임은 로고를
 * display:none 으로 감추기만 하고, closeGame 은 display 만 되돌렸다.
 * 클래스(on-cursor)와 좌표는 그대로 보존돼, 게임을 닫는 순간 "커서를
 * 따라다니던 큰 로고"가 그 자리에 그대로 되살아난다.
 *
 * 왜 스스로 복구되지 않았나: 복귀 로직은 mousemove 로만 돈다. Esc 로 닫으면
 * 마우스가 움직이지 않아 아예 실행되지 않는다. scroll 핸들러도 onHero 일
 * 때만 재평가해서 구제되지 않는 경우가 있다.
 *
 * ── 모바일에 대하여 ────────────────────────────────────────────────
 * 터치 기기는 이미 두 겹으로 막혀 있다.
 *   · JS: 'ontouchstart' 또는 maxTouchPoints > 0 이면 플로팅 로직을 통째로
 *     건너뛴다(early return)
 *   · CSS: @media(hover:none) and (pointer:coarse) 에서 .on-cursor 를
 *     display:none 으로 숨긴다
 * QA 가 모바일에서도 봤다면 PC 브라우저의 반응형 모드일 가능성이 높다.
 * 그 모드는 hover:hover / pointer:fine 이라 위 CSS 가 적용되지 않는다.
 * 실기기 확인이 필요하다 — 코드상으로는 막혀 있다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 게임 열고 닫을 때 로고를 헤더 상태로 되돌릴 것
 *  2. 터치 기기 차단(JS/CSS 두 겹)이 유지될 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const home = fs.readFileSync(path.join(ROOT, 'frontend/pap-home.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend/pap-styles.css'), 'utf8');

function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  return '';
}

console.log('\n=== 1. 게임 종료 시 로고가 복귀하는가 ===');
const close = fnBody(home, 'closeGame');
t('closeGame 을 찾았다', close.length > 0);
t('closeGame 이 로고 표시를 되돌린다 (기존 동작 유지)',
  /fLogo\.style\.display\s*=\s*''/.test(close));
t('closeGame 이 로고 상태를 헤더로 되돌린다',
  /window\._papResetFloatingLogo/.test(close),
  'display 만 되돌리면 on-cursor(96px) 상태가 그대로 되살아난다');

console.log('\n=== 2. 게임 시작 시에도 상태를 정리하는가 ===');
const init = fnBody(home, 'initGame');
t('initGame 을 찾았다', init.length > 0);
t('숨기기 전에 헤더 상태로 되돌린다',
  /_papResetFloatingLogo[\s\S]{0,200}fLogo\.style\.display\s*=\s*'none'/.test(init),
  '큰 상태로 감추면 그 상태가 보존된다');

console.log('\n=== 3. 리셋 함수가 노출돼 있는가 ===');
t('window._papResetFloatingLogo 를 노출한다',
  /window\._papResetFloatingLogo\s*=\s*_resetFloatingLogoToHeader/.test(home),
  '게임 코드는 다른 스코프라 전역을 통해서만 부를 수 있다');

console.log('\n=== 4. 터치 기기 차단 (두 겹) ===');
t('JS: 터치 기기면 플로팅 로직을 건너뛴다',
  /'ontouchstart' in window \|\| navigator\.maxTouchPoints > 0/.test(home));
const touchBlock = (css.match(/@media\(hover:none\) and \(pointer:coarse\)\{[\s\S]*?\n\}/) || [''])[0];
t('CSS: 터치 미디어쿼리를 찾았다', touchBlock.length > 0);
t('CSS: 터치 기기에서 커서추적 상태를 숨긴다',
  /\.floating-logo\.on-cursor\{display:none\}/.test(touchBlock),
  'JS 가 어떤 경로로든 클래스를 남겨도 화면에는 안 뜨게 하는 안전망');

console.log('\n=== 5. 큰/작은 상태 크기 전제 ===');
/* 실측값을 테스트가 알고 있어야 "왜 겹쳐 보이는가"가 문서로 남는다. */
t('기본(헤더) 로고는 32px', /\.floating-logo img\{height:32px/.test(css));
t('커서 추적 상태는 96px', /\.floating-logo\.on-cursor img\{height:96px\}/.test(css));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ floating-logo-reset tests FAILED'); process.exit(1); }
console.log('✅ floating-logo-reset tests passed');
