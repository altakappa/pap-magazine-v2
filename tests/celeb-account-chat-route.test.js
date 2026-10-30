/**
 * 기사 관련 텔레그램은 전부 PAP 셀럽속보 방으로 (2026-10-30)
 * 도메니코: "PAP alerts 채팅창으로 전송되고 있는 아이돌 소식들도 PAP 셀럽 속보 채팅창으로 변경해줘"
 *          → "기사 관련된 내용은 전부 pap 셀럽속보 방으로 전달하면 돼요"
 *   ① 방 결정 = _lib/celebChat: CELEB_CHAT_ID → TELEGRAM_CHAT_IDS 첫 방 → 호출부의 예전 방
 *   ② CELEB_CHAT_ROUTE=old 면 전부 예전 방
 *   ③ 기사 관련 4곳이 이 모듈을 쓴다 (계정 감시·브리프·캐러셀·기사 초안 텍스트)
 *   ④ 기사와 무관한 곳(결제·제출·크론 고장)은 건드리지 않았다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

const { celebChatId, celebOr } = require(path.join(ROOT, 'api', '_lib', 'celebChat.js'));
const KEYS = ['TELEGRAM_CHAT_IDS', 'CELEB_CHAT_ID', 'CELEB_CHAT_ROUTE'];
const saved = {}; KEYS.forEach(k => { saved[k] = process.env[k]; });
function env(o) { KEYS.forEach(k => { delete process.env[k]; }); Object.assign(process.env, o); }

console.log('\n[1] 방 결정');
env({ TELEGRAM_CHAT_IDS: '-5490514666' });
t('기본 = 셀럽속보 방', celebChatId() === '-5490514666', celebChatId());
t('celebOr 는 셀럽속보 방이 이긴다', celebOr('8815751224') === '-5490514666');
env({ TELEGRAM_CHAT_IDS: ' -100a , -100b ' });
t('여러 방이면 첫 방, 공백 무시', celebChatId() === '-100a', celebChatId());
env({ TELEGRAM_CHAT_IDS: '-5490514666', CELEB_CHAT_ID: '-999' });
t('직접 지정이 이긴다', celebChatId() === '-999');
env({ TELEGRAM_CHAT_IDS: '-5490514666', CELEB_CHAT_ROUTE: 'OLD' });
t('되돌리기(old, 대소문자 무시) = 빈 값', celebChatId() === '');
t('되돌리기면 예전 방', celebOr('8815751224') === '8815751224');
env({});
t('설정이 없으면 예전 방 (유실 방지)', celebOr('8815751224') === '8815751224');
t('아무것도 없으면 빈 값', celebOr('') === '' && celebOr(undefined) === '');
KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });

console.log('\n[2] 기사 관련 4곳이 셀럽속보 방을 쓴다');
{
  const s = R('api/cron/celeb-account-watch.js');
  t('계정 감시: require ../_lib/celebChat', /require\('\.\.\/_lib\/celebChat'\)/.test(s));
  t('계정 감시: alertChatId = celebOr(briefChatId())', /function alertChatId\(\) \{\s*return celebOr\(briefChatId\(\)\);/.test(s));
  t('계정 감시: 핸들러가 alertChatId() 를 쓴다', /const chatId = alertChatId\(\);/.test(s));
  t('계정 감시: 알림은 그 chatId 로', /sendTextToChatSafe\(chatId, buildAlert\(acc, m, v\.why\)\)/.test(s));
}
{
  const s = R('api/cron/celeb-brief.js');
  t('브리프: outChat = celebOr(rows[0].chat_id)', /const outChat = require\('\.\.\/_lib\/celebChat'\)\.celebOr\(rows\[0\]\.chat_id\)/.test(s));
  t('브리프: 사진·캡션·댓글 미리보기·번호 안내가 전부 outChat', /sendMediaToTelegram\(media, split\.caption, outChat\)/.test(s)
    && /sendTextToChatSafe\(outChat, split\.overflow\)/.test(s) && /sendTextToChatSafe\(outChat, preview\)/.test(s)
    && /sendTextToChatSafe\(outChat,\s*'✅ 브리프 #'/.test(s));
  t('브리프: 링크 보낸 방으로 직접 보내는 곳이 남지 않았다', !/ToTelegram\([^)]*rows\[0\]\.chat_id\)|ChatSafe\(rows\[0\]\.chat_id/.test(s));
  t('브리프: 게시 결과(tell)도 셀럽속보 먼저', /async function tell\(text\) \{[\s\S]{0,700}celebChatId\(\)[\s\S]{0,200}sendTextToChatSafe\(celeb, text\)/.test(s));
}
{
  const s = R('api/admin/celeb-carousel-telegram.js');
  t('캐러셀: celebOr(row.chat_id) 로', /const outChat = require\('\.\.\/_lib\/celebChat'\)\.celebOr\(row\.chat_id\)/.test(s)
    && /sendDocumentsToTelegram\(files, caption, outChat\)/.test(s));
}
{
  const s = R('api/admin/telegram-text.js');
  t('기사 초안 텍스트: 기본 셀럽속보, room=group 이면 예전 운영 그룹', /b\.room === 'group' \|\| !celeb\) \? sendTextToTelegramSafe/.test(s)
    && /\(p\) => sendTextToChatSafe\(celeb, p\)/.test(s));
}

console.log('\n[3] 기사와 무관한 곳은 그대로');
['api/paddle-webhook.js', 'api/submissions/index.js', 'api/_lib/cronGuard.js', 'api/cron/pipeline-watch.js']
  .forEach(f => t('그대로: ' + f, !/celebChat/.test(R(f))));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ celeb-chat-route tests FAILED'); process.exit(1); }
console.log('✅ celeb-chat-route tests passed');
