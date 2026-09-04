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

const { HTML_TAG_RE, dropKnownTags } = require('../_lib/stripHtml');
const { supabaseAdmin } = require('../_lib/supabase');
// 2026-08-07 — 가드 추가. 그전까지 이 크론은 cron_runs 에 아무 기록도
// 남기지 않아 '도는지 안 도는지 알 수 없는' 상태였다(7일 로그 0건).
// 실패해도 아무도 몰랐다는 뜻이다.
const { withCronGuard } = require('../_lib/cronGuard');

/* 2026-08-08 — 결과를 cron_runs note 에 남긴다.
   가드를 붙인 뒤 첫 실측: 실행은 ok(888ms)인데 발행 0 · 마킹 0 이었다.
   이 핸들러는 토큰 만료(401/403)를 만나면 200 으로 조용히 끝나서,
   로그만 봐서는 '돌았는데 왜 0인지' 알 수 없었다. 모든 종료 경로에
   사유를 적고, 토큰 문제는 503 으로 올려 알림이 가게 한다 —
   토큰 갱신은 사람만 할 수 있는 일이라 조용히 두면 영원히 0이다. */
function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

const { singleLinkDestination } = require('../_lib/igFirstLink');

const SITE = 'https://www.pap-magazine.com';
const PIN_API = 'https://api.pinterest.com/v5/pins';

function truncate(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = withCronGuard('sync-pinterest', async function handler(req, res) {
  // Vercel cron 보호
  /* 2026-09-04 보안감사 — CRON_SECRET 이 없으면 검사를 건너뛰던 fail-open 이었다.
     env 를 잊으면 누구나 이 크론을 돌릴 수 있었다. 없으면 거부한다(fail-closed). */
  if (!process.env.CRON_SECRET) return res.status(500).json({ error: 'CRON_SECRET not configured' });
  {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  /* 2026-08-08 — 승급 심사 대기용 일시정지 스위치.
   *
   * 왜 — Pinterest 는 Trial 등급으로 만든 핀을 '샌드박스'로 취급한다:
   * 만든 사람에게만 보이고 공개 프로필에 안 뜬다(공식 문서 확인).
   * 이 상태에서 크론이 돌면 112건이 아무도 못 보는 핀으로 발행되고
   * pinterest_synced_at 이 찍혀 버린다 — 승급 후 전량 리셋·재발행해야 하는
   * 쓰레기가 쌓인다. 그렇다고 토큰을 만료 상태로 두면 6시간마다 403 알림이
   * 울린다. 둘 다 피하는 스위치: Standard 승급 전까지 이 변수를 켜 둔다.
   * 승급되면 변수만 지우면 된다 — 코드 재수정 불필요. */
  if (process.env.PINTEREST_PUBLISH_PAUSED) {
    note(res, '발행 일시정지 (PINTEREST_PUBLISH_PAUSED) — Standard 승급 심사 대기 중. 승급 후 이 환경변수를 지울 것');
    return res.status(200).json({ paused: true, pinned: 0,
      message: 'Trial 등급 핀은 비공개(샌드박스)라 발행 보류 중. Standard 승급 후 재개.' });
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
      .select('id, title, title_en, slug, description, description_en, cover_image, og_image, thumbnail, issue, source_instagram_url')
      .eq('status', 'published')
      .eq('legacy', false)
      .is('pinterest_synced_at', null)
      .not('published_date', 'is', null)
      .lte('published_date', new Date().toISOString())
      .order('published_date', { ascending: false })
      .limit(BATCH);

    if (error) throw error;
    if (!eds || !eds.length) {
      note(res, '미처리 에디토리얼 없음 — 전체 발행 완료');
      return res.status(200).json({ done: true, pinned: 0, message: '미처리 에디토리얼 없음 (전체 발행 완료).' });
    }

    let pinned = 0, skipped = 0, netErrors = 0, rateLimited = false;

    for (const e of eds) {
      const handle = e.slug || e.id;
      const img = e.cover_image || e.og_image || e.thumbnail || '';

      // 이미지 없거나 https 가 아니면(핀터레스트가 거부) 영구 스킵
      if (!img || !/^https:\/\//i.test(img) || !handle || !e.title) {
        await supabaseAdmin.from('editorials')
          .update({ pinterest_synced_at: new Date().toISOString(), pinterest_error: 'no image/handle' })
          .eq('id', e.id);
        skipped++;
        continue;
      }

      /* 2026-09-03: 핀 목적지는 인스타그램 원본 (도메니코 확정).
         핀은 링크가 하나뿐이라 "IG 먼저 · 웹 다음" 순서를 쓸 수 없다.
         원본이 없는 화보만 웹으로 폴백. 규칙은 igFirstLink 한 곳에 둔다. */
      const link = singleLinkDestination(e, '/editorial/' + encodeURIComponent(handle)).url;
      const kw = e.title + ' — PAP Magazine editorial'
        + (e.issue ? ' · ' + e.issue : '');
      const baseDesc = String(e.description || e.description_en || '').replace(HTML_TAG_RE, dropKnownTags(' '));
      const description = truncate(baseDesc ? (kw + '. ' + baseDesc) : kw, 480);

      const body = {
        board_id: BOARD_ID,
        title: truncate(e.title, 95),
        description,
        link,
        // alt_text: 접근성 + 핀터레스트 시각검색·SEO 신호
        alt_text: truncate(e.title + ' — PAP Magazine fashion editorial' + (e.issue ? ' · ' + e.issue : ''), 480),
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
          signal: AbortSignal.timeout(15000), // 무응답이 60s 함수 예산 다 먹지 않게
        });
      } catch (netErr) {
        // 네트워크 오류 — 이번 항목만 남겨두고 계속 (synced_at 미기록 → 다음에 재시도)
        console.error('[sync-pinterest] network error:', netErr.message);
        netErrors++;
        continue;
      }

      if (resp.status === 429) {
        // rate limit — 즉시 중단, 다음 크론 실행에 재개
        rateLimited = true;
        break;
      }

      if (resp.status === 401 || resp.status === 403) {
        // 토큰 만료/권한 문제 — 항목 잘못이 아니므로 아무것도 마킹하지 않고
        // 즉시 중단. (마킹하면 배치 전체가 '영구 실패'로 남아 재발행 불가)
        const txt = await resp.text().catch(() => '');
        console.error('[sync-pinterest] auth error', resp.status, txt.slice(0, 200));
        note(res, 'Pinterest 토큰 만료/권한 오류(' + resp.status + ') — 토큰 갱신 전까지 발행 0. 항목은 마킹 안 함');
        /* 200 이 아니라 503 — 토큰 갱신은 사람만 할 수 있다. 조용히 두면
           "돌았는데 발행 0" 이 영원히 반복된다. 5xx 라야 가드가 실패로
           기록하고 텔레그램 알림(6시간 쿨다운)이 간다. */
        return res.status(503).json({
          pinned, skipped, authError: resp.status,
          message: 'PINTEREST_ACCESS_TOKEN 만료/권한 오류 — 토큰 갱신 필요. 항목은 마킹하지 않음.',
        });
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

    note(res, '핀 ' + pinned + '건 발행 · 스킵 ' + skipped
      + (netErrors ? ' · 네트워크오류 ' + netErrors : '')
      + (rateLimited ? ' · 429 중단(다음 실행 재개)' : '')
      + ' · 남은 대기 ' + (remaining == null ? '?' : remaining) + '건');
    return res.status(200).json({ pinned, skipped, netErrors, rateLimited, remaining: remaining ?? null });
  } catch (err) {
    console.error('[sync-pinterest] error:', err);
    return res.status(500).json({ error: 'sync failed', detail: String(err && err.message || err) });
  }
});
