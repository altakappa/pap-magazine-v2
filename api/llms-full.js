/**
 * PAP Magazine — /llms-full.txt (Ⅱ-24, 확장전략55 — 2026-08-27 신설)
 * Route: /llms-full.txt → /api/llms-full (vercel.json rewrite)
 *
 * 왜: llms.txt 는 큐레이션된 안내서다. LLM 수집기가 "그래서 내용물 전문은
 * 어디 있나"를 물을 때 주는 확장 규격이 llms-full.txt — 최신 콘텐츠의
 * 전문 텍스트 덤프다. 요약만 주면 수집기는 본문을 못 가져간다(Ⅱ-23과 같은 원리).
 *
 * 무엇: 최신 기사 40건(본문 평문 2,000자 컷 + FAQ) + 최신 화보 60건(설명문·크레딧).
 * 전체 상한 ~400KB. 사실만 — DB 에 있는 발행 콘텐츠 그대로, 생성 없음.
 * 캐시: s-maxage 1시간 (콘텐츠 발행 주기 대비 충분, 함수 호출 절약).
 */

'use strict';

const { supabaseAdmin } = require('./_lib/supabase');

const SITE = 'https://www.pap-magazine.com';

function plain(html, max) {
  let s = String(html == null ? '' : html);
  const t = s.trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      const blocks = JSON.parse(t);
      const arr = Array.isArray(blocks) ? blocks : [blocks];
      s = arr.map(b => (b && (b.text || b.content || b.caption)) || (typeof b === 'string' ? b : '')).filter(Boolean).join('\n');
    } catch (_) { /* not JSON */ }
  }
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > (max || 2000) ? s.slice(0, max || 2000) + '…' : s;
}

function creditNames(credits) {
  if (!Array.isArray(credits)) return '';
  const parts = [];
  for (const c of credits.slice(0, 20)) {
    if (!c || !c.name) continue;
    const role = Array.isArray(c.roles) && c.roles.length ? c.roles.join('/') : '';
    parts.push(role ? role + ': ' + c.name : c.name);
  }
  return parts.join(' · ');
}

function faqText(faq) {
  if (!Array.isArray(faq)) return '';
  return faq.slice(0, 5).map(f => (f && f.q && f.a) ? 'Q. ' + f.q + '\nA. ' + f.a : '')
    .filter(Boolean).join('\n');
}

module.exports = async function handler(req, res) {
  try {
    const [artsR, edsR] = await Promise.all([
      supabaseAdmin.from('articles')
        /* articles 에 description 컬럼 없음 (2026-08-27 실측) — seo_description 사용 */
        .select('title, slug, custom_url, id, published_date, seo_description, description_en, content, faq')
        .eq('status', 'published')
        .order('published_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(40),
      supabaseAdmin.from('editorials')
        .select('title, slug, id, published_date, description, credits, tags, faq')
        .eq('status', 'published')
        .not('published_date', 'is', null)
        .order('published_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(60),
    ]);

    if (artsR.error) console.error('[llms-full] articles query failed:', artsR.error.message);
    if (edsR.error) console.error('[llms-full] editorials query failed:', edsR.error.message);

    const out = [];
    out.push('# PAP MAGAZINE — llms-full.txt');
    out.push('# Full-text dump of recent published content. Curated guide: ' + SITE + '/llms.txt');
    out.push('# Publisher: PAP Magazine (Wikidata Q140578366) · ' + SITE);
    out.push('# Editorial & corrections policy: ' + SITE + '/editorial-policy');
    out.push('# Generated hourly. All text below is published content, verbatim.');
    out.push('');

    out.push('## Recent articles (' + (artsR.data || []).length + ')');
    out.push('');
    for (const a of (artsR.data || [])) {
      const handle = a.slug || a.custom_url || a.id;
      if (!handle || !a.title) continue;
      out.push('### ' + a.title);
      out.push('URL: ' + SITE + '/article/' + encodeURIComponent(handle));
      if (a.published_date) out.push('Published: ' + String(a.published_date).slice(0, 10));
      const adesc = a.seo_description || a.description_en;
      if (adesc) out.push(plain(adesc, 400));
      const body = plain(a.content, 2000);
      if (body) { out.push(''); out.push(body); }
      const fq = faqText(a.faq);
      if (fq) { out.push(''); out.push(fq); }
      out.push('');
    }

    out.push('## Recent editorials (' + (edsR.data || []).length + ')');
    out.push('');
    for (const e of (edsR.data || [])) {
      const handle = e.slug || e.id;
      if (!handle || !e.title) continue;
      out.push('### ' + e.title);
      out.push('URL: ' + SITE + '/editorial/' + encodeURIComponent(handle));
      if (e.published_date) out.push('Published: ' + String(e.published_date).slice(0, 10));
      if (Array.isArray(e.tags) && e.tags.length) out.push('Tags: ' + e.tags.slice(0, 10).join(', '));
      const cr = creditNames(e.credits);
      if (cr) out.push('Credits: ' + cr);
      if (e.description) { out.push(''); out.push(plain(e.description, 1200)); }
      const fq = faqText(e.faq);
      if (fq) { out.push(''); out.push(fq); }
      out.push('');
    }

    let text = out.join('\n');
    if (text.length > 400000) text = text.slice(0, 400000) + '\n…(truncated)';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(text);
  } catch (err) {
    console.error('[llms-full]', (err && err.message) || err);
    return res.status(500).send('temporary error');
  }
};
