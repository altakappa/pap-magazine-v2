/**
 * GET /api/cron/sync-pepperit — 페퍼릿(@pepperitmag) 기사 자동 수집.
 * (vercel.json: 20분마다 4·24·44분 — 2026-10-08 메타 앱 호출 한도 회피로 10분→20분)
 *
 * business_discovery(공개 조회) → 신규 게시물만 Claude 페퍼릿 톤 기사 생성 →
 * 이미지 Storage 영구 복사(ig-pepperit/) → pepperit_articles 에 published 삽입 →
 * pepperitmag.com IndexNow 즉시 핑.
 *
 * 수동: 관리자 토큰 GET (?dry=1 진단 / ?backfill=일수&max=상한 백필).
 */

const { bearerOk } = require('../_lib/secretCompare');
const { withCronGuard } = require('../_lib/cronGuard');   // 실행기록·실패알림 (2026-07-30)
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { archiveImagesToStorage, archiveVideosToStorage } = require('../_lib/instagramImport');
const { listPepperitMedia, normalizePepperitMedia, generatePepperitArticle } = require('../_lib/pepperitImport');
const { submitIndexNowPepperit, pingWebSub, PEPPERIT_SITE } = require('../_lib/pingSearch');
const { postPepperitTweet, buildPepperitTweet, isPepperitConfigured } = require('../_lib/xPost');

/** 메타 레이트리밋(code 4·17·32·613 / 'request limit reached') 인가. 판단 안 서면 false. */
function isMetaRateLimit(msg) {
  const t = String(msg == null ? '' : msg);
  return /"code"\s*:\s*(4|17|32|613)\b/.test(t) || /application request limit reached/i.test(t);
}

module.exports = withCronGuard('sync-pepperit', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const dry = !!(req.query && req.query.dry === '1');
  const backfillDays = parseInt((req.query && req.query.backfill) || '0', 10) || 0;
  const perCall = Math.max(1, Math.min(10, parseInt((req.query && req.query.max) || '5', 10) || 5));

  try {
    const media = backfillDays > 0
      ? await listPepperitMedia({ sinceDays: backfillDays, maxCount: 200 })
      : await listPepperitMedia({ maxCount: 12 });
    if (!media.length) return res.status(200).json({ imported: 0, message: '게시물 없음.' });

    const allIds = media.map((m) => m.id).filter(Boolean);
    const { data: existing } = await supabaseAdmin
      .from('pepperit_articles')
      .select('source_instagram_post_id')
      .in('source_instagram_post_id', allIds);
    const existingSet = new Set((existing || []).map((r) => r.source_instagram_post_id));

    const results = { imported: 0, skipped_existing: existingSet.size, failed: 0, errors: [], dry, classified: [] };
    const newUrls = [];

    for (const m of media) {
      if (existingSet.has(m.id)) continue;
      if (dry) {
        results.classified.push({ id: m.id, permalink: m.permalink, caption_head: String(m.caption || '').slice(0, 80) });
        continue;
      }
      if (backfillDays > 0 && (results.imported + results.failed) >= perCall) {
        results.remaining = (results.remaining || 0) + 1;
        continue;
      }
      try {
        const post = normalizePepperitMedia(m);
        const generated = await generatePepperitArticle(post);
        const archived = await archiveImagesToStorage(post, 10, 'ig-pepperit');
        const imgs = archived.length ? archived : post.mediaUrls;
        const videoUrls = await archiveVideosToStorage(post, 2, 'ig-pepperit');
        const row = {
          title: generated.title || ('PEPPERIT ' + m.id),
          slug: generated.slug,
          category: generated.category,
          content: generated.body,
          tags: generated.tags,
          thumbnail_url: imgs[0] || null,
          gallery: imgs,
          videos: videoUrls,
          status: 'published',
          published_date: post.timestamp || new Date().toISOString(),
          source_instagram_url: post.permalink,
          source_instagram_post_id: post.id,
        };
        const { data: inserted, error: insErr } = await supabaseAdmin
          .from('pepperit_articles').insert(row).select('id, slug').single();
        if (insErr) {
          if (insErr.code === '23505') { results.skipped_existing++; continue; }
          throw insErr;
        }
        results.imported++;
        if (inserted && (inserted.slug || inserted.id)) {
          const artUrl = PEPPERIT_SITE + '/article/' + encodeURIComponent(inserted.slug || inserted.id);
          newUrls.push(artUrl);
          // X 자동 게시 — @pepperitmag (키 미설정 시 조용히 스킵).
          // 아이돌·그룹명 해시태그 중심 → X 검색 유입.
          if (isPepperitConfigured()) {
            try {
              const tw = await postPepperitTweet(buildPepperitTweet({ title: row.title, url: artUrl, tags: generated.tags }));
              results.tweets = (results.tweets || []).concat(tw.ok ? [tw.id] : ['실패:' + (tw.detail || tw.status)]);
            } catch (_) {}
          }
        }
      } catch (e) {
        results.failed++;
        results.errors.push({ post_id: m.id, error: (e && e.message) || String(e) });
        console.error('[sync-pepperit] post ' + m.id + ' failed:', e);
      }
    }

    // 신규 발행 즉시 검색엔진 알림 (pepperitmag.com 호스트로)
    if (newUrls.length) {
      try {
        results.search_ping = { indexnow: await submitIndexNowPepperit(newUrls) };
        try { results.search_ping.websub = await pingWebSub(); } catch (_) {}
      } catch (e) { results.search_ping = { error: String(e && e.message || e).slice(0, 100) }; }
    }
    return res.status(200).json(results);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    /* 2026-10-08: 메타 '앱 호출 한도'(code 4 등) 는 우리 코드 고장이 아니라 앱 전체가 공유하는
       시간당 한도다. 하루 156회 중 79회(50%)가 이걸로 '실패' 로 찍혀 진짜 실패를 묻고 있었다.
       즉시 재시도는 한도를 더 태우므로 이번 회차만 접고 다음 회차에 맡긴다.
       ok=true 로 바꾸되 note 는 '⚠️ 한도초과' 로 시작한다 — 조용히 죽은 것처럼 보이지 않게
       아침 점검이 이 표식을 센다. 한도 말고 다른 오류는 그대로 500. */
    if (isMetaRateLimit(msg)) {
      console.warn('[sync-pepperit] 메타 앱 호출 한도 초과 — 이번 회차 건너뜀:', msg.slice(0, 160));
      return res.status(200).json({
        imported: 0,
        rate_limited: true,
        note: '⚠️ 한도초과 · 메타 앱 호출 한도(#4) — 이번 회차 건너뜀, 다음 회차 재시도',
      });
    }
    console.error('[sync-pepperit] top-level failure:', e);
    return res.status(500).json({ error: msg });
  }
}, { silenceTransient: true });

module.exports.isMetaRateLimit = isMetaRateLimit;
