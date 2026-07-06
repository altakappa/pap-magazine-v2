/**
 * /api/admin/magazine-issues
 *
 * QA #317 — Magazine 발행호 CRUD (admin only).
 *
 *   GET    /api/admin/magazine-issues       → 모든 이슈 (활성+비활성)
 *   POST   /api/admin/magazine-issues       → 새 이슈 생성
 *   PATCH  /api/admin/magazine-issues       → 이슈 수정 (id 필수, 부분 업데이트)
 *   DELETE /api/admin/magazine-issues?id=…  → 이슈 삭제
 *
 * 필드:
 *   issue_number (int, unique) — required
 *   title (varchar) — required
 *   issue_year (int) — required
 *   issue_month (int, 1-12) — optional
 *   month_label (varchar) — optional
 *   cover_image (text URL) — required
 *   editorial_count (int) — default 0
 *   link_url (text) — optional
 *   is_latest (bool) — default false
 *   is_active (bool) — default true
 *   sort_order (int) — default 0
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors }    = require('../../_lib/cors');
const { requireAdmin }  = require('../../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

function normalizeRow(body) {
  return {
    issue_number:    Number.isFinite(body && body.issue_number) ? Math.floor(body.issue_number) : null,
    title:           String((body && body.title) || '').trim(),
    issue_year:      Number.isFinite(body && body.issue_year) ? Math.floor(body.issue_year) : null,
    issue_month:     Number.isFinite(body && body.issue_month) ? Math.max(1, Math.min(12, Math.floor(body.issue_month))) : null,
    month_label:     body && body.month_label != null ? String(body.month_label).trim() || null : null,
    cover_image:     String((body && body.cover_image) || '').trim(),
    editorial_count: Number.isFinite(body && body.editorial_count) ? Math.max(0, Math.floor(body.editorial_count)) : 0,
    link_url:        body && body.link_url != null ? String(body.link_url).trim() || null : null,
    is_latest:       body && body.is_latest === true,
    is_active:       body && body.is_active === false ? false : true,
    sort_order:      Number.isFinite(body && body.sort_order) ? body.sort_order : 0,
  };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const user = await requireAdmin(req, res);
  if (!user) return;

  // ── GET ────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('magazine_issues')
        .select('*')
        .order('issue_year', { ascending: false })
        .order('sort_order', { ascending: false });

      if (error) {
        console.error('[admin magazine-issues GET] supabase error', error);
        return res.status(500).json({ message: 'Failed to load magazine issues' });
      }

      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ data: data || [] });
    } catch (err) {
      console.error('[admin magazine-issues GET] uncaught', err);
      return res.status(500).json({ message: 'Failed to load magazine issues' });
    }
  }

  // ── POST ───────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const row = normalizeRow(req.body || {});
      if (!row.issue_number) return res.status(400).json({ message: 'issue_number is required' });
      if (!row.title)        return res.status(400).json({ message: 'title is required' });
      if (!row.issue_year)   return res.status(400).json({ message: 'issue_year is required' });
      if (!row.cover_image)  return res.status(400).json({ message: 'cover_image is required' });

      // is_latest=true 로 새로 만들면 다른 모든 이슈의 is_latest 를 false 로 리셋
      if (row.is_latest){
        await supabaseAdmin
          .from('magazine_issues')
          .update({ is_latest: false })
          .eq('is_latest', true);
      }

      // QA #318 — created_by FK 사전 체크.
      let creatorId = null;
      try {
        const { data: profRow } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();
        if (profRow && profRow.id) creatorId = profRow.id;
      } catch (_){}

      const insertRow = Object.assign({}, row, {
        created_by: creatorId,
        updated_by: creatorId,
      });
      const { data, error } = await supabaseAdmin
        .from('magazine_issues')
        .insert(insertRow)
        .select()
        .single();
      if (error || !data) {
        console.error('[admin magazine-issues POST] insert failed', { error, insertRow });
        if (error && String(error.code) === '23505'){
          return res.status(409).json({ message: '이미 존재하는 발행 번호(#' + row.issue_number + ')입니다. 다른 번호를 사용해주세요.' });
        }
        return res.status(500).json({
          message: 'Failed to create magazine issue',
          detail:  (error && (error.message || error.hint)) || 'unknown DB error',
          code:    (error && error.code) || null,
        });
      }
      return res.status(201).json({ data });
    } catch (err) {
      console.error('[admin magazine-issues POST] uncaught', err);
      return res.status(500).json({
        message: 'Failed to create magazine issue',
        detail:  (err && err.message) || String(err),
      });
    }
  }

  // ── PATCH / PUT ────────────────────────────────────────────────────
  if (req.method === 'PATCH' || req.method === 'PUT') {
    try {
      const body = req.body || {};
      const id = String(body.id || '').trim();
      if (!id) return res.status(400).json({ message: 'id is required' });

      // 부분 업데이트: 명시적으로 넘어온 필드만.
      const patch = { updated_by: user.id };
      if (Number.isFinite(body.issue_number))    patch.issue_number    = Math.floor(body.issue_number);
      if (body.title !== undefined){
        var t = String(body.title || '').trim();
        if (!t) return res.status(400).json({ message: 'title cannot be empty' });
        patch.title = t;
      }
      if (Number.isFinite(body.issue_year))      patch.issue_year      = Math.floor(body.issue_year);
      if (body.issue_month !== undefined){
        patch.issue_month = Number.isFinite(body.issue_month) ? Math.max(1, Math.min(12, Math.floor(body.issue_month))) : null;
      }
      if (body.month_label !== undefined)        patch.month_label     = String(body.month_label || '').trim() || null;
      if (body.cover_image !== undefined){
        var c = String(body.cover_image || '').trim();
        if (!c) return res.status(400).json({ message: 'cover_image cannot be empty' });
        patch.cover_image = c;
      }
      if (Number.isFinite(body.editorial_count)) patch.editorial_count = Math.max(0, Math.floor(body.editorial_count));
      if (body.link_url !== undefined)           patch.link_url        = String(body.link_url || '').trim() || null;
      if (typeof body.is_latest === 'boolean')   patch.is_latest       = body.is_latest;
      if (typeof body.is_active === 'boolean')   patch.is_active       = body.is_active;
      if (Number.isFinite(body.sort_order))      patch.sort_order      = body.sort_order;

      // is_latest=true 로 바뀌면 다른 이슈들의 is_latest 를 false 로 리셋
      if (patch.is_latest === true){
        await supabaseAdmin
          .from('magazine_issues')
          .update({ is_latest: false })
          .eq('is_latest', true)
          .neq('id', id);
      }

      const { data, error } = await supabaseAdmin
        .from('magazine_issues')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error || !data) {
        console.error('[admin magazine-issues PATCH] update failed', error);
        if (error && String(error.code) === '23505'){
          return res.status(409).json({ message: '이미 존재하는 발행 번호입니다.' });
        }
        return res.status(500).json({ message: 'Failed to update magazine issue' });
      }
      return res.status(200).json({ data });
    } catch (err) {
      console.error('[admin magazine-issues PATCH] uncaught', err);
      return res.status(500).json({ message: 'Failed to update magazine issue' });
    }
  }

  // ── DELETE ─────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      const id = String((req.query && req.query.id) || (req.body && req.body.id) || '').trim();
      if (!id) return res.status(400).json({ message: 'id is required' });
      const { error } = await supabaseAdmin
        .from('magazine_issues')
        .delete()
        .eq('id', id);
      if (error) {
        console.error('[admin magazine-issues DELETE] failed', error);
        return res.status(500).json({ message: 'Failed to delete magazine issue' });
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[admin magazine-issues DELETE] uncaught', err);
      return res.status(500).json({ message: 'Failed to delete magazine issue' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
