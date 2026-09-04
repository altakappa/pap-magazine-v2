/**
 * GET /api/cron/video-repair — 릴스 기사의 빠진 mp4 를 되찾아 오는 복구 크론.
 * (2026-08-04 신설)
 *
 * 왜 만들었나 ─────────────────────────────────────────────────────────
 * 2026-07-31 부터 Graph API 목록 응답이 VIDEO 항목에 thumbnail_url 만 주고
 * media_url 을 생략하기 시작했다. sync-instagram 은 그 목록만 믿었으므로
 * videoUrls 가 빈 배열이 됐고, archiveVideosToStorage 는 0회 반복 후 조용히
 * [] 를 돌려줬다. 결과: 기사는 source_media_type='VIDEO' 로 정상 발행되는데
 * videos 는 [] — **반쯤 지어진 기사**다.
 *
 * 그 기사는 youtube-post 의 후보 필터(videos.length >= 1)에서 탈락하고,
 * youtube-post 는 "업로드할 릴스 기사 없음" 이라며 ok=true 를 남긴다.
 * 그래서 쇼츠 업로드가 8일간 사실상 0건이었는데도 실패 알림이 한 번도
 * 울리지 않았다. 실측 피해: 07-31~08-04 릴스 기사 6건.
 *
 * 수집 쪽 구멍은 instagramImport.resolveVideoUrls 로 막았다(재발 방지).
 * 이 크론은 **이미 망가진 기사를 되돌리는 역할**이다. 수집 시점 한 번의
 * 실패로 기사가 영영 반쪽으로 남지 않게, 나중에 다시 받아 채워 넣는다.
 * (수집 경로에 재시도 큐를 다는 대신 이 방식을 택한 이유: 서버리스에서
 *  큐를 유지하는 것보다, 결과 상태(videos=[])를 보고 고치는 쪽이 단순하고
 *  어떤 원인으로 빠졌든 똑같이 복구되기 때문이다.)
 *
 * 흐름 ────────────────────────────────────────────────────────────────
 *   articles(source_media_type='VIDEO', videos 비어 있음, IG post id 있음)
 *   → fetchMediaById 로 단건 재조회 → resolveVideoUrls 로 media_url 회수
 *   → archiveVideosToStorage 로 Storage 영구 복사 → articles.videos UPDATE
 *   → 1건이라도 복구되면 youtube-post 를 깨워 즉시 업로드 기회를 준다.
 *
 * 영영 못 고치는 기사(원본 삭제·비공개 전환)를 매 시간 두드리지 않도록
 * 실패 횟수를 ops_alert_state('video-repair-skip') 에 누적해 3회부터 건너뛴다.
 *
 * 2026-08-05 추가 — 영구 실패는 3회를 기다리지 않는다.
 * Graph 가 media_url 자체를 거부하는 릴스(인스타 음원을 얹은 경우)는 다시
 * 물어도 답이 같다. classifyMissingVideo 가 이런 건을 '영구'로 판정하면
 * 즉시 포기 처리하고 사유를 같은 레코드의 reasons 에 남긴다. 그래야
 * ① 헛된 재시도가 사라지고 ② 왜 이 기사가 조용한지 나중에 설명할 수 있다.
 *
 * 파라미터 (관리자 수동 트리거용):
 *   ?dry=1     — 대상만 보여주고 아무것도 고치지 않음
 *   ?limit=N   — 한 번에 고칠 기사 수 (기본 5, 최대 20)
 *   ?days=N    — 대상 기간 (기본 30일)
 *   ?reset=1   — 스킵 목록 초기화
 *
 * 보안: Vercel cron secret 또는 관리자 토큰.
 */

const { bearerOk } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const {
  fetchMediaById,
  resolveVideoUrls,
  archiveVideosToStorage,
} = require('../_lib/instagramImport');

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
const SKIP_KEY = 'video-repair-skip';
/* 복구된 릴스에만 열어주는 신선도 창(일). 정기 실행의 기본 3일은 그대로 둔다. */
const WAKE_DAYS = 7;
const MAX_FAILS = 3; // 이 횟수부터는 포기 — 원본이 삭제/비공개된 기사로 본다

/**
 * 복구 대상 고르기 — 순수 함수 (테스트 용이성 목적으로 분리).
 *
 * "videos 가 비었다" 의 판정을 여기 한 곳에만 둔다. DB 에는 null 로 들어간
 * 행과 [] 로 들어간 행이 섞여 있어, 어느 한쪽만 보면 절반을 놓친다.
 *
 * @param {Array} rows - articles 행 (id, videos, source_instagram_post_id, ...)
 * @param {{skip?:object, limit?:number}} [opts] - skip: {article_id: 실패횟수}
 * @returns {Array} 복구 대상 행
 */
function pickRepairTargets(rows, opts) {
  const o = opts || {};
  const skip = o.skip || {};
  const limit = Math.max(1, Math.min(20, o.limit || 5));
  const out = [];
  for (const r of (rows || [])) {
    if (!r || !r.source_instagram_post_id) continue;
    if (Array.isArray(r.videos) && r.videos.length && r.videos[0]) continue; // 이미 정상
    if ((skip[r.id] || 0) >= MAX_FAILS) continue;                            // 포기한 기사
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * mp4 를 못 받은 이유를 '영구'와 '일시'로 가른다 — 2026-08-05 신설.
 *
 * 왜 필요한가 ─────────────────────────────────────────────────────────
 * 2026-07-31 이후 Graph API 는 **인스타 음원(라이선스 음악)을 얹은 릴스**에
 * media_url 을 아예 주지 않는다. 단건 재조회를 해도 답은 영원히 같다.
 * 그런데 기존 코드는 이 경우를 네트워크 오류와 똑같이 취급해서
 *   ① MAX_FAILS(3)회를 다 태우고 (한 시간에 한 번씩, 사흘 내내 헛수고)
 *   ② 남는 기록은 '재조회 0/1' 한 줄뿐이라 왜 포기했는지 나중에 알 수 없었다.
 * 실측: 아더에러·청하·프라다·규진 공항·규진 베이델리 5건이 모두 이 경우다.
 *
 * 영구로 판정되면 재시도 없이 즉시 포기하고 사유를 남긴다.
 *   - attempted>0 && resolved===0 → Graph 가 media_url 을 거부 (음원 릴스)
 *   - attempted===0               → 이 게시물에 영상 후보 자체가 없음
 *   - 그 밖(일부는 회수됐는데 videoUrls 가 비어 있음) → 설명되지 않는 상태이므로
 *     일시 실패로 두고 다음 회차에 다시 시도한다. 애매하면 재시도가 안전하다.
 *
 * @param {object} post - _normalizeMedia 결과
 * @param {{attempted:number, resolved:number}} stat - resolveVideoUrls 반환값
 * @returns {{permanent:boolean, reason:string, message:string}}
 */
function classifyMissingVideo(post, stat) {
  const s = stat || {};
  const attempted = Number(s.attempted) || 0;
  const resolved = Number(s.resolved) || 0;
  const type = String((post && post.mediaType) || '').toUpperCase();

  if (attempted > 0 && resolved === 0) {
    return {
      permanent: true,
      reason: 'media_url_denied',
      message: 'Graph 가 media_url 을 주지 않음 — 인스타 음원(라이선스 음악) 릴스는 '
        + '영구 회수 불가 (재조회 ' + resolved + '/' + attempted + ')',
    };
  }
  if (attempted === 0) {
    return {
      permanent: true,
      reason: type === 'VIDEO' ? 'video_without_source' : 'not_video',
      message: '영상 후보를 찾지 못함 (media_type=' + (type || '알 수 없음') + ')',
    };
  }
  return {
    permanent: false,
    reason: 'partial',
    message: 'media_url 회수 실패 (재조회 ' + resolved + '/' + attempted + ')',
  };
}

async function loadSkip() {
  try {
    const { data } = await supabaseAdmin.from('ops_alert_state')
      .select('last_payload').eq('key', SKIP_KEY).maybeSingle();
    const p = data && data.last_payload;
    return {
      fails: (p && typeof p.fails === 'object' && p.fails) ? p.fails : {},
      reasons: (p && typeof p.reasons === 'object' && p.reasons) ? p.reasons : {},
    };
  } catch (e) {
    console.error('[video-repair] 스킵 목록 로드 실패:', (e && e.message) || e);
    return { fails: {}, reasons: {} };
  }
}

async function saveSkip(fails, reasons) {
  try {
    await supabaseAdmin.from('ops_alert_state').upsert({
      key: SKIP_KEY,
      last_payload: { fails, reasons: reasons || {}, updated: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  } catch (e) {
    console.error('[video-repair] 스킵 목록 저장 실패:', (e && e.message) || e);
  }
}

module.exports = withCronGuard('video-repair', async function handler(req, res) {
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const q = (req.query || {});
  const dry = String(q.dry || '') === '1';
  const limit = Math.max(1, Math.min(20, parseInt(q.limit || '5', 10) || 5));
  const days = Math.max(1, Math.min(365, parseInt(q.days || '30', 10) || 30));

  if (String(q.reset || '') === '1') {
    await saveSkip({}, {});
    res.locals.cronNote = '스킵 목록 초기화 (실패 횟수·포기 사유 모두)';
    return res.status(200).json({ ok: true, note: res.locals.cronNote });
  }

  /* 정렬 기준은 created_at 이 아니라 published_date 다.
     created_at 은 '언제 우리 DB 에 들어왔나' 이고, published_date 는 '언제
     세상에 나갔나' 다. 2023~2024년 아카이브 기사를 나중에 일괄 수입하면
     created_at 이 최신이 되어 복구 예산(기본 5건)을 옛 기사가 먼저 먹는다.
     실제로 2026-08-04 실행에서 5칸 중 2칸을 2023·2024년 기사가 차지했고,
     그중 하나는 원본이 사라져 어차피 못 고치는 건이었다. 쇼츠 업로드는
     신선도 창이 있으므로, 최근 기사를 먼저 손봐야 복구가 값을 한다. */
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const COLS = 'id, title, videos, source_instagram_post_id, source_media_type, status, created_at, published_date';

  const { data: fresh, error: selErr } = await supabaseAdmin.from('articles')
    .select(COLS)
    .eq('source_media_type', 'VIDEO')
    .gte('published_date', cutoff)
    .order('published_date', { ascending: false })
    .limit(300);
  if (selErr) throw selErr;

  const skipState = await loadSkip();
  const fails = skipState.fails;
  const reasons = skipState.reasons;
  const targets = pickRepairTargets(fresh, { skip: fails, limit });
  let scanned = (fresh || []).length;

  /* 최근 창에서 예산이 남으면 그때만 아카이브까지 내려간다 — 밀린 옛 기사도
     언젠가는 고쳐야 하지만, 순서는 항상 최근이 먼저다.
     published_date 가 null 인 행(수동 등록분)도 여기서 함께 줍는다. */
  if (targets.length < limit) {
    const seen = new Set(targets.map((t) => String(t.id)));
    const { data: old, error: oldErr } = await supabaseAdmin.from('articles')
      .select(COLS)
      .eq('source_media_type', 'VIDEO')
      .or('published_date.lt.' + cutoff + ',published_date.is.null')
      .order('published_date', { ascending: false, nullsFirst: false })
      .limit(300);
    if (oldErr) throw oldErr;
    scanned += (old || []).length;
    const more = pickRepairTargets(
      (old || []).filter((r) => r && !seen.has(String(r.id))),
      { skip: fails, limit: limit - targets.length },
    );
    for (const m of more) targets.push(m);
  }

  if (!targets.length) {
    const parked = Object.keys(reasons).length;
    res.locals.cronNote = '복구할 릴스 기사 없음 (최근 ' + days + '일 우선 · 전체 ' + scanned + '건 확인'
      + (parked ? ' · 영구 포기 ' + parked + '건' : '') + ')';
    return res.status(200).json({ ok: true, note: res.locals.cronNote, scanned, parked, reasons });
  }

  if (dry) {
    res.locals.cronNote = 'dry-run — 복구 대상 ' + targets.length + '건';
    return res.status(200).json({
      ok: true, dry: true, note: res.locals.cronNote,
      targets: targets.map((t) => ({ id: t.id, title: t.title, ig: t.source_instagram_post_id })),
      parked: Object.keys(reasons).length,
      reasons,
    });
  }

  const results = { repaired: 0, failed: 0, permanent: 0, detail: [] };
  let skipDirty = false;

  for (const t of targets) {
    const igId = String(t.source_instagram_post_id);
    try {
      const post = await fetchMediaById(igId);
      const stat = await resolveVideoUrls(post);
      if (!post.videoUrls.length) {
        const why = classifyMissingVideo(post, stat);
        const err = new Error(why.message);
        err.permanent = why.permanent;   // true 면 재시도하지 않고 즉시 포기한다
        err.reason = why.reason;
        throw err;
      }
      const report = {};
      const videoUrls = await archiveVideosToStorage(post, 2, undefined, report);
      if (!videoUrls.length) {
        throw new Error('Storage 복사 실패: ' + JSON.stringify((report.failures || []).slice(0, 2)));
      }
      const { error: upErr } = await supabaseAdmin.from('articles')
        .update({ videos: videoUrls }).eq('id', t.id);
      if (upErr) throw upErr;

      results.repaired++;
      results.detail.push({ id: t.id, title: t.title, videos: videoUrls.length, ok: true });
      if (fails[t.id] || reasons[t.id]) {
        delete fails[t.id];
        delete reasons[t.id];
        skipDirty = true;
      }
      console.log('[video-repair] 복구 완료: ' + t.title + ' (' + videoUrls.length + '개)');
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 200);
      const permanent = !!(e && e.permanent);
      const reason = (e && e.reason) || null;
      results.failed++;
      if (permanent) {
        /* 다시 물어도 답이 같은 실패다 — 재시도 예산을 태우지 않고 바로 포기하고,
           대신 '왜 포기했는지' 를 남긴다. 나중에 이 기사를 손으로 고칠 때
           (예: 음원 릴스를 직접 내려받아 올릴 때) 이 사유가 유일한 단서다. */
        results.permanent++;
        fails[t.id] = MAX_FAILS;
        reasons[t.id] = {
          reason,
          message: msg,
          title: t.title || null,
          ig: igId,
          at: new Date().toISOString(),
        };
      } else {
        fails[t.id] = (fails[t.id] || 0) + 1;
        delete reasons[t.id];
      }
      skipDirty = true;
      results.detail.push({
        id: t.id, title: t.title, ok: false, error: msg,
        permanent, reason, fails: fails[t.id],
      });
      console.error('[video-repair] 복구 ' + (permanent ? '포기(영구·' + reason + ')' : '실패')
        + ' ' + t.id + ' (' + fails[t.id] + '회): ' + msg);
    }
  }

  if (skipDirty) await saveSkip(fails, reasons);

  /* 1건이라도 복구했으면 유튜브 크론을 깨운다 — 신선도 창(기본 3일)이 있으므로
     다음 정기 실행까지 기다리다 창이 닫히면 복구가 헛수고가 된다.
     복구된 기사는 '수집이 늦은' 것이지 '오래된' 것이 아니므로 days=7 로 연다. */
  if (results.repaired && process.env.CRON_SECRET) {
    try {
      await fetch(SITE + '/api/cron/youtube-post?days=' + WAKE_DAYS, {
        method: 'GET',
        headers: { authorization: 'Bearer ' + process.env.CRON_SECRET },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      console.error('[video-repair] youtube-post 트리거 실패:', (e && e.message) || e);
    }
  }

  res.locals.cronNote = '릴스 mp4 복구 ' + results.repaired + '건 성공 / ' + results.failed + '건 실패'
    + (results.permanent ? ' (영구 포기 ' + results.permanent + '건)' : '');
  return res.status(200).json({ ok: true, note: res.locals.cronNote, ...results });
});

module.exports.pickRepairTargets = pickRepairTargets;
module.exports.classifyMissingVideo = classifyMissingVideo;
module.exports.MAX_FAILS = MAX_FAILS;
