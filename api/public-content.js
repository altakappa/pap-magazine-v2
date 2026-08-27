/**
 * PAP Magazine — 공개 콘텐츠 JSON API (Ⅱ-25, 확장전략55 — 2026-08-27 신설)
 * Route: /api/public/content.json → /api/public-content (vercel.json rewrite)
 *
 * 왜: 연구자·개발자·AI 도구가 PAP 데이터를 구조화된 형태로 쓰면 그 결과물이
 * 인용의 씨앗이 된다. 이미 공개 화면에 있는 메타데이터만 내보낸다 —
 * 새 정보 노출 없음(본문·이미지 원본·비공개 필드 제외).
 *
 * 캐시: s-maxage 1시간. 읽기 전용, 인증 없음, CORS 개방.
 */

'use strict';

const { supabaseAdmin } = require('./_lib/supabase');

const SITE = 'https://www.pap-magazine.com';

function creditsOut(credits) {
  if (!Array.isArray(credits)) return [];
  return credits.slice(0, 20)
    .filter(c => c && c.name)
    .map(c => ({ name: c.name, roles: Array.isArray(c.roles) ? c.roles.slice(0, 4) : [] }));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const [artsR, edsR] = await Promise.all([
      supabaseAdmin.from('articles')
        /* articles 에 description 컬럼 없음 (2026-08-27 실측) — seo_description 사용 */
        .select('title, title_en, slug, custom_url, id, published_date, seo_description, description_en')
        .eq('status', 'published')
        .order('published_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50),
      supabaseAdmin.from('editorials')
        .select('title, title_en, slug, id, published_date, description, credits, tags')
        .eq('status', 'published')
        .not('published_date', 'is', null)
        .order('published_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (artsR.error) console.error('[public-content] articles query failed:', artsR.error.message);
    if (edsR.error) console.error('[public-content] editorials query failed:', edsR.error.message);

    const articles = (artsR.data || []).map(a => ({
      title: a.title,
      title_en: a.title_en || undefined,
      url: SITE + '/article/' + encodeURIComponent(a.slug || a.custom_url || a.id),
      published_date: a.published_date,
      description: a.seo_description || a.description_en || undefined,
    }));
    const editorials = (edsR.data || []).map(e => ({
      title: e.title,
      title_en: e.title_en || undefined,
      url: SITE + '/editorial/' + encodeURIComponent(e.slug || e.id),
      published_date: e.published_date,
      description: e.description || undefined,
      credits: creditsOut(e.credits),
      tags: Array.isArray(e.tags) ? e.tags.slice(0, 10) : [],
    }));

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      source: 'PAP MAGAZINE (' + SITE + ')',
      license: 'Metadata may be quoted with attribution and a link to the canonical URL. Images and full texts remain copyrighted — see ' + SITE + '/editorial-policy',
      docs: SITE + '/llms.txt',
      articles,
      editorials,
    });
  } catch (err) {
    console.error('[public-content]', (err && err.message) || err);
    return res.status(500).json({ error: 'temporary error' });
  }
};
