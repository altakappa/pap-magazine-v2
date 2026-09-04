/**
 * PAP Magazine — Threads 제거 콜백 (Meta 앱 콘솔 요구 엔드포인트)
 * 사용자가 앱 승인을 취소하면 Meta가 ping — 단일 계정(자사) 운영이라 토큰 행 비활성만 기록.
 *
 * 2026-09-04 보안감사 — signed_request 검증 추가(delete.js 와 동일 이유).
 */
const { supabaseAdmin } = require('../_lib/supabase');
const { verifySignedRequest } = require('../_lib/metaSignedRequest');

module.exports = async function handler(req, res) {
  const v = verifySignedRequest(req, process.env.THREADS_APP_SECRET);
  if (!v.ok) {
    console.warn('[threads-uninstall] 거부:', v.reason);
    return res.status(v.status).json({ error: v.reason });
  }
  try {
    await supabaseAdmin.from('threads_auth').update({ access_token: null, updated_at: new Date().toISOString() }).eq('id', 1);
  } catch (e) { console.warn('[threads-uninstall]', e && e.message); }
  return res.status(200).json({ ok: true });
};
