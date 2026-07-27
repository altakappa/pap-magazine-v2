/**
 * /api/admin/studio — PAP STUDIO 프로젝트 관리(관리자 전용 CRUD).
 *   GET                  전체 프로젝트(미발행 포함, sort 순)
 *   GET ?slug=<slug>     단건
 *   POST   {…}           생성 (slug 없으면 title 로 생성)
 *   PATCH  {id, …}       수정 (제목·브랜드·설명·이미지·순서·발행 등)
 *   DELETE ?id=<id>      삭제
 *
 * 이미지 파일 업로드는 /api/admin/studio-upload (multipart) → URL 반환 → images[] 에 반영.
 * 소비자: frontend/studio-admin.html (/admin/studio).
 */
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');

const FIELDS = 'id,slug,title,brand,location,kind,category,description,film_slug,video_url,cover_url,images,sort_order,published,images_migrated,source_wix_url,created_at,updated_at';
const EDITABLE = ['title', 'brand', 'location', 'kind', 'category', 'description', 'film_slug', 'video_url', 'cover_url', 'images', 'sort_order', 'published'];

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  try { for await (const c of req) raw += c; } catch (_) {}
  try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
}
function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9가-힣\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 80);
}
function clean(body) {
  const out = {};
  for (const k of EDITABLE) {
    if (!(k in body)) continue;
    if (k === 'images') out.images = Array.isArray(body.images) ? body.images.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)) : [];
    else if (k === 'sort_order') out.sort_order = parseInt(body.sort_order, 10) || 0;
    else if (k === 'published') out.published = !!body.published;
    else if (k === 'kind') out.kind = body.kind === 'film' ? 'film' : 'photo';
    else out[k] = body[k] == null ? null : String(body[k]);
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const slug = req.query && req.query.slug;
      if (slug) {
        const { data, error } = await supabaseAdmin.from('studio_projects').select(FIELDS).eq('slug', String(slug)).maybeSingle();
        if (error) throw error;
        return res.status(200).json({ project: data || null });
      }
      const { data, error } = await supabaseAdmin.from('studio_projects').select(FIELDS).order('sort_order', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ projects: data || [] });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const fields = clean(body);
      let slug = slugify(body.slug || body.title || '');
      if (!slug) return res.status(400).json({ error: 'slug 또는 title 필요', code: 'missing_slug' });
      // slug 충돌 시 -2, -3 …
      let final = slug, n = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: dup } = await supabaseAdmin.from('studio_projects').select('id').eq('slug', final).maybeSingle();
        if (!dup) break; n++; final = slug + '-' + n;
        if (n > 50) break;
      }
      const row = Object.assign({ kind: 'photo', category: 'campaign', images: [], published: true }, fields, { slug: final });
      if (!row.cover_url && Array.isArray(row.images) && row.images.length) row.cover_url = row.images[0];
      row.updated_at = new Date().toISOString();
      const { data, error } = await supabaseAdmin.from('studio_projects').insert(row).select(FIELDS).single();
      if (error) throw error;
      return res.status(200).json({ ok: true, project: data });
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const body = await readJson(req);
      const id = body.id;
      if (!id) return res.status(400).json({ error: 'id 필요', code: 'missing_id' });
      const patch = clean(body);
      if (('images' in patch) && !patch.cover_url) {
        // cover 가 비었으면 첫 이미지로
        patch.cover_url = (patch.images && patch.images[0]) || null;
      }
      patch.updated_at = new Date().toISOString();
      const { data, error } = await supabaseAdmin.from('studio_projects').update(patch).eq('id', String(id)).select(FIELDS).single();
      if (error) throw error;
      return res.status(200).json({ ok: true, project: data });
    }

    if (req.method === 'DELETE') {
      const id = req.query && req.query.id;
      if (!id) return res.status(400).json({ error: 'id 필요', code: 'missing_id' });
      const { error } = await supabaseAdmin.from('studio_projects').delete().eq('id', String(id));
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE, OPTIONS');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('[admin/studio] error', e);
    return res.status(500).json({ error: '스튜디오 프로젝트 처리 실패 — contact@papkorea.com', code: 'studio_admin_failed' });
  }
};
