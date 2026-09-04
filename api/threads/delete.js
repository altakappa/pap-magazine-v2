/**
 * PAP Magazine — Threads 데이터 삭제 콜백 (Meta 앱 콘솔 요구 엔드포인트)
 * 자사 계정 단일 운영 — 삭제 요청 시 토큰 파기로 응답.
 *
 * 2026-09-04 보안감사 — signed_request 검증 추가. 예전엔 누구나 한 번 호출로 토큰을 지워
 * Threads 자동 발행을 멈출 수 있었다. 서명이 맞을 때만 DB 를 건드린다.
 */
const { supabaseAdmin } = require('../_lib/supabase');
const { verifySignedRequest } = require('../_lib/metaSignedRequest');

module.exports = async function handler(req, res) {
  const v = verifySignedRequest(req, process.env.THREADS_APP_SECRET);
  if (!v.ok) {
    console.warn('[threads-delete] 거부:', v.reason);
    return res.status(v.status).json({ error: v.reason });
  }
  try {
    await supabaseAdmin.from('threads_auth').update({ access_token: null, updated_at: new Date().toISOString() }).eq('id', 1);
  } catch (e) { console.warn('[threads-delete]', e && e.message); }
  return res.status(200).json({ url: 'https://www.pap-magazine.com/data-deletion', confirmation_code: 'pap-threads-' + Date.now() });
};
