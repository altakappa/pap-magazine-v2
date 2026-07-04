/**
 * PAP Magazine — Sitemap Index
 *
 * Splits the single sitemap into per-content-type sitemaps so each can scale
 * independently and be reported on separately in Search Console / Naver / Bing.
 *
 * Crawlers should fetch /sitemap-index.xml first, then walk to each child.
 */

const { handleCors } = require('./_lib/cors');

const SITE = 'https://www.pap-magazine.com';

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const today = new Date().toISOString().slice(0, 10);
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    '  <sitemap><loc>' + SITE + '/sitemap.xml</loc><lastmod>' + today + '</lastmod></sitemap>\n' +
    '  <sitemap><loc>' + SITE + '/sitemap-editorials.xml</loc><lastmod>' + today + '</lastmod></sitemap>\n' +
    '  <sitemap><loc>' + SITE + '/sitemap-articles.xml</loc><lastmod>' + today + '</lastmod></sitemap>\n' +
    '  <sitemap><loc>' + SITE + '/sitemap-films.xml</loc><lastmod>' + today + '</lastmod></sitemap>\n' +
    '  <sitemap><loc>' + SITE + '/sitemap-news.xml</loc><lastmod>' + today + '</lastmod></sitemap>\n' +
    '</sitemapindex>\n';

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  return res.status(200).send(xml);
};
