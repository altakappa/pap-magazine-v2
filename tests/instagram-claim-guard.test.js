'use strict';
/**
 * 인스타 아이디 가짜 등록 막기 (2026-10-03, 도메니코 "참여자가 아닌데 자기 거라고 속이면?")
 *  1겹: 등록·변경 시 텔레그램 알림(크레딧에 적힌 화보 수 포함)  2겹: 관리자 확인 도장 없으면 연락 버튼·프리미엄 배지 없음
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }
const LANGS = ['ko','en','de','it','fr','es','ja','zh','ru'];

t('마이그레이션 176: instagram_verified_at + 기존 등록자 일괄 도장', /add column if not exists instagram_verified_at/.test(R('supabase_migrations/176_profiles_instagram_verified.sql')) && /where instagram is not null and instagram_verified_at is null/.test(R('supabase_migrations/176_profiles_instagram_verified.sql')));
const me = R('api/auth/me.js');
t('me.js: 아이디가 바뀌면 도장을 지우고 알림, 같으면 그대로', /if \(prevHandle !== h\) \{ updates\.instagram_verified_at = null; _igChanged = /.test(me) && /if \(_igChanged\) alertInstagramClaim\(supabaseAdmin/.test(me) && /instagramVerified: !!profile\.instagram_verified_at/.test(me));
const lib = R('api/_lib/instagramClaimAlert.js');
t('알림 lib: @ 유무 둘 다 세고, 실패해도 저장을 안 막는다', /for \(const v of \[h, '@' \+ h\]\)/.test(lib) && /contains\('credits', \[\{ instagram: v \}\]\)/.test(lib) && /sendTextToTelegramSafe\(text\)/.test(lib));
t('member-update: instagramVerified → 도장 찍기/지우기', /instagramVerified \? new Date\(\)\.toISOString\(\) : null/.test(R('api/admin/member-update.js')) && /instagramVerified: !!m\.instagram_verified_at/.test(R('api/admin/members.js')));
const cp = R('api/_lib/contributorProfile.js');
t('기여자 페이지: 프리미엄이어도 도장 없으면 배지·연락 버튼 없음 (두 조회 모두)', /isPremiumProfile\(p\) && !!p\.instagram_verified_at/.test(cp) && /\.not\('instagram_verified_at', 'is', null\)/.test(cp));
t('연락 버튼 API 도 같은 판정(findPremiumCreator)을 쓴다', /findPremiumCreator\(supabaseAdmin, handle\)/.test(R('api/contributors/contact.js')));
const adm = R('frontend/pap-admin.js');
t('관리자 회원 창: 확인 대기/확인됨 + 도장 버튼 + 인스타 보기 링크', /async function setMemberIgVerified\(id, v\)/.test(adm) && /IG 확인 도장/.test(adm) && /도장 지우기/.test(adm) && /instagramVerified:!!v/.test(adm) && /pap-admin\.js\?v=(16[5-9]|1[7-9]\d|[2-9]\d\d)/.test(R('frontend/admin.html')));
const mp = R('frontend/mypage.html');
t('마이페이지: 확인 대기/확인됨 표시 9개 언어', ['igPending','igVerified'].every((k) => (mp.match(new RegExp(k + ":'", 'g')) || []).length === 9) && /mpIgVerifyState/.test(mp));
t('테스트 스크립트 등록', /instagram-claim-guard\.test\.js/.test(R('package.json')));
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
