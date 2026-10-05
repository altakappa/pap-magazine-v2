/**
 * PAP Magazine — X 트윗 공개 지표 수집 크론 (2026-10-05 신설)
 * Route: /api/cron/x-metrics   (매시 23분)
 *
 * 왜: 본문 링크 A/B(api/_lib/xBodyLinkAb.js)의 '도달' 눈금. 지금까지 X 는 "올라갔다"
 * 까지만 알고 "몇 명이 봤는가"는 아무도 몰랐다. threads-metrics 와 같은 설계:
 *   stage 1: 게시 24시간 뒤   stage 2: 게시 7일 뒤(확정)   stage 9: 조회 불가(삭제됨)
 *
 * 읽기 권한이 없는 요금제(402/403)면 전 건 동일하므로 즉시 멈추고 노트에 사유를
 * 싣는다 — 09-21 threads-metrics 교훈: '권한 없음'이라고 단정하지 않고 API 사유를 적는다.
 * 게이트: X_METRICS_ENABLED=false 로만 끈다 (기본 활성). ?dry=1 로 대상만 확인.
 */
const { bearerOk } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard, reportProduction } = require('../_lib/cronGuard');
const { getTweetMetrics, isConfigured } = require('../_lib/xPost');

const STAGE1_AFTER_MS = 24 * 3600 * 1000;
const STAGE2_AFTER_MS = 7 * 86400000;
const STAGE_DEAD = 9;
const MAX_PER_RUN = 100;           // X 는 한 요청에 100개

function dueStage(row, now) {
  const age = now - new Date(row.created_at || 0).getTime();
  const stage = Number(row.metrics_stage || 0);
  if (stage === STAGE_DEAD) return 0;
  if (stage < 2 && age >= STAGE2_AFTER_MS) return 2;
  if (stage < 1 && age >= STAGE1_AFTER_MS) return 1;
  return 0;
}

module.exports = withCronGuard('x-metrics', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET);
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  res.locals = res.locals || {};

  if (String(process.env.X_METRICS_ENABLED || '').toLowerCase() === 'false') {
    res.locals.cronNote = '비활성화 (X_METRICS_ENABLED=false)';
    return res.status(200).json({ ok: true, note: res.locals.cronNote });
  }
  if (!isConfigured()) {
    res.locals.cronNote = 'X env 미설정 — 수집 대기';
    return res.status(200).json({ ok: true, note: res.locals.cronNote });
  }

  /* 후보: 본문 트윗(답글 제외) · 성공 · tweet_id 보유 · 확정 전. 최근 14일만 본다 —
     그보다 오래된 건 A/B 와 무관하고 확정도 지났다. */
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: rows, error: qErr } = await supabaseAdmin
    .from('x_posts')
    .select('id, tweet_id, kind, created_at, metrics_stage')
    .eq('ok', true).eq('account', 'magazine').is('reply_to_id', null)
    .not('tweet_id', 'is', null).gte('created_at', since)
    .or('metrics_stage.is.null,metrics_stage.lt.2')
    .order('created_at', { ascending: true }).limit(500);
  if (qErr) {
    console.error('[x-metrics] x_posts 조회 실패:', qErr.message);
    res.locals.cronNote = '조회 실패 — 178 마이그레이션 적용 여부 확인';
    return res.status(500).json({ error: '지표 수집 대상 조회 실패', code: 'x_metrics_query_failed' });
  }

  const now = Date.now();
  const due = (rows || [])
    .map((r) => ({ row: r, stage: dueStage(r, now) }))
    .filter((x) => x.stage > 0)
    .slice(0, MAX_PER_RUN);

  if (req.query && req.query.dry === '1') {
    return res.status(200).json({ ok: true, dry: true, candidates: (rows || []).length, due: due.length,
      pick: due.map((x) => ({ tweet_id: x.row.tweet_id, stage: x.stage, kind: x.row.kind })) });
  }
  if (!due.length) {
    res.locals.cronNote = '수집 대상 없음 (후보 ' + (rows || []).length + '건)';
    return res.status(200).json({ ok: true, note: res.locals.cronNote });
  }

  const r = await getTweetMetrics(due.map((x) => x.row.tweet_id));
  if (!r.ok) {
    /* 요금제·권한 문제는 전 건 동일 — 사유를 그대로 노트에. 거짓 '권한 없음' 단정 금지. */
    console.error('[x-metrics] 지표 조회 막힘:', r.status || '', r.detail || r.skipped || '');
    res.locals.cronNote = '⚠️ X 지표 조회 막힘 (HTTP ' + (r.status || '?') + ') · 대기 ' + due.length + '건 · 사유: ' + String(r.detail || r.skipped || '알 수 없음').slice(0, 120);
    reportProduction(res, { produced: 0, remaining: due.length });
    return res.status(200).json({ ok: true, note: res.locals.cronNote, blocked: true, status: r.status || null });
  }

  let collected = 0; let dead = 0; let failed = 0;
  const nowIso = new Date().toISOString();
  for (const item of due) {
    const m = r.metrics[String(item.row.tweet_id)];
    const patch = m
      ? { views: m.views, likes: m.likes, replies: m.replies, reposts: m.reposts, quotes: m.quotes, metrics_at: nowIso, metrics_stage: item.stage }
      : { metrics_at: nowIso, metrics_stage: STAGE_DEAD };   // 응답에 없음 = 삭제됐거나 접근 불가 → 큐에서 뺀다
    const { error: upErr } = await supabaseAdmin.from('x_posts').update(patch).eq('id', item.row.id);
    if (upErr) { failed++; console.error('[x-metrics] 저장 실패:', upErr.message); continue; }
    if (m) collected++; else dead++;
  }
  const pending = Math.max(0, due.length - collected - failed - dead);
  res.locals.cronNote = '수집 ' + collected + '건 · 실패 ' + failed + '건' + (dead ? ' · 건너뜀(조회불가) ' + dead + '건' : '') + ' · 후보 ' + (rows || []).length + '건';
  reportProduction(res, { produced: collected, remaining: pending });
  return res.status(200).json({ ok: true, collected, failed, dead, due: due.length, candidates: (rows || []).length });
});
