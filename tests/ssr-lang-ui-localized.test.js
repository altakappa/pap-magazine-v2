// PAP Magazine — 언어판 SSR 의 한국어 UI 누출 방지 (2026-08-25)
//
// [왜] GSC "중복 페이지, Google에서 사용자와 다른 표준을 선택함" 1,655건 표본은
// 전부 언어판(/it·/fr·/de·/es·/en)이었다. URL 검사 실측(/it/editorial/sacre-chaos):
// 사용자 선언 표준은 /it 자신인데 Google 은 ko 정본을 표준으로 골랐다.
// 라이브 실측: /it 화보의 이탈리아어는 제목·설명 2~3문장뿐인데 다운로드 안내·
// 버튼·저작권 줄이 전부 한국어 → 언어판이 ko 사본처럼 보인다.
// 고칠 수 있는 신호(한국어 UI 누출)를 언어판에서 제거하고 이 테스트로 고정한다.
//
// Run with `node tests/ssr-lang-ui-localized.test.js` (wired into `npm test`).

'use strict';

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'api', '_lib', 'seoRenderer.js'), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('\n=== 다운로드 블록 현지화 (DL_T) ===');
for (const l of ['ko', 'en', 'it', 'fr', 'es', 'ja', 'de', 'zh', 'ru']) {
  ok(`DL_T.${l} 존재`, new RegExp(l + ": \\{ note:").test(src));
}
ok('블록이 사전을 쓴다 (DL.note/sub/login/use)',
   /DL\.note/.test(src) && /DL\.sub/.test(src) && /DL\.login/.test(src) && /DL\.use/.test(src));
// HTML 형태(<strong 포함)는 사전의 ko 항목 한 곳에만 있어야 한다.
// (라인 ~1999 의 네이버 스니펫 주석은 평문이라 이 패턴에 안 걸린다.)
ok('한국어 문구가 사전 밖(하드코딩)에 남아있지 않다',
   (src.match(/커버 및 로고 이미지 다운로드는 <strong/g) || []).length === 1
   && (src.match(/멤버십 구독하기/g) || []).length === 1);
ok('ko 문구는 종전 그대로 (스탠다드 멤버십 전용)', /스탠다드 멤버십<\/strong> 전용입니다/.test(src));
ok('언어 폴백은 en', /DL_T\[lang\] \|\| DL_T\.en/.test(src));

console.log('\n=== 저작권 줄 — 팝매거진은 ko 전용 ===');
ok("ko 조건부 병기 (\\${lang === 'ko' ? ' 팝매거진' : ''})",
   /© PAP MAGAZINE\$\{lang === 'ko' \? ' 팝매거진' : ''\}/.test(src));

console.log('\n=== SUMMARY ===');
console.log(`passed: ${passed}   failed: ${failed}`);
if (failed > 0) process.exit(1);
console.log('✓ ssr-lang-ui-localized tests passed');
process.exit(0);
