/**
 * 마이페이지 모바일 상단 탭바 고정 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA(🚨 결함, 수정 방향 오적용): "탭 메뉴가 헤더 아래에 나란히 고정"을
 * 요청했는데, 1차 수정 결과 탭바가 헤더를 통째로 덮어 헤더가 사라졌다.
 *
 * ── 원인 (라이브 실측) ──────────────────────────────────────────────
 * (A) 헤더의 실효 z-index 는 1600 이 아니라 1000 이다.
 *     pap-styles.css 에 .header{z-index:1600} 이 있지만, pap-header.js 가
 *     <head> 맨 뒤에 safety net <style> 을 주입해 header.header{z-index:1000}
 *     으로 덮어쓴다(특이도도 더 높다). CSS 파일만 보고 1600 으로 판단해
 *     탭바를 1400 으로 뒀고, 1400 > 1000 이라 탭바가 헤더를 덮었다.
 *     라이브 384px 실측: 헤더 밴드 전 지점(로고 중앙 포함)이 .mp-sidebar 로 찍혔다.
 *
 * (B) position:sticky 는 이 페이지에서 애초에 작동하지 않는다.
 *     body{overflow-x:hidden} 이면 CSS 규격상 overflow-y 가 visible→auto 로
 *     계산되어 body 가 스크롤 컨테이너가 되고, 그 자식의 sticky 는 고정될
 *     대상을 잃는다. 1차 수정 때 "sticky 정상 동작 확인"이라 적은 것은
 *     window 를 스크롤해 잰 오측이었다(실제 스크롤러는 body/html 쪽).
 *     → position:fixed 로 전환. 스크롤 컨테이너가 무엇이든 영향받지 않는다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 탭바가 헤더보다 위로 올라가지 않을 것 (z-index 역전 재발 방지)
 *     — 헤더 z 를 pap-header.js 에서 "직접 읽어" 비교한다. 숫자를 베껴
 *       적어두면 pap-header.js 가 바뀔 때 조용히 틀려지기 때문이다.
 *  2. 탭바 top 이 그 breakpoint 의 헤더 높이와 정확히 같을 것 (겹침/틈 방지)
 *  3. 본문 상단 여백이 헤더+탭바보다 클 것 (내용이 탭바에 가리지 않게)
 *  4. sticky 로 되돌아가지 않을 것 (body overflow 함정)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const mypage = fs.readFileSync(path.join(ROOT, 'frontend/mypage.html'), 'utf8');
const headerJs = fs.readFileSync(path.join(ROOT, 'frontend/pap-header.js'), 'utf8');

/* ── pap-header.js safety net 에서 "실제" 헤더 규격을 읽어온다 ───────── */
const safety = (headerJs.match(/id\s*=\s*'pap-header-safety'[\s\S]*?join\('\\n'\)/) || [''])[0];
const headerZ = (() => {
  const m = safety.match(/header\.header\{[^}]*z-index:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
})();
// 기본 72px + breakpoint 별 override
const headerH = { 900: 72, 768: null, 480: null };
[768, 480].forEach((bp) => {
  const re = new RegExp('@media\\(max-width:' + bp + 'px\\)\\{header\\.header\\{height:(\\d+)px');
  const m = safety.match(re);
  headerH[bp] = m ? parseInt(m[1], 10) : null;
});

console.log('\n=== 0. 헤더 규격을 pap-header.js 에서 읽을 수 있는가 (드리프트 감지) ===');
t('safety net 블록을 찾았다', safety.length > 0);
t(`헤더 z-index 를 읽었다 (= ${headerZ})`, headerZ !== null,
  'pap-header.js 의 safety net 구조가 바뀌었다 — 이 테스트를 함께 고칠 것');
t(`≤768 헤더 높이를 읽었다 (= ${headerH[768]})`, headerH[768] !== null);
t(`≤480 헤더 높이를 읽었다 (= ${headerH[480]})`, headerH[480] !== null);
t('기본 헤더 높이 72px 확인', /header\.header\{[^}]*height:72px/.test(safety));

/* ── mypage.html 의 breakpoint 별 .mp-sidebar / .mp-wrapper 규칙 ──────── */
function blockOf(maxWidth) {
  const re = new RegExp('@media\\(max-width:' + maxWidth + 'px\\)\\s*\\{', 'g');
  let m, out = '';
  while ((m = re.exec(mypage))) {
    let depth = 1, i = m.index + m[0].length;
    while (i < mypage.length && depth > 0) {
      if (mypage[i] === '{') depth++;
      else if (mypage[i] === '}') depth--;
      i++;
    }
    out += mypage.slice(m.index, i);
  }
  return out;
}
function ruleIn(block, selector) {
  const m = block.match(new RegExp(selector.replace(/[.\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}
function num(body, prop) {
  if (!body) return null;
  // z-index 는 단위가 없고 top/padding-top 은 px 이다 — 둘 다 받는다.
  const m = body.match(new RegExp(prop + ':\\s*(\\d+)(?:px)?\\b'));
  return m ? parseInt(m[1], 10) : null;
}

const b900 = blockOf(900), b768 = blockOf(768), b480 = blockOf(480);
const side900 = ruleIn(b900, '.mp-sidebar');

console.log('\n=== 1. 탭바가 헤더를 덮지 않는가 (이번 결함의 본체) ===');
const sideZ = num(side900, 'z-index');
t(`탭바 z-index(${sideZ}) < 헤더 z-index(${headerZ})`,
  sideZ !== null && headerZ !== null && sideZ < headerZ,
  '탭바가 헤더 위로 올라가면 헤더가 가려진다');
t('탭바 z-index 가 1400 이 아니다 (1차 오적용 값)', sideZ !== 1400);
t('커뮤니티 탭바(.c-header, z-index:999)와 같은 층에 있다',
  sideZ === 999 && /\.c-header\{top:72px!important;z-index:999!important\}/.test(headerJs));

console.log('\n=== 2. sticky 함정으로 되돌아가지 않았는가 ===');
t('.mp-sidebar 모바일은 position:fixed', /position:fixed/.test(side900 || ''));
t('.mp-sidebar 모바일에 position:sticky 가 없다',
  !/position:sticky/.test(side900 || ''),
  'body{overflow-x:hidden} 때문에 sticky 는 이 페이지에서 작동하지 않는다');
t('body 의 overflow-x:hidden 전제가 아직 유효하다 (sticky 금지 근거)',
  /body\{[^}]*overflow-x:hidden/.test(
    fs.readFileSync(path.join(ROOT, 'frontend/pap-styles.css'), 'utf8')
  ) || /overflow-x:hidden/.test(mypage));

console.log('\n=== 3. 탭바가 헤더 "바로 아래"에 붙는가 (breakpoint 별) ===');
const tops = { 900: num(side900, 'top'), 768: num(ruleIn(b768, '.mp-sidebar'), 'top'), 480: num(ruleIn(b480, '.mp-sidebar'), 'top') };
[900, 768, 480].forEach((bp) => {
  t(`≤${bp}px — 탭바 top ${tops[bp]}px = 헤더 높이 ${headerH[bp]}px`,
    tops[bp] !== null && tops[bp] === headerH[bp],
    tops[bp] === null ? '규칙을 못 찾음' : `어긋남 (겹치거나 틈이 생긴다)`);
});

console.log('\n=== 4. 본문이 탭바에 가리지 않는가 ===');
/* 탭바 높이 37px — .mp-side-link{padding:10px 16px} 기준 라이브 실측.
   가로 스크롤바가 보이면 53px 이 되므로 스크롤바는 숨겨야 한다(아래 5번). */
const BAR = 37;
const pads = {
  900: num(ruleIn(b900, 'body.pap-has-header .mp-wrapper'), 'padding-top'),
  768: num(ruleIn(b768, 'body.pap-has-header .mp-wrapper'), 'padding-top'),
  480: num(ruleIn(b480, 'body.pap-has-header .mp-wrapper'), 'padding-top'),
};
[900, 768, 480].forEach((bp) => {
  const need = headerH[bp] + BAR;
  t(`≤${bp}px — 본문 여백 ${pads[bp]}px ≥ 헤더+탭바 ${need}px`,
    pads[bp] !== null && pads[bp] >= need,
    pads[bp] === null ? '규칙을 못 찾음' : `${need - pads[bp]}px 만큼 본문이 가린다`);
});
t('pap-header.js 의 !important 를 특이도로 이기는 선택자를 쓴다',
  /body\.pap-has-header\s+\.mp-wrapper/.test(mypage) &&
  /\.pap-has-header \.mp-wrapper\{padding-top:100px!important\}/.test(headerJs),
  'body 를 앞에 붙이지 않으면 pap-header.js 의 100px!important 에 진다');

console.log('\n=== 5. 탭바 높이가 환경에 따라 흔들리지 않는가 ===');
t('가로 스크롤바 숨김 (스크롤바가 보이면 탭바가 37→53px 로 커진다)',
  /scrollbar-width:none/.test(side900 || '') &&
  /\.mp-sidebar::-webkit-scrollbar\{display:none\}/.test(mypage));
t('탭 스트립은 여전히 가로 스크롤 가능 (탭이 화면보다 길다)',
  /overflow-x:auto/.test(side900 || ''));
t('가로 스와이프가 뒤로가기로 새지 않는다',
  /overscroll-behavior-x:contain/.test(side900 || ''));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ mypage-sticky-tabs tests FAILED'); process.exit(1); }
console.log('✅ mypage-sticky-tabs tests passed');
