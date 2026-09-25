'use strict';
/**
 * POST /api/newsletter/subscribe  { email, lang, source, consent:true }
 *
 * 회원가입 없이 이메일만으로 주간 뉴스레터 신청 (2026-09-25, 도메니코 "만들기").
 * 실측: 회원 1,357 중 수신동의 172(13%). 인스타 팔로워 38.5만이 들어올 입구가 없었다.
 *
 * 이중 확인: 여기서는 pending 으로 적고 확인 메일만 보낸다. 확인 버튼(/api/newsletter/confirm)을
 * 눌러야 confirmed → 그때부터 발송 대상. 동의 문구는 서버 사본(newsletterCopy.consent)을 저장한다.
 * 이미 구독 중이어도 같은 답(code:'sent')을 준다 — 이메일 주소로 가입 여부를 캐낼 수 없게.
 * 응답에 원문 에러를 싣지 않는다(.claude/rules/api.md). 화면 문구는 code 로 프론트가 고른다.
 */
const crypto = require('crypto');
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { rateLimitStrict, RATE_LIMITS } = require('../_lib/rateLimit');
const { isValidEmail } = require('../_lib/validate');
const { extractClientIp, hashIp } = require('../_lib/clickGuard');
const { sendEmail, templates } = require('../_lib/email');
const { nlCopy, normLang } = require('../_lib/newsletterCopy');

const FRONTEND_URL = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';
const RESEND_GAP_MS = 10 * 60 * 1000;   // 같은 주소로 확인 메일은 10분에 한 번

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed', code: 'method' });
  if (await rateLimitStrict(req, res, RATE_LIMITS.auth, 'newsletter-subscribe')) return;

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  b = b || {};
  if (b.website) return res.status(200).json({ ok: true, code: 'sent' });   // honeypot

  const email = String(b.email || '').trim().toLowerCase().slice(0, 254);
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Invalid email', code: 'invalid_email' });
  if (b.consent !== true) return res.status(400).json({ message: 'Consent required', code: 'consent_required' });
  const lang = normLang(b.lang);
  const source = String(b.source || '').toLowerCase().replace(/[^a-z0-9_:.-]/g, '').slice(0, 60) || 'newsletter_page';

  try {
    const { data: row, error } = await supabaseAdmin.from('newsletter_signups')
      .select('id, status, token, confirm_sent_at').eq('email', email).maybeSingle();
    if (error) throw error;
    if (row && row.status === 'confirmed') return res.status(200).json({ ok: true, code: 'sent' });
    if (row && row.status === 'pending' && row.confirm_sent_at
        && Date.now() - new Date(row.confirm_sent_at).getTime() < RESEND_GAP_MS) {
      return res.status(200).json({ ok: true, code: 'sent' });
    }

    const now = new Date().toISOString();
    const fields = {
      language: lang, source, status: 'pending',
      consent_text: nlCopy(lang).consent,
      ip_hash: hashIp(extractClientIp(req)),
      updated_at: now,
    };
    let token;
    if (row) {
      // 수신거부했던 주소는 토큰을 새로 — 옛 링크로 되살아나지 않게
      const upd = row.status === 'unsubscribed'
        ? Object.assign({}, fields, { token: crypto.randomUUID(), unsubscribed_at: null })
        : fields;
      const { data: u, error: ue } = await supabaseAdmin.from('newsletter_signups')
        .update(upd).eq('id', row.id).select('token').single();
      if (ue) throw ue;
      token = u.token;
    } else {
      const { data: ins, error: ie } = await supabaseAdmin.from('newsletter_signups')
        .insert(Object.assign({ email }, fields)).select('token').single();
      if (ie) throw ie;
      token = ins.token;
    }

    const confirmUrl = FRONTEND_URL + '/api/newsletter/confirm?token=' + encodeURIComponent(token);
    const r = await sendEmail(email, templates.newsletterConfirm({ lang, confirmUrl }));
    if (!(r && r.sent === true)) {
      console.error('[newsletter/subscribe] 확인 메일 실패:', r && r.error);
      return res.status(502).json({ message: 'Could not send the confirmation email. contact@pap-magazine.com', code: 'mail_failed' });
    }
    await supabaseAdmin.from('newsletter_signups').update({ confirm_sent_at: new Date().toISOString() }).eq('token', token);
    return res.status(200).json({ ok: true, code: 'sent' });
  } catch (e) {
    console.error('[newsletter/subscribe]', (e && e.message) || e);
    return res.status(500).json({ message: 'Subscribe failed. contact@pap-magazine.com', code: 'server' });
  }
};
