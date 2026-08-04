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
 * 파라미터 (관리자 수동 트리거용):
 *   ?dry=1     — 대상만 보여주고 아무것도 고치지 않음
 *   ?limit=N   — 한 번에 고칠 기사 수 (기본 5, 최대 20)
 *   ?days=N    — 대상 기간 (기본 30일)
 *   ?reset=1   — 스킵 목록 초기화
 *
 * 보안: Vercel cron secret 또는 관리자 토큰.
 */

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

async function loadSkip() {
  try {
    const { data } = await supabaseAdmin.from('ops_alert_state')
      .select('last_payload').eq('key', SKIP_KEY).maybeSingle();
    const p = data && data.last_payload;
    return (p && typeof p.fails === 'object' && p.fails) ? p.fails : {};
  } catch (e) {
    console.error('[video-repair] 스킵 목록 로드 실패:', (e && e.message) || e);
    return {};
  }
}

async function saveSkip(fails) {
  try {
    await supabaseAdmin.from('ops_alert_state').upsert({
      key: SKIP_KEY,
      last_payload: { fails, updated: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  } catch (e) {
    console.error('[video-repair] 스킵 목록 저장 실패:', (e && e.message) || e);
  }
}

module.exports = withCronGuard('video-repair', async function handler(req, res) {
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const q = (req.query || {});
  const dry = String(q.dry || '') === '1';
  const limit = Math.max(1, Math.min(20, parseInt(q.limit || '5', 10) || 5));
  const days = Math.max(1, Math.min(365, parseInt(q.days || '30', 10) || 30));

  if (String(q.reset || '') === '1') {
    await saveSkip({});
    res.locals.cronNote = '스킵 목록 초기화';
    return res.status(200).json({ ok: true, note: res.locals.cronNote });
  }

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { data: rows, error: selErr } = await supabaseAdmin.from('articles')
    .select('id, title, videos, source_instagram_post_id, source_media_type, status, created_at')
    .eq('source_media_type', 'VIDEO')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(300);
  if (selErr) throw selErr;

  const fails = await loadSkip();
  const targets = pickRepairTargets(rows, { skip: fails, limit });

  if (!targets.length) {
    res.locals.cronNote = '복구할 릴스 기사 없음 (최근 ' + days + '일 · 전체 ' + (rows || []).length + '건 확인)';
    return res.status(200).json({ ok: true, note: res.locals.cronNote, scanned: (rows || []).length });
  }

  if (dry) {
    res.locals.cronNote = 'dry-run — 복구 대상 ' + targets.length + '건';
    return res.status(200).json({
      ok: true, dry: true, note: res.locals.cronNote,
      targets: targets.map((t) => ({ id: t.id, title: t.title, ig: t.source_instagram_post_id })),
    });
  }

  const results = { repaired: 0, failed: 0, detail: [] };
  let skipDirty = false;

  for (const t of targets) {
    const igId = String(t.source_instagram_post_id);
    try {
      const post = await fetchMediaById(igId);
      const stat = await resolveVideoUrls(post);
      if (!post.videoUrls.length) {
        throw new Error('media_url 회수 실패 (재조회 ' + stat.resolved + '/' + stat.attempted + ')');
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
      if (fails[t.id]) { delete fails[t.id]; skipDirty = true; }
      console.log('[video-repair] 복구 완료: ' + t.title + ' (' + videoUrls.length + '개)');
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 200);
      results.failed++;
      fails[t.id] = (fails[t.id] || 0) + 1;
      skipDirty = true;
      results.detail.push({ id: t.id, title: t.title, ok: false, error: msg, fails: fails[t.id] });
      console.error('[video-repair] 복구 실패 ' + t.id + ' (' + fails[t.id] + '회): ' + msg);
    }
  }

  if (skipDirty) await saveSkip(fails);

  /* 1건이라도 복구했으면 유튜브 크론을 깨운다 — 신선도 창(3일)이 있으므로
     다음 정기 실행까지 기다리다 창이 닫히면 복구가 헛수고가 된다. */
  if (results.repaired && process.env.CRON_SECRET) {
    try {
      await fetch(SITE + '/api/cron/youtube-post', {
        method: 'GET',
        headers: { authorization: 'Bearer ' + process.env.CRON_SECRET },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      console.error('[video-repair] youtube-post 트리거 실패:', (e && e.message) || e);
    }
  }

  res.locals.cronNote = '릴스 mp4 복구 ' + results.repaired + '건 성공 / ' + results.failed + '건 실패';
  return res.status(200).json({ ok: true, note: res.locals.cronNote, ...results });
});

module.exports.pickRepairTargets = pickRepairTargets;
module.exports.MAX_FAILS = MAX_FAILS;
