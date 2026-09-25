'use strict';
/**
 * GET /ig  → 인스타그램 프로필 링크 페이지 (2026-09-25, 도메니코 "전부 적용")
 *
 * 왜: 팔로워 384,869명인데 IG→웹 클릭이 30일 214번. 인스타 캡션엔 링크를 못 다니
 * 프로필 링크 하나가 사실상 유일한 문이다. 외부 링크 모음 서비스 대신 우리 페이지를 둔다:
 * 한 번 거치지 않고, 들어온 사람 수를 우리 표(social_inclicks src=ig campaign=bio)로 잰다.
 *
 * 내용 (매 방문 최신, 받는 사람 언어 하나):
 *   이번 주 PAP 화보·기사 (최근 14일 조회수 순 6개, 부족하면 최신으로 채움)
 *   뉴스레터 · 서브미션 · 멤버십 · 전체 화보
 * 모든 링크 utm_source=ig_bio. 도착 페이지 계측과 별개로, 이 페이지 방문 자체도 기록한다.
 * CDN 캐시를 두지 않는다 (캐시되면 함수가 안 돌아 방문 기록이 빠진다). 화보 목록은 함수 안에서 10분 캐시.
 */
const { supabaseAdmin } = require('./_lib/supabase');
const { IG_PAGE, pickLang } = require('./_lib/igLandingCopy');
const { weeklyCopy } = require('./_lib/weeklyNewsCopy');
const { logSocialInclick } = require('./_lib/socialInclick');

const SITE = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';
const UTM = 'utm_source=ig_bio&utm_medium=social&utm_campaign=bio';
const CACHE_MS = 10 * 60 * 1000;
let cache = null;   // { at, rows }

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function withUtm(u) { return u + (u.includes('?') ? '&' : '?') + UTM; }
function localPath(lang, kind, slug) {
  const pre = lang === 'ko' ? '' : '/' + lang;   // 사이트 규칙: 한국어는 앞말 없음, 나머지는 /en /it …
  return SITE + pre + '/' + kind + '/' + encodeURIComponent(slug);
}

async function loadRows(db) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const [ed, ar] = await Promise.all([
    db.from('editorials').select('id, title, slug, cover_image, thumbnail, view_count, published_date')
      .eq('status', 'published').order('published_date', { ascending: false }).limit(24),
    db.from('articles').select('id, title, title_en, slug, thumbnail_url, hero_image_url, view_count, published_date')
      .eq('status', 'published').order('published_date', { ascending: false }).limit(24),
  ]);
  const eds = ((ed && ed.data) || []).filter((e) => e.slug && e.title && (e.cover_image || e.thumbnail))
    .map((e) => ({ kind: 'editorial', id: e.id, slug: e.slug, img: e.cover_image || e.thumbnail, title: e.title, views: e.view_count || 0, date: String(e.published_date || '') }));
  const ars = ((ar && ar.data) || []).filter((a) => a.slug && a.title && (a.thumbnail_url || a.hero_image_url))
    .map((a) => ({ kind: 'article', id: a.id, slug: a.slug, img: a.thumbnail_url || a.hero_image_url, title: a.title, title_en: a.title_en, views: a.view_count || 0, date: String(a.published_date || '') }));
  const rank = (xs) => {
    const recent = xs.filter((x) => x.date >= since).sort((a, b) => b.views - a.views);
    const rest = xs.filter((x) => x.date < since);   // 이미 최신순
    return recent.concat(rest);
  };
  const E = rank(eds), A = rank(ars);
  const out = E.slice(0, 4).concat(A.slice(0, 2));
  for (const x of E.slice(4).concat(A.slice(2))) { if (out.length >= 6) break; out.push(x); }
  // 언어별 제목 (사이트와 같은 번역본; 없으면 원제)
  const ids = out.map((x) => x.id);
  const tr = {};
  if (ids.length) {
    const { data } = await db.from('seo_translations').select('content_id, kind, lang, title').in('content_id', ids);
    (data || []).forEach((r) => { if (r.title) (tr[r.content_id] = tr[r.content_id] || {})[r.lang] = r.title; });
  }
  out.forEach((x) => { x.tr = tr[x.id] || {}; });
  cache = { at: Date.now(), rows: out };
  return out;
}

function titleFor(x, lang) {
  if (x.kind === 'article') {
    if (lang === 'ko') return x.title;
    if (lang === 'en') return x.title_en || x.title;
    return x.tr[lang] || x.title_en || x.title;
  }
  return x.tr[lang] || x.title;
}

function page(lang, rows) {
  const C = IG_PAGE[lang] || IG_PAGE.en;
  const W = weeklyCopy(lang);
  const card = (x, big) => `
    <a class="card${big ? ' big' : ''}" href="${esc(withUtm(localPath(lang, x.kind, x.slug)))}">
      <img src="${esc(SITE + '/api/img?u=' + encodeURIComponent(x.img))}" alt="${esc(titleFor(x, lang))}" loading="${big ? 'eager' : 'lazy'}">
      <span class="kind">${esc(x.kind === 'editorial' ? W.editorial : W.article)}</span>
      <span class="t">${esc(titleFor(x, lang))}</span>
    </a>`;
  const grid = rows.length
    ? card(rows[0], true) + '<div class="grid">' + rows.slice(1).map((x) => card(x, false)).join('') + '</div>'
    : `<p class="empty">${esc(C.empty)}</p>`;
  const btn = (href, a, b, primary) => `<a class="btn${primary ? ' primary' : ''}" href="${esc(withUtm(SITE + href))}"><b>${esc(a)}</b>${b ? `<small>${esc(b)}</small>` : ''}</a>`;
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>${esc(C.title)} · ${esc(W.thisWeek)}</title>
<meta property="og:title" content="${esc(C.title)}"><meta property="og:description" content="${esc(W.tagline)}">
<meta property="og:image" content="${SITE}/pap-logo.png">
<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font-family:'Montserrat',Helvetica,Arial,sans-serif;word-break:keep-all}
.wrap{max-width:520px;margin:0 auto;padding:28px 16px 48px}
.brand{text-align:center;font-size:24px;font-weight:900;letter-spacing:.6em;padding-left:.6em}
.tag{text-align:center;font-size:10px;letter-spacing:.3em;color:rgba(255,255,255,.55);margin:8px 0 26px}
.btn{display:block;border:1px solid rgba(255,255,255,.25);padding:14px 16px;margin:0 0 10px;color:#fff;text-decoration:none;text-align:center}
.btn b{display:block;font-size:13px;letter-spacing:.04em}.btn small{display:block;font-size:11px;color:rgba(255,255,255,.6);margin-top:4px}
.btn.primary{background:#fff;color:#000;border-color:#fff}.btn.primary small{color:rgba(0,0,0,.6)}
h2{font-size:10px;letter-spacing:.3em;color:#c44;margin:28px 0 12px}
.card{display:block;color:#fff;text-decoration:none;margin-bottom:14px}.card img{width:100%;aspect-ratio:4/5;object-fit:cover;display:block;background:#111}
.card .kind{display:block;font-size:9px;letter-spacing:.2em;color:rgba(255,255,255,.5);margin-top:8px}.card .t{display:block;font-size:13px;font-weight:700;line-height:1.35;margin-top:3px}
.card.big .t{font-size:17px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.grid .card{margin:0}
.empty{color:rgba(255,255,255,.6);font-size:13px}
.foot{text-align:center;font-size:11px;color:rgba(255,255,255,.4);margin-top:28px}.foot a{color:rgba(255,255,255,.6)}
</style>
</head>
<body><div class="wrap">
<div class="brand">PAP</div>
<div class="tag">${esc(W.tagline)}</div>
${btn('/newsletter', C.newsletter, C.newsletterSub, true)}
${btn('/submission.html', C.submit, C.submitSub)}
${btn('/subscribe', C.member, C.memberSub)}
<h2>${esc(W.thisWeek)}</h2>
${grid}
${btn('/', C.all, '')}
<div class="foot"><a href="${esc(withUtm(SITE + '/'))}">pap-magazine.com</a> · @pap_magazine</div>
</div></body>
</html>`;
}

module.exports = async function handler(req, res) {
  const lang = pickLang(req.query && req.query.lang, req.headers && req.headers['accept-language']);
  let rows = [];
  try { rows = await loadRows(module.exports._db || supabaseAdmin); }
  catch (e) { console.error('[ig-landing] 목록 조회 실패 — 버튼만 보여준다:', (e && e.message) || e); }
  // 방문 기록 (봇·자기 리퍼러는 logSocialInclick 이 거른다).
  // 서버리스는 응답 뒤 남은 작업을 끊을 수 있어 기다린다(insert 한 번, 실패해도 페이지는 나간다).
  try { await logSocialInclick({ query: { utm_source: 'ig', utm_campaign: 'bio' }, headers: req.headers || {}, url: '/ig', socket: req.socket }, 'ig-bio'); } catch (_) { /* 기록 실패는 무시 */ }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Accept-Language');
  return res.status(200).send(page(lang, rows));
};
module.exports._db = null;
module.exports._page = page;
module.exports._reset = () => { cache = null; };
