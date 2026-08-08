/**
 * 웹 푸시 구독 — /api/push/subscribe (B-7, 2026-08-09)
 *
 *   POST   { endpoint, keys:{p256dh, auth} } → 구독 저장 (로그인 불필요)
 *   DELETE { endpoint }                      → 구독 해지
 *
 * 왜 로그인 불필요인가: 사다리 원칙(성장 헌법 7조) — 첫 계단에 문턱을
 * 두지 않는다. 알림 허용 자체가 브라우저 단의 명시적 동의다.
 * endpoint 는 브라우저가 만든 유일 URL 이라 그대로 PK.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { verifyToken } = require('../_lib/auth');

function validSub(b) {
  if (!b || typeof b !== 'object') return null;
  const endpoint = String(b.endpoint || '');
  const p256dh = b.keys && String(b.keys.p256dh || '');
  const auth = b.keys && String(b.keys.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) return null;
  if (!p256dh || p256dh.length > 300 || !auth || auth.length > 100) return null;
  return { endpoint, p256dh, auth };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  try {
    if (req.method === 'POST') {
      const sub = validSub(req.body);
      if (!sub) return res.status(400).json({ error: '구독 형식이 올바르지 않다' });
      const me = verifyToken(req); // 로그인돼 있으면 연결만 (필수 아님)
      const { error } = await supabaseAdmin.from('push_subscriptions')
        .upsert({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth,
          user_id: (me && me.id) || null, disabled_at: null }, { onConflict: 'endpoint' });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const endpoint = String((req.body && req.body.endpoint) || '');
      if (!endpoint) return res.status(400).json({ error: 'endpoint 필요' });
      await supabaseAdmin.from('push_subscriptions')
        .update({ disabled_at: new Date().toISOString() }).eq('endpoint', endpoint);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('[push/subscribe] 예외', (e && e.message) || e);
    return res.status(500).json({ error: 'subscribe failed' });
  }
};
