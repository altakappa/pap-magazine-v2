/**
 * GET /api/cron/release-due-scheduled
 *
 * Vercel Cron entry point (QA #249). Runs every 5 minutes — see
 * vercel.json — and emits an explicit "auto-published" audit-log entry
 * for every films / editorials / articles row whose
 * `scheduled_publish_at` has just slipped into the past.
 *
 * Why a cron at all when the public GET already gates on
 * `scheduled_publish_at <= now()`?
 *
 * The passive gate handles VISIBILITY just fine — readers transparently
 * see the content the moment the timestamp passes. What's missing is
 * an EVENT the admin can audit: "this scheduled film went live at
 * 14:32 KST without me lifting a finger". Before this cron there was
 * no row in content_audit_log for the moment of release, so the editor
 * had no way to verify the schedule actually fired. With it, every
 * release lands in the existing 작업 로그 UI (QA #209) alongside the
 * manual edits, so the admin can answer "did my schedule fire?" with
 * a single SQL/UI lookup instead of inferring from absence of bugs.
 *
 * Security:
 *   Vercel signs cron requests with the CRON_SECRET env var (Bearer).
 *   We refuse anything missing/mismatched so the route can't be
 *   triggered by curl/bots.
 *
 * Idempotency:
 *   We don't want to double-log the same release on every 5-minute
 *   tick after the first one. The natural anchor is content_audit_log
 *   itself — we filter out rows that already carry an 'auto_published'
 *   action for this content_id. That keeps the cron stateless on the
 *   films/editorials/articles tables themselves (no new schema column
 *   needed) and rerunning is safe.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { recordContentChange } = require('../_lib/audit');

// Cap per run so a long backlog (e.g. cron paused for hours) can't
// stall the function or exceed Vercel's hobby plan timeouts. The
// remainder gets picked up on the next tick.
const MAX_RELEASES_PER_RUN = 50;

// Content-type → DB table mapping. Audit log uses the singular form
// the existing UI already speaks (see api/_lib/audit.js).
const TARGETS = [
  { type: 'film',      table: 'films' },
  { type: 'editorial', table: 'editorials' },
  { type: 'article',   table: 'articles' },
];

async function _alreadyAudited(contentType, contentIds){
  if (!contentIds.length) return new Set();
  const { data, error } = await supabaseAdmin
    .from('content_audit_log')
    .select('content_id')
    .eq('content_type', contentType)
    .eq('action', 'auto_published')
    .in('content_id', contentIds);
  if (error) {
    // Soft-fail — better to risk a duplicate audit row than to skip a
    // release entirely. The admin UI lists rows in created_at order
    // so a dup is just noise, not a state bug.
    console.warn('[cron/release-due-scheduled] audit-dedupe lookup failed for', contentType, error.message || error);
    return new Set();
  }
  return new Set((data || []).map(r => r.content_id));
}

async function _releaseTarget({ type, table }, nowIso){
  // Pull every row whose scheduled_publish_at has passed AND that the
  // public GET would now expose (`status='published'`). Schema sanity:
  // each of films / editorials / articles carries the same scheduled
  // publish column (QA #61 + #127 + #224).
  const { data: due, error } = await supabaseAdmin
    .from(table)
    .select('id, title, scheduled_publish_at')
    .eq('status', 'published')
    .not('scheduled_publish_at', 'is', null)
    .lte('scheduled_publish_at', nowIso)
    .order('scheduled_publish_at', { ascending: true })
    .limit(MAX_RELEASES_PER_RUN);
  if (error) throw new Error(`[${type}] due-select failed: ${error.message || error}`);
  if (!due || !due.length) return { type, count: 0, audited: 0, skipped: 0 };

  // Dedupe — drop ids we've already logged as auto_published.
  const ids = due.map(r => r.id);
  const seen = await _alreadyAudited(type, ids);
  const fresh = due.filter(r => !seen.has(r.id));

  // Write one audit row per release. recordContentChange is async but
  // light — sequence them to keep the log readable in order.
  let audited = 0;
  for (const row of fresh){
    try {
      await recordContentChange({
        content_type: type,
        content_id:   row.id,
        action:       'auto_published',
        actor:        null,             // system action — no human actor
        actor_label:  '시스템 (자동 발행)',
        summary:      `예약 발행 완료: ${row.title || '(제목 없음)'} — ${row.scheduled_publish_at}`,
        diff:         null,
      });
      audited++;
    } catch (e){
      // Log and continue — we don't want one bad row to halt the
      // entire batch. Vercel surfaces console output in the function
      // log, which is enough for the editor to spot something off.
      console.error(`[cron/release-due-scheduled] audit insert failed for ${type}#${row.id}:`, e && e.message ? e.message : e);
    }
  }

  return {
    type,
    count: due.length,           // total due rows seen
    audited,                     // freshly logged this tick
    skipped: due.length - fresh.length, // already-audited skips
  };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // Auth — Vercel passes Bearer <CRON_SECRET>. Reject anything else.
  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) {
    console.error('[cron/release-due-scheduled] CRON_SECRET env not set — refusing to run');
    return res.status(500).json({ message: 'CRON_SECRET not configured' });
  }
  if (got !== expected) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const startedAt = Date.now();
  const nowIso = new Date().toISOString();
  const results = [];

  try {
    for (const target of TARGETS){
      const r = await _releaseTarget(target, nowIso);
      results.push(r);
    }
    const elapsedMs = Date.now() - startedAt;
    const summary = results.map(r => `${r.type}: ${r.audited}/${r.count}`).join(', ');
    console.log(`[cron/release-due-scheduled] ran in ${elapsedMs}ms — ${summary}`);
    return res.status(200).json({
      ok: true,
      ranAt: nowIso,
      elapsedMs,
      results,
    });
  } catch (e){
    // Surface the failure loudly so it shows up in the Vercel log
    // stream. Returning 500 also makes Vercel mark the cron run as
    // failed in its UI, which is the easiest external signal the
    // editor can spot if something went wrong.
    console.error('[cron/release-due-scheduled] fatal:', e && e.stack ? e.stack : e);
    return res.status(500).json({
      ok: false,
      message: e && e.message ? e.message : String(e),
      partial: results,
    });
  }
};
