/**
 * QA #202 — content audit log helper.
 *
 * Every editorial/article/film/shorts mutation goes through here so
 * the admin UI's "수정 이력" panel has a single canonical source of
 * truth. The functions are designed to be FIRE-AND-FORGET — if the
 * audit insert fails (network blip, table not yet migrated, etc.) we
 * log and keep going so a transient ledger problem never blocks the
 * actual content save.
 *
 * Two entry points:
 *   - recordContentChange(...)  — generic; pass action + diff.
 *   - diffFields(prev, next, fields)
 *                                — compute a {field: [before, after]}
 *                                  object for use as the `diff` arg.
 */

const { supabaseAdmin } = require('./supabase');

// Short Korean phrases the admin UI can render verbatim. Anything not
// in this map falls back to the action keyword itself, so callers
// don't need to ship UI changes when introducing a new verb.
const ACTION_LABEL = {
  create:         '등록',
  update:         '수정',
  delete:         '삭제',
  publish:        '공개',
  unpublish:      '비공개 전환',
  // QA #249 — emitted by api/cron/release-due-scheduled when a film /
  // editorial / article's scheduled_publish_at timestamp is crossed
  // and the row transitions from "queued" to publicly visible. Gives
  // the editor an explicit log row to verify the schedule fired.
  auto_published: '예약 자동 발행',
};

/**
 * Build a {field: [before, after]} diff for the given keys, skipping
 * fields whose value is unchanged. Used by PUT handlers to show only
 * what the editor actually touched.
 */
function diffFields(prev, next, fields){
  const out = {};
  if(!prev || !next || !Array.isArray(fields)) return out;
  for(const k of fields){
    if(next[k] === undefined) continue; // not part of this PUT
    // Coarse stringify equality. Good enough for primitives + small JSON.
    const a = JSON.stringify(prev[k] === undefined ? null : prev[k]);
    const b = JSON.stringify(next[k] === undefined ? null : next[k]);
    if(a !== b){
      out[k] = [prev[k], next[k]];
    }
  }
  return out;
}

/**
 * Append one entry to content_audit_log.
 *
 * @param {object} opts
 * @param {string} opts.content_type — 'editorial'|'article'|'film'|'shorts'
 * @param {string} opts.content_id   — uuid of the row
 * @param {string} opts.action       — 'create'|'update'|'delete'|'publish'|'unpublish'
 * @param {object} [opts.actor]      — the {id, email} from requireAdmin
 * @param {string} [opts.actor_label]— pre-computed display name (optional)
 * @param {string} [opts.summary]    — short Korean phrase for the UI row
 * @param {object} [opts.diff]       — JSON-able diff payload
 */
async function recordContentChange(opts){
  if(!opts || !opts.content_type || !opts.content_id || !opts.action) return;

  // Best-effort: resolve a friendly label so the audit row stays
  // readable even if the actor's profile is later renamed/deleted.
  let actor_label = opts.actor_label || null;
  if(!actor_label && opts.actor && opts.actor.id){
    try {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('display_name, email')
        .eq('id', opts.actor.id)
        .single();
      if(data){
        actor_label = data.display_name || data.email || null;
      }
    } catch(_){ /* ignore — denormalised label is best-effort */ }
    // JWT email fallback when profile lookup misses (matches the
    // test-email endpoint's three-tier resolution from QA #195).
    if(!actor_label && opts.actor.email) actor_label = opts.actor.email;
  }

  // Default summary mirrors the Korean action label so the admin UI
  // can render a row without further translation.
  const summary = opts.summary || ACTION_LABEL[opts.action] || opts.action;

  try {
    await supabaseAdmin.from('content_audit_log').insert({
      content_type: opts.content_type,
      content_id:   opts.content_id,
      action:       opts.action,
      actor_id:     opts.actor && opts.actor.id ? opts.actor.id : null,
      actor_label:  actor_label,
      summary:      summary,
      diff:         opts.diff && Object.keys(opts.diff).length ? opts.diff : null,
    });
  } catch (err) {
    // Never let a ledger failure surface as a content-save failure.
    console.warn('[audit] insert failed for', opts.content_type, opts.content_id, opts.action, err && err.message);
  }
}

/**
 * QA #202 — enrich content rows with denormalised authorship labels.
 *
 * For a list of rows that each carry `created_by` and/or `updated_by`
 * UUIDs, batch-fetch the corresponding profiles in ONE query and
 * mutate each row with `_creator` / `_editor` objects shaped as:
 *   { id, display_name, email }
 *
 * Designed for the admin list endpoints so the UI can render
 * "수정: 도메니코 · 2시간 전" without a per-row round-trip. The legacy
 * raw uuid columns are preserved on the row so any non-UI consumer
 * still sees the same shape it always saw.
 */
async function attachAuthorship(rows){
  if(!Array.isArray(rows) || !rows.length) return rows;

  // Collect every distinct uuid across both columns.
  const ids = new Set();
  for(const r of rows){
    if(r && r.created_by) ids.add(r.created_by);
    if(r && r.updated_by) ids.add(r.updated_by);
  }
  if(!ids.size) return rows;

  let profilesById = {};
  try {
    // QA #208 Phase 2g — include `role` so the admin can filter by
    // author role (대표 관리자 / 서브 관리자).
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, email, role')
      .in('id', Array.from(ids));
    for(const p of (data || [])) profilesById[p.id] = p;
  } catch(err){
    // Non-fatal — admin UI will just show "—" for missing names.
    console.warn('[attachAuthorship] profiles lookup failed:', err && err.message);
  }

  for(const r of rows){
    if(!r) continue;
    r._creator = r.created_by ? (profilesById[r.created_by] || { id: r.created_by, display_name: null, email: null }) : null;
    r._editor  = r.updated_by ? (profilesById[r.updated_by] || { id: r.updated_by, display_name: null, email: null }) : null;
  }
  return rows;
}

module.exports = {
  ACTION_LABEL,
  diffFields,
  recordContentChange,
  attachAuthorship,
};
