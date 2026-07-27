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

console.log('=== 일시성 실패 알림 억제 (2026-07-27) ===');
// sync-instagram backfill 의 20초 timeout 469회/일이 6시간마다 "🚨 크론 실패"를
// 울리던 노이즈를 없앤다. 일시성 에러는 로그만, 진짜 크래시(토큰·스키마)는 알림 유지.
t('cronGuard: silenceTransient 옵션 존재', /silenceTransient/.test(cg));
t('cronGuard: 일시성 패턴에 timeout·abort 포함', /TRANSIENT_RE[\s\S]*aborted[\s\S]*timeout/.test(cg));
t('cronGuard: 일시성이면 알림 스킵 (로그는 유지)',
  /transient\s*=\s*silenceTransient && TRANSIENT_RE/.test(cg) && /if \(!transient\)/.test(cg),
  '일시성 판정 후 !transient 일 때만 _sendAlert 경로로 가야 한다');
t('cronGuard: 로그는 일시성이어도 항상 기록 (진단용)',
  cg.indexOf('await _logRun(cronName, ok, duration') < cg.indexOf('const transient'),
  '_logRun 이 알림 판정보다 먼저여야 일시성 실패도 대시보드에 남는다');
const si = R('api/cron/sync-instagram.js');
t('sync-instagram: silenceTransient 적용', /\}\s*,\s*\{\s*silenceTransient:\s*true\s*\}\s*\)/.test(si));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ cron-alert-telegram tests FAILED'); process.exit(1); }
console.log('✅ cron-alert-telegram tests passed');
