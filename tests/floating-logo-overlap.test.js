/**
 * 메인홈 Floating Logo 중첩 재발 방지 (2026-07-22 QA).
 *
 * [원인] 헤더 개편(pap-header.js v25)으로 index.html 예외가 사라지며, 헤더가
 * 모든 페이지에 자기 정적 로고(.logo-wrap img)를 그리기 시작했다. 그런데 메인홈엔
 * 마우스 추종 '플로팅 로고'(#floatingLogo)가 별도로 존재하고 헤더 중앙에 도킹되므로,
 * 헤더 정적 로고 + 플로팅 로고가 같은 자리에 겹쳐 PAP 로고가 이중으로 보였다.
 * (라이브 실측: 헤더 위치의 visible 로고 요소 2개 → 수정 후 1개)
 *
 * [수정] pap-header.js _papDockFloatingLogo() 에서 #floatingLogo 가 있는 페이지는
 * 헤더 자체 로고(.logo-wrap img)를 visibility:hidden 처리해 플로팅 로고만 남긴다.
 * (.logo-wrap 박스는 유지 → getHeaderLogoPos 도킹 좌표 정확)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const hdr = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'pap-header.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 메인홈 Floating Logo 중첩 재발 방지 ===');

const dock = (hdr.match(/function _papDockFloatingLogo\(\)\{[\s\S]*?\n  \}/) || [''])[0];
t('_papDockFloatingLogo 함수 존재', dock.length > 0);
t('#floatingLogo 있을 때만 동작 (가드 유지)', /if \(!document\.getElementById\('floatingLogo'\)\) return;/.test(dock));
t('헤더 자체 로고(.logo-wrap img)를 선택한다', /header\.header \.logo-wrap img/.test(dock));
t('헤더 자체 로고를 visibility:hidden 으로 숨긴다', /\.style\.visibility\s*=\s*'hidden'/.test(dock));
// 헤더는 여전히 자기 로고 마크업을 만든다(다른 페이지용) — 마크업 자체를 지운 게 아님
t('헤더 로고 마크업은 유지(다른 페이지엔 그대로 노출)', /class="logo-wrap"><img src="\/pap-logo\.png"/.test(hdr));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ floating-logo-overlap tests FAILED'); process.exit(1); }
console.log('✅ floating-logo-overlap tests passed');
