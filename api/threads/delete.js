/**
 * PAP Magazine — Threads 데이터 삭제 콜백 (Meta 앱 콘솔 요구 엔드포인트)
 * 자사 계정 단일 운영 — 삭제 요청 시 토큰 파기로 응답.
 */
const { supabaseAdmin } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  try {
    await supabaseAdmin.from('threads_auth').update({ access_token: null, updated_at: new Date().toISOString() }).eq('id', 1);
  } catch (e) { console.warn('[threads-delete]', e && e.message); }
  return res.status(200).json({ url: 'https://www.pap-magazine.com/data-deletion', confirmation_code: 'pap-threads-' + Date.now() });
};
