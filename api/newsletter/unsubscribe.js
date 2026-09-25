'use strict';
/**
 * GET /api/newsletter/unsubscribe?token=<uuid>   (2026-09-25)
 * 비회원 뉴스레터 수신거부. 로그인 없이 한 번에. 여러 번 눌러도 같은 답.
 * 회원은 이 링크를 받지 않는다(회원 메일은 /api/auth/unsubscribe 토큰).
 */
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { newsletterPage } = require('../_lib/newsletterPage');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function html(res, status, body) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).send(body);
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed', code: 'method' });
  const token = String((req.query && req.query.token) || '');
  if (!UUID_RE.test(token)) return html(res, 400, newsletterPage('invalid', 'en'));
  try {
    const { data: row, error } = await supabaseAdmin.from('newsletter_signups')
      .select('id, language, status').eq('token', token).maybeSingle();
    if (error) throw error;
    if (!row) return html(res, 404, newsletterPage('invalid', 'en'));
    if (row.status !== 'unsubscribed') {
      const now = new Date().toISOString();
      const { error: ue } = await supabaseAdmin.from('newsletter_signups')
        .update({ status: 'unsubscribed', unsubscribed_at: now, updated_at: now }).eq('id', row.id);
      if (ue) throw ue;
    }
    return html(res, 200, newsletterPage('unsub', row.language));
  } catch (e) {
    console.error('[newsletter/unsubscribe]', (e && e.message) || e);
    return html(res, 500, newsletterPage('invalid', 'en'));
  }
};
