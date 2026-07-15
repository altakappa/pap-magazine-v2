/**
 * PAP Magazine — Sitemap Index
 *
 * Splits the single sitemap into per-content-type sitemaps so each can scale
 * independently and be reported on separately in Search Console / Naver / Bing.
 *
 * Crawlers should fetch /sitemap-index.xml first, then walk to each child.
 *
 * 2026-07-16 — lastmod 를 "오늘"이 아니라 각 콘텐츠 타입의 실제 최신
 * updated_at/published_date 로. 항상 오늘이면 신선도 신호가 무의미해지고,
 * 크롤러가 매번 전 자식 사이트맵을 다시 긁는다. DB 실패 시 오늘로 폴백.
 */

const { handleCors } = require('./_lib/cors');
const { supabaseAdmin } = require('./_lib/supabase');

const SITE = 'https://www.pap-magazine.com';

// 테이블별 최신 갱신 시각 (YYYY-MM-DD). 실패/빈 값 → null.
async function latest(table, col) {
  try {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(col)
      .eq('status', 'published')
      .not(col, 'is', null)
      .order(col, { ascending: false })
      .limit(1);
    if (error || !data || !data.length) return null;
    const v = data[0][col];
    return v ? String(v).slice(0, 10) : null;
  } catch (_) { return null; }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const today = new Date().toISOString().slice(0, 10);

  // 병렬 조회 — 어느 하나가 실패해도 나머지는 유지.
  const [edMod, artMod, filmMod, shortMod] = await Promise.all([
    latest('editorials', 'updated_at'),
    latest('articles', 'updated_at'),
    latest('films', 'updated_at'),
    latest('shorts', 'updated_at'),
  ]);
  const filmsMod = [filmMod, shortMod].filter(Boolean).sort().pop() || today;
  const row = (path, lastmod) =>
    '  <sitemap><loc>' + SITE + path + '</loc><lastmod>' + (lastmod || today) + '</lastmod></sitemap>\n';

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    row('/sitemap.xml', edMod) +               // 정적 페이지 + 에디토리얼
    row('/sitemap-editorials.xml', edMod) +
    row('/sitemap-articles.xml', artMod) +
    row('/sitemap-films.xml', filmsMod) +
    row('/sitemap-news.xml', artMod) +         // 뉴스 = 최근 48h 기사
    row('/sitemap-brands.xml', edMod) +        // 브랜드 허브는 에디토리얼 발행에 연동
    '</sitemapindex>\n';

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  return res.status(200).send(xml);
};
