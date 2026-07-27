/**
 * GET /api/studio                — 발행된 스튜디오 프로젝트 목록(사진 프로젝트, sort 순).
 * GET /api/studio?slug=<slug>    — 단일 프로젝트(갤러리 전 이미지 + 연결 필름).
 *
 * 소비자: frontend/studio.html (PAP STUDIO 포트폴리오). 데이터는 studio_projects
 * (cron/studio-import 가 Wix 에서 이식, cron/studio-image-migrate 가 이미지를 우리
 * 스토리지로 이관). 공개 데이터라 익명 읽기 허용(RLS: published=true).
 */
const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); return res.status(405).end(); }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');

  try {
    const slug = req.query && req.query.slug ? String(req.query.slug) : '';

    if (slug) {
      const { data, error } = await supabaseAdmin.from('studio_projects')
        .select('slug,title,brand,location,kind,category,description,film_slug,video_url,cover_url,images,source_wix_url')
        .eq('slug', slug).eq('published', true).limit(1).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'not found' });
      // 연결 필름(있으면) 함께
      let film = null;
      if (data.film_slug) {
        const { data: f } = await supabaseAdmin.from('studio_projects')
          .select('slug,title,video_url,cover_url,images').eq('slug', data.film_slug).maybeSingle();
        film = f || null;
      }
      return res.status(200).json({ project: data, film });
    }

    // 목록: 사진 프로젝트만(필름은 상세에서 연결 노출), sort 순
    const { data, error } = await supabaseAdmin.from('studio_projects')
      .select('slug,title,brand,location,kind,category,cover_url,film_slug')
      .eq('published', true).eq('kind', 'photo')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return res.status(200).json({ projects: data || [], count: (data || []).length });
  } catch (e) {
    console.error('[studio] error', e);
    return res.status(500).json({ error: 'Failed to load studio projects — contact@papkorea.com', code: 'studio_load_failed' });
  }
};
