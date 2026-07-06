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
      // QA #318 — created_by/updated_by 는 profiles(id) 를 FK 로 참조.
      // 서브 관리자 등 profiles 에 row 가 없는 계정으로 요청 시 FK 위반 →
      // 500 로 실패. 우선 FK 유효성을 사전 체크해서 없으면 null 로 대체.
      let creatorId = null;
      try {
        const { data: profRow } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();
        if (profRow && profRow.id) creatorId = profRow.id;
      } catch (_){ /* profiles 조회 실패는 무시하고 null 로 진행 */ }

      const insertRow = Object.assign({}, row, {
        created_by: creatorId,
        updated_by: creatorId,
      });
      const { data, error } = await supabaseAdmin
        .from('loading_images')
        .insert(insertRow)
        .select()
        .single();
      if (error || !data) {
        // QA #318 — 진단을 위해 서버가 감췄던 실제 Supabase 에러를
        // 클라이언트로 노출. code + message + hint 를 상세히 전달.
        console.error('[admin loading-images POST] insert failed', {
          error,
          insertRow: Object.assign({}, insertRow, { image_url_pc: '(redacted)' })
        });
        return res.status(500).json({
          message: 'Failed to create loading image',
          detail:  (error && (error.message || error.hint)) || 'unknown DB error',
          code:    (error && error.code) || null,
        });
      }
      return res.status(201).json({ data });
    } catch (err) {
      console.error('[admin loading-images POST] uncaught', err);
      return res.status(500).json({
        message: 'Failed to create loading image',
        detail:  (err && err.message) || String(err),
      });
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
      // QA #318 — updated_by FK 사전 체크. profiles 에 없으면 null 로.
      let editorId = null;
      try {
        const { data: profRow } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();
        if (profRow && profRow.id) editorId = profRow.id;
      } catch (_){}

      // 부분 업데이트: 명시적으로 넘어온 필드만 반영.
      const patch = { updated_by: editorId };
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
        console.error('[admin loading-images PATCH] update failed', { error, patch });
        return res.status(500).json({
          message: 'Failed to update loading image',
          detail:  (error && (error.message || error.hint)) || 'unknown DB error',
          code:    (error && error.code) || null,
        });
      }
      return res.status(200).json({ data });
    } catch (err) {
      console.error('[admin loading-images PATCH] uncaught', err);
      return res.status(500).json({
        message: 'Failed to update loading image',
        detail:  (err && err.message) || String(err),
      });
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
