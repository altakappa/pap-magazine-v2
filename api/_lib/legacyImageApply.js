/**
 * 레거시 화보 이미지 회수 — 적용 로직 (2026-07-31).
 *
 * 스캔(admin/legacy-image-scan)이 matched 로 판정한 화보에 IG 원본을 붙인다.
 *
 * 왜 _lib 로 뽑았나:
 *   진입점이 둘이다 — 관리자 수동(api/admin/legacy-image-apply)과
 *   크론(api/cron/legacy-image-recover). 복붙하면 한쪽만 고쳐지는 사고가 난다.
 *   번역 백필(_lib/seoTranslateBackfill.js)에서 쓰는 것과 같은 규약이다.
 *   **진입점은 둘, 로직은 하나.**
 *
 * 배경: 2019-02~2023-01 발행 373편의 cover_image 가 실제 사진이 아니라
 * `data:image/svg+xml,...` 플레이스홀더였다. 계정 미디어 4,114개를 전량 훑어
 * 161편이 매칭됐고, 원본을 못 찾은 202편은 같은 날 비공개로 내렸다.
 *
 * 안전 설계:
 *  - matched 만 건드린다. ambiguous(10편)는 사람이 볼 때까지 손대지 않는다 —
 *    잘못 붙이면 남의 사진이 남의 화보에 실리고 되돌리기 어렵다.
 *  - **IG CDN URL 을 그대로 저장하지 않는다.** 수일 내 만료되므로 저장하면
 *    며칠 뒤 다시 깨진 화보가 된다(같은 실수를 두 번 하는 셈).
 *    Supabase Storage 로 복사한 뒤 그 공개 URL 을 쓴다.
 *  - 이미지를 한 장도 못 받으면 그 화보는 건너뛴다. 플레이스홀더를 빈 값으로
 *    바꾸면 더 나빠진다.
 *  - 적용된 행은 계획표에 applied 로 남긴다(무엇을·언제 바꿨는지의 근거).
 */
'use strict';

const { supabaseAdmin } = require('./supabase');
const { fetchMediaById, archiveImagesToStorage } = require('./instagramImport');

const MAX_IMAGES = 12;      // 화보 1편당 보관할 최대 장수
const DEFAULT_BUDGET_MS = 70000;

/**
 * @param {object}  o
 * @param {number} [o.limit=8]      이번 호출에서 처리할 화보 수 (1~20)
 * @param {boolean}[o.dry]          무엇을 바꿀지만 보고, 쓰지 않는다
 * @param {number} [o.budgetMs]     시간 예산
 * @returns {Promise<{ok,applied,skipped,remaining,results,elapsedMs,done}>}
 * @throws  {Error} err.statusCode 가 있으면 호출자가 그 코드로 응답한다.
 */
async function applyLegacyImages(o) {
  const opts = o || {};
  const started = Date.now();
  const budgetMs = Number(opts.budgetMs) || DEFAULT_BUDGET_MS;
  const dry = !!opts.dry;
  const limit = Math.max(1, Math.min(20, parseInt(opts.limit, 10) || 8));

  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    const e = new Error('IG_ACCESS_TOKEN/IG_USER_ID 환경변수 미설정.');
    e.statusCode = 503;
    throw e;
  }

  const { data: plan, error } = await supabaseAdmin
    .from('legacy_image_recovery')
    .select('id, editorial_id, title, ig_media_id, ig_permalink, handles')
    .eq('status', 'matched')
    .limit(limit);
  if (error) { const e = new Error('plan 조회 실패'); e.statusCode = 500; e.code = 'plan_query'; throw e; }

  if (!plan || !plan.length) {
    return {
      ok: true, done: true, applied: 0, skipped: 0, remaining: 0,
      results: [], elapsedMs: Date.now() - started, message: 'matched 잔여 없음',
    };
  }

  const results = [];
  let applied = 0, skipped = 0;

  for (const p of plan) {
    if (Date.now() - started > budgetMs) break;
    try {
      // 캐러셀이면 자식 미디어까지 펼쳐 전부 받는다(한 장짜리로 복구되면 화보가 아니다).
      const post = await fetchMediaById(p.ig_media_id);
      const urls = await archiveImagesToStorage(post, MAX_IMAGES, 'legacy-recovery');

      if (!urls.length) {
        skipped++;
        results.push({ title: p.title, skipped: '이미지 0장 — 플레이스홀더 유지' });
        if (!dry) {
          await supabaseAdmin.from('legacy_image_recovery')
            .update({ note: '적용 시도했으나 이미지 0장 (' + new Date().toISOString().slice(0, 10) + ')' })
            .eq('id', p.id);
        }
        continue;
      }

      const patch = {
        cover_image: urls[0],
        gallery: urls,
        // 저장된 URL 이 실제 게시물과 어긋나 있었다(2024년 shortcode 가 2022년 화보에).
        // 매칭으로 확인된 permalink 로 교정한다.
        source_instagram_url: p.ig_permalink || null,
      };

      if (dry) {
        results.push({ title: p.title, would_set: { images: urls.length, cover: urls[0].slice(0, 80) } });
        continue;
      }

      const { error: upErr } = await supabaseAdmin
        .from('editorials').update(patch).eq('id', p.editorial_id);
      if (upErr) { skipped++; results.push({ title: p.title, error: upErr.message.slice(0, 120) }); continue; }

      await supabaseAdmin.from('legacy_image_recovery')
        .update({ status: 'applied', applied_at: new Date().toISOString() }).eq('id', p.id);

      applied++;
      results.push({ title: p.title, images: urls.length, permalink: p.ig_permalink });
    } catch (e) {
      skipped++;
      const msg = String((e && e.message) || e).slice(0, 150);
      console.error('[legacy-image-apply]', p.title, msg);
      results.push({ title: p.title, error: msg });
    }
  }

  const { count: left } = await supabaseAdmin
    .from('legacy_image_recovery').select('*', { count: 'exact', head: true }).eq('status', 'matched');
  const remaining = typeof left === 'number' ? left : null;

  return {
    ok: true, dry, applied, skipped, remaining,
    done: remaining === 0,
    elapsedMs: Date.now() - started,
    results,
  };
}

module.exports = { applyLegacyImages, MAX_IMAGES };
