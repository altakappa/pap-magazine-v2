/**
 * 헤더 컨트롤 색 일관성 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA(🐛): 에디토리얼 목록·상세에서 헤더 우측 로그인/마이페이지 아이콘이
 * 안 보이거나 다른 페이지와 색이 다르다.
 *
 * ── 조사 결과: 페이지 문제가 아니었다 ───────────────────────────────
 * 같은 헤더 안에서 계정 아이콘만 흐렸다. 라이브 실측(computed color):
 *     검색  .header-left-item  → rgb(255,255,255)   100%
 *     언어  .lang-btn          → rgb(255,255,255)   100%
 *     계정  .header-right-item → rgba(255,255,255,0.4)  40%
 *
 * 왜 검색은 100% 인가: .header-left-item 은 40% 로 선언돼 있지만 마크업이
 * `class="search-btn header-left-item"` 이고, 뒤에 오는 .search-btn{color:#fff}
 * 가 이긴다. 계정 아이콘은 그런 덮어쓰기가 없어 40% 로 남았다.
 * 즉 "계정만 덮어쓰기를 못 받은" 상태였다.
 *
 * 에디토리얼 전용이 아니다 — 홈에서도 40% 로 확인했다. 어두운 헤더 위에서는
 * 흐릿할 뿐이지만, 밝은 배경 위에서는 사실상 보이지 않는다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 헤더 컨트롤(검색·언어·계정)의 기본 색이 서로 같을 것
 *  2. pap-styles.css 와 pap-header.js 주입본이 같은 값일 것
 *     — 한쪽만 고치면 주입 헤더를 쓰는 페이지에서 다시 갈라진다
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
const hdr = fs.readFileSync(path.join(ROOT, 'frontend/pap-header.js'), 'utf8');

/** 선택자 블록에서 color 값을 뽑아 정규화한다(#fff / rgb(255,255,255) 동일 취급). */
function colorOf(src, selector) {
  const re = new RegExp(selector.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}');
  const m = src.match(re);
  if (!m) return null;
  const c = m[1].match(/color:\s*([^;}]+)/);
  if (!c) return null;
  const v = c[1].trim().toLowerCase().replace(/\s+/g, '');
  if (v === '#fff' || v === '#ffffff' || v === 'rgb(255,255,255)' || v === 'white') return 'WHITE';
  return v;
}

console.log('\n=== 1. 헤더 컨트롤 기본색이 서로 같은가 ===');
const targets = ['.header-right-item', '.lang-btn'];
const vals = targets.map((s) => ({ s, v: colorOf(css, s) }));
vals.forEach(({ s, v }) => t(`${s} → ${v}`, v !== null, '규칙을 못 찾음'));
t('계정 아이콘이 언어 버튼과 같은 색',
  vals[0].v !== null && vals[0].v === vals[1].v,
  `계정 ${vals[0].v} vs 언어 ${vals[1].v} — 계정만 흐리면 밝은 배경에서 안 보인다`);
t('계정 아이콘이 흰색(불투명)', colorOf(css, '.header-right-item') === 'WHITE',
  '반투명이면 배경에 따라 가시성이 달라진다');

console.log('\n=== 2. 검색 버튼이 100% 인 근거가 유지되는가 ===');
/* .header-left-item 자체는 40% 지만 .search-btn 이 덮어쓴다. 이 구조가
   깨지면 검색 버튼이 갑자기 흐려지므로 전제를 함께 감시한다. */
t('.search-btn 이 흰색으로 덮어쓴다', colorOf(css, '.search-btn') === 'WHITE',
  `현재: ${colorOf(css, '.search-btn')}`);
t('검색 버튼 마크업이 두 클래스를 함께 쓴다',
  /class="search-btn header-left-item"/.test(hdr),
  '클래스가 바뀌면 덮어쓰기가 풀려 검색이 흐려진다');

console.log('\n=== 3. 주입 헤더(pap-header.js)와 값이 같은가 ===');
/* pap-header.js 는 자체 CSS 를 주입한다. 한쪽만 고치면 주입 헤더를 쓰는
   페이지에서 색이 다시 갈라진다. */
['.header-right-item', '.lang-btn', '.header-left-item'].forEach((sel) => {
  const a = colorOf(css, sel);
  const b = colorOf(hdr, sel);
  t(`${sel} — CSS(${a}) = 주입본(${b})`, a !== null && a === b,
    '두 곳의 값이 다르면 페이지마다 헤더 색이 달라진다');
});

console.log('\n=== 4. index.html 오버레이 미니헤더 계정 아이콘이 안 흐린가 (2026-07-21 QA) ===');
/* 에디토리얼 목록/상세는 .overlay-mini-header 를 따로 쓴다. 그 계정 아이콘이
   인라인 color:inherit 이면 클래스(#fff)를 이기고 어두운 배경색을 상속해
   검정 위 검정으로 사라진다. bcb7594 가 클래스만 고쳐 이 경로를 놓쳤다. */
const idx = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
const acctInherit = (idx.match(/class="header-right-item"[^>]*aria-label="Account"[^>]*color:\s*inherit/g) || []).length;
t('오버레이 계정 아이콘에 color:inherit 가 없다', acctInherit === 0,
  acctInherit + '곳이 color:inherit — 어두운 오버레이에서 아이콘이 안 보인다. color:#fff 로.');
const acctWhite = (idx.match(/class="header-right-item"[^>]*aria-label="Account"[^>]*color:\s*#fff/g) || []).length;
t('오버레이 계정 아이콘이 흰색으로 지정됐다', acctWhite >= 6,
  '현재 흰색 지정: ' + acctWhite + '곳');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ header-icon-color tests FAILED'); process.exit(1); }
console.log('✅ header-icon-color tests passed');
