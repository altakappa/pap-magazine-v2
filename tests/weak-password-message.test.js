'use strict';
/**
 * 유출 비밀번호(HIBP) 거절을 "일반 오류"로 뭉개지 않는다 (2026-10-14 건강 점검에서 발견).
 * Vercel 로그: "Signup error: Password is known to be weak and easy to guess" 80회 · 9명(9/16~10/14).
 * 서버는 500 "Registration failed", 화면은 "회원가입 중 오류" 라 사용자가 같은 비밀번호로 계속 재시도했다.
 * 고침: 서버 400 + code weak_password, 화면은 9개 언어 pwLeaked 안내. 재설정(reset-password)도 같게.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

const su = R('api/auth/signup.js');
t('signup: weak/pwned 거절은 500 이 아니라 400 weak_password, 500 폴백보다 앞', (() => { const i = su.indexOf("code: 'weak_password'"); const j = su.indexOf("'Registration failed. Please try again.'"); return i > 0 && j > i && /\/weak\|easy to guess\|pwned\|leaked\/i\.test\(error\.message\)/.test(su); })());
const rp = R('api/auth/reset-password.js');
t('reset-password: updateUserById 거절 중 weak 는 400 weak_password', /if \(\/weak\|easy to guess\|pwned\|leaked\/i\.test\(upErr\.message \|\| ''\)\) \{\s*\n\s*return res\.status\(400\)\.json\(\{ code: 'weak_password'/.test(rp));

const au = R('frontend/auth.html');
const cnt = (k) => (au.match(new RegExp('\\b' + k + ":'", 'g')) || []).length;
t('auth.html: ERR 사전 전 블록(10, ru 중복 포함)에 pwLeaked, 한국어 문구', cnt('pwLeaked') === 10 && /pwLeaked:'이 비밀번호는 유출된 적이 있어 사용할 수 없습니다\./.test(au));
t('auth.html: 가입 catch 가 weak 메시지를 pwLeaked 로 보여준다 (emailDuplicate 다음, 일반 오류보다 앞)', /msgs\.emailDuplicate, 'error'\);\s*\n\s*\} else if \(\/weak\|easy to guess\|breach\|leaked\|pwned\/i\.test\(msg\)\) \{\s*\n[^\n]*\n\s*PAP\.ui\.toast\(msgs\.pwLeaked \|\| msg, 'error'\);/.test(au));
t('auth.html: 재설정 catch 도 같은 매핑', /if \(\/weak\|easy to guess\|breach\|leaked\|pwned\/i\.test\(em\)\) em = msgs\.pwLeaked \|\| em;/.test(au));
t('auth 사전 버전 ≥7', Number((au.match(/content="auth" data-v="(\d+)"/) || [])[1]) >= 7);
// ERR 사전이 문법상 살아 있는지: 스크립트 블록을 실제로 파싱
t('auth.html 인라인 스크립트가 파싱된다', (() => { try { const scripts = [...au.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]); for (const s of scripts) new Function(s); return true; } catch (e) { return e.message; } })());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
