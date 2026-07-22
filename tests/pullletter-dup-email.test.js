/**
 * 풀레터 3차 QA(2026-07-22) — "정상 파일인데 신청에 실패했습니다" 근본원인 회귀 테스트.
 *
 * [서버 로그로 확정한 원인] pullletters.email UNIQUE 제약(pullletters_email_key).
 *   같은 이메일의 두 번째 신청부터 전부 23505 duplicate key 로 거부됐고,
 *   원시 DB 영문 메시지가 그대로 내려가 프론트 폴백("신청에 실패했습니다")만 보였다.
 *   파일 형식/용량과 무관 — 1차(형식)·2차(null)와 달리 이번엔 DB 제약이 범인.
 *
 * [조치] ① DB: 제약 제거(migration drop_pullletters_email_unique, 도메니코 승인 다건 허용)
 *        ② 서버: 23505 → 409 duplicate_request 매핑, 원시 메시지 비노출, 문의처 포함
 *        ③ 프론트: dupRequest 8개 언어 + duplicate 패턴 매칭, 폴백에 문의처 포함
 * 이 테스트는 ②③이 되돌아가지 않도록 감시한다. (①은 라이브 SQL 로 확인 완료)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'pullletters', 'index.js'), 'utf8');
const fe  = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'pullletter.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 풀레터 중복신청(23505) 근본수정 회귀 ===');

// ── 서버 (api/pullletters/index.js) ──
const catchBlock = (api.match(/catch \(error\) \{[\s\S]*?Create pull-letter error[\s\S]*?\n    \}/) || [''])[0];
t('create catch 에서 23505 → 409 매핑', /error\.code === '23505'[\s\S]{0,200}status\(409\)/.test(catchBlock));
t('409 응답에 duplicate_request 코드', /code:\s*'duplicate_request'/.test(catchBlock));
t('원시 error.message 를 그대로 내려보내지 않음', !/message:\s*error\.message\s*\|\|/.test(catchBlock),
  'error.message || … 패턴이 다시 생기면 DB 내부 메시지가 사용자에게 샌다');
t('일반 500 안내에 문의처 포함', /500[\s\S]{0,300}contact@pap-magazine\.com/.test(catchBlock));

// ── 프론트 (pullletter.html) ──
t('dupRequest 메시지 키 존재', /dupRequest:\{ko:/.test(fe));
['ko','en','it','fr','es','ja','zh','ru'].forEach(function(l){
  t('dupRequest ' + l, new RegExp("dupRequest:\\{[\\s\\S]*?" + l + ":'").test(fe));
});
t('catch 가 duplicate 계열 패턴 매칭', /duplicate_request\|already exists\|duplicate key/.test(fe));
t('duplicate 매칭 시 dupRequest 사용', /duplicate_request\|already exists\|duplicate key[\s\S]{0,300}dupRequest/.test(fe));
t('submitFailed 폴백에 문의처 포함(ko)', /submitFailed:\{ko:'[^']*contact@pap-magazine\.com/.test(fe));
t('submitFailed 폴백에 문의처 포함(en)', /submitFailed:\{[^}]*en:'[^']*contact@pap-magazine\.com/.test(fe));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ pullletter-dup-email tests FAILED'); process.exit(1); }
console.log('✅ pullletter-dup-email tests passed');
