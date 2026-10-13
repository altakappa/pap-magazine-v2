'use strict';
/**
 * 비밀번호 재설정을 링크 대신 6자리 코드로 (2026-10-13, 도메니코 "ㄱ으로 가자").
 * 핫메일/아웃룩 링크 스캐너가 1회용 재설정 링크를 먼저 열어 "만료"시키던 문제(Iván 사례).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }
const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];

const sc = R('api/auth/send-code.js');
t('send-code: purpose reset|signup 만, JWT 에 purpose', /const purpose = \(req\.body && req\.body\.purpose === 'reset'\) \? 'reset' : 'signup';/.test(sc) && /\{ email: email\.trim\(\)\.toLowerCase\(\), codeHash, purpose \}/.test(sc));
t('send-code: RESET_COPY 9개 언어(제목·제목줄·본문)', LANGS.every((l) => new RegExp('\\n  ' + l + ": \\{ subject: '[^']+', heading: '[^']+', body: '[^']+' \\},").test(sc.slice(sc.indexOf('const RESET_COPY'), sc.indexOf('function pickCodeLang')))));
t('send-code: 재설정은 가입된 이메일에만 발송, 응답은 동일(열거 방지)', /if \(purpose === 'reset'\) \{[\s\S]*?\.ilike\('email', email\.trim\(\)\)\.maybeSingle\(\);\s*\n\s*if \(!prof\) return res\.status\(200\)\.json\(\{ verificationToken, message: 'Verification code sent' \}\);/.test(sc) && /buildVerificationEmail\(code, codeLang, purpose\)/.test(sc));
const vc = R('api/auth/verify-code.js');
t('verify-code: verifiedToken 에 purpose 고정', /purpose: decoded\.purpose === 'reset' \? 'reset' : 'signup'/.test(vc));
const su = R('api/auth/signup.js');
t('signup: 재설정 토큰으로 가입 불가', /decoded\.purpose === 'reset'\)/.test(su));
const rp = R('api/auth/reset-password.js');
t('reset-password: purpose reset + verified 필수, 정책(8자·글자+숫자), admin.updateUserById, token_version +1', /decoded\.purpose !== 'reset'/.test(rp) && /length < 8/.test(rp) && /auth\.admin\.updateUserById\(prof\.id, \{ password: String\(password\) \}\)/.test(rp) && /token_version: \(Number\(prof\.token_version\) \|\| 0\) \+ 1/.test(rp) && /rateLimitStrict\(req, res, RATE_LIMITS\.auth, 'reset-password'\)/.test(rp));
t('reset-password: 계정 없으면 같은 모양 200(열거 방지)', /if \(!prof\) \{[\s\S]*?return res\.status\(200\)\.json\(\{ ok: true \}\);/.test(rp));

const au = R('frontend/auth.html');
t('auth.html: 재설정 코드 입력칸 + 라벨', /id="resetCode" maxlength="6" inputmode="numeric"/.test(au) && /data-i18n="resetCodeHint">이메일로 전송된 6자리 코드를 입력하세요\.<\/label>/.test(au));
t('auth.html: sendResetEmail 이 send-code purpose:reset 호출, Supabase 링크 발송 제거', /purpose: 'reset'/.test(au) && !/sb\.auth\.resetPasswordForEmail\(/.test(au));
t('auth.html: doResetPassword 가 verify-code → reset-password', /\/api\/auth\/verify-code'[\s\S]*?verificationToken: _resetVerificationToken[\s\S]*?\/api\/auth\/reset-password'[\s\S]*?verifiedToken: j1\.verifiedToken, password: pw1/.test(au));
const cnt = (k) => (au.match(new RegExp('\\b' + k + ":'", 'g')) || []).length;
t('auth.html: forgotDesc/forgotBtn/forgotSent/resetCodeHint 사전 전 블록(10, ru 중복 포함)', cnt('resetCodeHint') === 10 && cnt('forgotBtn') === 10 && /forgotBtn:'재설정 코드 받기'/.test(au) && !/forgotBtn:'재설정 링크 받기'/.test(au));
t('auth.html HTML: 링크→코드 문구', /data-i18n="forgotDesc">가입하신 이메일을 입력하시면 재설정 코드를 보내드립니다\./.test(au) && /data-i18n="forgotBtn" onclick="sendResetEmail\(\)">재설정 코드 받기</.test(au));
t('auth 사전 8개 언어에 새 한국어 키 2개', ['en','de','it','fr','es','ja','zh','ru'].every((l) => { const d = JSON.parse(R('frontend/i18n/ui/auth.' + l + '.json')); return d['가입하신 이메일을 입력하시면 재설정 코드를 보내드립니다.'] && d['재설정 코드 받기'] && !/[가-힣]/.test(d['재설정 코드 받기']); }));
t('auth 사전 버전 ≥6', Number((au.match(/content="auth" data-v="(\d+)"/) || [])[1]) >= 6);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
