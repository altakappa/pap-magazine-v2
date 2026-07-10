/**
 * PAP Magazine — Shared SEO Page Renderer
 *
 * One reusable HTML/schema builder for every server-rendered content type
 * (editorial, article, film, short). Keeping the template here avoids
 * 4×500-line duplicates and makes meta-tag/schema improvements one-edit.
 *
 * Each content endpoint passes a `kind` plus a normalized record and gets
 * back a full <!doctype html> string ready to send.
 */

const SITE = 'https://www.pap-magazine.com';
const SITE_NAME = 'PAP Magazine';
const DEFAULT_OG_IMAGE = 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/c_1_7c42a14014.jpg';
const ORG_LOGO = 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/PAP_LOGO.png';

/* Instagram SEO — 홈의 Organization(@id) 와 동일 엔티티로 묶고, 모든 SSR
 * 상세 페이지의 publisher 에 sameAs 를 실어 Google 지식그래프가 사이트와
 * @pap_magazine 계열 SNS 를 같은 브랜드로 인식하게 한다. */
const ORG_ID = SITE + '/#organization';
// 2026-07: 공식 계정군 확정 — pap_celeb 핸들 교정, pap_icons 추가,
// pap_korea 제거 (PEPPERIT @pepperitmag 로 전환된 별개 매거진 — 동일 엔티티 아님).
const ORG_SAMEAS = [
  'https://www.instagram.com/pap_magazine/',
  'https://www.instagram.com/pap_celeb/',
  'https://www.instagram.com/papfashion_/',
  'https://www.instagram.com/papbeauty_/',
  'https://www.instagram.com/pap_trends/',
  'https://www.instagram.com/papstudios_/',
  'https://www.instagram.com/pap_object/',
  'https://www.instagram.com/pap_icons/',
  'https://www.facebook.com/papmagazine/',
  'https://www.youtube.com/@pap-magazine',
  'https://www.threads.net/@pap_magazine',
  'https://www.pinterest.com/07667zb6r6qwnjy4kbo8nl6hmxbcaz/',
  // 2026-07-07: 신규 공식 채널 — X 자동 게시 + 네이버 블로그 + 틱톡(공식 핸들 확정).
  'https://x.com/papmagazine_',
  'https://blog.naver.com/pap_magazine',
  'https://www.tiktok.com/@pap_magazine'
];
// 허브-스포크 퍼널 — 기사 카테고리에 맞는 니치 계정 (메인과 나란히 노출).
const NICHE_IG = [
  [/beauty/i, 'papbeauty_'],
  [/fashion/i, 'papfashion_'],
  [/news|celeb|music/i, 'pap_celeb'],
  [/art/i, 'papstudios_'],
  [/culture|life|trend/i, 'pap_trends'],
];
function nicheIg(category) {
  const c = String(category || '');
  for (const [re, acct] of NICHE_IG) if (re.test(c)) return acct;
  return null;
}

const ORG_PUBLISHER = {
  '@type': 'Organization',
  '@id': ORG_ID,
  name: SITE_NAME,
  // 전 검색엔진 브랜드 검색 대응 — PAP MAGAZINE / PAP MAG / PAP / PAP 매거진 / PAP매거진 / 팝매거진.
  alternateName: ['PAP MAGAZINE', 'PAP MAG', 'PAP', 'PAP 매거진', 'PAP매거진', '팝매거진', '팹매거진'],
  url: SITE,
  logo: { '@type': 'ImageObject', url: ORG_LOGO },
  sameAs: ORG_SAMEAS
};

/* ── escape helpers ─────────────────────────────────── */
function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escText(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escJson(obj) {
  return JSON.stringify(obj, (k, v) => v === undefined ? undefined : v).replace(/</g, '\\u003c');
}
function fmtIsoDate(d) {
  if (!d) return new Date().toISOString();
  try { return new Date(d).toISOString(); } catch { return new Date().toISOString(); }
}
function truncate(s, n) {
  if (!s) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const parsed = JSON.parse(v); if (Array.isArray(parsed)) return parsed; } catch {}
    return v.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function extractContributors(record) {
  const names = new Set();
  let c = record.credits;
  if (!c) return [];
  try {
    const obj = typeof c === 'string' ? JSON.parse(c) : c;
    if (Array.isArray(obj)) {
      obj.forEach(entry => {
        if (entry && typeof entry === 'object' && entry.name) names.add(String(entry.name));
        else if (typeof entry === 'string') names.add(entry);
      });
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(v => {
        if (Array.isArray(v)) v.forEach(x => x && names.add(String(x.name || x)));
        else if (typeof v === 'string') names.add(v);
      });
    }
  } catch { /* free-form text — ignore */ }
  return Array.from(names).slice(0, 30);
}

/* ── QA #177 — structured credit helpers ────────────────────────────
 *
 * Parses record.credits into the row shape the editorial overlay
 * renders (`Role @handle1 @handle2`). Mirrors the SPA's buildCreditBlock
 * so a direct visit and an in-app overlay show the same crew list.
 *
 * Input shapes:
 *   new (post QA #168) — [{roles:[…], name, instagram, website}, …]
 *   legacy submission  — {photographer:["Name (@handle)"], …}
 *   bare array of {role, name, instagram}  — pre-roles[] form
 *
 * Output:
 *   [{ role: 'Photographer', handles: ['@handle1', '@handle2'] }, …]
 *   Empty array when nothing usable. */
const IG_ROLE_LABEL = {
  photographer: 'Photographer',
  photographer_assist: 'Assisted by', photo_assist: 'Assisted by', photo_asst: 'Assisted by',
  stylist: 'Style', styling: 'Style',
  styling_assist: 'Style assist', stylist_assist: 'Style assist',
  hair: 'Hair', hairstylist: 'Hair', hair_asst: 'Hair assist',
  makeup: 'Make Up', make_up: 'Make Up', mua: 'Make Up', muah: 'Make Up',
  casting: 'Casting', casting_director: 'Casting',
  set_design: 'Set Design', set_designer: 'Set Design',
  art_director: 'Art Director', creative_director: 'Creative Director',
  producer: 'Producer',
  video: 'Video', videographer: 'Video', director: 'Director',
  starring: 'Starring', model: 'Starring',
};
function normalizeHandle(s) {
  if (!s) return '';
  let h = String(s).trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/\/$/, '');
  if (!h) return '';
  return h.charAt(0) === '@' ? h : '@' + h;
}
function humanizeRoleKey(raw) {
  const k = String(raw || '').toLowerCase().replace(/[\s.]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (IG_ROLE_LABEL[k]) return IG_ROLE_LABEL[k];
  const s = String(raw || '').trim();
  if (!s) return 'Credit';
  if (/^[a-z0-9_]+$/.test(s)) return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return s;
}
function extractStructuredCredits(record) {
  const c = record.credits;
  if (!c) return [];
  let obj;
  try { obj = typeof c === 'string' ? JSON.parse(c) : c; } catch { return []; }
  if (!obj) return [];
  const rows = []; // {role, handles}
  if (Array.isArray(obj)) {
    obj.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const handle = normalizeHandle(entry.instagram || entry.website || '');
      if (!handle && !entry.name) return;
      // QA #302 — 다중 역할 병합. 'Photo & Art Director' 처럼 모두 표기.
      const _rolesArr = Array.isArray(entry.roles) && entry.roles.length
        ? entry.roles
        : (entry.role ? [entry.role] : ['Credit']);
      const role = _rolesArr
        .map(function (r) { return humanizeRoleKey(r); })
        .filter(Boolean)
        .join(' & ') || humanizeRoleKey(_rolesArr[0]);
      const handles = handle ? [handle] : (entry.name ? [escText(entry.name)] : []);
      rows.push({ role, handles });
    });
  } else if (typeof obj === 'object') {
    Object.keys(obj).forEach((roleKey) => {
      const arr = Array.isArray(obj[roleKey]) ? obj[roleKey] : [obj[roleKey]];
      const role = humanizeRoleKey(roleKey);
      const handles = [];
      arr.forEach((entry) => {
        if (!entry) return;
        if (typeof entry === 'object') {
          const h = normalizeHandle(entry.instagram || entry.website || '');
          if (h) handles.push(h);
          return;
        }
        const m = String(entry).match(/\(([^)]+)\)/);
        if (m) {
          const h = normalizeHandle(m[1]);
          if (h) handles.push(h);
        }
      });
      if (handles.length) rows.push({ role, handles });
    });
  }
  return rows;
}

/* QA #177 — fashion brand chips ("Wearing" section).
 * Input shape: record.fashion = { brands: [{name, instagram}, …] } */
function extractFashionBrands(record) {
  const f = record.fashion;
  if (!f) return [];
  let obj;
  try { obj = typeof f === 'string' ? JSON.parse(f) : f; } catch { return []; }
  const arr = obj && Array.isArray(obj.brands) ? obj.brands : [];
  const seen = new Set();
  const out = [];
  arr.forEach((b) => {
    if (!b) return;
    const handle = normalizeHandle(b.instagram || b.name || '');
    if (!handle) return;
    const key = handle.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(handle);
  });
  return out;
}

/* QA #177 — per-image credit map { img_1: "@brand Type, @brand2 Type2" }.
 * Returns the matching credit string for the 1-based gallery index, or ''. */
function getImageCredit(record, oneBasedIdx) {
  const f = record.fashion;
  if (!f) return '';
  let obj;
  try { obj = typeof f === 'string' ? JSON.parse(f) : f; } catch { return ''; }
  const map = obj && obj.imageCredits && typeof obj.imageCredits === 'object' ? obj.imageCredits : null;
  if (!map) return '';
  return String(map['img_' + oneBasedIdx] || '').trim();
}

/* ── per-kind config: route prefix, breadcrumb labels, default schema ── */
const KIND = {
  editorial: {
    pathPrefix: '/editorial/',
    breadcrumb: { name: 'Magazine', url: SITE + '/magazine' },
    schemaType: 'Article',
    sectionFallback: 'Editorial'
  },
  article: {
    pathPrefix: '/article/',
    breadcrumb: { name: 'Articles', url: SITE + '/articles' },
    schemaType: 'NewsArticle',
    sectionFallback: 'Article'
  },
  film: {
    pathPrefix: '/film/',
    breadcrumb: { name: 'Films', url: SITE + '/films' },
    schemaType: 'VideoObject',
    sectionFallback: 'Film'
  },
  short: {
    pathPrefix: '/short/',
    breadcrumb: { name: 'Films', url: SITE + '/films' },
    schemaType: 'VideoObject',
    sectionFallback: 'Short'
  }
};

/* ── main render function ───────────────────────────── */
function renderSeoHtml(kind, record) {
  const cfg = KIND[kind] || KIND.editorial;
  const slug = record.slug || record.custom_url || record.id;

  /* QA #308 — Film credit inheritance from a linked editorial.
   *
   * When a film is registered by linking an existing editorial (QA #229)
   * we don't re-type the crew list on the film row. In that case the film
   * has an empty `credits` array. If a related editorial IS linked and IT
   * carries the credits, mirror them onto the record so both the SSR
   * <section class="seo-credits"> block AND the Article-schema author list
   * pick them up without any per-caller changes. Only kicks in for the
   * 'film' kind — editorial/article/short don't inherit. */
  if (kind === 'film'
      && (!record.credits
          || (Array.isArray(record.credits) && record.credits.length === 0))
      && record.related_editorial
      && Array.isArray(record.related_editorial.credits)
      && record.related_editorial.credits.length){
    record = Object.assign({}, record, {
      credits: record.related_editorial.credits
    });
  }

  const titleKo = record.title || SITE_NAME;
  const titleEn = record.title_en || titleKo;
  const seoTitle = record.seo_title || `${titleKo} | ${SITE_NAME}`;
  const descKo = record.seo_description || record.description || record.subtitle || `${titleKo} — ${SITE_NAME}`;
  const descEn = record.description_en || descKo;
  const desc = truncate(descKo, 160);

  /* Cover image: per-kind preferred fields */
  const ogImage = record.og_image
    || record.cover_image
    || record.hero_image_url
    || record.thumbnail_url
    || record.thumbnail
    || (record.youtube_id && /^[A-Za-z0-9_-]{11}$/.test(record.youtube_id)
        ? `https://img.youtube.com/vi/${record.youtube_id}/maxresdefault.jpg`
        : null)
    || DEFAULT_OG_IMAGE;

  const canonical = `${SITE}${cfg.pathPrefix}${encodeURIComponent(slug)}`;
  const published = fmtIsoDate(record.published_date);
  const modified = fmtIsoDate(record.updated_at || record.published_date);

  const tags = asArray(record.tags);
  const contributors = extractContributors(record);

  /* Gallery for editorials/articles */
  const gallery = asArray(record.gallery).filter(u => typeof u === 'string').slice(0, 60);
  const allImages = [ogImage, ...gallery].filter(Boolean);

  /* Build the primary schema (Article / NewsArticle / VideoObject).
   * Only emit VideoObject when the stored id is in the canonical 11-char
   * shape — anything else would produce a broken contentUrl/embedUrl that
   * Google rejects from the rich-result. */
  let primarySchema;
  if (cfg.schemaType === 'VideoObject' && record.youtube_id && /^[A-Za-z0-9_-]{11}$/.test(record.youtube_id)) {
    primarySchema = {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: titleKo,
      description: descKo,
      thumbnailUrl: [ogImage].filter(Boolean),
      uploadDate: published,
      contentUrl: `https://www.youtube.com/watch?v=${record.youtube_id}`,
      embedUrl: `https://www.youtube.com/embed/${record.youtube_id}`,
      publisher: ORG_PUBLISHER,
      keywords: tags.length ? tags.join(', ') : undefined,
      inLanguage: 'ko-KR'
    };
  } else {
    // QA #187 — richer Article schema. Adds wordCount + articleBody
    // (truncated) so Google's "About this result" panel can quote the
    // editorial, and switches `image` from bare URLs to ImageObject
    // arrays with caption text — boosts image-search ranking and gives
    // the AI overviews enough metadata to attribute the photographer.
    const bodyForWordCount = String(descKo || '').replace(/\s+/g, ' ').trim();
    const wordCount = bodyForWordCount
      ? bodyForWordCount.split(' ').filter(Boolean).length
      : undefined;
    const imageObjects = allImages.map((u, i) => ({
      '@type': 'ImageObject',
      url: u,
      caption: i === 0 ? `${titleKo} — Cover` : `${titleKo} — Look ${i}`,
      copyrightHolder: { '@type': 'Organization', name: SITE_NAME }
    }));

    primarySchema = {
      '@context': 'https://schema.org',
      '@type': cfg.schemaType,
      headline: titleKo,
      alternativeHeadline: titleEn,
      description: descKo,
      image: imageObjects,
      articleBody: bodyForWordCount ? truncate(bodyForWordCount, 600) : undefined,
      wordCount,
      datePublished: published,
      dateModified: modified,
      author: contributors.length
        ? contributors.map(name => ({ '@type': 'Person', name }))
        : [{ '@type': 'Organization', name: SITE_NAME, url: SITE }],
      publisher: ORG_PUBLISHER,
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      keywords: tags.length ? tags.join(', ') : undefined,
      articleSection: record.issue || record.category || cfg.sectionFallback,
      inLanguage: 'ko-KR',
      // QA #187 — explicit isAccessibleForFree so Google news/Discover
      // doesn't mistake the editorial for paywalled content.
      isAccessibleForFree: true
    };
  }

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: cfg.breadcrumb.name, item: cfg.breadcrumb.url },
      { '@type': 'ListItem', position: 3, name: titleKo, item: canonical }
    ]
  };

  /* HTML pieces */
  const tagHtml = tags.length
    ? '<ul class="seo-tags">' + tags.map(t => `<li>#${escText(t)}</li>`).join('') + '</ul>'
    : '';

  /* QA #177 — structured Credit block matching the in-app overlay
   * (`Role @handle1 @handle2`). Falls back to the legacy flat contributor
   * list when extractStructuredCredits returns nothing — better than
   * dropping the section entirely on very old rows. */
  const creditRows = extractStructuredCredits(record);
  const creditsHtml = creditRows.length
    ? '<section class="seo-credits"><h2>Credits</h2>' +
        creditRows.map(({ role, handles }) =>
          `<div class="ed-cred-row"><div class="ed-cred-role">${escText(role)}</div><div class="ed-cred-val">${handles.map(h => escText(h)).join(' ')}</div></div>`
        ).join('') +
      '</section>'
    : (contributors.length
        ? '<section class="seo-credits"><h2>Credits</h2><ul>' +
            contributors.map(n => `<li>${escText(n)}</li>`).join('') +
          '</ul></section>'
        : '');

  /* QA #271 v4 — SSR 페이지에도 다운로드 영역 추가. SPA overlay와 동일한
   * 동작: 회원가입 사용자만 다운로드 가능, 비로그인 시 CTA 표시.
   * 로그인 상태는 클라이언트 JS가 결정 → 일단 placeholder만 출력하고
   * pap-content-editorial.js가 hydrate 시점에 _renderEditorialDownloads()로
   * 채움. coverUrl + gallery는 data-* attribute로 전달.
   *
   * 단, SSR 페이지는 SPA로 즉시 redirect 되므로 (QA #131), 실제로는 hydrate
   * 시점에 SPA 오버레이가 열리고 그쪽이 다운로드 영역을 렌더한다. 그래도
   * 혹시 redirect 전에 본문이 잠시 노출되는 경우를 대비해 SSR HTML에도
   * 같은 div를 포함. */
  const ssrCoverUrlForDl = String((record && record.cover_image) || '').replace(/"/g, '&quot;');
  const ssrGalleryForDl = (() => {
    try { return Buffer.from(JSON.stringify(asArray(record.gallery))).toString('base64'); }
    catch (_) { return ''; }
  })();
  const ssrTitleForDl = String((record && record.title) || 'editorial')
    .replace(/[^a-zA-Z0-9가-힯 ]/g, '').replace(/\s+/g, '-').toLowerCase() || 'editorial';
  const downloadsHtml =
    '<section class="seo-downloads" id="edDetailDownloads" ' +
      'data-cover-url="' + ssrCoverUrlForDl + '" ' +
      'data-gallery-b64="' + ssrGalleryForDl + '" ' +
      'data-title="' + ssrTitleForDl + '" ' +
      'style="margin-top:24px;padding:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px">' +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
        '<div style="font-size:10px;font-weight:700;letter-spacing:.15em;color:#999">DOWNLOADS</div>' +
        '<div style="font-size:13px;color:#ccc">커버 이미지 + PAP 로고 합성 갤러리 이미지 다운로드는 <strong style="color:#fff">회원가입한 사용자</strong> 전용입니다.</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">' +
          '<a href="/auth.html?mode=signup" style="display:inline-block;padding:10px 22px;border:1px solid #fff;background:#fff;color:#000;font-size:10px;font-weight:700;letter-spacing:.12em;text-decoration:none">회원가입하기 →</a>' +
          '<a href="/auth.html" style="display:inline-block;padding:10px 22px;border:1px solid #555;color:#fff;font-size:10px;font-weight:700;letter-spacing:.12em;text-decoration:none">로그인</a>' +
        '</div>' +
        '<div style="font-size:11px;color:#666;margin-top:4px">개인 사용 및 비상업적 용도에 한해 사용 가능</div>' +
      '</div>' +
    '</section>';

  /* QA #177 — fashion brand chips, mirrors the SPA overlay's "Fashion by"
   * row. Hidden when the editorial has no brands listed. */
  const fashionBrands = extractFashionBrands(record);
  const fashionHtml = fashionBrands.length
    ? '<section class="seo-fashion"><h2>Fashion</h2><div class="ed-fashion-chips">' +
        fashionBrands.map(h => `<span class="ed-fashion-pair"><a class="ed-fashion-chip" href="https://www.instagram.com/${escAttr(h.replace(/^@/, ''))}/" target="_blank" rel="noopener noreferrer">${escText(h)}</a><a class="ed-buy-chip" href="/go/${encodeURIComponent(h.replace(/^@/, '').toLowerCase())}" target="_blank" rel="sponsored nofollow noopener">구매</a></span>`).join('') +
      '</div></section>'
    : '';

  /* QA #177 — optional video embed when an editorial carries a YouTube /
   * Vimeo / Instagram link in record.url. We only handle the common
   * YouTube watch / youtu.be / Vimeo formats here — anything else is
   * rendered as a plain link. Mirrors the SPA's _renderEditorialVideo. */
  function _extractEmbed(url) {
    const u = String(url || '').trim();
    if (!u) return null;
    let m;
    if ((m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/))) {
      return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0` };
    }
    if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/))) {
      return { kind: 'iframe', src: `https://player.vimeo.com/video/${m[1]}` };
    }
    if (/instagram\.com\/(reel|p)\//i.test(u)) {
      return { kind: 'link', href: u, label: 'Watch on Instagram' };
    }
    if (/^https?:\/\//i.test(u)) return { kind: 'link', href: u, label: 'Watch external' };
    return null;
  }
  const videoEmbed = cfg.schemaType !== 'VideoObject' ? _extractEmbed(record.url) : null;
  const videoHtml = videoEmbed
    ? (videoEmbed.kind === 'iframe'
        ? `<section class="seo-video-section"><div class="seo-embed"><iframe src="${escAttr(videoEmbed.src)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div></section>`
        : `<section class="seo-video-section"><a class="seo-embed-link" href="${escAttr(videoEmbed.href)}" target="_blank" rel="noopener noreferrer">${escText(videoEmbed.label)} ↗</a></section>`)
    : '';

  /* QA #162 — Related Editorial card (films only). The /api/films join
   * embeds editorials!related_editorial_id under record.related_editorial,
   * so when a film has one we render a link card to /editorial/<slug>.
   * Hidden when absent so editorials / articles (which don't carry the
   * field) get no empty section. */
  const rel = record.related_editorial && typeof record.related_editorial === 'object'
    ? record.related_editorial : null;
  const relatedEditorialHtml = (cfg.schemaType === 'VideoObject' && rel && rel.title)
    ? `<section class="seo-related"><h2>Related Editorial</h2>
        <a class="seo-related-card" href="/editorial/${escAttr(rel.slug || rel.id || '')}">
          ${rel.cover_image || rel.thumbnail ? `<img src="${escAttr(rel.cover_image || rel.thumbnail)}" alt="${escAttr(rel.title)} — Cover" loading="lazy" width="240" height="160">` : ''}
          <div class="seo-related-meta">
            <div class="seo-related-tagline">RELATED EDITORIAL</div>
            <div class="seo-related-title">${escText(rel.title)}</div>
          </div>
        </a></section>`
    : '';

  /* QA #163 — Related Films cards (editorials only). The /api/editorials
   * reverse-join embeds matching films under record.related_films, so when
   * an editorial has linked films we render cards that click through to
   * /film/<slug>. Mirrors the SPA overlay's _renderRelatedFilms() output. */
  const relFilms = (cfg.schemaType !== 'VideoObject' && Array.isArray(record.related_films))
    ? record.related_films.filter(f => f && f.title && (f.slug || f.id))
    : [];
  const relatedFilmsHtml = relFilms.length
    ? `<section class="seo-related"><h2>Related Films</h2>
        <div class="seo-related-films">${relFilms.map(f => {
          const ytThumb = (f.youtube_id && /^[A-Za-z0-9_-]{11}$/.test(f.youtube_id))
            ? `https://img.youtube.com/vi/${f.youtube_id}/hqdefault.jpg` : '';
          const thumb = f.thumbnail_url || ytThumb || '';
          return `<a class="seo-related-card" href="/film/${escAttr(f.slug || f.id)}">
            ${thumb ? `<img src="${escAttr(thumb)}" alt="${escAttr(f.title)} — Cover" loading="lazy" width="240" height="160">` : ''}
            <div class="seo-related-meta">
              <div class="seo-related-tagline">FILM</div>
              <div class="seo-related-title">${escText(f.title)}</div>
            </div>
          </a>`;
        }).join('')}</div></section>`
    : '';

  /* Hero — image for editorial/article, YouTube embed for film/short.
   *
   * youtube_id has to match the canonical 11-char id shape before we
   * concatenate it into the embed URL. Without this guard, a legacy row
   * whose youtube_id is a full URL ("https://www.youtube.com/<id>")
   * produces an iframe src like
   *   https://www.youtube-nocookie.com/embed/https://www.youtube.com/<id>
   * which YouTube serves as a blank page (QA #160 — "Selects" film).
   * The new admin form (saveFilm + savePost) refuses to insert non-id-
   * shaped values, but historical rows still need this defence. */
  const isValidYtId = typeof record.youtube_id === 'string'
    && /^[A-Za-z0-9_-]{11}$/.test(record.youtube_id);
  const heroHtml = (cfg.schemaType === 'VideoObject' && isValidYtId)
    ? `<div class="seo-video"><iframe src="https://www.youtube-nocookie.com/embed/${escAttr(record.youtube_id)}?rel=0" title="${escAttr(titleKo)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
    : ogImage
      ? `<div class="seo-hero"><img src="${escAttr(ogImage)}" alt="${escAttr(titleKo)} — Cover" loading="eager" fetchpriority="high" width="1200" height="800" data-pin-url="${escAttr(canonical)}" data-pin-media="${escAttr(ogImage)}" data-pin-description="${escAttr(titleKo + ' — PAP Magazine editorial')}"></div>`
      : '';

  /* QA #177 — gallery now annotates each image with the per-look fashion
   * credit string when fashion.imageCredits has one for that index. Same
   * data path the SPA uses (`@brand1 Item, @brand2 Item2`). The caption
   * sits below the image instead of as a hover overlay so it works
   * without JS (matters for SSR/crawlers + accessibility). */
  const galleryHtml = gallery.length
    ? '<section class="seo-gallery" aria-label="Gallery">' +
        gallery.map((src, i) => {
          const credit = getImageCredit(record, i + 1);
          // Pinterest 리치핀/저장 최적화 (2026-07): 각 이미지에 data-pin-*
          // 를 실어 방문자가 핀 저장 시 캐노니컬 PAP 페이지로 역링크되고
          // 룩·크레딧이 설명으로 채워진다 → 콘텐츠가 핀터레스트 검색
          // 그래프로 유입되는 플라이휠.
          const pinDesc = titleKo + ' — Look ' + (i + 1) + (credit ? ' · ' + credit : '') + ' | PAP Magazine';
          return `<figure>`
            + `<img src="${escAttr(src)}" alt="${escAttr(titleKo)} — Look ${i + 1}" loading="lazy" decoding="async" data-pin-url="${escAttr(canonical)}" data-pin-media="${escAttr(src)}" data-pin-description="${escAttr(pinDesc)}">`
            + (credit ? `<figcaption class="ed-img-credits">${escText(credit)}</figcaption>` : '')
            + `</figure>`;
        }).join('') +
      '</section>'
    : '';

  /* Content body for articles.
     QA(2026-07): admin v2 는 content 를 JSON 블록 배열
     ([{type:'text'|'image'|'quote'|'video'|'videogroup'|'gallery'|'slide', …}])
     로 저장한다. 예전엔 이 문자열을 그대로 출력해서, /article/<slug> 직접
     진입 시(기사 SSR 은 SPA 로 리다이렉트하지 않음) PC·모바일 모두 원본
     JSON([{"type":...}])이 노출됐다. 여기서 파싱해 정적 시맨틱 HTML 로
     렌더한다 — SPA 의 _renderArticleBlocks(pap-content-article.js) 서버 미러.
     상호작용(슬라이드 화살표·라이트박스)은 없지만 텍스트·이미지·영상·갤러리는
     정상 노출된다. 블록 배열이 아니면(레거시 HTML/텍스트) 원문을 그대로 쓴다. */
  function _renderArticleBody(content) {
    let blocks = null;
    if (typeof content === 'string' && content.trim().charAt(0) === '[') {
      try { const p = JSON.parse(content); if (Array.isArray(p)) blocks = p; } catch { blocks = null; }
    } else if (Array.isArray(content)) {
      blocks = content;
    }
    if (!blocks) {
      return typeof content === 'string' ? content : escText(JSON.stringify(content));
    }
    const iframe = (src) => `<div style="margin:36px 0;position:relative;padding-bottom:56.25%;height:0;overflow:hidden"><iframe src="${escAttr(src)}" loading="lazy" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe></div>`;
    const vid = (u) => {
      const e = _extractEmbed(u);
      if (e && e.kind === 'iframe') return iframe(e.src);
      if (u) return `<p style="margin:36px 0;font-size:12px"><a href="${escAttr(u)}" target="_blank" rel="noopener" style="color:#aaa">${escText(u)} ↗</a></p>`;
      return '';
    };
    let html = '';
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      const t = b.type || 'text';
      const c = (b.content || '').toString();
      const url = (b.url || '').toString();
      if (t === 'text') {
        html += c.split(/\n\n+/).map(p => `<p style="margin:0 0 22px;line-height:1.9">${escText(p).replace(/\n/g, '<br>')}</p>`).join('');
      } else if (t === 'image') {
        if (!url) continue;
        html += `<figure style="margin:36px 0"><img src="${escAttr(url)}" alt="${escAttr(c)}" loading="lazy" style="width:100%;display:block;border-radius:2px">${c ? `<figcaption style="margin-top:12px;font-size:12px;color:#888;text-align:center;letter-spacing:.04em;line-height:1.6">${escText(c)}</figcaption>` : ''}</figure>`;
      } else if (t === 'quote') {
        const src = (b.source || '').toString();
        html += `<blockquote style="margin:36px 0;padding:20px 26px;border-left:3px solid #999;font-style:italic;color:#ddd;font-size:16px;line-height:1.85">${escText(c)}${src ? `<footer style="margin-top:14px;font-size:11px;color:#888;font-style:normal;text-align:right">— ${escText(src)}</footer>` : ''}</blockquote>`;
      } else if (t === 'video') {
        html += vid(c || url);
      } else if (t === 'videogroup') {
        const vids = Array.isArray(b.videos) ? b.videos : [];
        if (!vids.length) continue;
        html += '<div style="margin:36px 0;display:flex;flex-direction:column;gap:24px">';
        for (const v of vids) { if (v && v.url) html += `<div style="margin:0">${vid(v.url)}${v.caption ? `<div style="margin-top:6px;font-size:11px;color:#888;text-align:center">${escText(v.caption)}</div>` : ''}</div>`; }
        html += '</div>';
      } else if (t === 'gallery') {
        const imgs = Array.isArray(b.images) ? b.images : [];
        if (!imgs.length) continue;
        html += '<div style="margin:36px 0;display:grid;grid-template-columns:1fr 1fr;gap:12px">';
        for (const im of imgs) { if (im && im.url) html += `<figure style="margin:0"><img src="${escAttr(im.url)}" alt="${escAttr(im.caption || '')}" loading="lazy" style="width:100%;aspect-ratio:4/5;object-fit:cover;display:block;border-radius:2px">${im.caption ? `<figcaption style="margin-top:8px;font-size:11px;color:#888;text-align:center;line-height:1.5">${escText(im.caption)}</figcaption>` : ''}</figure>`; }
        html += '</div>';
      } else if (t === 'slide') {
        const imgs = Array.isArray(b.images) ? b.images : [];
        if (!imgs.length) continue;
        html += '<div style="margin:36px 0;display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch">';
        for (const im of imgs) { if (im && im.url) html += `<figure style="margin:0;flex:0 0 88%;scroll-snap-align:center"><img src="${escAttr(im.url)}" alt="${escAttr(im.caption || '')}" loading="lazy" style="width:100%;aspect-ratio:4/5;object-fit:cover;display:block;border-radius:2px">${im.caption ? `<figcaption style="margin-top:8px;font-size:11px;color:#888;text-align:center;line-height:1.6">${escText(im.caption)}</figcaption>` : ''}</figure>`; }
        html += '</div>';
      } else {
        html += `<p style="margin:0 0 22px;line-height:1.9">${escText(c)}</p>`;
      }
    }
    return html;
  }
  const bodyHtml = record.content
    ? `<div class="seo-body">${_renderArticleBody(record.content)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko" prefix="og: https://ogp.me/ns#">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${escText(seoTitle)}</title>
<meta name="description" content="${escAttr(desc)}">
${tags.length ? `<meta name="keywords" content="${escAttr(tags.join(', '))}">` : ''}
<meta name="author" content="${escAttr(SITE_NAME)} - ALTAKAPPA Co., Ltd.">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="googlebot" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">

<link rel="canonical" href="${escAttr(canonical)}">
<!-- QA #187 — hreflang covers every locale that has an i18n bundle on
     the SPA. Same canonical URL because translation happens client-side;
     when we ship per-locale SSR variants, point each href to its prefix
     (e.g. /it/editorial/...). x-default keeps non-mapped locales here. -->
<link rel="alternate" hreflang="x-default" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="ko" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="en" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="it" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="fr" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="es" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="ja" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="zh" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="ru" href="${escAttr(canonical)}">
<link rel="alternate" hreflang="de" href="${escAttr(canonical)}">

<meta property="og:type" content="${cfg.schemaType === 'VideoObject' ? 'video.other' : 'article'}">
<meta property="og:title" content="${escAttr(seoTitle)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:url" content="${escAttr(canonical)}">
<meta property="og:site_name" content="${escAttr(SITE_NAME)}">
<meta property="og:image" content="${escAttr(ogImage)}">
<meta property="og:image:secure_url" content="${escAttr(ogImage)}">
<meta property="og:image:alt" content="${escAttr(titleKo)} — Editorial Cover">
<!-- QA #187 + B-4 (2026-07) — Explicit OG image dimensions.
     실측 결과 콘텐츠 커버는 일관되게 IG 표준 4:5 세로(1080×1350, 2000×2500)인데
     기존 1200×800(가로) 선언은 실물과 달라 FB/카카오 첫 공유 시 잘못된 크롭
     힌트를 줬다. 스크레이퍼는 이 값을 비율 힌트로 쓰므로 4:5로 선언한다.
     기본 폴백 이미지만 가로형(2000×1250)이라 분기. -->
<meta property="og:image:width" content="${ogImage === DEFAULT_OG_IMAGE ? '2000' : /img\.youtube\.com/.test(ogImage) ? '1280' : '1080'}">
<meta property="og:image:height" content="${ogImage === DEFAULT_OG_IMAGE ? '1250' : /img\.youtube\.com/.test(ogImage) ? '720' : '1350'}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:locale" content="ko_KR">
<meta property="og:locale:alternate" content="en_US">
<meta property="og:locale:alternate" content="it_IT">
<meta property="article:author" content="${escAttr(SITE_NAME)}">
<meta property="article:section" content="${escAttr(record.issue || record.category || cfg.sectionFallback)}">
<meta property="article:published_time" content="${escAttr(published)}">
<meta property="article:modified_time" content="${escAttr(modified)}">
${tags.map(t => `<meta property="article:tag" content="${escAttr(t)}">`).join('\n')}

<meta name="twitter:card" content="${cfg.schemaType === 'VideoObject' ? 'player' : 'summary_large_image'}">
<meta name="twitter:site" content="@papmagazine_">
<meta name="twitter:creator" content="@papmagazine_">
<meta name="twitter:title" content="${escAttr(seoTitle)}">
<meta name="twitter:description" content="${escAttr(desc)}">
<meta name="twitter:image" content="${escAttr(ogImage)}">
<meta name="twitter:image:alt" content="${escAttr(titleKo)} — Editorial Cover">

<script type="application/ld+json">${escJson(primarySchema)}</script>
<script type="application/ld+json">${escJson(breadcrumbSchema)}</script>

<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#000000">

<!-- QA #187 — LCP preload. The largest paint element on every editorial /
     article page is the hero cover image. Preloading it (with explicit
     fetchpriority=high) gives Lighthouse a tangible LCP boost — usually
     -300~800ms on cold cache. We DON'T preload for VideoObject pages
     because the LCP element there is the YouTube iframe, not an image. -->
${cfg.schemaType !== 'VideoObject' && ogImage ? `<link rel="preload" as="image" fetchpriority="high" href="${escAttr(ogImage)}">` : ''}

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com">
<link rel="preconnect" href="https://igcazquhkwxtqsaqpznx.supabase.co">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/pap-styles.css?v=15">

<style>
  body.seo-loading{background:#000;color:#fff;font-family:Inter,-apple-system,sans-serif;margin:0;padding:0}
  .seo-hero,.seo-video{display:block;width:100%;max-width:1200px;margin:0 auto}
  .seo-hero img{display:block;width:100%;height:auto}
  .seo-video{aspect-ratio:16/9;background:#111}
  .seo-video iframe{width:100%;height:100%;display:block;border:0}
  /* QA(2026-07) #9 — 타이틀 그룹(제목·부제·발행일)은 밀착시키고, 발행일은
     보조 정보로 축소, 그 아래 본문과는 여백을 벌려 위계·리듬을 명확히 한다.
     (제목→부제 12→4, 부제→발행일 24→4, 발행일 13→11px, 발행일→본문 여백 확대) */
  .seo-meta{max-width:800px;margin:32px auto;padding:0 24px;line-height:1.6}
  .seo-meta h1{font-family:'Playfair Display',serif;font-size:clamp(28px,5vw,56px);margin:0 0 4px}
  .seo-meta .alt{opacity:.65;font-style:italic;margin:0 0 4px}
  .seo-meta time{opacity:.5;font-size:11px;letter-spacing:.1em;text-transform:uppercase;display:block;margin-bottom:0}
  .seo-meta .seo-desc-primary{font-size:15px;line-height:1.8;margin:32px 0 12px;white-space:pre-line}
  .seo-meta .seo-desc-en{font-size:13px;line-height:1.75;margin:0 0 12px;opacity:.6;white-space:pre-line;padding-top:14px;border-top:1px dashed rgba(255,255,255,.12)}
  .seo-tags{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:24px 0}
  .seo-tags li{padding:4px 10px;border:1px solid rgba(255,255,255,.2);font-size:12px}
  /* QA #177 — structured credits / fashion / per-image credits to match SPA overlay */
  .seo-credits{max-width:800px;margin:48px auto;padding:0 24px}
  .seo-credits h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin-bottom:16px}
  .seo-credits ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:16px}
  .seo-credits ul li{font-size:13px;opacity:.8}
  .ed-cred-row{display:grid;grid-template-columns:160px 1fr;gap:16px;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:13.5px;line-height:1.7}
  .ed-cred-row:last-child{border-bottom:none}
  .ed-cred-role{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.55)}
  .ed-cred-val{color:rgba(255,255,255,.92);word-break:break-word}
  .seo-fashion{max-width:800px;margin:32px auto;padding:0 24px}
  .seo-fashion h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin-bottom:14px}
  .ed-fashion-chips{display:flex;flex-wrap:wrap;gap:8px}
  .ed-fashion-chip{display:inline-block;padding:6px 12px;border:1px solid rgba(255,255,255,.18);font-size:12px;color:rgba(255,255,255,.85);text-decoration:none;transition:background .2s}
  .ed-fashion-chip:hover{background:rgba(255,255,255,.06)}
  .ed-fashion-pair{display:inline-flex}
  .ed-buy-chip{display:inline-block;padding:6px 10px;border:1px solid rgba(255,255,255,.18);border-left:none;font-size:11px;color:#000;background:#fff;text-decoration:none;font-weight:700}
  .ed-buy-chip:hover{opacity:.85}
  .seo-video-section{max-width:1200px;margin:48px auto;padding:0 16px}
  .seo-embed{position:relative;width:100%;aspect-ratio:16/9;background:#111}
  .seo-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
  .seo-embed-link{display:inline-block;padding:14px 28px;border:1px solid rgba(255,255,255,.3);color:#fff;text-decoration:none;font-size:12px;letter-spacing:.12em;text-transform:uppercase}
  .seo-embed-link:hover{background:rgba(255,255,255,.06)}
  .ed-img-credits{margin:8px 0 0;font-size:11px;letter-spacing:.04em;color:rgba(255,255,255,.55);line-height:1.6;font-family:Inter,-apple-system,sans-serif}
  /* Related editorial / films cards — QA #162 + #163 */
  .seo-related{max-width:800px;margin:36px auto;padding:0 24px}
  .seo-related h2{font-size:14px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin-bottom:14px}
  .seo-related-card{display:flex;align-items:center;gap:16px;padding:16px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.02);text-decoration:none;color:inherit;transition:background .2s;margin-bottom:10px}
  .seo-related-card:hover{background:rgba(255,255,255,.05)}
  .seo-related-card img{width:120px;height:80px;object-fit:cover;background:#222;flex-shrink:0}
  .seo-related-meta{flex:1;min-width:0}
  .seo-related-tagline{font-size:9px;font-weight:700;letter-spacing:.2em;color:rgba(201,169,110,.9);text-transform:uppercase;margin-bottom:6px}
  .seo-related-title{font-size:15px;font-weight:600;letter-spacing:.02em;line-height:1.4}
  .seo-related-films{display:flex;flex-direction:column;gap:0}
  .seo-gallery{max-width:1200px;margin:48px auto;padding:0 16px;display:grid;grid-template-columns:1fr;gap:24px}
  .seo-gallery figure{margin:0}
  .seo-gallery img{display:block;width:100%;height:auto;background:#111}
  @media(min-width:900px){.seo-gallery{grid-template-columns:1fr 1fr;gap:32px}}
  .seo-body{max-width:800px;margin:32px auto;padding:0 24px;line-height:1.7;font-size:16px}
  .seo-body p{margin:0 0 1.2em}
  .seo-body img{max-width:100%;height:auto;display:block;margin:24px auto}
  .seo-back{max-width:800px;margin:48px auto 80px;padding:24px;border-top:1px solid rgba(255,255,255,.1);font-size:13px;letter-spacing:.06em;text-transform:uppercase;opacity:.7}
  .seo-back a{color:#fff;text-decoration:none;margin-right:8px}
  .seo-back a:hover{opacity:.7}
  /* 검색 유입 → 인스타그램 전환 모듈 (2026-07). 구글/네이버에서 기사로
     들어온 방문자에게 팔로우 CTA 노출 — 스트릿/셀럽/패션위크 주제 검색
     트래픽을 IG 팔로워로 전환하는 깔때기의 착지점. */
  .ig-funnel{max-width:800px;margin:56px auto 0;padding:36px 28px;border:1px solid rgba(255,255,255,.16);text-align:center}
  .ig-funnel .igf-kicker{font-size:10px;letter-spacing:.32em;text-transform:uppercase;opacity:.55;margin-bottom:14px}
  .ig-funnel .igf-copy{font-size:15px;line-height:1.75;margin-bottom:22px}
  .ig-funnel .igf-copy b{font-weight:600}
  .ig-funnel .igf-btn{display:inline-block;background:#fff;color:#000;padding:13px 34px;font-size:11.5px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;text-decoration:none;transition:opacity .3s}
  .ig-funnel .igf-btn:hover{opacity:.82}
  .ig-funnel .igf-sub{margin-top:14px;font-size:11px;opacity:.5;letter-spacing:.04em}
  .ig-funnel .pin-btn{display:inline-block;margin-left:10px;background:#E60023;color:#fff;padding:13px 30px;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-decoration:none;transition:opacity .3s}
  .ig-funnel .pin-btn:hover{opacity:.85}
</style>
</head>
<body class="seo-loading">
${(kind === 'editorial' || kind === 'film') ? `<!-- QA #178 / #233 — Real-browser redirect bridge.
     The SSR HTML above + meta tags is what crawlers / social-preview
     scrapers consume (they don't run JS). Real users instead get sent to
     the SPA homepage with the kind-specific deep-link, which renders the
     EXACT same overlay as clicking a card from the menu — no parallel
     templates to keep in sync.
     Editorial → ?ed=<slug>   → /editorial/<slug> (final URL)
     Film      → ?film=<slug> → /film/<slug>      (final URL — QA #233)
     ?raw=1 escape hatch leaves the user on the SSR view for debugging /
     archival snapshots.
     Articles / shorts still skip the redirect (TODO: extend the same
     bridge once their slug-based deep-link path lands). -->
<style>
  /* Hide the SSR body the instant we know we'll be redirecting so the
     user doesn't see a flash of the simplified SSR layout. Crawlers
     without JS keep seeing the body normally. */
  html.js-redirecting body{opacity:0!important;transition:none!important}
</style>
<script>
  (function(){
    try {
      var qs = (window.location.search || '').toLowerCase();
      if (qs.indexOf('raw=1') !== -1 || qs.indexOf('no-spa=1') !== -1) return;
      // 리다이렉트 루프 가드 (2026-07 교체) — 예전 영구 boolean 플래그
      // (_pap_ssr_redirect_done)는 세션당 1회만 리다이렉트해서, 다이렉트
      // 진입/새로고침이 SSR 에 갇히는 버그가 있었다. 이제 (kind/slug)별 +
      // 15초 창 + 최대 4회로 좁힌다: 정상 재방문·새로고침은 항상 SPA 로 넘기고
      // (SPA 오픈 성공 시 pap-content-seo.js 가 이 레코드를 즉시 삭제),
      // SPA 오픈이 짧은 시간에 반복 실패할 때만 SSR 에 안착시킨다(무한 루프 차단).
      var _KEY = '_pap_ssr_bounce', _WINDOW_MS = 15000, _MAX = 4;
      var _id = ${JSON.stringify(kind)} + '/' + ${JSON.stringify(slug)};
      var _now = Date.now();
      try {
        var _rec = null;
        try { _rec = JSON.parse(sessionStorage.getItem(_KEY) || 'null'); } catch(_){}
        if (_rec && _rec.id === _id && (_now - _rec.first) < _WINDOW_MS) {
          if (_rec.n >= _MAX) {
            // 짧은 시간에 MAX회 반복 진입 = SPA 가 못 잡는 상황. 레코드를 그대로
            // 두고 리다이렉트 없이 SSR 에 머문다(정상 폴백). 지우지 않기 때문에
            // 창(15초)이 지날 때까지 계속 머물러 루프가 실제로 끊긴다. 창이
            // 만료되면 아래 else 로 리셋되어 이후 정상 재방문은 다시 재시도된다.
            return;
          }
          _rec.n++;
        } else {
          _rec = { id: _id, n: 1, first: _now };
        }
        try { sessionStorage.setItem(_KEY, JSON.stringify(_rec)); } catch(_){}
      } catch(_){}
      document.documentElement.classList.add('js-redirecting');
      // SPA homepage picks up the right query param via deep-link IIFEs
      // in pap-content-seo.js, opens the matching overlay, and pushes
      // /<kind>/<slug> as the final URL.
      var paramName = ${JSON.stringify(kind === 'film' ? 'film' : 'ed')};
      var target = '/?' + paramName + '=' + encodeURIComponent(${JSON.stringify(slug)});
      window.location.replace(target);
    } catch(_){ /* on any error, leave the SSR page visible */ }
  })();
</script>` : ''}

<main class="seo-content">
  <article>
    ${heroHtml}
    <div class="seo-meta">
      <h1>${escText(titleKo)}</h1>
      ${titleEn !== titleKo ? `<p class="alt">${escText(titleEn)}</p>` : ''}
      <time datetime="${escAttr(published)}">${escText(published.slice(0, 10))}${record.issue ? ' · ' + escText(record.issue) : record.category ? ' · ' + escText(record.category) : ''}</time>
      <p class="seo-desc-primary">${escText(descKo)}</p>
      ${descEn && descEn !== descKo ? `<p class="seo-desc-en">${escText(descEn)}</p>` : ''}
      ${tagHtml}
    </div>
    ${bodyHtml}
    ${galleryHtml}
    ${videoHtml}
    ${creditsHtml}
    ${downloadsHtml}
    ${fashionHtml}
    ${relatedEditorialHtml}
    ${relatedFilmsHtml}

    ${record.source_instagram_url && /instagram\.com/.test(String(record.source_instagram_url)) ? `
    <aside class="ig-funnel" style="margin-bottom:0">
      <div class="igf-kicker">On Instagram</div>
      <p class="igf-copy">이 콘텐츠의 원본 게시물이 <b>인스타그램</b>에 있습니다.<br>좋아요·저장하고, 매일 공개되는 새 에디토리얼을 가장 먼저 만나보세요.</p>
      <a class="igf-btn" href="/api/ig-out?src=ssr&to=post&url=${encodeURIComponent(String(record.source_instagram_url).split('?')[0])}" target="_blank" rel="noopener">인스타그램에서 보기 ↗</a>
    </aside>` : ''}

    <aside class="ig-funnel">
      <div class="igf-kicker">PAP Magazine — Instagram</div>
      <p class="igf-copy">매일 업데이트되는 에디토리얼과 패션·셀럽 뉴스,<br><b>인스타그램에서 가장 먼저</b> 만나보세요.</p>
      <a class="igf-btn" href="/api/ig-out?src=ssr&to=profile&url=https%3A%2F%2Fwww.instagram.com%2Fpap_magazine%2F" target="_blank" rel="noopener">Follow @pap_magazine</a>
      ${nicheIg(record.category) ? `<a class="igf-btn" style="background:transparent;color:#bbb;border:1px solid rgba(255,255,255,.25)" href="/api/ig-out?src=ssr&to=profile&url=${encodeURIComponent('https://www.instagram.com/' + nicheIg(record.category) + '/')}" target="_blank" rel="noopener">+ @${nicheIg(record.category)}</a>` : ''}
      ${ogImage ? `<a class="pin-btn" href="https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(canonical)}&media=${encodeURIComponent(ogImage)}&description=${encodeURIComponent(titleKo + ' — PAP Magazine editorial')}" target="_blank" rel="noopener" data-pin-do="none">Pinterest에 저장</a>` : ''}
      <div class="igf-sub">전 세계 크리에이티브 팀과 만드는 월 20+ 에디토리얼 · <a href="${SITE}/network" style="color:inherit">PAP 인스타그램 네트워크 →</a></div>
    </aside>
  </article>
</main>

<nav class="seo-back" aria-label="Site navigation">
  <a href="${SITE}/">← ${escText(SITE_NAME)}</a> ·
  <a href="${SITE}/magazine">Magazine</a> ·
  <a href="${SITE}/articles">Articles</a> ·
  <a href="${SITE}/films">Films</a>
</nav>

<script>
  window._papServerRendered = true;
  window._papInitialContent = ${JSON.stringify({ kind, slug })};
</script>
<script src="/pap-geo-lang.js"></script>
<script src="/cookie-consent.js" defer></script>
<!-- QA(2026-07) #11 — 공통 헤더/햄버거 nav 통일. pap-header.js 는 자체 CSS·함수를
     주입하는 self-contained 스크립트라 이 SSR 페이지에서도 SPA 와 동일한 헤더를
     보여준다. (에디토리얼/필름 SSR 은 위 브릿지로 SPA 리다이렉트되지만, 기사 SSR 은
     리다이렉트하지 않으므로 직접 진입 시 헤더 일치가 특히 중요.) _navGo 는
     navigateWithInterstitial 부재 시 location.href 로 폴백한다. -->
<script src="/pap-header.js?v=17" defer></script>
</body>
</html>`;
}

/* ── 404 page ───────────────────────────────────────── */
function renderNotFoundHtml(kind, slug) {
  const cfg = KIND[kind] || KIND.editorial;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Not Found | PAP Magazine</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${cfg.breadcrumb.url}">
<style>body{background:#000;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}a{color:#fff}</style>
</head><body>
<main>
  <h1>404 — Not Found</h1>
  <p>The ${kind} you're looking for may have been removed or renamed.</p>
  <p><a href="${cfg.breadcrumb.url}">Browse ${cfg.breadcrumb.name} →</a></p>
</main></body></html>`;
}

module.exports = { renderSeoHtml, renderNotFoundHtml, KIND, SITE, SITE_NAME };
