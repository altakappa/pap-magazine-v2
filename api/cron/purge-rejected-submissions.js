/**
 * GET /api/cron/purge-rejected-submissions
 *
 * QA #211 — daily auto-purge of rejected submissions older than 30 days.
 *
 * Schedule: vercel.json wires this to fire once per day at 03:10 KST
 * (18:10 UTC). Within the 30-day window an admin can recover a rejected
 * submission by flipping its status back to 'pending' — review.js clears
 * `rejected_at` when that happens, so the cron skips recovered rows.
 *
 * Steps per matching row:
 *   1. Extract Supabase Storage paths from file_urls.
 *   2. Remove the storage objects in one batched call.
 *   3. Delete the submissions row.
 *   4. Log to console with the count + failures.
 *
 * Storage URL shape (set by upload-url.js):
 *   https://<project>.supabase.co/storage/v1/object/public/submissions/<uid>/<filename>
 * We extract `<uid>/<filename>` as the storage path argument.
 *
 * Security: Vercel signs cron requests with CRON_SECRET. Same auth gate
 * as send-due-campaigns.js.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');

// Submissions stay recoverable for this many days after rejection.
const RETENTION_DAYS = 30;
// Cap how many we delete per run so a flood of pending purges can't blow
// the function's 60s budget. The cron runs daily, so anything missed gets
// caught on the next tick.
const MAX_PER_RUN = 200;
// Supabase Storage bucket where the look images live (set by
// /api/submissions/upload-url.js).
const STORAGE_BUCKET = 'submissions';

// Pull "<uid>/<filename>" out of a public Supabase Storage URL. Returns
// null for non-storage URLs so external/legacy URLs are skipped silently.
function _storagePathFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  // Public URLs include `/storage/v1/object/public/<bucket>/<path>`.
  const marker = '/storage/v1/object/public/' + STORAGE_BUCKET + '/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const tail = url.slice(idx + marker.length);
  // Strip any query string (signed URLs sometimes carry one).
  const qIdx = tail.indexOf('?');
  return qIdx === -1 ? tail : tail.slice(0, qIdx);
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // Auth — Vercel cron passes Bearer <CRON_SECRET>.
  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) {
    console.error('[cron/purge-rejected] CRON_SECRET env not set');
    return res.status(500).json({ message: 'CRON_SECRET not configured' });
  }
  if (got !== expected) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const stats = { scanned: 0, purged: 0, storage_deleted: 0, errors: [] };

  try {
    // Find expired rejected submissions. Order by rejected_at so the
    // oldest go first — keeps the queue from starving if MAX_PER_RUN is hit.
    const { data: rows, error: scanErr } = await supabaseAdmin
      .from('submissions')
      .select('id, file_urls, rejected_at, title')  // 2026-07-12: title 컬럼 부재(42703)로 크론 실패하던 버그 — 실제 컬럼명 title
      .eq('status', 'rejected')
      .lt('rejected_at', cutoff)
      .order('rejected_at', { ascending: true })
      .limit(MAX_PER_RUN);

    if (scanErr) throw scanErr;
    stats.scanned = (rows || []).length;
    if (!rows || !rows.length) {
      return res.status(200).json({
        message: 'No submissions to purge.',
        cutoff,
        ...stats,
      });
    }

    for (const row of rows) {
      try {
        // 1) Storage cleanup — extract paths and batch-remove.
        const storagePaths = [];
        const fileUrls = Array.isArray(row.file_urls) ? row.file_urls : [];
        for (const url of fileUrls) {
          const p = _storagePathFromUrl(url);
          if (p) storagePaths.push(p);
        }
        if (storagePaths.length) {
          const { error: rmErr } = await supabaseAdmin
            .storage
            .from(STORAGE_BUCKET)
            .remove(storagePaths);
          if (rmErr) {
            // Non-fatal: log + continue with the row deletion. Orphan
            // storage objects are cheaper than a stalled queue.
            console.warn('[cron/purge-rejected] storage remove failed for',
              row.id, '—', rmErr.message);
            stats.errors.push({ id: row.id, step: 'storage', message: rmErr.message });
          } else {
            stats.storage_deleted += storagePaths.length;
          }
        }

        // 2) Row delete. cascade rules handled by FK ON DELETE in schema.
        const { error: delErr } = await supabaseAdmin
          .from('submissions')
          .delete()
          .eq('id', row.id);
        if (delErr) {
          stats.errors.push({ id: row.id, step: 'row', message: delErr.message });
          continue;
        }
        stats.purged += 1;
      } catch (err) {
        stats.errors.push({ id: row.id, step: 'loop', message: err && err.message });
      }
    }

    console.log('[cron/purge-rejected] done', JSON.stringify(stats));
    return res.status(200).json({
      message: 'Purge complete',
      cutoff,
      retention_days: RETENTION_DAYS,
      ...stats,
    });
  } catch (err) {
    console.error('[cron/purge-rejected] uncaught', err);
    return res.status(500).json({
      message: 'Purge failed',
      detail: err && err.message,
      ...stats,
    });
  }
};
