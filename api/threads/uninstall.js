/**
 * PAP Magazine — Threads 제거 콜백 (Meta 앱 콘솔 요구 엔드포인트)
 * 사용자가 앱 승인을 취소하면 Meta가 ping — 단일 계정(자사) 운영이라 토큰 행 비활성만 기록.
 */
const { supabaseAdmin } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  try {
    await supabaseAdmin.from('threads_auth').update({ access_token: null, updated_at: new Date().toISOString() }).eq('id', 1);
  } catch (e) { console.warn('[threads-uninstall]', e && e.message); }
  return res.status(200).json({ ok: true });
};
