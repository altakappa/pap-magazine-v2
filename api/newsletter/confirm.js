'use strict';
/**
 * GET /api/newsletter/confirm?token=<uuid>   (2026-09-25)
 *
 * 이중 확인의 두 번째 걸음. pending → confirmed, 환영 메일 1통.
 * 같은 주소가 이미 PAP 회원이면 회원 쪽 수신동의(profiles.email_consent)도 켠다 —
 * 회원은 발송기가 profiles 기준으로 보내고, 이 표의 줄은 발송 대상에서 빠진다(중복 발송 방지).
 * 메일 앱에서 바로 열리므로 HTML 한 장으로 답한다.
 */
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { sendEmail, templates } = require('../_lib/email');
const { newsletterPage } = require('../_lib/newsletterPage');

const FRONTEND_URL = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function html(res, status, body) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).send(body);
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed', code: 'method' });
  const token = String((req.query && req.query.token) || '');
  if (!UUID_RE.test(token)) return html(res, 400, newsletterPage('invalid', 'en'));
  try {
    const { data: row, error } = await supabaseAdmin.from('newsletter_signups')
      .select('id, email, language, status').eq('token', token).maybeSingle();
    if (error) throw error;
    if (!row || row.status === 'unsubscribed') return html(res, 404, newsletterPage('invalid', row && row.language));
    if (row.status === 'confirmed') return html(res, 200, newsletterPage('confirmed', row.language));

    const now = new Date().toISOString();
    const { error: ue } = await supabaseAdmin.from('newsletter_signups')
      .update({ status: 'confirmed', confirmed_at: now, updated_at: now }).eq('id', row.id);
    if (ue) throw ue;

    // 이미 회원인 주소 → 회원 수신동의를 켠다 (본인 메일함에서 확인 버튼을 눌렀으니 동의 증명이 된다)
    let member = null;
    try {
      // ilike 는 _ 와 % 를 와일드카드로 읽는다 → a_b@x.com 이 aXb@x.com 회원과 맞을 수 있다. 이스케이프.
      const likeSafe = String(row.email).replace(/[\\%_]/g, (c) => '\\' + c);
      const { data: prof } = await supabaseAdmin.from('profiles')
        .select('id, email_consent').ilike('email', likeSafe).maybeSingle();
      member = prof || null;
      if (member && !member.email_consent) {
        await supabaseAdmin.from('profiles').update({ email_consent: true, email_consent_at: now }).eq('id', member.id);
        await supabaseAdmin.from('consent_history').insert({
          user_id: member.id, consent_type: 'email', granted: true, granted_at: now, source: 'newsletter_confirm',
        });
      }
    } catch (me) { console.warn('[newsletter/confirm] 회원 동기화 실패(구독 확인은 됨):', me && me.message); }

    const unsubUrl = member
      ? FRONTEND_URL + '/mypage#mp-preferences'
      : FRONTEND_URL + '/api/newsletter/unsubscribe?token=' + encodeURIComponent(token);
    const w = await sendEmail(row.email, templates.newsletterWelcome({ lang: row.language, unsubUrl }));
    if (!(w && w.sent === true)) console.warn('[newsletter/confirm] 환영 메일 실패(구독 확인은 됨):', w && w.error);

    return html(res, 200, newsletterPage('confirmed', row.language));
  } catch (e) {
    console.error('[newsletter/confirm]', (e && e.message) || e);
    return html(res, 500, newsletterPage('invalid', 'en'));
  }
};
