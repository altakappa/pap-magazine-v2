/**
 * GET /api/cron/purge-news-tips — 제보 미디어 7일 자동 삭제
 *
 * 도메니코 2026-11-11: "제보는 특별히 1기가 용량까지 허락해주자 하지만
 *   일주일뒤 보관하지않고 삭제하는걸로해줘"
 *
 * ■ 지우는 것은 **미디어**이고, 행은 남긴다
 * 무엇이 들어왔고 어떻게 처리했는지는 기록이어야 한다. 그래서 media 경로는
 * 비우고 media_purged_at 을 찍되 행 자체는 지우지 않는다. 용량을 먹는 쪽은
 * 1GB 영상이고 그건 스토리지에 있다.
 *
 * ■ 채택했는데 확보하지 않은 제보는 건드리지 않는다
 * 설계의 함정: 채택해서 기사에 실은 영상이 7일 뒤 사라지면 **발행된 기사가
 * 깨진다.** 순서는 ① 채택(used) → ② 확보(media_archived) → ③ 원본 삭제 다.
 * 이 크론은 ②가 안 끝난 used 제보를 건너뛰고, 대신 텔레그램으로 조른다.
 * 즉 확보를 잊어도 영상이 먼저 사라지는 일은 없다 — 사람의 실수를 데이터
 * 손실로 바꾸지 않는다.
 *
 * ■ 못 지운 몫은 다음 회차가 맡는다
 * 한 회차 상한을 둔다. 크론은 매일 오므로 이번에 무리해서 태우는 것보다
 * 다음 회차에 온전히 도는 쪽이 언제나 싸다.
 *
 * 보안: Vercel 크론이 Bearer <CRON_SECRET> 로 서명한다. 비교는 timing-safe.
 */

'use strict';

const { safeEqual } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { withCronGuard } = require('../_lib/cronGuard');
const { sendTextToTelegramSafe } = require('../_lib/telegram');
const T = require('../_lib/newsTip');

const MAX_PER_RUN = 200;

module.exports = withCronGuard('purge-news-tips', async function handler(req, res) {
  if (handleCors(req, res)) return;
  /* 공책을 먼저 만든다. Vercel 서버리스의 res 에는 locals 가 없어서, 만들지 않고
     res.locals.cronNote 에 쓰면 **할 일을 다 끝낸 직후 마지막 줄에서** 500 이 난다
     (2026-08-13 submission-authorization-sweep 6회 전부 그렇게 죽었다.
     tests/cron-contract.test.js 가 지키는 규칙). */
  res.locals = res.locals || {};

  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) {
    console.error('[cron/purge-news-tips] CRON_SECRET env not set');
    return res.status(500).json({ message: 'CRON_SECRET not configured' });
  }
  if (!safeEqual(got, expected)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const cutoff = new Date(Date.now() - T.PURGE_AFTER_DAYS * 24 * 3600 * 1000).toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from('news_tips')
    .select('id, title, status, media, media_archived, created_at')
    .is('media_purged_at', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) {
    console.error('[cron/purge-news-tips] select failed:', error.message);
    return res.status(500).json({ message: 'select failed', code: 'select_failed' });
  }

  let purged = 0, files = 0, skippedUnarchived = 0, failures = 0;
  const waiting = [];

  for (const r of (rows || [])) {
    const media = Array.isArray(r.media) ? r.media : [];

    // 채택했는데 확보가 안 끝났으면 건너뛴다 — 기사가 깨지는 쪽이 더 비싸다.
    if (r.status === 'used' && !r.media_archived) {
      skippedUnarchived++;
      waiting.push({ id: r.id, title: String(r.title || '').slice(0, 60) });
      continue;
    }

    const paths = media.map((m) => m && m.path).filter(Boolean);
    if (paths.length) {
      const { error: rmErr } = await supabaseAdmin.storage.from(T.BUCKET).remove(paths);
      if (rmErr) {
        // 스토리지 삭제가 실패하면 DB 도 바꾸지 않는다 — 다음 회차가 다시 시도한다.
        // (여기서 purged 로 찍으면 파일은 남고 아무도 다시 안 본다.)
        console.error('[cron/purge-news-tips] remove failed', r.id, rmErr.message);
        failures++;
        continue;
      }
      files += paths.length;
    }

    const { error: upErr } = await supabaseAdmin.from('news_tips').update({
      media: [],
      media_purged_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    if (upErr) {
      console.error('[cron/purge-news-tips] update failed', r.id, upErr.message);
      failures++;
      continue;
    }
    purged++;
  }

  /* 확보를 기다리는 건이 있으면 조른다. 알림이 없으면 영상은 영원히 남고
     (용량을 먹고) 아무도 그 사실을 모른다 — 관측되지 않는 상태는 없는 것처럼
     보인다는 교훈 그대로다. */
  if (waiting.length) {
    try {
      await sendTextToTelegramSafe('⏳ 채택했지만 미디어를 확보하지 않은 제보 ' + waiting.length + '건'
        + '\n' + waiting.slice(0, 10).map((w) => '· ' + w.title + ' (tip=' + w.id + ')').join('\n')
        + '\n확보 전에는 원본을 지우지 않습니다. 관리자 화면에서 "미디어 확보" 를 눌러 주세요.');
    } catch (_) { /* 알림 실패가 크론을 실패로 만들지 않는다 */ }
  }

  const note = 'purged=' + purged + ' files=' + files
    + ' waitingArchive=' + skippedUnarchived + ' failures=' + failures
    + ' cutoff=' + cutoff.slice(0, 10);
  console.log('[cron/purge-news-tips]', note);
  res.locals.cronNote = note;   // cron_runs 에 남는 한 줄 요약
  return res.status(200).json({
    ok: true, purged, files, waitingArchive: skippedUnarchived, failures, cutoff, note,
  });
});
