/**
 * /api/admin/repurpose — 소셜 재가공(반자동) 관리 엔드포인트.
 *
 *   GET  /api/admin/repurpose?type=article&limit=40
 *        → 최근 발행 기사/에디토리얼 목록 + 각 항목의 저장된 재가공 결과(플랫폼별).
 *
 *   POST /api/admin/repurpose
 *        body: { target_type:'article'|'editorial', target_id, platform:'xiaohongshu'|'kakao',
 *                overwrite?:bool, op?:'generate'|'mark_posted' }
 *        → op='generate'(기본): Claude 로 재가공 후 social_repurpose 에 upsert, 결과 반환.
 *          overwrite=false 이고 이미 있으면 재생성 없이 기존 값 반환.
 *        → op='mark_posted': 해당 행 status='posted' 로 표시(수동 게시 완료 체크).
 *
 * 인증: requireAdmin (에디토리얼 auto-generate 와 동일 — 콘텐츠 채우기 작업).
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { generateRepurpose, extractImageUrls, PLATFORMS } = require('../../_lib/socialRepurpose');

const TARGETS = {
  article: {
    table: 'articles',
    // 재가공에 쓰는 필드만 선별
    columns: 'id,title,subtitle,content,gallery,thumbnail_url,credits,tags,status,published_date,created_at',
    contentField: (row) => row.content,
  },
  editorial: {
    table: 'editorials',
    // 에디토리얼은 subtitle 이 없고 본문은 description(+ _en), 대표 이미지는 cover_image/thumbnail.
    columns: 'id,title,description,description_en,gallery,cover_image,thumbnail,credits,tags,status,published_date,created_at',
    contentField: (row) => [row.description, row.description_en].filter(Boolean).join('\n\n'),
  },
};

function _parseBody(req) {
  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
  }
  return body || {};
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    // ───────────────────────── GET: 목록 ─────────────────────────
    if (req.method === 'GET') {
      const type = String(req.query.type || 'article');
      const t = TARGETS[type];
      if (!t) return res.status(400).json({ message: 'Unknown type' });
      const limit = Math.min(parseInt(req.query.limit, 10) || 40, 100);

      const { data: rows, error } = await supabaseAdmin
        .from(t.table)
        .select(t.columns)
        .eq('status', 'published')
        .order('published_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      const ids = (rows || []).map((r) => r.id);
      let repurposeByTarget = {};
      if (ids.length) {
        const { data: reps } = await supabaseAdmin
          .from('social_repurpose')
          .select('*')
          .eq('target_type', type)
          .in('target_id', ids);
        (reps || []).forEach((r) => {
          (repurposeByTarget[r.target_id] = repurposeByTarget[r.target_id] || {})[r.platform] = r;
        });
      }

      const items = (rows || []).map((r) => ({
        id: r.id,
        title: r.title,
        subtitle: r.subtitle || '',
        thumbnail: r.thumbnail_url || r.cover_image || r.thumbnail || (extractImageUrls(r.gallery, 1)[0] || ''),
        image_count: extractImageUrls(r.gallery, 30).length,
        published_date: r.published_date || r.created_at,
        repurpose: repurposeByTarget[r.id] || {},
      }));
      return res.status(200).json({ type, items });
    }

    // ───────────────────────── POST: 생성 / 표시 ─────────────────────────
    if (req.method === 'POST') {
      const body = _parseBody(req);
      const type = String(body.target_type || '');
      const targetId = String(body.target_id || '');
      const platform = String(body.platform || '');
      const op = String(body.op || 'generate');
      const t = TARGETS[type];
      if (!t) return res.status(400).json({ message: 'Unknown target_type' });
      if (!targetId) return res.status(400).json({ message: 'Missing target_id' });
      if (!PLATFORMS[platform]) return res.status(400).json({ message: 'Unknown platform' });

      // 수동 게시 완료 표시
      if (op === 'mark_posted' || op === 'unmark_posted') {
        const status = op === 'mark_posted' ? 'posted' : 'draft';
        const { data, error } = await supabaseAdmin
          .from('social_repurpose')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('target_type', type).eq('target_id', targetId).eq('platform', platform)
          .select('*').single();
        if (error) return res.status(404).json({ message: '해당 재가공 항목이 없습니다.' });
        return res.status(200).json({ item: data });
      }

      const overwrite = body.overwrite === true;

      // 기존 행 확인
      const { data: existing } = await supabaseAdmin
        .from('social_repurpose')
        .select('*')
        .eq('target_type', type).eq('target_id', targetId).eq('platform', platform)
        .maybeSingle();
      if (existing && !overwrite) {
        return res.status(200).json({ item: existing, reused: true });
      }

      // 대상 로드
      const { data: row, error: loadErr } = await supabaseAdmin
        .from(t.table).select(t.columns).eq('id', targetId).single();
      if (loadErr || !row) return res.status(404).json({ message: '대상을 찾을 수 없습니다.' });

      const gallery = Array.isArray(row.gallery) ? row.gallery : [];
      const gen = await generateRepurpose({
        platform,
        title: row.title,
        subtitle: row.subtitle || '',
        contentText: t.contentField(row) || '',
        imageUrls: gallery.length ? gallery : [row.thumbnail_url, row.cover_image, row.thumbnail].filter(Boolean),
        credits: row.credits,
        tags: Array.isArray(row.tags) ? row.tags : [],
      });

      const patch = {
        target_type: type,
        target_id: targetId,
        platform,
        title: gen.title,
        body: gen.body,
        hashtags: gen.hashtags || [],
        image_urls: gen.image_urls || [],
        lang: gen.lang || null,
        status: 'draft',
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { data: saved, error: upErr } = await supabaseAdmin
        .from('social_repurpose')
        .upsert(patch, { onConflict: 'target_type,target_id,platform' })
        .select('*').single();
      if (upErr) throw upErr;

      return res.status(200).json({ item: saved });
    }

    return res.status(405).json({ message: 'Method not allowed' });
  } catch (err) {
    console.error('[admin/repurpose] error:', err && err.message);
    return res.status(500).json({ message: '서버 오류', detail: String(err && err.message || err).slice(0, 300) });
  }
};
