/**
 * PAP Magazine — Pinterest 에디토리얼 자동 발행 크론
 * Route: /api/cron/sync-pinterest  (vercel.json crons 에 등록)
 *
 * editorials 아카이브(약 3000개)를 Pinterest "EDITORIAL" 보드로
 * 페이스 조절하며 소급 발행하고, 새 에디토리얼도 자동 발행한다.
 *
 * 안전 설계:
 *   - 매 실행 배치 크기 제한(PINTEREST_SYNC_BATCH, 기본 12) → 신규
 *     계정이 한 번에 대량 핀을 쏟아 스팸 정지되는 것 방지.
 *   - pinterest_synced_at 로 처리 여부 추적 → 중복 발행 없음.
 *   - 이미지 없는/깨진 항목은 pinterest_error 로 표시하고 스킵.
 *   - Pinterest 429(rate limit) 만나면 즉시 배치 중단, 다음 실행에 재개.
 *   - 최신 에디토리얼 우선(published_date DESC) → 새 콘텐츠부터 노출.
 *
 * 필요 환경변수 (Vercel):
 *   PINTEREST_ACCESS_TOKEN  : v5 API 액세스 토큰 (scope: pins:write, boards:read)
 *   PINTEREST_BOARD_ID      : "EDITORIAL" 보드 ID
 *   CRON_SECRET             : (선택) Vercel cron 보호
 *   PINTEREST_SYNC_BATCH    : (선택) 실행당 발행 수, 기본 12
 */

const { supabaseAdmin } = require('../_lib/supabase');

const SITE = 'https://www.pap-magazine.com';
const PIN_API = 'https://api.pinterest.com/v5/pins';

function truncate(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = async function handler(req, res) {
  // Vercel cron 보호
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const TOKEN = process.env.PINTEREST_ACCESS_TOKEN;
  const BOARD_ID = process.env.PINTEREST_BOARD_ID;
  if (!TOKEN || !BOARD_ID) {
    return res.status(503).json({
      error: 'Pinterest 환경변수 미설정 (PINTEREST_ACCESS_TOKEN / PINTEREST_BOARD_ID).',
    });
  }

  // 안전 램프 (봇 판정 방지) — 신규 계정은 천천히, 성숙할수록 빠르게.
  // 크론은 하루 4회 실행되므로 run당 배치 × 4 ≈ 하루 발행량.
  // 이미 발행된 핀 수(pinnedCount)를 계정 성숙도 근사치로 사용.
  //   ~50개 미만  : 3/run  ≈ 12/일  (1주차 워밍업)
  //   ~200개 미만 : 5/run  ≈ 20/일
  //   ~600개 미만 : 8/run  ≈ 32/일
  //   ~1500개 미만: 12/run ≈ 48/일
  //   그 이상      : 16/run ≈ 64/일 (계정 안정화 후 최대 속도)
  // PINTEREST_SYNC_BATCH 를 세팅하면 램프 대신 수동 고정.
  function rampBatch(n) {
    if (n < 50) return 3;
    if (n < 200) return 5;
    if (n < 600) return 8;
    if (n < 1500) return 12;
    return 16;
  }

  try {
    const { count: pinnedCount } = await supabaseAdmin
      .from('editorials').select('id', { count: 'exact', head: true })
      .not('pinterest_pin_id', 'is', null);
    const BATCH = process.env.PINTEREST_SYNC_BATCH
      ? Math.max(1, Math.min(50, parseInt(process.env.PINTEREST_SYNC_BATCH, 10)))
      : rampBatch(pinnedCount || 0);

    // 미처리 에디토리얼 (최신 우선)
    const { data: eds, error } = await supabaseAdmin
      .from('editorials')
      .select('id, title, title_en, slug, description, description_en, cover_image, og_image, thumbnail, issue')
      .eq('status', 'published')
      .is('pinterest_synced_at', null)
      .not('published_date', 'is', null)
      .lte('published_date', new Date().toISOString())
      .order('published_date', { ascending: false })
      .limit(BATCH);

    if (error) throw error;
    if (!eds || !eds.length) {
      return res.status(200).json({ done: true, pinned: 0, message: '미처리 에디토리얼 없음 (전체 발행 완료).' });
    }

    let pinned = 0, skipped = 0, rateLimited = false;

    for (const e of eds) {
      const handle = e.slug || e.id;
      const img = e.cover_image || e.og_image || e.thumbnail || '';

      // 이미지 없으면 영구 스킵
      if (!img || !handle || !e.title) {
        await supabaseAdmin.from('editorials')
          .update({ pinterest_synced_at: new Date().toISOString(), pinterest_error: 'no image/handle' })
          .eq('id', e.id);
        skipped++;
        continue;
      }

      const link = SITE + '/editorial/' + encodeURIComponent(handle);
      const kw = e.title + ' — PAP Magazine editorial'
        + (e.issue ? ' · ' + e.issue : '');
      const baseDesc = String(e.description || e.description_en || '').replace(/<[^>]*>/g, ' ');
      const description = truncate(baseDesc ? (kw + '. ' + baseDesc) : kw, 480);

      const body = {
        board_id: BOARD_ID,
        title: truncate(e.title, 95),
        description,
        link,
        media_source: { source_type: 'image_url', url: img },
      };

      let resp;
      try {
        resp = await fetch(PIN_API, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (netErr) {
        // 네트워크 오류 — 이번 항목만 남겨두고 계속 (synced_at 미기록 → 다음에 재시도)
        console.error('[sync-pinterest] network error:', netErr.message);
        continue;
      }

      if (resp.status === 429) {
        // rate limit — 즉시 중단, 다음 크론 실행에 재개
        rateLimited = true;
        break;
      }

      if (resp.ok) {
        const j = await resp.json().catch(() => ({}));
        await supabaseAdmin.from('editorials')
          .update({ pinterest_pin_id: j.id || 'ok', pinterest_synced_at: new Date().toISOString(), pinterest_error: null })
          .eq('id', e.id);
        pinned++;
      } else {
        // 4xx (이미지 거부·잘못된 링크 등) → 영구 스킵으로 표시
        const txt = await resp.text().catch(() => '');
        await supabaseAdmin.from('editorials')
          .update({ pinterest_synced_at: new Date().toISOString(), pinterest_error: resp.status + ': ' + truncate(txt, 200) })
          .eq('id', e.id);
        skipped++;
      }
    }

    // 남은 개수 카운트 (참고용)
    const { count: remaining } = await supabaseAdmin
      .from('editorials')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .is('pinterest_synced_at', null);

    return res.status(200).json({ pinned, skipped, rateLimited, remaining: remaining ?? null });
  } catch (err) {
    console.error('[sync-pinterest] error:', err);
    return res.status(500).json({ error: 'sync failed', detail: String(err && err.message || err) });
  }
};
