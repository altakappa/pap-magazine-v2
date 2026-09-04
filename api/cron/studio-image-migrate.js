/**
 * GET /api/cron/studio-image-migrate — Wix 이미지 → 우리 Supabase 스토리지 이관 (2단계, "진짜 이식").
 *
 * studio_projects 의 images[]/cover_url 중 아직 Wix(static.wixstatic.com) 인 것을
 * 다운로드해 media 버킷(studio/<slug>/…)에 업로드하고 URL 을 우리 것으로 치환한다.
 * 한 프로젝트의 이미지가 많아(최대 수십 장) 시간 예산 내에서 이미지 단위로 진행,
 * 전량 이관되면 images_migrated=true. 다음 실행이 이어감(migrate-external-images 와 동일 철학).
 *
 * 보안: CRON_SECRET Bearer 또는 관리자.
 */
const { bearerOk } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');

const MAX_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const TIME_BUDGET_MS = 90000;
const IS_WIX = (u) => typeof u === 'string' && /static\.wixstatic\.com/.test(u);

// ── 영상 이관 (2026-07-27, 도메니코 "모든 데이터를 가져오자") ──
// 필름 mp4 는 수십~수백MB 라 이미지와 별도 상한·타임아웃을 쓴다.
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const VIDEO_FETCH_TIMEOUT_MS = 60000;
const IS_WIX_VIDEO = (u) => typeof u === 'string' && /video\.wixstatic\.com/.test(u);

async function fetchVideo(url) {
  // 해상도 사다리: 원 URL(보통 1080p) → 720p → 480p. 용량 초과·실패 시 한 단계 낮춘다.
  const id = (String(url).match(/video\/([0-9a-f]{6}_[A-Za-z0-9]+)\//) || [])[1];
  const candidates = id ? [url,
    'https://video.wixstatic.com/video/' + id + '/720p/mp4/file.mp4',
    'https://video.wixstatic.com/video/' + id + '/480p/mp4/file.mp4'] : [url];
  let lastErr = null;
  for (const cand of [...new Set(candidates)]) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), VIDEO_FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(cand, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; PAPStudioImport/1.0)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const len = parseInt(r.headers.get('content-length') || '0', 10);
      if (len && len > MAX_VIDEO_BYTES) throw new Error('too large: ' + len);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_VIDEO_BYTES) throw new Error('too large: ' + buf.length);
      return buf;
    } catch (e) { lastErr = e; } finally { clearTimeout(to); }
  }
  throw lastErr || new Error('video fetch failed');
}

async function uploadVideo(slug, idx, url) {
  const buf = await fetchVideo(url);
  const path = 'studio/' + slug + '/film_' + idx + '_' + Date.now() + '.mp4';
  const { error } = await supabaseAdmin.storage.from('media').upload(path, buf, { contentType: 'video/mp4', upsert: true });
  if (error) throw error;
  const { data } = supabaseAdmin.storage.from('media').getPublicUrl(path);
  return data && data.publicUrl;
}

function extFromUrl(u) {
  const m = String(u).match(/~mv2\.(jpe?g|png)/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}
function ctFromExt(ext) { return ext === 'png' ? 'image/png' : 'image/jpeg'; }

async function fetchImage(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // Wix base URL 은 원본 제공. 원본이 과대할 수 있어 fit 변환으로 장변 2048 상한.
    const dl = IS_WIX(url) ? (url + '/v1/fit/w_2048,h_2048,q_90,enc_auto/studio.' + extFromUrl(url)) : url;
    const r = await fetch(dl, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; PAPStudioImport/1.0)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    if (!/^image\//.test(ct)) throw new Error('not an image: ' + ct);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('too large: ' + buf.length);
    return { buf, ct };
  } finally { clearTimeout(to); }
}

async function uploadOne(slug, idx, url) {
  const { buf, ct } = await fetchImage(url);
  const ext = ct === 'image/png' ? 'png' : 'jpg';
  const path = 'studio/' + slug + '/' + idx + '_' + Date.now() + '.' + ext;
  const { error } = await supabaseAdmin.storage.from('media').upload(path, buf, { contentType: ct, upsert: true });
  if (error) throw error;
  const { data } = supabaseAdmin.storage.from('media').getPublicUrl(path);
  return data && data.publicUrl;
}

module.exports = withCronGuard('studio-image-migrate', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
  if (!cronOk) { const u = await requireAdmin(req, res); if (!u) return; }

  const started = Date.now();
  const results = { rows: 0, images_migrated: 0, failed: 0, done: false, errors: [] };

  try {
    const { data: rows, error } = await supabaseAdmin.from('studio_projects')
      .select('id,slug,cover_url,images,images_migrated')
      .eq('images_migrated', false).order('sort_order', { ascending: true }).limit(50);
    if (error) throw error;

    for (const row of (rows || [])) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const imgs = Array.isArray(row.images) ? row.images.slice() : [];
      let changed = false;
      for (let i = 0; i < imgs.length; i++) {
        if (!IS_WIX(imgs[i])) continue;
        if (Date.now() - started > TIME_BUDGET_MS) break;
        try {
          const nu = await uploadOne(row.slug, i, imgs[i]);
          if (nu) { imgs[i] = nu; changed = true; results.images_migrated++; }
        } catch (e) { results.failed++; results.errors.push({ slug: row.slug, i, error: (e && e.message || '').slice(0, 120) }); }
      }
      // cover: 첫 이관 이미지로(또는 cover 가 Wix 면 images[0] 로 대체)
      let cover = row.cover_url;
      if (IS_WIX(cover)) cover = imgs.find((u) => !IS_WIX(u)) || cover;
      const stillWix = imgs.some(IS_WIX) || IS_WIX(cover);
      if (changed || cover !== row.cover_url) {
        await supabaseAdmin.from('studio_projects').update({
          images: imgs, cover_url: cover, images_migrated: !stillWix, updated_at: new Date().toISOString(),
        }).eq('id', row.id);
      }
      results.rows++;
      if (Date.now() - started > TIME_BUDGET_MS) break;
    }

    /* 영상 이관 — video_urls[] 의 Wix 영상을 media 버킷으로. 파일이 커서
       시간 예산 내 되는 만큼만 진행, 남은 것은 다음 실행(10분 주기)이 이어간다. */
    results.videos_migrated = 0; results.video_failed = 0;
    const { data: vrows, error: verr } = await supabaseAdmin.from('studio_projects')
      .select('id,slug,video_url,video_urls,videos_migrated')
      .eq('videos_migrated', false).limit(10);
    if (verr) throw verr;
    for (const row of (vrows || [])) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const vids = Array.isArray(row.video_urls) ? row.video_urls.slice() : [];
      let changed = false;
      for (let i = 0; i < vids.length; i++) {
        if (!IS_WIX_VIDEO(vids[i])) continue;
        if (Date.now() - started > TIME_BUDGET_MS) break;
        try {
          const nu = await uploadVideo(row.slug, i, vids[i]);
          if (nu) { vids[i] = nu; changed = true; results.videos_migrated++; }
        } catch (e) { results.video_failed++; results.errors.push({ slug: row.slug, video: i, error: (e && e.message || '').slice(0, 120) }); }
      }
      if (changed) {
        await supabaseAdmin.from('studio_projects').update({
          video_urls: vids,
          video_url: vids[0] || row.video_url,
          videos_migrated: !vids.some(IS_WIX_VIDEO),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
      }
    }

    const { count } = await supabaseAdmin.from('studio_projects')
      .select('id', { count: 'exact', head: true }).eq('images_migrated', false);
    const { count: vcount } = await supabaseAdmin.from('studio_projects')
      .select('id', { count: 'exact', head: true }).eq('videos_migrated', false);
    results.remaining_rows = count || 0;
    results.remaining_video_rows = vcount || 0;
    results.done = (count || 0) === 0 && (vcount || 0) === 0;
    return res.status(200).json(results);
  } catch (e) {
    console.error('[studio-image-migrate] error', e);
    throw e;
  }
});
