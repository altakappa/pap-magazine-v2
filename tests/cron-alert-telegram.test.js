/**
 * 크론 실패 알림 → 개인 텔레그램 전환 회귀 (2026-07-23 도메니코 지시).
 * "이메일 말고 개인 텔레그램(그룹방 X)으로" — 미설정/실패 시엔 이메일 폴백.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const tg = R('api/_lib/telegram.js');
const cg = R('api/_lib/cronGuard.js');
const ep = R('api/admin/telegram-chats.js');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 개인방 전송 헬퍼 ===');
t('TELEGRAM_PERSONAL_CHAT_ID 사용', /TELEGRAM_PERSONAL_CHAT_ID/.test(tg));
t('그룹 CHAT_ID 로 폴백하지 않음 (개인방 지시)',
  /no_personal_chat_id/.test(tg),
  '미설정 시 그룹으로 보내면 지시 위반 — skipped 반환이 정답');

console.log('=== cronGuard 알림 경로 ===');
t('개인 텔레그램 우선 시도', /sendTextToTelegramPersonalSafe\(/.test(cg));
t('성공 시 이메일 생략 (return)', /if \(tg && tg\.ok\) return;/.test(cg));
t('실패/미설정 시 이메일 폴백 유지 (알림 유실 방지)', /sendEmail\(ADMIN_EMAIL/.test(cg));

console.log('=== 파이프라인 정체 알림 개인방 전환 ===');
const pa = R('api/_lib/pushAlert.js');
const pw = R('api/cron/pipeline-watch.js');
t('pushAlert: personalOnly 옵션 존재 (개인방 제한)', /personalOnly && personal/.test(pa));
t('pushAlert: 개인 env 미설정 시 그룹 폴백 (유실 방지)', /TELEGRAM_CHAT_IDS \|\| process\.env\.TELEGRAM_CHAT_ID/.test(pa));
t('pipeline-watch: 정체·복구 알림 모두 personalOnly', (pw.match(/personalOnly: true/g) || []).length === 2,
  '한쪽만 바꾸면 복구 알림이 여전히 그룹으로 간다');

console.log('=== chat_id 조회 엔드포인트 ===');
t('관리자 전용', /requireAdmin/.test(ep));
t('메시지 본문 미노출 (chat 메타만)', /chat_id|type|name/.test(ep) && !/message\.text/.test(ep));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ cron-alert-telegram tests FAILED'); process.exit(1); }
console.log('✅ cron-alert-telegram tests passed');
