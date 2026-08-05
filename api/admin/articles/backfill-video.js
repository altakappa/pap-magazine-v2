/**
 * GET /api/admin/articles/backfill-video?slug=<slug|id>  (관리자 전용)
 *
 * 영상 지원(069) 이전에 수집된 기사의 릴스/영상을 소급 보관한다:
 * 기사의 source_instagram_post_id 로 Graph API 에서 원본 미디어를 다시
 * 조회 → 영상 원본을 Storage 에 영구 복사 → articles.videos 갱신.
 *
 * ?brand=pepperit 이면 pepperit_articles 대상으로 동일 처리.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { archiveVideosToStorage } = require('../../_lib/instagramImport');

const _IG_API = 'https://graph.facebook.com/v25.0';

/**
 * 영상을 못 건졌을 때 '왜' 를 가른다 — 2026-08-05 신설.
 *
 * 예전에는 두 가지 전혀 다른 상황이 같은 문장('이 게시물에는 영상이 없음')으로
 * 돌아왔다:
 *   ① 진짜로 영상이 아닌 게시물 (이미지·캐러셀) — 기사 분류가 틀린 것이니
 *      source_media_type 을 고쳐야 한다.
 *   ② 영상 게시물인데 Graph 가 media_url 을 안 준 것 — 2026-07-31 이후
 *      인스타 음원(라이선스 음악)을 얹은 릴스에서 계속 나오는 현상이고,
 *      몇 번을 다시 눌러도 결과가 같다. 손으로 내려받아 올리는 수밖에 없다.
 * 둘을 구분 못 하면 ②를 ①로 오해해서 "영상이 없는 게시물이구나" 하고
 * 넘어가게 된다. 실제로 5건이 이렇게 조용히 묻혔다.
 *
 * @param {object} media - Graph 응답 (media_type, children.data[])
 * @returns {{reason:string, note:string, media_type:(string|null)}}
 */
function classifyBackfillMiss(media) {
  const m = media || {};
  const type = m.media_type || null;
  const kids = (m.children && Array.isArray(m.children.data)) ? m.children.data : [];
  const hasVideo = type === 'VIDEO' || kids.some((c) => c && c.media_type === 'VIDEO');

  if (hasVideo) {
    return {
      reason: 'media_url_missing',
      media_type: type,
      note: '영상 게시물인데 Graph 가 media_url 을 주지 않음 — 인스타 음원(라이선스 음악) '
        + '릴스는 2026-07-31 이후 API 로 회수할 수 없다. 원본을 직접 내려받아 올려야 한다.',
    };
  }
  return {
    reason: 'not_video',
    media_type: type,
    note: '이 게시물에는 영상이 없음 (media_type=' + (type || '알 수 없음') + ')',
  };
}

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const key = req.query && req.query.slug;
    if (!key) return res.status(400).json({ error: 'slug(또는 id) 필요' });
    const isPepperit = (req.query && req.query.brand) === 'pepperit';
    const table = isPepperit ? 'pepperit_articles' : 'articles';
    const prefix = isPepperit ? 'ig-pepperit' : 'ig-articles';

    // slug 우선, 실패 시 id 로 조회
    let { data: a } = await supabaseAdmin.from(table)
      .select('id, title, slug, videos, source_instagram_post_id')
      .eq('slug', String(key)).maybeSingle();
    if (!a) {
      const r2 = await supabaseAdmin.from(table)
        .select('id, title, slug, videos, source_instagram_post_id')
        .eq('id', String(key)).maybeSingle();
      a = r2.data;
    }
    if (!a) return res.status(404).json({ error: '기사를 찾을 수 없음' });
    if (!a.source_instagram_post_id) return res.status(400).json({ error: '원본 IG 게시물 ID 없음' });

    // 원본 미디어 재조회 — 페퍼릿(타 계정)은 자체 미디어 조회 불가하므로
    // PAP 소유 미디어만 직접 조회 가능. 페퍼릿은 business_discovery 최근
    // 목록에서 매칭 (오래된 게시물은 못 찾을 수 있음).
    let media = null;
    if (!isPepperit) {
      const url = _IG_API + '/' + a.source_instagram_post_id +
        '?fields=media_type,media_url,thumbnail_url,children{media_url,media_type}' +
        '&access_token=' + process.env.IG_ACCESS_TOKEN;
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (j.error) return res.status(502).json({ error: 'Graph 조회 실패', detail: JSON.stringify(j.error).slice(0, 200) });
      media = j;
    } else {
      const { listPepperitMedia } = require('../../_lib/pepperitImport');
      const rows = await listPepperitMedia({ maxCount: 100 });
      media = rows.find((m) => m.id === a.source_instagram_post_id) || null;
      if (!media) return res.status(404).json({ error: '최근 100개 게시물에서 원본을 찾지 못함' });
    }

    // 영상 URL 수집
    const videoUrls = [];
    if (media.media_type === 'VIDEO' && media.media_url) videoUrls.push(media.media_url);
    if (media.children && Array.isArray(media.children.data)) {
      media.children.data.forEach((c) => {
        if (c && c.media_type === 'VIDEO' && c.media_url) videoUrls.push(c.media_url);
      });
    }
    if (!videoUrls.length) {
      const why = classifyBackfillMiss(media);
      return res.status(200).json({
        ok: true,
        note: why.note,
        reason: why.reason,
        media_type: why.media_type,
        title: a.title,
      });
    }

    const archived = await archiveVideosToStorage(
      { id: a.source_instagram_post_id, videoUrls }, 3, prefix);
    if (!archived.length) return res.status(502).json({ error: '영상 보관 실패 (로그 확인)' });

    const { error: upErr } = await supabaseAdmin.from(table)
      .update({ videos: archived }).eq('id', a.id);
    if (upErr) throw upErr;

    return res.status(200).json({ ok: true, title: a.title, videos: archived.length, found: videoUrls.length });
  } catch (err) {
    console.error('[backfill-video] error:', err);
    return res.status(500).json({ error: String(err && err.message || err).slice(0, 200) });
  }
};

module.exports.classifyBackfillMiss = classifyBackfillMiss;
