/**
 * GET /api/admin/telegram-chats — 봇이 최근 받은 메시지의 채팅 목록 (관리자 전용)
 *
 * 왜 (2026-07-23): 크론 실패 알림을 도메니코 개인 텔레그램으로 보내려면
 * TELEGRAM_PERSONAL_CHAT_ID env 가 필요한데, 개인 chat_id 는 봇에게 DM 을
 * 보낸 뒤 getUpdates 로만 알 수 있다. 콘솔에서 curl 치는 대신 이 엔드포인트가
 * chat id·유형·이름만 추려서 보여준다 (메시지 본문은 노출하지 않는다).
 *
 * 사용: 개인 계정으로 봇에게 아무 메시지나 1통 보낸 뒤 이 URL 호출 →
 * type=private 인 항목의 id 를 Vercel env TELEGRAM_PERSONAL_CHAT_ID 로 저장.
 */
'use strict';
const { requireAdmin } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN 미설정' });

  try {
    const r = await fetch('https://api.telegram.org/bot' + token + '/getUpdates?limit=100', {
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    if (!j || j.ok !== true) {
      return res.status(502).json({ error: 'getUpdates 실패', detail: (j && j.description) || ('HTTP ' + r.status) });
    }
    const seen = new Map();
    for (const u of j.result || []) {
      const chat = (u.message && u.message.chat) || (u.my_chat_member && u.my_chat_member.chat) || null;
      if (chat && chat.id != null) {
        seen.set(String(chat.id), {
          chat_id: String(chat.id),
          type: chat.type,
          name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '',
        });
      }
    }
    const chats = Array.from(seen.values());
    return res.status(200).json({
      ok: true,
      chats,
      note: chats.length === 0
        ? '최근 업데이트에 채팅이 없습니다. 개인 계정으로 봇에게 메시지를 1통 보낸 뒤 다시 호출하세요. (봇 시작: 텔레그램에서 봇 검색 → /start)'
        : 'type=private 항목의 chat_id 를 Vercel env TELEGRAM_PERSONAL_CHAT_ID 로 저장 후 재배포하세요.',
    });
  } catch (e) {
    return res.status(502).json({ error: 'getUpdates 호출 실패', detail: String((e && e.message) || e) });
  }
};
