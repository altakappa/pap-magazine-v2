/**
 * PAP Magazine — Threads 성과 지표 수집 크론
 * Route: /api/cron/threads-metrics   (매시 17분)
 *
 * 왜: 2026-07-16 재가동 이후 248건을 게시했는데 성과 데이터가 0건이었다.
 * "올라갔다"까지만 알고 "읽혔는가"는 아무도 모르는 상태였다. 그래서
 * 대화형 훅(socialHook)과 일반 AI 카피를 섞어 쓰면서도 어느 쪽이 나은지
 * 판단할 근거가 없었다.
 *
 * 언제 재는가 — 2회.
 *   1차(stage 1): 게시 24시간 뒤 — 초기 반응. 발행 시각·요일 비교에 쓴다.
 *   2차(stage 2): 게시 7일 뒤   — 확정치. 이후로는 다시 재지 않는다.
 * 두 시점을 쓰는 이유: Threads 는 며칠에 걸쳐 노출이 붙는다. 24시간만
 * 보면 늦게 터지는 글을 실패로 오독하고, 7일만 보면 피드백이 일주일 늦다.
 *
 * 필요 권한: threads_manage_insights.
 * 2026-08-03 이전에 발급된 토큰에는 이 권한이 없다 — 그 상태에서는 조용히
 * 대기 모드로 200 을 반환한다(크론 실패 알림 스팸 방지). /api/threads/oauth
 * 재인증 1회 후 자동으로 수집이 시작된다.
 *
 * 게이트: THREADS_METRICS_ENABLED=false 로만 끈다 (기본 활성).
 * 수동 트리거: 관리자 토큰 GET/POST (?dry=1 로 수집 대상만 확인).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { getThreadInsights } = require('../_lib/threads');

const DAY = 86400000;
const STAGE1_AFTER_MS = 24 * 3600 * 1000; // 24시간
const STAGE2_AFTER_MS = 7 * DAY;          // 7일
const MAX_PER_RUN = 10;                   // 한 번에 최대 10건 (Graph rate limit 여유)
const TIME_BUDGET_MS = 30000;             // 서버리스 타임아웃 전에 스스로 멈춘다

// 게시 시각 — 097 이전 행은 posted_at 이 없으므로 created_at 으로 폴백.
function postedAtMs(row) {
  const v = row.posted_at || row.created_at;
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

// 이 행이 지금 수집 대상인가 — 대상이면 목표 stage, 아니면 0.
function dueStage(row, now) {
  const age = now - postedAtMs(row);
  const stage = Number(row.metrics_stage || 0);
  if (stage < 2 && age >= STAGE2_AFTER_MS) return 2;
  if (stage < 1 && age >= STAGE1_AFTER_MS) return 1;
  return 0;
}

module.exports = withCronGuard('threads-metrics', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  res.locals = res.locals || {};

  if (String(process.env.THREADS_METRICS_ENABLED || '').toLowerCase() === 'false') {
    res.locals.cronNote = '비활성화 (THREADS_METRICS_ENABLED=false)';
    return res.status(200).json({ ok: true, note: res.locals.cronNote });
  }

  // 인증 전이면 대기 모드 — 크론이 실패 알림을 쏟아내지 않게 한다.
  const { data: authRow } = await supabaseAdmin
    .from('threads_auth').select('access_token').eq('id', 1).maybeSingle();
  if (!authRow || !authRow.access_token) {
    res.locals.cronNote = 'Threads 미인증 — 수집 대기';
    return res.status(200).json({ ok: true, note: res.locals.cronNote });
  }

  // 후보 조회: 게시 성공 + thread_id 보유 + 아직 확정(stage 2) 아님.
  // metrics_stage 가 NULL 인 기존 248건도 걸리도록 or 조건을 쓴다.
  const { data: rows, error: qErr } = await supabaseAdmin
    .from('threads_posts')
    .select('id, article_id, thread_id, status, created_at, posted_at, metrics_stage')
    .eq('status', 'published')
    .not('thread_id', 'is', null)
    .or('metrics_stage.is.null,metrics_stage.lt.2')
    .order('created_at', { ascending: true })
    .limit(500);
  if (qErr) {
    // 097 미적용이면 posted_at/metrics_stage 가 없어 여기서 걸린다.
    // 원문 대신 분류 코드로 응답하고 상세는 로그로만 남긴다.
    console.error('[threads-metrics] threads_posts 조회 실패:', qErr.message);
    res.locals.cronNote = '조회 실패 — 097 마이그레이션 적용 여부 확인';
    return res.status(500).json({ error: '지표 수집 대상 조회 실패', code: 'threads_metrics_query_failed' });
  }

  const now = Date.now();
  const due = (rows || [])
    .map((r) => ({ row: r, stage: dueStage(r, now) }))
    .filter((x) => x.stage > 0)
    .slice(0, MAX_PER_RUN);

  if (req.query && req.query.dry === '1') {
    return res.status(200).json({
      ok: true, dry: true, candidates: (rows || []).length, due: due.length,
      pick: due.map((x) => ({ thread_id: x.row.thread_id, stage: x.stage, posted_at: x.row.posted_at || x.row.created_at })),
    });
  }

  if (!due.length) {
    res.locals.cronNote = '수집 대상 없음 (후보 ' + (rows || []).length + '건)';
    return res.status(200).json({ ok: true, note: res.locals.cronNote });
  }

  const started = Date.now();
  let collected = 0; let failed = 0; let needsReauth = false; let lastErr = null;

  for (const item of due) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      const m = await getThreadInsights(item.row.thread_id);
      const { error: upErr } = await supabaseAdmin.from('threads_posts').update({
        views: m.views, likes: m.likes, replies: m.replies,
        reposts: m.reposts, quotes: m.quotes,
        metrics_at: new Date().toISOString(),
        metrics_stage: item.stage,
      }).eq('id', item.row.id);
      if (upErr) { failed++; lastErr = upErr.message; console.error('[threads-metrics] 저장 실패:', upErr.message); continue; }
      collected++;
    } catch (e) {
      lastErr = String(e && e.message || e).slice(0, 200);
      if (e && e.needsReauth) { needsReauth = true; break; } // 권한 문제는 전 건 동일 — 즉시 중단
      failed++;
      console.error('[threads-metrics] 수집 실패 thread_id=' + item.row.thread_id + ':', lastErr);
    }
  }

  if (needsReauth) {
    // 실패로 기록하면 6시간마다 알림이 울린다. 이건 '고장'이 아니라
    // '재인증 대기'다 — 토큰 알림(threads.js alertTokenTrouble)이 별도로 담당한다.
    console.error('[threads-metrics] insights 권한 없음 — /api/threads/oauth 재인증 필요:', lastErr);
    res.locals.cronNote = 'insights 권한 없음 — 재인증 대기 (수집 ' + collected + '건)';
    return res.status(200).json({ ok: true, note: res.locals.cronNote, collected, needs_reauth: true });
  }

  res.locals.cronNote = '수집 ' + collected + '건 · 실패 ' + failed + '건 · 대기 ' + Math.max(0, due.length - collected - failed) + '건';
  return res.status(200).json({ ok: true, collected, failed, due: due.length, candidates: (rows || []).length });
});
