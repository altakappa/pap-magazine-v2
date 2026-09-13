/**
 * POST /api/contributors/contact   { handle, message }
 *
 * 2026-09-13 도메니코(5번 장치) — 프리미엄 크리에이터 공개 프로필의 "연락하기".
 * 로그인 회원이 쓴 메시지를 PAP 가 그 크리에이터의 가입 이메일로 전달한다(reply-to = 보낸 회원 이메일).
 *   · 받는 쪽: 프로필 인스타 아이디가 handle 인 **활성 프리미엄** 회원만(비프리미엄은 404 — 버튼 자체가 안 뜬다).
 *   · 보내는 쪽: 로그인 필수(토큰 버전까지 확인), 하루 3건(contributor_contacts 로 센다, 마이그레이션 155), 10~2000자, 자기 자신에겐 불가.
 *   · 크리에이터의 이메일은 응답에 절대 싣지 않는다. 운영자 텔레그램에 사본(누가 누구에게, 앞 200자).
 * 메일 실패는 200 으로 숨기지 않는다 — 기록은 남기되 502 로 알려 다시 시도하게 한다.
 */
'use strict';
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAuthStrict } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { sendEmail, templates } = require('../_lib/email');
const { resolveEmailLang } = require('../_lib/emailLocale');
const { sendTextToTelegramSafe } = require('../_lib/telegram');
const { normHandle, findPremiumCreator } = require('../_lib/contributorProfile');

const DAILY_LIMIT = 3;
const MIN_LEN = 10;
const MAX_LEN = 2000;

/** 본문 정리 — 제어문자 제거, 길이 제한. 순수 함수(테스트용). */
function cleanMessage(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  const user = await requireAuthStrict(req, res);
  if (!user) return;

  const body = req.body || {};
  const handle = normHandle(body.handle);
  const message = cleanMessage(body.message);
  if (!handle) return res.status(400).json({ code: 'HANDLE_INVALID', message: 'Invalid handle' });
  if (message.length < MIN_LEN) return res.status(400).json({ code: 'MESSAGE_TOO_SHORT', message: 'Message must be at least ' + MIN_LEN + ' characters' });

  try {
    const creator = await findPremiumCreator(supabaseAdmin, handle);
    if (!creator || !creator.email) return res.status(404).json({ code: 'NOT_CONTACTABLE', message: 'This creator does not accept messages' });
    if (creator.id === user.id) return res.status(400).json({ code: 'SELF', message: 'You cannot message yourself' });

    // 하루 3건 — 보낸 사람 기준
    const since = new Date(Date.now() - 86400000).toISOString();
    const { count } = await supabaseAdmin
      .from('contributor_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('sender_id', user.id)
      .gte('created_at', since);
    if ((count || 0) >= DAILY_LIMIT) {
      return res.status(429).json({ code: 'DAILY_LIMIT', message: 'You can send up to ' + DAILY_LIMIT + ' messages per day' });
    }

    const { data: sender } = await supabaseAdmin
      .from('profiles').select('email, display_name, name').eq('id', user.id).maybeSingle();
    if (!sender || !sender.email) return res.status(400).json({ code: 'SENDER_EMAIL_MISSING', message: 'Your account has no email' });

    const { error: insErr } = await supabaseAdmin.from('contributor_contacts').insert({
      sender_id: user.id, recipient_id: creator.id, handle, message,
    });
    if (insErr) throw insErr;

    const lang = resolveEmailLang(creator);
    const tpl = templates.contributorContact(
      { name: creator.display_name || '' },
      { name: sender.display_name || sender.name || '', email: sender.email },
      handle, message, lang);
    const result = await sendEmail(creator.email, tpl);   // ★ await — 서버리스 동결

    try {
      await sendTextToTelegramSafe('✉️ 크리에이터 프로필 연락 전달' + (result && result.sent ? '' : ' (메일 실패)')
        + '\n받는 사람: @' + handle + '\n보낸 사람: ' + (sender.display_name || sender.email)
        + '\n' + message.slice(0, 200));
    } catch (_) {}

    if (!(result && result.sent)) {
      return res.status(502).json({ code: 'MAIL_FAILED', message: 'Message saved but delivery failed. Please try again later.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[contributors/contact]', e && e.message);
    return res.status(500).json({ code: 'contact_failed', message: 'Failed to send message' });
  }
};
module.exports.cleanMessage = cleanMessage;
module.exports.DAILY_LIMIT = DAILY_LIMIT;
