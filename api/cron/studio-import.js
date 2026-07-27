/**
 * GET /api/cron/studio-import — Wix PAP Studio 포트폴리오 → studio_projects 이식 (1단계: 메타·이미지 URL 스크랩).
 *
 * Wix(contact750858.wixsite.com/pap-studio)의 각 프로젝트 SSR HTML 을 서버에서 fetch·파싱해
 * 브랜드·제목·LOCATION·설명·필름링크·전 이미지 URL 을 studio_projects 에 upsert 한다.
 * 이미지는 우선 Wix 원본 URL 로 저장하고, 2단계 크론(studio-image-migrate)이 우리 스토리지로 이관한다.
 * "하나도 빠짐없이" — /all 컬렉션의 전 프로젝트(사진+필름)를 자동 발견해 순서대로 수집.
 *
 * 보안: CRON_SECRET Bearer 또는 관리자 토큰.
 */
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');

const WIX = 'https://contact750858.wixsite.com/pap-studio';
const ALL_URL = WIX + '/portfolio-collections/all';
const FETCH_TIMEOUT_MS = 20000;
const TIME_BUDGET_MS = 90000;

async function fetchText(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; PAPStudioImport/1.0)' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(to); }
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ');
}
function meta(html, prop) {
  const re = new RegExp('<meta[^>]+(?:property|name)="' + prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*content="([^"]*)"', 'i');
  const m = html.match(re); return m ? decodeEntities(m[1]) : '';
}
// 전 컬렉션 페이지에서 프로젝트 slug 목록(순서 유지)
function parseSlugs(html) {
  const re = /\/portfolio-collections\/all\/([a-z0-9][a-z0-9-]*)(?:"|\?)/gi;
  const seen = new Set(); const out = [];
  let m; while ((m = re.exec(html))) { const s = m[1]; if (!seen.has(s)) { seen.add(s); out.push(s); } }
  return out;
}
// 프로젝트 상세의 갤러리 이미지 base URL 전량(중복 제거·순서 유지)
function parseImages(html) {
  const re = /static\.wixstatic\.com\/media\/([A-Za-z0-9_]+~mv2\.(?:jpg|jpeg|png))/gi;
  const seen = new Set(); const out = [];
  let m; while ((m = re.exec(html))) { const id = m[1]; if (!seen.has(id)) { seen.add(id); out.push('https://static.wixstatic.com/media/' + id); } }
  return out;
}
// 연결된 필름 프로젝트 slug (사진 프로젝트에서 "FILM → See more")
function parseFilmSlug(html) {
  const re = /\/portfolio-collections\/all\/([a-z0-9-]+-film[a-z0-9-]*)(?:"|\?)/i;
  const m = html.match(re); return m ? m[1] : null;
}
// 필름 페이지의 영상 URL (youtube/vimeo/wix video) best-effort
function parseVideo(html) {
  const yt = html.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
  if (yt) return 'https://www.youtube.com/watch?v=' + yt[1];
  const vi = html.match(/player\.vimeo\.com\/video\/(\d+)/i) || html.match(/vimeo\.com\/(\d+)/i);
  if (vi) return 'https://vimeo.com/' + vi[1];
  return null;
}
// slug 접두사 → 브랜드 표기 (Wix 본문 헤딩 파싱이 불안정해 slug 기반 매핑)
const BRAND_MAP = [
  ['barrel', 'BARREL'], ['puma', 'PUMA'], ['borntowin', 'BORN TO WIN'],
  ['markandlona', 'MARK & LONA'], ['umbro', 'UMBRO'], ['undermycar', 'UNDERMYCAR'],
  ['nationalgeographic', 'NATIONAL GEOGRAPHIC'], ['wilson', 'WILSON'], ['arena', 'ARENA'],
  ['mammut', 'MAMMUT'], ['psg', 'PSG'], ['lecoq', 'LE COQ SPORTIF'],
  ['hydrogen', 'HYDROGEN'], ['metrocity', 'METROCITY'],
];
function deriveBrand(slug) {
  for (const [k, v] of BRAND_MAP) if (slug.startsWith(k)) return v;
  return null;
}

async function importOne(slug, order) {
  const url = ALL_URL + '/' + slug;
  const html = await fetchText(url);
  const images = parseImages(html);
  const kind = /-film/.test(slug) ? 'film' : 'photo';
  const row = {
    slug,
    title: meta(html, 'og:title') || slug,
    brand: deriveBrand(slug),
    description: meta(html, 'og:description') || null,
    kind,
    category: 'campaign',
    film_slug: kind === 'photo' ? parseFilmSlug(html) : null,
    video_url: kind === 'film' ? parseVideo(html) : null,
    cover_url: images[0] || meta(html, 'og:image').split('/v1/')[0] || null,
    images,
    source_wix_url: url,
    sort_order: order,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from('studio_projects')
    .upsert(row, { onConflict: 'slug' });
  if (error) throw error;
  return { slug, kind, imageCount: images.length };
}

module.exports = withCronGuard('studio-import', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) { const u = await requireAdmin(req, res); if (!u) return; }

  const q = req.query || {};
  const perCall = Math.max(1, Math.min(20, parseInt(q.max || '6', 10) || 6));
  const started = Date.now();
  const results = { imported: [], skipped_existing: 0, failed: [], done: false };

  try {
    // 1) 전 프로젝트 slug 발견 (/all)
    const allHtml = await fetchText(ALL_URL);
    const slugs = parseSlugs(allHtml);
    if (!slugs.length) return res.status(200).json({ error: 'slug 목록을 찾지 못함(Wix 렌더 변경?)', done: false });

    // 2) 이미 적재된 slug
    const { data: existing } = await supabaseAdmin.from('studio_projects').select('slug');
    const have = new Set((existing || []).map((r) => r.slug));
    results.skipped_existing = have.size;

    // 3) 미적재분만 순서대로 수집 (재실행 시 이어감). ?force=1 이면 전량 재수집.
    const force = q.force === '1';
    const pending = slugs.map((s, i) => ({ slug: s, order: i })).filter((x) => force || !have.has(x.slug));

    if (!pending.length) {
      results.done = true;
      results.total_in_collection = slugs.length;
      return res.status(200).json(results);
    }

    for (const { slug, order } of pending) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      if (results.imported.length >= perCall) break;
      try { results.imported.push(await importOne(slug, order)); }
      catch (e) { results.failed.push({ slug, error: (e && e.message) || String(e) }); }
    }

    results.total_in_collection = slugs.length;
    results.remaining = pending.length - results.imported.length;
    results.done = results.remaining <= 0 && results.failed.length === 0;
    return res.status(200).json(results);
  } catch (e) {
    console.error('[studio-import] error', e);
    throw e;
  }
});
