/**
 * GET/POST /api/admin/instagram-diagnose — 인스타 자동 수집 진단·강제 임포트 (관리자 전용).
 *
 * QA #347. sync-instagram이 최근 게시물을 스킵한 이유를 관리자에게 명확히
 * 보여주고, 필요 시 필터를 우회해 강제로 아티클로 저장할 수 있게 한다.
 *
 * 사용법:
 *   GET  ?scan=1&days=14         — 최근 14일 게시물 목록 + 상태(imported/skipped/reason)
 *   POST { instagramUrl, forceArticle: true }
 *        — 필터 우회하고 아티클로 강제 저장.
 *          isLikelyEditorialCaption / AI Editorial 분류를 모두 건너뜀.
 *
 * 스캔 결과 status:
 *   imported            — DB 에 이미 존재 (articles.source_instagram_post_id)
 *   editorial(db)       — editorials.source_instagram_url shortcode 매치 (정상 스킵)
 *   editorial(caption)  — 캡션 휴리스틱이 편집 크레딧으로 판정 (오탐 의심)
 *   pending             — 아직 미수집. 다음 크론(2시간마다)에 수집 예상
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const {
  listMediaPaged,
  listRecentMedia,
  fetchInstagramPost,
  generateArticleFromPost,
  buildArticleRow,
  archiveImagesToStorage,
  archiveVideosToStorage,
  isLikelyEditorialCaption,
  _extractShortcode,
} = require('../_lib/instagramImport');

module.exports = async function handler(req, res){
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID){
    return res.status(503).json({ error: 'IG_ACCESS_TOKEN / IG_USER_ID 환경변수 미설정.' });
  }

  try {
    // ===== SCAN 모드 (GET) — 진단만 =====
    if (req.method === 'GET' && (req.query || {}).scan === '1'){
      const days = Math.max(1, Math.min(60, parseInt(req.query.days || '14', 10) || 14));
      const media = await listMediaPaged({ sinceDays: days, maxCount: 100 });
      if (!media.length) return res.status(200).json({ days, posts: [] });

      // articles + editorials 매핑 준비 (배치 조회)
      const allIds = media.map(m => m.id).filter(Boolean);
      const [{ data: arts }, { data: eds }] = await Promise.all([
        supabaseAdmin.from('articles')
          .select('id, source_instagram_post_id, title, slug, custom_url, status')
          .in('source_instagram_post_id', allIds),
        supabaseAdmin.from('editorials')
          .select('source_instagram_url').not('source_instagram_url', 'is', null),
      ]);
      const importedMap = new Map((arts || []).map(a => [a.source_instagram_post_id, a]));
      const editorialShortcodes = new Set(
        (eds || []).map(e => _extractShortcode(e.source_instagram_url)).filter(Boolean)
      );

      const posts = media.map(m => {
        const shortcode = _extractShortcode(m.permalink);
        const existing = importedMap.get(m.id);
        let status = 'pending';
        let reason = null;
        if (existing){
          status = 'imported';
          reason = 'articles.id ' + existing.id + ' (' + existing.status + ')';
        } else if (shortcode && editorialShortcodes.has(shortcode)){
          status = 'editorial(db)';
          reason = 'editorials.source_instagram_url 매치 — 정상 스킵';
        } else if (isLikelyEditorialCaption(m.caption)){
          status = 'editorial(caption)';
          reason = '캡션 휴리스틱 판정. 뉴스인데 잘못 걸렸다면 강제 임포트 사용.';
        }
        return {
          id: m.id,
          shortcode,
          permalink: m.permalink,
          timestamp: m.timestamp,
          caption_head: String(m.caption || '').slice(0, 120),
          media_type: m.media_type,
          status,
          reason,
          article_slug: existing ? (existing.custom_url || existing.slug || null) : null,
          article_title: existing ? existing.title : null,
        };
      });
      return res.status(200).json({ days, count: posts.length, posts });
    }

    // ===== FORCE IMPORT (POST) =====
    if (req.method === 'POST'){
      const body = req.body || {};
      const url = String(body.instagramUrl || '').trim();
      const forceArticle = body.forceArticle === true;
      if (!url) return res.status(400).json({ error: 'instagramUrl 필요.' });
      if (!/instagram\.com\/(?:p|reel|tv)\//.test(url) && !_extractShortcode(url)){
        return res.status(400).json({ error: '유효한 Instagram URL이 아닙니다.' });
      }

      const post = await fetchInstagramPost(url);
      if (!post || !post.id) return res.status(404).json({ error: '게시물을 찾지 못함.' });

      // 중복 체크 — 이미 있으면 그 row 반환.
      const { data: existing } = await supabaseAdmin
        .from('articles').select('*')
        .eq('source_instagram_post_id', post.id).maybeSingle();
      if (existing){
        return res.status(200).json({ article: existing, duplicate: true });
      }

      const generated = await generateArticleFromPost(post);
      // 강제 모드: AI 가 'Editorial' 로 분류해도 'News' 로 다운그레이드.
      if (forceArticle && String(generated.category || '').toLowerCase() === 'editorial'){
        generated.category = 'News';
        generated._forced_from_editorial = true;
      }
      const archivedUrls = await archiveImagesToStorage(post, 10);
      const videoUrls = await archiveVideosToStorage(post, 2);
      const row = buildArticleRow(post, generated, {
        status: body.status || 'draft',
        archivedUrls, videoUrls,
      });
      row.created_by = user.id;

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('articles').insert(row).select().single();
      if (insErr){
        if (insErr.code === '23505'){
          return res.status(409).json({ error: '이미 임포트된 게시물입니다.', code: 'duplicate' });
        }
        console.error('[instagram-diagnose] insert failed:', insErr);
        return res.status(500).json({ error: 'DB insert 실패: ' + insErr.message });
      }
      return res.status(201).json({
        article: inserted,
        duplicate: false,
        forced_from_editorial: !!generated._forced_from_editorial,
      });
    }

    return res.status(405).json({ error: 'Method not allowed. GET ?scan=1 또는 POST forceArticle.' });
  } catch (e){
    console.error('[instagram-diagnose] failed:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
