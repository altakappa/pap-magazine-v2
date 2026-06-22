/**
 * GET /api/cron/sync-instagram — 매시간 실행되는 자동 동기화.
 *
 * QA #275. @pap_magazine의 최근 25개 게시물 fetch → 아직 import 안 된
 * 게시물만 Claude로 기사 생성 → articles 테이블에 draft 상태로 INSERT.
 *
 * 어드민이 articles 관리 페이지에서 검토 후 published로 전환.
 *
 * 보안: Vercel cron secret 검증 (CRON_SECRET 환경변수).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const {
  listRecentMedia,
  generateArticleFromPost,
  buildArticleRow,
} = require('../_lib/instagramImport');

function _normalizeMediaForGenerator(m){
  // listRecentMedia가 반환한 raw Graph API row를
  // generateArticleFromPost가 기대하는 shape로 변환.
  const mediaUrls = [];
  if (m.media_type === 'CAROUSEL_ALBUM' && m.children && Array.isArray(m.children.data)){
    m.children.data.forEach((c) => { if (c.media_url) mediaUrls.push(c.media_url); });
  } else if (m.media_url){
    mediaUrls.push(m.media_url);
  } else if (m.thumbnail_url){
    mediaUrls.push(m.thumbnail_url);
  }
  return {
    id: m.id,
    caption: m.caption || '',
    mediaUrls: mediaUrls,
    permalink: m.permalink || null,
    timestamp: m.timestamp || null,
    author: m.username || 'pap_magazine',
  };
}

module.exports = async function handler(req, res){
  // Vercel cron 보호 — CRON_SECRET이 Vercel에 설정되어 있으면 검증.
  if (process.env.CRON_SECRET){
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + process.env.CRON_SECRET){
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID){
    return res.status(503).json({
      error: 'Instagram 환경변수 미설정 (IG_ACCESS_TOKEN / IG_USER_ID).',
    });
  }

  try {
    // 1) 최근 25개 가져오기.
    const media = await listRecentMedia({ limit: 25 });
    if (!media.length) return res.status(200).json({ imported: 0, message: '게시물 없음.' });

    // 2) 이미 import된 게시물 ID들 조회 (중복 방지).
    const allIds = media.map((m) => m.id).filter(Boolean);
    const { data: existing } = await supabaseAdmin
      .from('articles')
      .select('source_instagram_post_id')
      .in('source_instagram_post_id', allIds);
    const existingSet = new Set((existing || []).map((r) => r.source_instagram_post_id));

    // 3) 신규 게시물만 import.
    const newOnes = media.filter((m) => !existingSet.has(m.id));
    const results = { imported: 0, skipped: existingSet.size, failed: 0, errors: [] };
    for (let i = 0; i < newOnes.length; i++){
      const m = newOnes[i];
      try {
        const post = _normalizeMediaForGenerator(m);
        const generated = await generateArticleFromPost(post);
        const row = buildArticleRow(post, generated, { status: 'draft' });
        const { error: insErr } = await supabaseAdmin.from('articles').insert(row);
        if (insErr){
          // unique index 충돌은 race condition (동시 cron 실행) — skip 처리.
          if (insErr.code === '23505'){
            results.skipped++;
            continue;
          }
          throw insErr;
        }
        results.imported++;
      } catch (e){
        results.failed++;
        results.errors.push({ post_id: m.id, error: (e && e.message) || String(e) });
        console.error('[sync-instagram] post ' + m.id + ' failed:', e);
      }
    }

    return res.status(200).json(results);
  } catch (e){
    console.error('[sync-instagram] top-level failure:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
