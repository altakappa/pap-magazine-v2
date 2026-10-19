/**
 * GET  /api/admin/telegram-webhook-setup          — 텔레그램 웹훅 상태 (getWebhookInfo)
 * POST /api/admin/telegram-webhook-setup          — 웹훅 (재)등록 (setWebhook) 후 상태 반환
 *
 * 왜 (2026-10-19): 봇으로 들어오는 메시지가 9/10 부터 0건이었다. "올려 149" 를 쳐도 아무 반응이 없었다.
 * 등록은 `curl .../bot<토큰>/setWebhook` 인데 토큰이 Vercel env 에만 있어 매번 도메니코가 토큰을 꺼내
 * 콘솔에서 쳐야 했고, 그래서 한 달 넘게 안 고쳐졌다. 서버가 env 로 직접 등록하면 관리자 탭에서
 * 한 번 누르는 걸로 끝난다. 토큰·시크릿은 응답에 싣지 않는다 (마스킹만).
 *
 * 등록 내용: url = https://www.pap-magazine.com/api/telegram/webhook
 *           secret_token = TELEGRAM_WEBHOOK_SECRET (webhook.js 가 헤더로 검증하는 값과 같은 env)
 *           allowed_updates = ["message"]  (채널·편집 업데이트는 안 받는다 — webhook.js 가 message 만 본다)
 *           drop_pending_updates = false   (죽어 있던 동안 쌓인 메시지는 버리지 않는다; 도메니코가 보낸 링크일 수 있다)
 */
'use strict';
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');

const WEBHOOK_URL = 'https://www.pap-magazine.com/api/telegram/webhook';

function mask(s) { s = String(s || ''); return s ? (s.slice(0, 4) + '…' + s.slice(-2) + ' (' + s.length + '자)') : '(없음)'; }

async function tg(token, method, body) {
  const r = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j || j.ok !== true) throw new Error(method + ' 실패: ' + ((j && j.description) || ('HTTP ' + r.status)));
  return j.result;
}

function summarize(info) {
  const i = info || {};
  return {
    url: i.url || '',
    registered_here: i.url === WEBHOOK_URL,
    pending_update_count: i.pending_update_count || 0,
    last_error_date: i.last_error_date ? new Date(i.last_error_date * 1000).toISOString() : null,
    last_error_message: i.last_error_message || null,
    has_custom_certificate: !!i.has_custom_certificate,
    allowed_updates: i.allowed_updates || null,
  };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!token) return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN 미설정' });
  try {
    if (req.method === 'POST') {
      if (!secret) return res.status(400).json({ error: 'TELEGRAM_WEBHOOK_SECRET 미설정 — 등록해도 webhook.js 가 fail-closed 로 전부 거부한다' });
      await tg(token, 'setWebhook', {
        url: WEBHOOK_URL, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: false,
      });
      const info = await tg(token, 'getWebhookInfo');
      return res.status(200).json({ ok: true, action: 'setWebhook', secret: mask(secret), webhook: summarize(info) });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET 또는 POST' });
    const info = await tg(token, 'getWebhookInfo');
    const s = summarize(info);
    return res.status(200).json({ ok: true, secret_configured: !!secret, webhook: s,
      note: s.registered_here ? '등록돼 있다. 그래도 안 받으면 last_error_message 를 보라.' : 'POST 로 등록하라.' });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
module.exports.summarize = summarize;
module.exports.WEBHOOK_URL = WEBHOOK_URL;
