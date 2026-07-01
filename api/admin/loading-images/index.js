/**
 * /api/admin/loading-images
 *
 * QA #310 — 스플래시 로더 이미지 CRUD (admin only).
 *
 *   GET    /api/admin/loading-images       → 모든 이미지 (활성+비활성)
 *   POST   /api/admin/loading-images       → 새 이미지 생성
 *   PATCH  /api/admin/loading-images       → 이미지 수정 (id 필수, 부분 업데이트)
 *   DELETE /api/admin/loading-images?id=…  → 이미지 삭제
 *
 * cover_groups + cover_images 와 달리 loading_images 는 단일 테이블 —
 * 1 row = 1 이미지. 그룹핑이 필요 없어 단순한 CRUD.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors }    = require('../../_lib/cors');
const { requireAdmin }  = require('../../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

function normalizeRow(body) {
  return {
    image_url_pc:     String((body && body.image_url_pc) || '').trim(),
    image_url_mobile: String((body && body.image_url_mobile) || '').trim() || null,
    alt_text:         body && body.alt_text != null ? String(body.alt_text).trim() : null,
    sort_order:       Number.isFinite(body && body.sort_order) ? body.sort_order : 0,
    is_active:        body && body.is_active === false ? false : true,
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
        .from('loading_images')
        .select('id,image_url_pc,image_url_mobile,alt_text,sort_order,is_active,created_at,updated_at,created_by,updated_by')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[admin loading-images GET] supabase error', error);
        return res.status(500).json({ message: 'Failed to load loading images' });
      }

      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ data: data || [] });
    } catch (err) {
      console.error('[admin loading-images GET] uncaught', err);
      return res.status(500).json({ message: 'Failed to load loading images' });
    }
  }

  // ── POST ───────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const row = normalizeRow(req.body || {});
      if (!row.image_url_pc) {
        return res.status(400).json({ message: 'image_url_pc is required' });
      }
      const insertRow = Object.assign({}, row, {
        created_by: user.id,
        updated_by: user.id,
      });
      const { data, error } = await supabaseAdmin
        .from('loading_images')
        .insert(insertRow)
        .select()
        .single();
      if (error || !data) {
        console.error('[admin loading-images POST] insert failed', error);
        return res.status(500).json({ message: 'Failed to create loading image' });
      }
      return res.status(201).json({ data });
    } catch (err) {
      console.error('[admin loading-images POST] uncaught', err);
      return res.status(500).json({ message: 'Failed to create loading image' });
    }
  }

  // ── PATCH ──────────────────────────────────────────────────────────
  if (req.method === 'PATCH' || req.method === 'PUT') {
    try {
      const body = req.body || {};
      const id   = String(body.id || '').trim();
      if (!id) {
        return res.status(400).json({ message: 'id is required' });
      }
      // 부분 업데이트: 명시적으로 넘어온 필드만 반영.
      const patch = { updated_by: user.id };
      if (body.image_url_pc !== undefined) {
        const v = String(body.image_url_pc || '').trim();
        if (!v) return res.status(400).json({ message: 'image_url_pc cannot be empty' });
        patch.image_url_pc = v;
      }
      if (body.image_url_mobile !== undefined) {
        patch.image_url_mobile = String(body.image_url_mobile || '').trim() || null;
      }
      if (body.alt_text !== undefined) {
        patch.alt_text = String(body.alt_text || '').trim() || null;
      }
      if (Number.isFinite(body.sort_order)) {
        patch.sort_order = body.sort_order;
      }
      if (typeof body.is_active === 'boolean') {
        patch.is_active = body.is_active;
      }
      const { data, error } = await supabaseAdmin
        .from('loading_images')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error || !data) {
        console.error('[admin loading-images PATCH] update failed', error);
        return res.status(500).json({ message: 'Failed to update loading image' });
      }
      return res.status(200).json({ data });
    } catch (err) {
      console.error('[admin loading-images PATCH] uncaught', err);
      return res.status(500).json({ message: 'Failed to update loading image' });
    }
  }

  // ── DELETE ─────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      const id = String((req.query && req.query.id) || (req.body && req.body.id) || '').trim();
      if (!id) {
        return res.status(400).json({ message: 'id is required' });
      }
      const { error } = await supabaseAdmin
        .from('loading_images')
        .delete()
        .eq('id', id);
      if (error) {
        console.error('[admin loading-images DELETE] failed', error);
        return res.status(500).json({ message: 'Failed to delete loading image' });
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[admin loading-images DELETE] uncaught', err);
      return res.status(500).json({ message: 'Failed to delete loading image' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
