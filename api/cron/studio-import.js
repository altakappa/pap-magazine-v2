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

// /all 목록 페이지는 Wix 가 데이터센터(서버) IP 에 축소 렌더를 내려줘 일부만 잡힌다.
// "하나도 빠짐없이" 를 보장하려고 전 프로젝트 slug 를 발견 순서대로 내장한다(2026-07-27 확인, 총 50건).
// 상세페이지 fetch 는 서버에서도 정상이므로 slug 만 확보되면 전량 수집된다.
// 스크랩 결과와 합집합으로 쓰이므로 Wix 에 새 프로젝트가 추가돼도 자동 반영된다.
const SEED_SLUGS = [
  'barrel-2026-jihyo-film', 'barrel-2026-jihyo',
  'puma-inspiredbyhbs-film', 'puma-inspiredbyhbs',
  'borntowin-natty-film', 'borntowin-natty',
  'borntowin-gymbro-1', 'borntowin-gymbro',
  'markandlona-26ss-general-film-1', 'markandlona-26ss-general-1',
  'markandlona-26ss-t-line-film', 'markandlona-26ss-t-line',
  'markandlona-tline-25fw-film-2', 'markandlona-25fw-tline-2',
  'umbro-cleat-film', 'umbro-cleat',
  'markandlona-tline-25fw-film', 'markandlona-tline-25fw',
  'undermycarxcovernat', 'borntowin-openpace',
  'umbro-wintercloset-film', 'umbro-wintercloset',
  'markandlona-25fw-general', 'markandlona-25fw-ppl',
  'nationalgeographic-25fw-ppl', 'undermycarxpuma',
  'borntowin-nightout', 'wilson-25ss-campaign',
  'arena-25ss-campaign-2', 'umbro-meshpack-film', 'umbro-meshpack',
  'umbro-chillout-film', 'umbro-chillout', 'arena-25ss-campaign-1',
  'mammut-25ss-film', 'mammut-25ss-campaign', 'psg-fw2024',
  'lecoq-sportsdown', 'umbro-apresski-film', 'umbro-apresski',
  'umbro-2024fw-ppl', 'hydrogen-2024fw-ppl', 'metrocity-2024fw',
  'mammut-24fw-film', 'mammut-24fw-campaign', 'nationalgeographic-2024-ppl',
  'markandlona-24fw-film-jp', 'markandlona-24fw-film-1',
  'markandlona-24fw-campaign', 'markandlona-24fw-campaign-jp',
];

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
// HTML → 평문 (script/style 제거 후 태그 제거)
function textOf(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' '));
}
// LOCATION 필드 best-effort (없으면 null — 관리자에서 수동 편집 가능). 잘못 잡느니 비운다.
function parseLocation(html) {
  const t = textOf(html);
  const m = t.match(/LOCATION\s*[:\-]?\s*([A-Za-z가-힣][A-Za-z가-힣0-9,.\s'&/()\-]{1,40})/);
  if (!m) return null;
  let v = m[1].replace(/\b(CLIENT|BRAND|CATEGORY|CREDIT|DATE|PROJECT|PHOTOGRAPH|DIRECTOR|MODEL|STYLIST|SEE\s*MORE|ALL|PORTFOLIO)\b[\s\S]*$/i, '');
  v = v.replace(/\s{2,}/g, ' ').replace(/[,.\s]+$/, '').trim();
  return v.length >= 2 ? v.slice(0, 60) : null;
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
  const location = parseLocation(html);
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
  if (location) row.location = location; // 파싱 실패 시 기존 값/수동 편집 보존
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
  const perCall = Math.max(1, Math.min(50, parseInt(q.max || '6', 10) || 6));
  const started = Date.now();
  const results = { imported: [], skipped_existing: 0, failed: [], done: false };

  try {
    // 1) 전 프로젝트 slug 발견: 내장 시드(전량 보장) ∪ /all 스크랩(신규 자동 반영).
    //    /all 은 서버 IP 에 축소 렌더되므로 스크랩만으론 누락된다 → 시드가 바닥을 깐다.
    let scraped = [];
    try { scraped = parseSlugs(await fetchText(ALL_URL)); } catch (_) { /* 스크랩 실패해도 시드로 진행 */ }
    const seen = new Set(); const slugs = [];
    for (const s of SEED_SLUGS.concat(scraped)) { if (!seen.has(s)) { seen.add(s); slugs.push(s); } }
    if (!slugs.length) return res.status(200).json({ error: 'slug 목록 없음', done: false });

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
