/**
 * GET /api/articles-snapshot
 * 2026-07-12 — 기사 목록 첫 페인트용 "정적 스냅샷"을 DB에서 항상 최신으로 생성.
 *
 * 배경: frontend/data/articles.json 정적 파일은 수동 갱신이라 stale해지고(관측 시
 * 최신 2026-03-02, 4개월), 첫 페인트에 오래된 기사가 떴다. Vercel 크론은 배포된
 * 정적 파일을 쓸 수 없으므로, 파일을 주기 재생성하는 대신 이 엔드포인트가 DB에서
 * 최신 목록을 만들어 엣지 캐시(s-maxage=1800)로 제공한다 → 크론 없이 항상 ≤30분 신선.
 *
 * 반환: frontend/data/articles.json 과 동일한 "압축 키" 바레 배열
 *   [{ t, sub, d, slug, url, cat, th, img, tags, cr, desc, gallery }, ...]
 * (loadJSON 이 그대로 소비. 상세용 blocks/videos 는 전체 syncArticles 가 채움)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const nowIso = new Date().toISOString();
    // 공개 발행분만, 최신순, 최대 600편(목록 첫 페인트로 충분).
    const { data, error } = await supabaseAdmin
      .from('articles')
      .select('title,subtitle,slug,custom_url,category,tags,thumbnail_url,hero_image_url,credits,gallery,content,published_date')
      .eq('status', 'published')
      .or(`scheduled_publish_at.is.null,scheduled_publish_at.lte.${nowIso}`)
      .order('published_date', { ascending: false })
      .limit(600);
    if (error) throw error;

    const list = (data || []).map(function (a) {
      const raw = a.content || '';
      // content 가 JSON 블록 배열이면 desc 는 비움(전체 sync 가 blocks 로 렌더),
      // 아니면 레거시 HTML/plain 을 desc 로 유지 (정적 스냅샷과 동일 규칙).
      const isBlocks = typeof raw === 'string' && raw.trim().charAt(0) === '[';
      return {
        t: a.title || '',
        sub: a.subtitle || '',
        d: a.published_date || '',
        slug: a.slug || '',
        url: a.custom_url || a.slug || '',
        cat: a.category || '',
        th: a.thumbnail_url || '',
        img: a.hero_image_url || '',
        tags: Array.isArray(a.tags) ? a.tags : [],
        cr: Array.isArray(a.credits) ? a.credits : [],
        desc: isBlocks ? '' : raw,
        gallery: Array.isArray(a.gallery) ? a.gallery : [],
      };
    });

    // 엣지 캐시: POP 당 30분 1회 생성, 이후 1시간까지 백그라운드 갱신하며 캐시 서빙.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=1800, stale-while-revalidate=3600');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify(list));
  } catch (e) {
    console.error('[articles-snapshot] error:', (e && e.message) || 'UNKNOWN');
    // 실패 시 빈 배열 대신 에러 → 프론트가 정적 파일 폴백으로 전환하도록.
    return res.status(500).json({ error: 'snapshot_failed' });
  }
};
