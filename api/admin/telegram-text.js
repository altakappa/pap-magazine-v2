/**
 * POST /api/admin/telegram-text — 관리자가 쓴 텍스트(기사 초안·캡션)를 PAP 텔레그램 방으로 보낸다
 *
 * 왜 (2026-10-19): 도메니코 "아이브 신곡 기사 만들어서 텔레그램으로 보내줘".
 * 기사 초안을 텔레그램으로 넘길 통로가 없었다. 에디토리얼(화보)은 발행 시
 * telegram-send 워커가 캡션을 보내지만, 기사 텍스트를 임의로 보내는 길은 없었고
 * 봇 토큰은 Vercel env 에만 있어 로컬·클로드에서 직접 못 보낸다.
 * 관리자 세션으로만 호출되는 얇은 라우트 하나로 해결한다. 저장·발행과 무관하다.
 *
 * Body: { text: string, personal?: boolean }
 *   personal=true 면 TELEGRAM_PERSONAL_CHAT_ID(도메니코 개인방), 아니면 운영 그룹(TELEGRAM_CHAT_ID).
 * 텔레그램 sendMessage 상한이 4096자라 4000자 단위로 잘라 순서대로 보낸다(캡션 한/영 합치면 2~3천자).
 */
'use strict';
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { sendTextToTelegramSafe, sendTextToTelegramPersonalSafe } = require('../_lib/telegram');

const CHUNK = 4000;
const MAX_TOTAL = 16000;

function splitChunks(text, size) {
  const out = [];
  let rest = String(text || '');
  while (rest.length > size) {
    // 문단 경계에서 자른다. 없으면 그냥 size 에서.
    let cut = rest.lastIndexOf('\n\n', size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await requireAdmin(req, res);
  if (!user) return;
  const b = req.body || {};
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'text 가 비었다' });
  if (text.length > MAX_TOTAL) return res.status(413).json({ error: 'text 가 너무 길다 (' + MAX_TOTAL + '자 상한)' });
  const send = b.personal ? sendTextToTelegramPersonalSafe : sendTextToTelegramSafe;
  const parts = splitChunks(text, CHUNK);
  const results = [];
  for (const p of parts) {
    const r = await send(p);           // 순서 보장 — 병렬로 보내면 뒤집혀 도착한다
    results.push(r);
    if (!r.ok) break;
  }
  const ok = results.length === parts.length && results.every((r) => r.ok);
  return res.status(ok ? 200 : 502).json({
    ok, parts: parts.length, sent: results.filter((r) => r.ok).length,
    error: ok ? undefined : (results.find((r) => !r.ok) || {}).error || (results.find((r) => !r.ok) || {}).skipped,
  });
};
module.exports.splitChunks = splitChunks;
