/**
 * GET /api/admin/legacy-image-scan   (관리자 또는 CRON_SECRET)
 *
 * 레거시 화보 373편의 원본 이미지를 인스타그램에서 찾아 '계획표'에 기록한다.
 * ⚠️ 이 엔드포인트는 editorials 를 절대 수정하지 않는다 — 조사 전용이다.
 *
 * 배경 (2026-07-31 실측):
 *   2019-02 ~ 2023-01 발행 에디토리얼 373편의 cover_image 가 실제 사진이 아니라
 *   `data:image/svg+xml,...` 플레이스홀더다(갤러리도 전부 동일, 2장 이상은 0편).
 *   즉 초기 4년치 아카이브가 '사진 없는 화보' 로 서비스되고 있다. 서술문 백필로
 *   설명을 채우려 했지만 순서가 반대였다 — 사진이 없으면 설명도 의미가 없다.
 *
 * 왜 조사와 적용을 분리하나:
 *   잘못 매칭된 사진이 남의 화보에 붙으면 되돌리기 어렵다. 스캔은 계획표
 *   (legacy_image_recovery)에만 쓰고, 적용은 사람이 결과를 본 뒤 별도로 한다.
 *
 * 왜 저장된 URL 을 안 쓰나:
 *   source_instagram_url 이 실제 게시물과 어긋나 있다(실측: 'D' 로 시작하는
 *   2024년 이후 shortcode 가 2022년 화보에 붙어 있음). 캡션에는 제목이 그대로
 *   들어 있어 제목 매칭이 더 정확하다 — 판정 규칙은 _lib/legacyImageMatch.js.
 *
 * 사용법:
 *   GET ?pages=6            — 이번 호출에서 훑을 IG 페이지 수(50건/페이지, 기본 6)
 *   GET ?reset=1            — 커서를 처음으로 되돌린다
 *   GET ?report=1           — IG 호출 없이 계획표 집계만
 *
 * 커서는 ops_alert_state 에 저장해 여러 번 나눠 훑는다(계정 미디어 4,300여 개
 * → 한 번의 함수 실행으로는 못 끝낸다). 토큰은 커서에 남지 않는다(fetchMediaPage 주석).
 */
'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { fetchMediaPage } = require('../_lib/instagramImport');
const { matchOne, extractHandles } = require('../_lib/legacyImageMatch');

const CURSOR_KEY = 'legacy-image-scan-cursor';
const BUDGET_MS = 70000;   // 함수 상한 120s — 페이지당 최대 20s 이므로 여유를 크게 둔다

/** 플레이스홀더 이미지를 가진 발행 화보만 대상으로 한다. */
async function loadTargets() {
  const { data, error } = await supabaseAdmin
    .from('editorials')
    .select('id, title, published_date')
    .eq('status', 'published')
    .like('cover_image', 'data:image%')
    .limit(2000);
  if (error) throw error;
  return (data || []).filter(r => r.title);
}

async function readCursor() {
  const { data } = await supabaseAdmin.from('ops_alert_state')
    .select('last_payload').eq('key', CURSOR_KEY).maybeSingle();
  return (data && data.last_payload) || {};
}

async function writeCursor(payload) {
  await supabaseAdmin.from('ops_alert_state').upsert({
    key: CURSOR_KEY,
    last_alert_at: new Date().toISOString(),
    last_payload: payload,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
}

async function buildReport() {
  const { data } = await supabaseAdmin
    .from('legacy_image_recovery').select('status').limit(5000);
  const by = {};
  for (const r of (data || [])) by[r.status] = (by[r.status] || 0) + 1;
  return by;
}

module.exports = async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  res.setHeader('Cache-Control', 'no-store');

  if (req.query && req.query.report === '1') {
    return res.status(200).json({ ok: true, plan: await buildReport(), targets: (await loadTargets()).length });
  }
  if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID) {
    return res.status(503).json({ error: 'IG env 미설정' });
  }

  const started = Date.now();
  const maxPages = Math.max(1, Math.min(20, parseInt((req.query && req.query.pages) || '6', 10) || 6));

  const targets = await loadTargets();
  let state = (req.query && req.query.reset === '1') ? {} : await readCursor();
  let cursor = state.afterCursor || null;
  let scannedPages = 0;
  let scannedMedia = state.scannedMedia || 0;
  let newlyMatched = 0;
  let newlyAmbiguous = 0;
  const samples = [];

  /* 이미 매칭된 화보는 다시 안 본다 — 여러 번 나눠 훑으므로 중복 작업을 피한다. */
  const { data: donePlan } = await supabaseAdmin
    .from('legacy_image_recovery').select('editorial_id, status').limit(5000);
  const settled = new Set((donePlan || [])
    .filter(p => p.status === 'matched' || p.status === 'applied')
    .map(p => p.editorial_id));
  const pending = targets.filter(t => !settled.has(t.id));

  for (let i = 0; i < maxPages; i++) {
    if (Date.now() - started > BUDGET_MS) break;
    let page;
    try {
      page = await fetchMediaPage({ afterCursor: cursor });
    } catch (e) {
      console.error('[legacy-image-scan] media page 실패', e && e.message);
      break;
    }
    scannedPages++;
    scannedMedia += (page.rows || []).length;

    for (const t of pending) {
      if (settled.has(t.id)) continue;
      const m = matchOne(t, page.rows);
      if (m.status === 'none') continue;

      const row = {
        editorial_id: t.id,
        title: t.title,
        status: m.status,
        match_count: m.count,
        ig_media_id: m.media.id || null,
        ig_permalink: m.media.permalink || null,
        ig_timestamp: m.media.timestamp || null,
        caption: String(m.media.caption || '').slice(0, 2000),
        handles: extractHandles(m.media.caption),
        scanned_at: new Date().toISOString(),
      };
      const { error } = await supabaseAdmin
        .from('legacy_image_recovery').upsert(row, { onConflict: 'editorial_id' });
      if (error) { console.warn('[legacy-image-scan] 저장 실패', t.title, error.message); continue; }

      if (m.status === 'matched') { settled.add(t.id); newlyMatched++; }
      else newlyAmbiguous++;
      if (samples.length < 5) samples.push({ title: t.title, permalink: row.ig_permalink, status: m.status });
    }

    cursor = page.nextCursor;
    if (!cursor) break;   // 가장 오래된 게시물까지 도달
  }

  const done = !cursor;
  await writeCursor({ afterCursor: cursor, scannedMedia, finishedAt: done ? new Date().toISOString() : null });

  return res.status(200).json({
    ok: true,
    targets: targets.length,
    scannedPages, scannedMedia,
    newlyMatched, newlyAmbiguous,
    allMediaScanned: done,
    plan: await buildReport(),
    samples,
    elapsedMs: Date.now() - started,
    hint: done
      ? '계정 미디어를 전부 훑었습니다. ?report=1 로 최종 집계를 확인하세요.'
      : '같은 URL 을 반복 호출하면 다음 페이지부터 이어서 훑습니다.',
  });
};
