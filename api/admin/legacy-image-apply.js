/**
 * GET /api/admin/legacy-image-apply   (관리자 또는 CRON_SECRET)
 *
 * 스캔(legacy-image-scan)이 matched 로 판정한 레거시 화보에 IG 원본 이미지를
 * 실제로 붙인다. 2026-07-31 도메니코 승인 — "나머지는 전부 적용".
 *
 * 배경: 2019~2023 발행 373편의 이미지가 `data:image/svg+xml,...` 플레이스홀더였다.
 * 스캔 결과 161편이 현재 계정 미디어와 정확히 매칭됐고(4,114개 전량 훑음),
 * 원본을 못 찾은 202편은 같은 날 비공개(draft)로 내렸다.
 *
 * 안전 설계:
 *  - matched 만 건드린다. ambiguous(10편)는 사람이 볼 때까지 손대지 않는다 —
 *    잘못 붙이면 남의 사진이 남의 화보에 실리고 되돌리기 어렵다.
 *  - **IG CDN URL 을 그대로 저장하지 않는다.** 그 URL 은 수일 내 만료되므로
 *    저장하면 며칠 뒤 다시 깨진 화보가 된다(같은 실수를 두 번 하는 셈).
 *    Supabase Storage 로 복사한 뒤 그 공개 URL 을 쓴다.
 *  - 이미지를 한 장도 못 받으면 그 화보는 건너뛴다. 플레이스홀더를 빈 값으로
 *    바꾸면 더 나빠진다.
 *  - 적용된 행은 계획표에 applied 로 남긴다(무엇을·언제 바꿨는지의 근거).
 *  - 시간 예산 안에서 나눠 처리한다. 반복 호출하면 이어서 진행한다.
 *
 * 사용법:
 *   GET ?limit=8          — 이번 호출에서 처리할 화보 수 (기본 8)
 *   GET ?dry=1            — 무엇을 바꿀지만 보고, 쓰지 않는다
 */
'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { fetchMediaById, archiveImagesToStorage } = require('../_lib/instagramImport');

const BUDGET_MS = 70000;
const MAX_IMAGES = 12;   // 화보 1편당 보관할 최대 장수

module.exports = async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    return res.status(503).json({ error: 'IG env 미설정' });
  }

  const started = Date.now();
  const dry = !!(req.query && req.query.dry === '1');
  const limit = Math.max(1, Math.min(20, parseInt((req.query && req.query.limit) || '8', 10) || 8));

  const { data: plan, error } = await supabaseAdmin
    .from('legacy_image_recovery')
    .select('id, editorial_id, title, ig_media_id, ig_permalink, handles')
    .eq('status', 'matched')
    .limit(limit);
  if (error) return res.status(500).json({ error: 'plan 조회 실패', code: 'plan_query' });
  if (!plan || !plan.length) {
    return res.status(200).json({ ok: true, done: true, applied: 0, message: 'matched 잔여 없음' });
  }

  const results = [];
  let applied = 0, skipped = 0;

  for (const p of plan) {
    if (Date.now() - started > BUDGET_MS) break;
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

  return res.status(200).json({
    ok: true, dry, applied, skipped,
    remaining_matched: typeof left === 'number' ? (dry ? left : left) : null,
    elapsedMs: Date.now() - started,
    results,
    hint: '같은 URL 을 반복 호출하면 잔여분을 이어서 처리합니다.',
  });
};
