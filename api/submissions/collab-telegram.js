/**
 * GET /api/submissions/collab-telegram?id=<uuid>[&kind=resubmit]
 *
 * 공동작업자가 지정된 서브미션의 **인스타그램용 이미지**(4:5 + PAP 로고 합성 PNG)를 텔레그램으로 보내는 워커
 * (도메니코 2026-09-24: "공동작업자 지정시 반드시 텔레그램으로 인스타그램용 이미지와 크레딧과 함께 나에게 알려줘").
 *
 * 크레딧·머리말 텍스트는 제출/재제출 API 가 그 자리에서 이미 보냈다(싸고 확실한 것 먼저).
 * 여기는 무거운 합성만 — 최대 20장 × 장당 수 초라 제출 요청(120초 상한) 안에서 돌리면 504 가 난다
 * (발행 텔레그램 9/20 사고와 같은 이유, api/editorials/telegram-send.js 와 같은 구조).
 * vercel.json 에서 maxDuration 300 을 받는다(정확한 파일명 키).
 *
 * 인증: Bearer CRON_SECRET(서버 간) 또는 관리자 세션(수동 재전송). 공동작업자가 없는 서브미션은 보내지 않는다.
 */
'use strict';
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { safeEqual } = require('../_lib/secretCompare');
const { requireAdmin } = require('../_lib/auth');
const { sendCollabImages } = require('../_lib/collabTelegram');

function _cronAuthorized(req) {
  const expected = String(process.env.CRON_SECRET || '').trim();
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return !!(expected && got && safeEqual(got, expected));
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let who = 'cron';
  if (!_cronAuthorized(req)) {
    const u = await requireAdmin(req, res);
    if (!u) return;
    who = 'admin:' + (u.email || u.id);
  }
  const id = String((req.query && req.query.id) || (req.body && req.body.id) || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'id required' });
  const kind = String((req.query && req.query.kind) || '') === 'resubmit' ? 'resubmit' : 'new';

  const started = Date.now();
  try {
    const { data: sub, error } = await supabaseAdmin.from('submissions').select('id, title, file_urls, description').eq('id', id).single();
    if (error || !sub) return res.status(404).json({ error: 'not found' });
    let desc = {};
    try { desc = sub.description ? JSON.parse(sub.description) : {}; } catch (_) { desc = {}; }
    const collabs = Array.isArray(desc.collaborators) ? desc.collaborators : [];
    if (!collabs.length) return res.status(200).json({ ok: true, id, skipped: 'no_collaborators' });
    console.log('[collab-telegram] 시작:', sub.title, 'by', who);
    const r = await sendCollabImages(sub, desc, { kind });
    const ms = Date.now() - started;
    console.log('[collab-telegram] 끝:', sub.title, JSON.stringify(r), ms + 'ms');
    return res.status(200).json({ ok: true, id, result: r, ms });
  } catch (e) {
    console.error('[collab-telegram] 실패:', e && e.message);
    return res.status(500).json({ error: 'send failed' });
  }
};
