/**
 * /api/admin/banners
 *
 * QA #295 — 메인 hero 배너 그룹 CRUD (admin only).
 *
 *   GET    /api/admin/banners      → 모든 그룹(활성+비활성) + 이미지
 *   POST   /api/admin/banners      → 새 그룹 + 이미지 (nested) 생성
 *   PUT    /api/admin/banners      → 그룹 + 이미지 일괄 교체 (id 필수)
 *   DELETE /api/admin/banners?id=  → 그룹 삭제 (이미지는 CASCADE)
 *
 * 모든 핸들러는 requireAdmin (대표 + 서브 모두 허용 ─ 콘텐츠 운영
 * 권한이므로 staff 도 사용 가능).
 *
 * 이미지 nested 패턴은 admin UI 가 사용하기 편하도록 그룹 PUT 한 번에
 * 모든 이미지 (추가/삭제/순서변경)를 보내는 "전체 교체" 시맨틱. 일관성
 * 보장: 트랜잭션이 아닌 단순 DELETE+INSERT 라 동시 편집 시 마지막
 * 저장이 이김.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors }    = require('../../_lib/cors');
const { requireAdmin }  = require('../../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

// 들어오는 image 배열을 sort_order 와 함께 정규화. 빈 image_url 은 drop.
// QA #296 — image_url_mobile (옵션) 도 함께 정규화. 빈 문자열 → null.
function normalizeImages(rawImages) {
  if (!Array.isArray(rawImages)) return [];
  return rawImages
    .map(function (img, idx) {
      const url       = String((img && img.image_url) || '').trim();
      const urlMobile = String((img && img.image_url_mobile) || '').trim();
      if (!url) return null;
      return {
        image_url: url,
        image_url_mobile: urlMobile || null,
        sort_order: Number.isFinite(img && img.sort_order) ? img.sort_order : idx,
      };
    })
    .filter(Boolean);
}

// group 본문(텍스트 필드만)을 정규화. null/undefined 처리.
// QA #298 — scheduled_publish_at (ISO 문자열 또는 null) 도 함께 정규화.
function normalizeGroupFields(body) {
  let scheduledAt = null;
  if (body.scheduled_publish_at) {
    const d = new Date(body.scheduled_publish_at);
    if (!isNaN(d.getTime())) scheduledAt = d.toISOString();
  }
  return {
    issue:      body.issue      != null ? String(body.issue).trim()      : null,
    title:      String(body.title || '').trim(),
    link_url:   body.link_url   != null ? String(body.link_url).trim()   : null,
    sort_order: Number.isFinite(body.sort_order) ? body.sort_order : 0,
    is_active:  body.is_active === false ? false : true,
    scheduled_publish_at: scheduledAt,
  };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // 전 라우트 admin 필요.
  const user = await requireAdmin(req, res);
  if (!user) return;

  // ── GET ────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('cover_groups')
        .select('id,issue,title,link_url,sort_order,is_active,scheduled_publish_at,created_at,updated_at,images:cover_images(id,image_url,image_url_mobile,sort_order)')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[admin banners GET] supabase error', error);
        return res.status(500).json({ message: 'Failed to load banner groups' });
      }

      const out = (data || []).map(function (g) {
        const imgs = Array.isArray(g.images) ? g.images.slice() : [];
        imgs.sort(function (a, b) {
          return (a.sort_order || 0) - (b.sort_order || 0);
        });
        return Object.assign({}, g, { images: imgs });
      });

      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ data: out });
    } catch (err) {
      console.error('[admin banners GET] uncaught', err);
      return res.status(500).json({ message: 'Failed to load banner groups' });
    }
  }

  // ── POST ───────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const body  = req.body || {};
      const group = normalizeGroupFields(body);
      const imgs  = normalizeImages(body.images);

      if (!group.title) {
        return res.status(400).json({ message: 'title is required' });
      }

      const { data: created, error: insErr } = await supabaseAdmin
        .from('cover_groups')
        .insert(group)
        .select()
        .single();

      if (insErr || !created) {
        console.error('[admin banners POST] group insert failed', insErr);
        return res.status(500).json({ message: 'Failed to create banner group' });
      }

      if (imgs.length > 0) {
        const rows = imgs.map(function (img) {
          return Object.assign({}, img, { group_id: created.id });
        });
        const { error: imgErr } = await supabaseAdmin.from('cover_images').insert(rows);
        if (imgErr) {
          // 그룹은 만들어졌는데 이미지가 실패 ─ 그룹도 롤백.
          await supabaseAdmin.from('cover_groups').delete().eq('id', created.id);
          console.error('[admin banners POST] image insert failed', imgErr);
          return res.status(500).json({ message: 'Failed to create banner images' });
        }
      }

      return res.status(201).json({ data: Object.assign({}, created, { images: imgs }) });
    } catch (err) {
      console.error('[admin banners POST] uncaught', err);
      return res.status(500).json({ message: 'Failed to create banner group' });
    }
  }

  // ── PUT ────────────────────────────────────────────────────────────
  // 그룹 텍스트 필드 갱신 + 이미지 배열 전체 교체 (단순 DELETE + INSERT).
  if (req.method === 'PUT') {
    try {
      const body = req.body || {};
      const id   = String(body.id || '').trim();
      if (!id) {
        return res.status(400).json({ message: 'id is required' });
      }

      const group = normalizeGroupFields(body);
      const imgs  = normalizeImages(body.images);

      if (!group.title) {
        return res.status(400).json({ message: 'title is required' });
      }

      const { data: updated, error: updErr } = await supabaseAdmin
        .from('cover_groups')
        .update(group)
        .eq('id', id)
        .select()
        .single();

      if (updErr || !updated) {
        console.error('[admin banners PUT] update failed', updErr);
        return res.status(500).json({ message: 'Failed to update banner group' });
      }

      // 이미지 전체 교체: 기존 모두 삭제 후 새로 삽입.
      const { error: delErr } = await supabaseAdmin
        .from('cover_images')
        .delete()
        .eq('group_id', id);
      if (delErr) {
        console.error('[admin banners PUT] image delete failed', delErr);
        return res.status(500).json({ message: 'Failed to replace banner images' });
      }

      if (imgs.length > 0) {
        const rows = imgs.map(function (img) {
          return Object.assign({}, img, { group_id: id });
        });
        const { error: insErr } = await supabaseAdmin.from('cover_images').insert(rows);
        if (insErr) {
          console.error('[admin banners PUT] image insert failed', insErr);
          return res.status(500).json({ message: 'Failed to insert banner images' });
        }
      }

      return res.status(200).json({ data: Object.assign({}, updated, { images: imgs }) });
    } catch (err) {
      console.error('[admin banners PUT] uncaught', err);
      return res.status(500).json({ message: 'Failed to update banner group' });
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
        .from('cover_groups')
        .delete()
        .eq('id', id);
      if (error) {
        console.error('[admin banners DELETE] failed', error);
        return res.status(500).json({ message: 'Failed to delete banner group' });
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[admin banners DELETE] uncaught', err);
      return res.status(500).json({ message: 'Failed to delete banner group' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
