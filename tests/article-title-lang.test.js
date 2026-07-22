/**
 * 아티클 제목 언어 폴백 (2026-07-22 QA: 한국어 설정인데 목록·상세 제목이 영문).
 *
 * [원인] 한국어 원문은 ti18n 이 아니라 기본 필드(t)에 실리는데, 렌더 폴백이
 * `ti18n[L] || ti18n.en || t` 라서 L='ko' 일 때 ti18n.ko 부재 → 곧장 영문(en).
 * QA #30 수정이 title_en 을 ti18n.en 으로 싣기 시작한 순간부터 한국어 사용자
 * 전원이 영문 제목을 보게 됐다(의도 주석 '한국어→원문'과 구현이 정반대).
 * 라이브 실측: pap-lang='ko' 상태의 /article 목록 제목 전부 영문 재현.
 *
 * [수정] 언어별 폴백: ko → ti18n.ko→원문(t)→en · 그 외 → ti18n[L]→en→원문.
 * 이 테스트는 실제 헬퍼(_papLocTitle/_papLocSub)를 추출·실행해 검증한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'pap-content-article.js'), 'utf8');
const listSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'articles.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

// 실제 헬퍼 추출·실행 (현재 언어는 주입)
function build(lang){
  const m = src.match(/function _papLocTitle[\s\S]*?\n\}\nfunction _papLocSub[\s\S]*?\n\}/);
  if(!m) return null;
  return new Function('_papCurLang', m[0] + '; return {title:_papLocTitle, sub:_papLocSub};')(() => lang);
}

console.log('\n=== 아티클 제목 언어 폴백 (실행 검증) ===');
const H = build('ko');
t('헬퍼 추출 성공', !!H);
if(H){
  const dbItem = { t:'뉴진스를 다시 재생해야 할 시간', ti18n:{ en:'TIME TO PRESS PLAY AGAIN' }, sub:'데뷔 4주년', subi18n:{ en:'4th anniversary' } };
  t('ko: 원문(한국어)이 나온다 — 라이브 버그 케이스', H.title(dbItem) === '뉴진스를 다시 재생해야 할 시간', 'got: '+H.title(dbItem));
  t('ko: 부제도 한국어', H.sub(dbItem) === '데뷔 4주년');
  const koTrans = { t:'ENGLISH SEED TITLE', ti18n:{ ko:'명시 한국어 번역', en:'ENGLISH SEED TITLE' } };
  t('ko: 명시 ti18n.ko 가 있으면 그것이 우선', build('ko').title(koTrans) === '명시 한국어 번역');
  t('en: 영문이 나온다', build('en').title(dbItem) === 'TIME TO PRESS PLAY AGAIN');
  const jaItem = { t:'한국어 원문', ti18n:{ en:'EN TITLE', ja:'日本語タイトル' } };
  t('ja: 일본어 번역 우선', build('ja').title(jaItem) === '日本語タイトル');
  t('ja: 번역 없으면 en 폴백', build('ja').title(dbItem) === 'TIME TO PRESS PLAY AGAIN');
  t('번역 전무: 원문 폴백 (어느 언어든)', build('fr').title({ t:'원문만' }) === '원문만');
}

console.log('\n=== 목록(articles.html) 인라인도 같은 규칙 ===');
t('ko 분기가 원문(t) 우선', /_curLang==='ko'[\s\S]{0,80}a\.ti18n&&a\.ti18n\.ko\)\|\|a\.t\|\|/.test(listSrc));
t('구(舊) en-우선 폴백이 남아있지 않다', !/_locT=\(a\.ti18n&&\(a\.ti18n\[_curLang\]\|\|a\.ti18n\.en\)\)\|\|a\.t/.test(listSrc));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ article-title-lang tests FAILED'); process.exit(1); }
console.log('✅ article-title-lang tests passed');
