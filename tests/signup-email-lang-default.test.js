/**
 * 가입 시 메일 언어 기본값 (2026-10-19 도메니코 "서브미션 심사완료 이메일이 전부 한글로 가고있는지")
 * 실측: 해외 회원 48명(국가 KR 아님, 사이트 언어도 ko 아님)이 email_language='ko'.
 * 원인: /auth 로 바로 들어오면 showSignup() 을 안 거쳐 드롭다운이 첫 옵션 '한국어' 로 남고,
 * 제출 시 그 값을 그대로 보냈다. 심사 결과 메일은 email_language 를 1순위로 쓰므로 한국어로 갔다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'frontend/auth.html'), 'utf8');
let pass = 0, fail = 0;
function t(n, c) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

t('드롭다운을 직접 바꾸면 touched 표시', /id="signupEmailLang"[^>]*onchange="this\.dataset\.touched='1'"/.test(html));
t('제출: 안 건드렸으면 사이트 언어(signupLang), 건드렸으면 고른 값', /emailLangEl\.dataset\.touched === '1' && emailLangEl\.value\) \|\| signupLang/.test(html));
t('제출: 드롭다운 값을 무조건 쓰던 옛 줄이 없다', !/var emailLang = \(emailLangEl && emailLangEl\.value\) \|\| signupLang;/.test(html));
t('기본 진입(mode 없음)도 드롭다운을 사이트 언어로 맞춘다', /Default entry: signup step 1[\s\S]{0,400}_el\.value = \['ko','en','it','fr','es','ja','zh','ru','de'\]/.test(html));
t('showSignup 프리셋은 사용자가 고른 값을 덮지 않는다', /if \(el && el\.dataset\.touched !== '1'\) el\.value =/.test(html));

// 실제 동작: 심사 메일 언어 규칙이 email_language 1순위인지 (원인 경로 확인)
const { resolveEmailLang } = require('../api/_lib/emailLocale');
t("규칙 확인: email_language='ko' 면 사이트 언어 en 이어도 ko (그래서 가입값이 중요하다)", resolveEmailLang({ email_language: 'ko', language: 'en', country: 'GB' }) === 'ko');
t("규칙 확인: email_language 없으면 사이트 언어", resolveEmailLang({ email_language: null, language: 'it', country: 'IT' }) === 'it');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
