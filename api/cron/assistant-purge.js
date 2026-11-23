/**
 * GET /api/cron/assistant-purge — 상담 기록 30일 뒤 삭제 (2026-11-23)
 *
 * 상담봇은 방문자가 타이핑한 문장을 저장한다. 무엇을 묻는지 알아야 사이트에서
 * 뭘 고쳐야 하는지가 보이기 때문이다. 다만 개인정보를 받지 않는다고 해서 사람이
 * 본문에 적어 넣지 않는다는 보장은 없다. 그래서 짧게 들고 지운다 — 제보 파일을
 * 7일 뒤 지우는 것과 같은 원칙이고, 처리방침에도 같은 줄로 적는다.
 *
 * 30일인 이유: 월 단위로 "이번 달에 뭘 많이 물었나" 를 한 번 보기에 충분하고,
 * 그보다 길게 들고 있을 이유가 없다.
 */
'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { withCronGuard } = require('../_lib/cronGuard');
const { safeEqual } = require('../_lib/secretCompare');

const KEEP_DAYS = 30;

function bearerOk(auth, secret) {
  const got = String(auth || '').replace(/^Bearer\s+/i, '').trim();
  return !!(secret && got && safeEqual(got, String(secret)));
}

module.exports = withCronGuard('assistant-purge', async function handler(req, res) {
  if (handleCors(req, res)) return;
  res.locals = res.locals || {};   // ★ 공책을 먼저 만든다 (2026-08-13 사고, cron-contract)
  function note(m) { res.locals = res.locals || {}; res.locals.cronNote = m; return m; }

  /* 삭제하는 크론이다 — 예약 호출만 허용한다. */
  if (!bearerOk(req.headers && req.headers.authorization, process.env.CRON_SECRET)) {
    note('예약 호출 아님 — 거부');
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('assistant_conversations')
    .delete()
    .lt('created_at', cutoff)
    .select('id');
  if (error) throw error;   // withCronGuard 가 기록 + 실패 알림

  const n = (data || []).length;
  note(n ? n + '건 삭제 (' + KEEP_DAYS + '일 경과)' : '지울 것 없음');
  return res.status(200).json({ deleted: n, cutoff, keep_days: KEEP_DAYS, note: res.locals.cronNote });
});
