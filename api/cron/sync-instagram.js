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
const { pingNewContent, SITE } = require('../_lib/pingSearch');
const { postTweet, buildArticleTweet, isConfigured: xConfigured } = require('../_lib/xPost');
const {
  listRecentMedia,
  listMediaPaged,
  generateArticleFromPost,
  buildArticleRow,
  archiveImagesToStorage,
  archiveVideosToStorage,
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
  // 백필 모드: ?backfill=<일수>&max=<회당 처리 상한, 기본 5>
  // Vercel 함수 120초 제한 내에서 (AI 생성 + 이미지 아카이브) 처리 가능한
  // 만큼만 하고 remaining 을 반환 — 반복 호출로 기간 전체를 채운다.
  const backfillDays = parseInt((req.query && req.query.backfill) || '0', 10) || 0;
  const perCall = Math.max(1, Math.min(10, parseInt((req.query && req.query.max) || '5', 10) || 5));

  try {
    // 1) 게시물 가져오기 — 기본: 최근 25개 / 백필: 기간 내 전체 (페이지네이션)
    const media = backfillDays > 0
      ? await listMediaPaged({ sinceDays: backfillDays, maxCount: 200 })
      : await listRecentMedia({ limit: 25 });
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
    const newUrls = []; // 이번 실행에서 발행된 기사 URL — 종료 시 즉시 검색 핑
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

      // 백필: 회당 처리 상한 도달 시 나머지는 다음 호출로 (타임아웃 방지)
      if (backfillDays > 0 && (results.imported + results.failed + results.skipped_editorial_ai) >= perCall){
        results.remaining = (results.remaining || 0) + 1;
        continue;
      }

      try {
        const post = normalizeMedia(m);
        const generated = await generateArticleFromPost(post);
        // ③ AI 분류: 크레딧 게시물로 판정되면 수집하지 않음.
        if (String(generated.category || '').toLowerCase() === 'editorial'){
          results.skipped_editorial_ai++;
          continue;
        }
        // IG CDN 이미지는 수일 내 만료 — Supabase Storage 영구본으로 교체
        // (웹사이트 썸네일·갤러리 + 틱톡 기사 게시 공용)
        const archivedUrls = await archiveImagesToStorage(post, 10);
        // 릴스/영상 게시물 — 영상 원본도 영구 보관해 기사에서 직접 재생
        const videoUrls = await archiveVideosToStorage(post, 2);
        const row = buildArticleRow(post, generated, { status: 'published', archivedUrls, videoUrls });
        const { data: inserted, error: insErr } = await supabaseAdmin.from('articles')
          .insert(row).select('id, custom_url, slug').single();
        if (insErr){
          // unique index 충돌은 race condition (동시 cron 실행) — skip 처리.
          if (insErr.code === '23505'){
            results.skipped_existing++;
            continue;
          }
          throw insErr;
        }
        results.imported++;
        if (inserted){
          const h = inserted.custom_url || inserted.slug || inserted.id;
          if (h){
            const artUrl = SITE + '/article/' + encodeURIComponent(h);
            newUrls.push(artUrl);
            // X 자동 게시 — 발행 즉시 트윗 (키 미설정 시 조용히 스킵).
            // 링크 카드가 SSR og/twitter 이미지로 자동 생성된다.
            if (xConfigured()){
              try {
                const tw = await postTweet(buildArticleTweet({ title: generated.title_ko || row.title, url: artUrl, tags: generated.tags }));
                results.tweets = (results.tweets || []).concat(tw.ok ? [tw.id] : ['실패:' + (tw.detail || tw.status)]);
              } catch (_) {}
            }
          }
        }
      } catch (e){
        results.failed++;
        results.errors.push({ post_id: m.id, error: (e && e.message) || String(e) });
        console.error('[sync-instagram] post ' + m.id + ' failed:', e);
      }
    }

    if (dry) results.editorial_shortcodes_known = editorialShortcodes.size;

    // 신규 발행 즉시 검색엔진 알림 — IndexNow(네이버·빙·얀덱스) + WebSub(구글
    // 계열 피드 재수집). 일간 IndexNow 크론은 보험으로 유지, 여기는 실시간 채널.
    if (newUrls.length){
      try { results.search_ping = await pingNewContent(newUrls); }
      catch (e){ results.search_ping = { error: String(e && e.message || e).slice(0, 100) }; }
    }
    return res.status(200).json(results);
  } catch (e){
    console.error('[sync-instagram] top-level failure:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
