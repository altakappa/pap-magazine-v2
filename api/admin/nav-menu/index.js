/**
 * /api/admin/nav-menu
 *
 * QA #320 — 햄버거 메뉴 카테고리 CRUD (admin only).
 *
 *   GET    /api/admin/nav-menu       → 모든 항목 (활성+비활성)
 *   POST   /api/admin/nav-menu       → 새 메뉴 항목 생성
 *   PATCH  /api/admin/nav-menu       → 항목 수정 (id 필수, 부분 업데이트)
 *   DELETE /api/admin/nav-menu?id=…  → 항목 삭제
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors }    = require('../../_lib/cors');
const { requireAdmin }  = require('../../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

const ALLOWED_STYLES = ['default', 'red', 'gold', 'muted'];

function normalizeRow(body) {
  const style = String((body && body.style) || 'default').toLowerCase();
  return {
    label_key:     body && body.label_key ? String(body.label_key).trim() : null,
    label_default: String((body && body.label_default) || '').trim(),
    link_url:      String((body && body.link_url) || '').trim(),
    style:         ALLOWED_STYLES.indexOf(style) === -1 ? 'default' : style,
    sort_order:    Number.isFinite(body && body.sort_order) ? body.sort_order : 0,
    is_active:     body && body.is_active === false ? false : true,
  };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const user = await requireAdmin(req, res);
  if (!user) return;

  // FK 사전 체크 헬퍼 (QA #318 패턴)
  async function resolveEditorId() {
    try {
      const { data: profRow } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();
      if (profRow && profRow.id) return profRow.id;
    } catch (_){}
    return null;
  }

  // ── GET ────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('nav_menu_items')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('[admin nav-menu GET] supabase error', error);
        return res.status(500).json({
          message: 'Failed to load nav menu',
          detail: (error && error.message) || 'unknown',
        });
      }

      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ data: data || [] });
    } catch (err) {
      console.error('[admin nav-menu GET] uncaught', err);
      return res.status(500).json({ message: 'Failed to load nav menu', detail: err && err.message });
    }
  }

  // ── POST ───────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const row = normalizeRow(req.body || {});
      if (!row.label_default) return res.status(400).json({ message: 'label_default is required' });
      if (!row.link_url)      return res.status(400).json({ message: 'link_url is required' });

      const editorId = await resolveEditorId();
      const insertRow = Object.assign({}, row, {
        created_by: editorId,
        updated_by: editorId,
      });
      const { data, error } = await supabaseAdmin
        .from('nav_menu_items')
        .insert(insertRow)
        .select()
        .single();
      if (error || !data) {
        console.error('[admin nav-menu POST] insert failed', { error, insertRow });
        return res.status(500).json({
          message: 'Failed to create nav menu item',
          detail:  (error && (error.message || error.hint)) || 'unknown DB error',
          code:    (error && error.code) || null,
        });
      }
      return res.status(201).json({ data });
    } catch (err) {
      console.error('[admin nav-menu POST] uncaught', err);
      return res.status(500).json({
        message: 'Failed to create nav menu item',
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

      const editorId = await resolveEditorId();
      const patch = { updated_by: editorId };

      if (body.label_key !== undefined) {
        patch.label_key = body.label_key ? String(body.label_key).trim() : null;
      }
      if (body.label_default !== undefined) {
        const v = String(body.label_default || '').trim();
        if (!v) return res.status(400).json({ message: 'label_default cannot be empty' });
        patch.label_default = v;
      }
      if (body.link_url !== undefined) {
        const v = String(body.link_url || '').trim();
        if (!v) return res.status(400).json({ message: 'link_url cannot be empty' });
        patch.link_url = v;
      }
      if (body.style !== undefined) {
        const s = String(body.style || 'default').toLowerCase();
        patch.style = ALLOWED_STYLES.indexOf(s) === -1 ? 'default' : s;
      }
      if (Number.isFinite(body.sort_order)) patch.sort_order = body.sort_order;
      if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;

      const { data, error } = await supabaseAdmin
        .from('nav_menu_items')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error || !data) {
        console.error('[admin nav-menu PATCH] update failed', { error, patch });
        return res.status(500).json({
          message: 'Failed to update nav menu item',
          detail:  (error && (error.message || error.hint)) || 'unknown DB error',
          code:    (error && error.code) || null,
        });
      }
      return res.status(200).json({ data });
    } catch (err) {
      console.error('[admin nav-menu PATCH] uncaught', err);
      return res.status(500).json({
        message: 'Failed to update nav menu item',
        detail:  (err && err.message) || String(err),
      });
    }
  }

  // ── DELETE ─────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      const id = String((req.query && req.query.id) || (req.body && req.body.id) || '').trim();
      if (!id) return res.status(400).json({ message: 'id is required' });
      const { error } = await supabaseAdmin
        .from('nav_menu_items')
        .delete()
        .eq('id', id);
      if (error) {
        console.error('[admin nav-menu DELETE] failed', error);
        return res.status(500).json({
          message: 'Failed to delete nav menu item',
          detail:  (error && (error.message || error.hint)) || 'unknown DB error',
        });
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[admin nav-menu DELETE] uncaught', err);
      return res.status(500).json({
        message: 'Failed to delete nav menu item',
        detail:  (err && err.message) || String(err),
      });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
