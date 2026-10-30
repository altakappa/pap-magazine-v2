/**
 * 셀럽 계정 감시 알림의 방 옮기기 (2026-10-30)
 * 도메니코: "PAP alerts 채팅창으로 전송되고 있는 아이돌 소식들도 PAP 셀럽 속보 채팅창으로 변경해줘."
 *   ① 기본 = 셀럽속보 방 (TELEGRAM_CHAT_IDS 첫 방, celeb-watch 와 같은 방)
 *   ② CELEB_ACCOUNT_CHAT_ID 로 직접 지정 가능
 *   ③ CELEB_ACCOUNT_CHAT=personal 이면 예전 방(개인 → 운영)으로 복귀
 *   ④ 셀럽속보 방 설정이 없으면 예전 방으로 (알림 유실 방지)
 *   ⑤ 크론이 실제로 alertChatId() 를 쓴다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'celeb-account-watch.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

// 두 함수만 떼어 실행한다 (핸들러는 DB·텔레그램을 부르므로 직접 못 부른다)
function grab(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = SRC.indexOf('\n}\n', i);
  return SRC.slice(i, j + 2);
}
const code = grab('briefChatId') + '\n' + grab('alertChatId') + '\nreturn alertChatId;';
const alertChatId = new Function('process', code)(process);

const KEYS = ['TELEGRAM_CHAT_IDS', 'TELEGRAM_CHAT_ID', 'TELEGRAM_PERSONAL_CHAT_ID', 'CELEB_ACCOUNT_CHAT', 'CELEB_ACCOUNT_CHAT_ID'];
const saved = {}; KEYS.forEach(k => { saved[k] = process.env[k]; });
function env(o) { KEYS.forEach(k => { delete process.env[k]; }); Object.assign(process.env, o); }

console.log('\n[1] 어느 방으로 가나');
env({ TELEGRAM_CHAT_IDS: '-5490514666', TELEGRAM_PERSONAL_CHAT_ID: '111', TELEGRAM_CHAT_ID: '222' });
t('기본 = 셀럽속보 방', alertChatId() === '-5490514666', alertChatId());
env({ TELEGRAM_CHAT_IDS: ' -100a , -100b ', TELEGRAM_PERSONAL_CHAT_ID: '111' });
t('여러 방이면 첫 방, 공백 무시', alertChatId() === '-100a', alertChatId());
env({ TELEGRAM_CHAT_IDS: '-5490514666', CELEB_ACCOUNT_CHAT_ID: '-999', TELEGRAM_PERSONAL_CHAT_ID: '111' });
t('직접 지정이 이긴다', alertChatId() === '-999');
env({ TELEGRAM_CHAT_IDS: '-5490514666', CELEB_ACCOUNT_CHAT: 'personal', TELEGRAM_PERSONAL_CHAT_ID: '111', TELEGRAM_CHAT_ID: '222' });
t('personal = 예전 개인방', alertChatId() === '111');
env({ TELEGRAM_CHAT_IDS: '-5490514666', CELEB_ACCOUNT_CHAT: 'PERSONAL', TELEGRAM_CHAT_ID: '222' });
t('personal 대소문자 무시, 개인방 없으면 운영방', alertChatId() === '222');
env({ TELEGRAM_PERSONAL_CHAT_ID: '111' });
t('셀럽속보 설정이 없으면 예전 방으로 (유실 방지)', alertChatId() === '111');
env({});
t('아무것도 없으면 빈 값 (크론이 미설정으로 멈춤)', alertChatId() === '');
KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });

console.log('\n[2] 크론 연결');
t('핸들러가 alertChatId() 를 쓴다', /const chatId = alertChatId\(\);/.test(SRC));
t('예전 briefChatId() 를 직접 쓰는 곳이 없다', !/const chatId = briefChatId\(\)/.test(SRC));
t('알림 전송은 그 chatId 로', /sendTextToChatSafe\(chatId, buildAlert\(acc, m, v\.why\)\)/.test(SRC));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ celeb-account-chat-route tests FAILED'); process.exit(1); }
console.log('✅ celeb-account-chat-route tests passed');
