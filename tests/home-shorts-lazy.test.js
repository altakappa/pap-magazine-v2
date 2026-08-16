/**
 * 홈 쇼츠 유튜브 지연 로딩 회귀 (2026-08-17, "웹사이트 느려짐" 진단).
 *
 * [실측] 홈을 여는 순간 쇼츠 캐러셀이 화면 밖인데도 유튜브 iframe 5개
 * (중앙+양옆 2개씩)를 즉시 로드 — 각 ~2.3초, 서드파티 JS 수 MB.
 * 서버는 무죄(TTFB 10ms). 섹션이 보일 때만 로드하도록 수정.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const sh = R('frontend/pap-content-creator-shorts.js');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  \u2713',n);} else {fail++;console.log('  \u2717',n); if(d)console.log('     ',d);} }

console.log('\n=== \uc1fc\uce20 \uc9c0\uc5f0 \ub85c\ub529 ===');
t('보일 때(또는 이미 로드됨)만 iframe src 세팅',
  /if\(shortsInView \|\| loaded\)\{/.test(sh),
  '이 가드가 사라지면 홈 첫 로드에 유튜브 5개가 다시 붙는다');
t('로드 여부 판별 존재', /var loaded = iframe\.src && iframe\.src !== '' && iframe\.src !== 'about:blank';/.test(sh));
t('IntersectionObserver 가 진입 시 재호출 (지연 로딩의 전제)',
  /shortsInView=e\.isIntersecting;[\s\S]{0,80}updateShortsPositions\(\);/.test(sh));

console.log('--- \uce90\uc2dc\ubc84\uc2a4\ud2b8 ---');
const htmls = fs.readdirSync(path.join(__dirname,'..','frontend')).filter(f=>f.endsWith('.html'));
let stale = [];
htmls.forEach(f=>{ if(R('frontend/'+f).includes('pap-content-creator-shorts.js?v=13')) stale.push(f); });
t('v=13 참조 잔존 0건 (전 HTML v=14+)', stale.length === 0, stale.join(', '));
t('index.html 이 v=14+ 참조', /pap-content-creator-shorts\.js\?v=(1[4-9]|[2-9]\d)/.test(R('frontend/index.html')));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('\u274c home-shorts-lazy tests FAILED'); process.exit(1); }
