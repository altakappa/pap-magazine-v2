/**
 * GET /api/editorials/telegram-send?id=<uuid>
 *
 * 발행 에디토리얼의 텔레그램 전송 전용 워커 (2026-09-20).
 *
 * 왜 따로 뒀나 — 사고 기록:
 *   발행 PUT(api/editorials/[id].js) 안에서 캡션·커버·갤러리 16장 합성·업로드를 직접 돌렸다.
 *   09:45 발행 → 120초 상한에서 "Vercel Runtime Timeout Error" 504. DB 는 published 로 바뀌었지만
 *   관리자 화면엔 "발행 실패", 텔레그램엔 이미지 일부만, **인스타 캡션(크레딧)은 안 옴**, 승인 메일도 안 나감.
 *   4:5 PNG 합성은 장당 수 초, 업로드는 수십 MB — 발행 요청 하나에 다 태울 일이 아니다.
 *
 * 구조:
 *   [id].js 는 발행 순간 이 경로를 CRON_SECRET 으로 깨우고(waitUntil, 없으면 9초 대기) 바로 응답한다.
 *   여기는 vercel.json 에서 maxDuration 300 을 받는다(정확한 파일명 키 — [id] 글롭 문제 회피).
 *   캡션은 telegram.js 가 맨 먼저 보낸다. 워커가 상한에서 죽어도 크레딧은 이미 가 있다.
 *
 * 인증: Bearer CRON_SECRET(서버 간) 또는 관리자 세션(수동 재전송용). 발행된 화보만 보낸다.
 * 스케줄 없음 — 크론 계약 테스트 대상이 아니라서 api/cron/ 이 아니라 여기 둔다(backfill-ig.js 와 같은 자리).
 */
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { safeEqual } = require('../_lib/secretCompare');
const { requireAdmin } = require('../_lib/auth');
const { sendEditorialToTelegramSafe } = require('../_lib/telegram');

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
    // 관리자 수동 재전송 — 역할은 DB 에서 다시 확인한다(JWT 의 role 은 오래됐을 수 있다). 실패 응답은 requireAdmin 이 보낸다.
    const u = await requireAdmin(req, res);
    if (!u) return;
    who = 'admin:' + (u.email || u.id);
  }

  const id = String((req.query && req.query.id) || (req.body && req.body.id) || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'id required' });

  const started = Date.now();
  try {
    const { data: ed, error } = await supabaseAdmin.from('editorials').select('*').eq('id', id).single();
    if (error || !ed) return res.status(404).json({ error: 'not found' });
    if (ed.status !== 'published') return res.status(409).json({ error: 'not published', status: ed.status });
    console.log('[telegram-send] 시작:', ed.title, 'by', who);
    const r = await sendEditorialToTelegramSafe(ed);
    const ms = Date.now() - started;
    console.log('[telegram-send] 끝:', ed.title, JSON.stringify(r), ms + 'ms');
    return res.status(200).json({ ok: true, id, result: r, ms });
  } catch (e) {
    console.error('[telegram-send] 실패:', e && e.message);
    return res.status(500).json({ error: 'send failed' });
  }
};
