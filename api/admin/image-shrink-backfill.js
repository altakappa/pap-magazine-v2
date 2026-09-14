/**
 * GET /api/admin/image-shrink-backfill — 이미 올라간 큰 이미지를 줄인다 (관리자 전용)
 *
 * [왜] 2026-09-14 Supabase 전송량 초과로 사이트가 3시간 40분 멈췄다. 알림에는
 * exceed_egress_quota(DB 쪽)와 exceed_cached_egress_quota(Storage 쪽)가 같이 떴다.
 * DB 쪽은 embedding 열 제거로 고쳤고(12d2fff), 이건 Storage 쪽이다.
 *
 * 실측 2026-09-14 — media 버킷 48,904개 35GB 평균 758KB.
 * 1MB 넘는 이미지 5,487장이 12GB. Vercel 최다 경로는 /_vercel/image 하루 16,000회.
 * 독자가 받는 건 54KB 지만, 그 54KB 를 만들려고 Vercel 이 원본 758KB 를 매번 끌어간다.
 *
 * 신규 이미지는 3e71ee8 이 저장 전에 줄인다. 이 도구는 **이미 올라간 것**을 줄인다.
 *
 * ■ 절차 (파일 한 장마다)
 *   1) media/<경로> 를 media/originals/<경로> 로 **옮긴다** (Storage 내부 이동, 전송량 0)
 *   2) originals 쪽을 받아 긴 변 2000px 로 줄인다 (여기서만 전송량이 든다)
 *   3) 줄인 것을 **원래 경로에** 올린다 → URL 이 그대로다
 *   4) image_shrink_progress 에 기록한다
 *   안 줄어들면 originals 에서 원래 자리로 도로 옮기고 skipped 로 남긴다.
 *
 * ■ 지우지 않는다
 * 원본은 media/originals/ 에 그대로 남는다. 되돌리기는 ?revert= 한 줄이다.
 * **원본을 지우는 것은 도메니코가 직접 한다.** 이 도구는 아무것도 지우지 않는다.
 *
 * ■ 왜 URL 을 안 건드리나
 * 축소본을 새 경로에 만들면 articles·editorials·films·shorts·banners·creators·
 * cover_images·community_* 등 스무 개 넘는 열을 갈아끼워야 한다. 하나만 놓쳐도
 * 이미지가 깨진다. 같은 경로에 올리면 갈아끼울 것이 없다.
 *
 * ■ 왜 형식을 안 바꾸나
 * 경로가 그대로여야 하므로 확장자도 그대로여야 한다. PNG 는 PNG 로 재압축한다
 * (keepFormat). 크기 감소의 대부분은 형식 변환이 아니라 2000px 리사이즈에서 온다.
 *
 * ■ 언제 돌리나
 * 원본을 한 번 읽어야 하므로 전송량 12GB 를 쓴다 (250GB 의 4.8%).
 * 빌링 사이클은 매월 18일 시작이다. **사이클 초반에 돌리는 게 안전하다.**
 *
 *   ?scan=1                 대상 통계만 본다 (아무것도 바꾸지 않는다)
 *   ?run=1&limit=N          N장 처리 (기본 10, 최대 60). 시간 예산 안에서 멈춘다
 *   ?run=1&dry=1            받아서 줄여만 보고 올리지 않는다 (효과 측정용)
 *   ?revert=1&name=<경로>   원본을 제자리로 되돌린다
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { shrinkImageBuffer, shrinkNote } = require('../_lib/imageShrink');

const BUCKET = 'media';
const ORIGINALS_PREFIX = 'originals/';
const PROGRESS = 'image_shrink_progress';

/* 1MB 넘는 것만 손댄다. 이 아래는 줄여도 얼마 안 남는다. */
const MIN_BYTES = Number(process.env.IMAGE_SHRINK_MIN_BYTES || 1000000);
/* Vercel 함수 시간 한도를 넘기지 않도록. 한 번에 다 하지 않고 여러 번 부른다. */
const TIME_BUDGET_MS = Number(process.env.IMAGE_SHRINK_BUDGET_MS || 50000);
const MAX_PER_RUN = 60;

function isImageName(name) {
  return /\.(jpe?g|png)$/i.test(String(name || ''));
}

/* 남은 대상은 **DB 가 판별한다** (마이그레이션 157, 뷰 image_shrink_targets).
 *
 * 2026-09-14 백필 헛돌기 사고 — 종전에는 "크기 큰 순 상위 96장" 을 가져온 뒤
 * 코드가 진행 표로 걸러냈다. 그런데 PNG 는 형식을 유지하며 줄이면 20% 밖에
 * 안 줄어(2,003KB → 1,611KB) 처리 후에도 1MB 를 넘는다. media 버킷의 PNG 는
 * 8,212개 6.7GB 라 목록 위쪽을 점령했고, 걸러내면 빈 배열이 나왔다.
 * **165번 호출하는 동안 한 장도 처리하지 못했고 오류는 한 건도 없었다.**
 *
 * 뷰가 진행 표를 미리 빼주면 위쪽이 무엇으로 채워지든 항상 진짜 남은 것이 나온다. */
const TARGETS_VIEW = 'image_shrink_targets';

/* supabase-js 는 .from() 다음에 **반드시 .select() 가 먼저** 와야 한다.
   필터를 먼저 붙이면 "from(...).eq is not a function" 으로 실행 중에 죽는다.
   2026-09-14 에 실제로 그렇게 배포해 500 을 냈다. tests/supabase-query-shape.test.js 가 지킨다. */
function targetQuery(columns, selectOpts) {
  return supabaseAdmin
    .from(TARGETS_VIEW)
    .select(columns, selectOpts);
}

/* 대상 후보를 크기 큰 순으로 가져온다.
   뷰(157)가 originals/ 제외 · mp4 제외 · 1MB 초과 · 진행 표에 없는 것을 이미 골라 준다. */
async function pickTargets(limit) {
  /* 뷰가 이미 '진행 표에 없는 것' 만 준다. 코드가 또 거르지 않는다 —
     그게 헛돌기의 원인이었다. */
  const { data: rows, error } = await targetQuery('name, size_bytes, mimetype')
    .order('size_bytes', { ascending: false })
    .limit(limit);
  if (error) throw new Error(TARGETS_VIEW + ': ' + error.message);
  return (rows || []).filter(r => isImageName(r.name)).slice(0, limit);
}

async function record(row) {
  const { error } = await supabaseAdmin.from(PROGRESS).upsert(row, { onConflict: 'name' });
  if (error) console.warn('[image-shrink] 기록 실패:', error.message);
}

async function shrinkOne(target, opts) {
  opts = opts || {};
  const name = target.name;
  const origPath = ORIGINALS_PREFIX + name;
  const store = supabaseAdmin.storage.from(BUCKET);

  /* 1) 원본을 originals/ 로 피신 (Storage 내부 이동 — 전송량 0) */
  if (!opts.dry) {
    const mv = await store.move(name, origPath);
    if (mv.error) {
      await record({ name, size_from: target.size_bytes, status: 'failed', reason: 'move: ' + mv.error.message });
      return { name, ok: false, reason: 'move 실패: ' + mv.error.message };
    }
  }

  /* 2) 받아서 줄인다 (여기서만 전송량이 든다) */
  const from = opts.dry ? name : origPath;
  const dl = await store.download(from);
  if (dl.error || !dl.data) {
    if (!opts.dry) await store.move(origPath, name);   // 되돌린다
    await record({ name, size_from: target.size_bytes, status: 'failed', reason: 'download: ' + ((dl.error && dl.error.message) || 'no data') });
    return { name, ok: false, reason: 'download 실패' };
  }
  const buf = Buffer.from(await dl.data.arrayBuffer());
  const ct = target.mimetype || (/\.png$/i.test(name) ? 'image/png' : 'image/jpeg');

  const sh = await shrinkImageBuffer(buf, ct, { keepFormat: true });

  if (!sh.shrunk) {
    /* 안 줄어들면 제자리로 되돌리고 '건너뜀' 으로 남긴다 — 다음 회차에 또 안 집도록 */
    if (!opts.dry) {
      const back = await store.move(origPath, name);
      if (back.error) return { name, ok: false, reason: '되돌리기 실패: ' + back.error.message };
    }
    await record({ name, size_from: buf.length, size_to: buf.length, status: 'skipped', reason: sh.reason });
    return { name, ok: true, skipped: true, note: shrinkNote(sh) };
  }

  if (opts.dry) {
    return { name, ok: true, dry: true, from: sh.from, to: sh.to, note: shrinkNote(sh) };
  }

  /* 3) 줄인 것을 원래 경로에 올린다 — URL 이 그대로다 */
  const up = await store.upload(name, sh.buf, { contentType: sh.contentType, upsert: true });
  if (up.error) {
    await store.move(origPath, name);                  // 원본을 제자리로
    await record({ name, size_from: sh.from, status: 'failed', reason: 'upload: ' + up.error.message });
    return { name, ok: false, reason: 'upload 실패: ' + up.error.message };
  }

  await record({
    name, size_from: sh.from, size_to: sh.to,
    original_path: origPath, status: 'done', reason: sh.reason,
  });
  return { name, ok: true, from: sh.from, to: sh.to, note: shrinkNote(sh) };
}

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const q = req.query || {};

  try {
    /* ── 통계만 ─────────────────────────────────────────── */
    if (q.scan) {
      /* 개수는 count 로 정확히 센다. select 로 세면 PostgREST 행 상한(5,000)에
         걸려 "5000" 이라는 거짓 숫자가 나온다 — 2026-09-14 실제로 그랬다. */
      const { count: total } = await targetQuery('name', { count: 'exact', head: true });

      /* 용량은 합계 함수가 없어 페이지로 나눠 더한다. 1,000행씩, 최대 30페이지. */
      let bytes = 0, counted = 0, capped = false;
      for (let page = 0; page < 30; page++) {
        const from = page * 1000;
        const { data: chunk, error: e2 } = await targetQuery('size_bytes')
          .order('size_bytes', { ascending: false }).range(from, from + 999);
        if (e2) break;
        if (!chunk || !chunk.length) break;
        for (const r of chunk) bytes += Number(r.size_bytes) || 0;
        counted += chunk.length;
        if (chunk.length < 1000) break;
        if (page === 29) capped = true;
      }

      const { count: doneCount } = await supabaseAdmin
        .from(PROGRESS).select('name', { count: 'exact', head: true }).eq('status', 'done');
      let saved = 0;
      for (let page = 0; page < 30; page++) {
        const from = page * 1000;
        const { data: chunk } = await supabaseAdmin
          .from(PROGRESS).select('size_from, size_to').eq('status', 'done').range(from, from + 999);
        if (!chunk || !chunk.length) break;
        for (const r of chunk) saved += (Number(r.size_from) || 0) - (Number(r.size_to) || 0);
        if (chunk.length < 1000) break;
      }

      return res.status(200).json({
        ok: true,
        기준: Math.round(MIN_BYTES / 1024) + 'KB 초과 이미지 (jpg·png, mp4 제외, 이미 한 것 뺀 수)',
        남은_후보: total || 0,
        남은_용량_MB: Math.round(bytes / 1048576),
        용량_집계한_장수: counted,
        용량이_일부만_집계됨: capped || undefined,
        처리완료: doneCount || 0,
        절감_MB: Math.round(saved / 1048576),
      });
    }

    /* ── 되돌리기 ───────────────────────────────────────── */
    if (q.revert) {
      const name = String(q.name || '');
      if (!name) return res.status(400).json({ error: 'name 이 필요하다' });
      const store = supabaseAdmin.storage.from(BUCKET);
      const mv = await store.move(ORIGINALS_PREFIX + name, name);
      if (mv.error) return res.status(500).json({ error: '되돌리기 실패: ' + mv.error.message });
      await record({ name, status: 'reverted', reason: '사람이 되돌림' });
      return res.status(200).json({ ok: true, reverted: name });
    }

    /* ── 실행 ───────────────────────────────────────────── */
    if (q.run) {
      const limit = Math.min(Math.max(parseInt(q.limit, 10) || 10, 1), MAX_PER_RUN);
      const dry = !!q.dry;
      const started = Date.now();
      const targets = await pickTargets(limit);
      const results = [];
      let savedBytes = 0;

      for (const t of targets) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        const r = await shrinkOne(t, { dry });
        results.push(r);
        if (r.ok && !r.skipped && r.from && r.to) savedBytes += (r.from - r.to);
      }

      return res.status(200).json({
        ok: true, dry,
        처리: results.length,
        절감_MB: Math.round(savedBytes / 1048576),
        걸린_초: Math.round((Date.now() - started) / 1000),
        결과: results,
      });
    }

    return res.status(400).json({
      error: '무엇을 할지 정해야 한다',
      사용법: ['?scan=1', '?run=1&limit=10', '?run=1&limit=5&dry=1', '?revert=1&name=<경로>'],
    });
  } catch (e) {
    console.error('[image-shrink-backfill]', e);
    return res.status(500).json({ error: (e && e.message) || 'unknown' });
  }
};

module.exports.shrinkOne = shrinkOne;
module.exports.pickTargets = pickTargets;
module.exports.MIN_BYTES = MIN_BYTES;
