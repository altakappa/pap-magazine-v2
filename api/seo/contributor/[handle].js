/**
 * PAP Magazine — 기여자 프로필 /contributor/:handle (Ⅲ-30, 2026-08-27)
 * 관문: 인물 크레딧 + 발행 화보 MIN_EDITORIALS(2)편 이상 — 미달이면 404 (씬페이지 방지).
 * Person JSON-LD(sameAs 인스타그램) + 참여 화보 그리드. 공개 크레딧 정보만 사용.
 */

'use strict';

const { supabaseAdmin } = require('../../_lib/supabase');
const { handleCors } = require('../../_lib/cors');
const { MIN_EDITORIALS, SITE, escText, escAttr, normHandle, isPersonRole, pageShell } =
  require('../../_lib/contributorProfile');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const handle = normHandle(req.query && req.query.handle);
  if (!handle) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send('<!DOCTYPE html><title>Not found</title>Not found');
  }
  try {
    const { data, error } = await supabaseAdmin.rpc('contributor_editorials', { p_handle: handle });
    if (error) throw error;

    /* RPC 는 (화보 × 크레딧행) 곱을 돌려준다 — 화보 단위로 dedupe, 역할은 합산 */
    const byId = new Map();
    const roleSet = new Set();
    let name = '';
    for (const r of (data || [])) {
      (r.roles || []).forEach(x => { if (x && isPersonRole(x)) roleSet.add(String(x)); });
      if (!name && r.cname) name = String(r.cname);
      if (!byId.has(String(r.id))) {
        byId.set(String(r.id), {
          title: r.title, slug: r.slug || r.id,
          img: r.thumbnail || r.cover_image || '',
          date: r.published_date,
        });
      }
    }
    const eds = Array.from(byId.values());
    const roles = Array.from(roleSet).slice(0, 6);
    /* 관문: 인물 역할이 하나도 없으면(브랜드 크레딧) 또는 편수 미달이면 404 */
    if (!eds.length || eds.length < MIN_EDITORIALS || !roles.length) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, s-maxage=600');
      return res.status(404).send('<!DOCTYPE html><title>Not found</title>Not found');
    }

    const canonical = SITE + '/contributor/' + handle;
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      mainEntity: {
        '@type': 'Person',
        name: name || handle,
        jobTitle: roles.join(', '),
        sameAs: ['https://www.instagram.com/' + handle + '/'],
        url: canonical,
      },
      hasPart: eds.slice(0, 30).map(e => ({
        '@type': 'CreativeWork', name: e.title,
        url: SITE + '/editorial/' + encodeURIComponent(e.slug),
      })),
    };

    const body =
      '<div class="eyebrow">Contributor</div>\n'
      + '<h1>' + escText(name || handle) + '</h1>\n'
      + '<p class="sub">' + escText(roles.join(' · ')) + ' — PAP MAGAZINE 발행 화보 '
      + eds.length + '편 참여.</p>\n'
      + '<a class="ig" href="https://www.instagram.com/' + escAttr(handle)
      + '/" target="_blank" rel="noopener noreferrer">@' + escText(handle) + ' ↗</a>\n'
      + '<div class="grid">\n'
      + eds.slice(0, 30).map(e =>
          '<a class="card" href="/editorial/' + escAttr(encodeURIComponent(e.slug)) + '">'
          + (e.img ? '<img src="' + escAttr(e.img) + '" alt="' + escAttr(e.title) + '" loading="lazy">' : '')
          + '<div class="t">' + escText(e.title) + '</div>'
          + (e.date ? '<div class="d">' + escText(String(e.date).slice(0, 10)) + '</div>' : '')
          + '</a>').join('\n')
      + '\n</div>\n'
      + '<div class="foot"><a href="/contributors">← 기여자 전체 보기</a> · 크레딧은 발행 시 게재된 '
      + '공개 정보입니다. 정정: <a href="/editorial-policy#corrections">정정 정책</a></div>';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(pageShell(
      escText(name || handle) + ' — PAP MAGAZINE 기여 화보 ' + eds.length + '편',
      (name || handle) + ' (' + roles.join(', ') + ')이 PAP MAGAZINE에 발행한 화보 '
        + eds.length + '편의 크레딧과 작품 목록.',
      canonical, jsonLd, body));
  } catch (err) {
    console.error('[contributor]', (err && err.message) || err);
    return res.status(500).send('temporary error');
  }
};
