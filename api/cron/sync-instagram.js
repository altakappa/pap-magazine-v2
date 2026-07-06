/**
 * GET /api/cron/sync-instagram — 2시간마다 실행되는 자동 동기화.
 *
 * QA #275 + 2026-07 확장. @pap_magazine 최근 25개 게시물 fetch →
 * "에디토리얼이 아닌" 신규 게시물만 Claude로 기사 생성 → articles 에
 * published 상태로 INSERT (운영자 결정: 자동 공개).
 *
 * 에디토리얼 제외 3겹 (에디토리얼은 운영자가 웹사이트에 사전 업로드하므로
 * 중복 수집 금지):
 *   ① DB 매칭   — editorials.source_instagram_url 의 shortcode 와 일치
 *   ② 휴리스틱  — 캡션의 크레딧 역할 라인·/editorial/ 링크 (isLikelyEditorialCaption)
 *   ③ AI 분류   — Claude 가 category='Editorial' 로 판정 시 스킵
 *
 * 수동 진단: 관리자 토큰으로 GET ?dry=1 → 분류 결과만 반환 (INSERT·AI 호출 없음).
 * 보안: Vercel cron secret 또는 관리자 토큰.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const {
  listRecentMedia,
  generateArticleFromPost,
  buildArticleRow,
  isLikelyEditorialCaption,
  normalizeMedia,
  _extractShortcode,
} = require('../_lib/instagramImport');

module.exports = async function handler(req, res){
  // Vercel cron 보호 — CRON_SECRET 일치 또는 관리자 토큰 (수동 진단·트리거용).
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk){
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID){
    return res.status(503).json({
      error: 'Instagram 환경변수 미설정 (IG_ACCESS_TOKEN / IG_USER_ID).',
    });
  }

  const dry = !!(req.query && req.query.dry === '1');

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

    // 3) 에디토리얼 shortcode 집합 (①번 필터) — 백필된 source_instagram_url 기반.
    const { data: eds } = await supabaseAdmin
      .from('editorials')
      .select('source_instagram_url')
      .not('source_instagram_url', 'is', null)
      .limit(5000);
    const editorialShortcodes = new Set(
      (eds || [])
        .map((e) => _extractShortcode(e.source_instagram_url))
        .filter(Boolean)
    );

    // 4) 게시물 분류.
    const results = {
      imported: 0, skipped_existing: existingSet.size,
      skipped_editorial_db: 0, skipped_editorial_caption: 0, skipped_editorial_ai: 0,
      failed: 0, errors: [], dry: dry, classified: [],
    };
    for (const m of media){
      if (existingSet.has(m.id)) continue;
      const shortcode = _extractShortcode(m.permalink);
      let cls = 'article';
      if (shortcode && editorialShortcodes.has(shortcode)){
        cls = 'editorial(db)'; results.skipped_editorial_db++;
      } else if (isLikelyEditorialCaption(m.caption)){
        cls = 'editorial(caption)'; results.skipped_editorial_caption++;
      }
      if (dry){
        results.classified.push({
          id: m.id, permalink: m.permalink, class: cls,
          caption_head: String(m.caption || '').slice(0, 80),
        });
        continue;
      }
      if (cls !== 'article') continue;

      try {
        const post = normalizeMedia(m);
        const generated = await generateArticleFromPost(post);
        // ③ AI 분류: 크레딧 게시물로 판정되면 수집하지 않음.
        if (String(generated.category || '').toLowerCase() === 'editorial'){
          results.skipped_editorial_ai++;
          continue;
        }
        const row = buildArticleRow(post, generated, { status: 'published' });
        const { error: insErr } = await supabaseAdmin.from('articles').insert(row);
        if (insErr){
          // unique index 충돌은 race condition (동시 cron 실행) — skip 처리.
          if (insErr.code === '23505'){
            results.skipped_existing++;
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

    if (dry) results.editorial_shortcodes_known = editorialShortcodes.size;
    return res.status(200).json(results);
  } catch (e){
    console.error('[sync-instagram] top-level failure:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
