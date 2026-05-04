// PAP Magazine — Content harness, SEO meta + deep-link sub-module
// (extracted from pap-app.js per HARNESS_CHECKLIST.md mission 8f).
//
// Owns:
//   - _updateEditorialMeta(title, det): rewrites document.title, meta
//     description, og:*, twitter:*, canonical, JSON-LD Article schema for
//     social-share crawlers and Google's JS-aware indexer when an editorial
//     overlay opens.
//   - _resetEditorialMeta(): restores the generic homepage meta when the
//     editorial overlay closes.
//   - DEEP LINK hash IIFE: opens an editorial from `#editorial/<Title>` on
//     initial load (e.g. /ko/<slug>/ redirected from old papkorea routes).
//   - DEEP LINK ?ed= IIFE: opens an editorial from `?ed=<Name>` query param
//     (used by certain external link sources). Polls for edDetails to
//     populate before opening to avoid a flash of empty content.
//
// Public surface (consumed cross-script via globals):
//   _updateEditorialMeta / _resetEditorialMeta — called from
//     pap-content-editorial.js's _openEditorialInner / closeEditorial.
//
// Dependencies (must be loaded before this file):
//   - pap-content-editorial.js → openEditorial, edDetails (deep-link IIFEs
//                                resolve these at click/load time)

// ======== SEO META + DEEP LINKS ========
// ======== SEO: per-editorial meta tag updater ========
// Updates document.title, meta description, og:*, twitter:*, canonical
// and injects a JSON-LD Article schema when an editorial overlay opens.
// Helps social-share crawlers (Kakao/Facebook/X) show editorial-specific
// previews and gives Google's JS-aware indexer richer signals than the
// generic homepage tags.
function _updateEditorialMeta(title, det){
  if(!title) return;
  var lang = (typeof localStorage !== 'undefined' && localStorage.getItem('pap-lang')) || 'ko';
  var rawDesc = det && det.desc;
  var descText = '';
  if(typeof rawDesc === 'string') descText = rawDesc;
  else if(rawDesc && typeof rawDesc === 'object') descText = rawDesc[lang] || rawDesc.en || rawDesc.ko || '';
  // Strip HTML, collapse whitespace, cap at 200 chars for meta description.
  var desc = String(descText).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if(!desc){
    desc = title + ' — ' + (det && det.issue || '') + ' on PAP Magazine';
  }
  var img = (det && det.thumb) || '';
  var url = 'https://www.pap-magazine.com/#editorial/' + encodeURIComponent(title);
  var pageTitle = title + ' | PAP Magazine';

  // Helper: get-or-create a meta tag and set its content.
  function _setMeta(selector, attrName, attrValue, content){
    var el = document.head.querySelector(selector);
    if(!el){
      el = document.createElement('meta');
      el.setAttribute(attrName, attrValue);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }
  document.title = pageTitle;
  _setMeta('meta[name="description"]',         'name',     'description',     desc);
  _setMeta('meta[property="og:title"]',        'property', 'og:title',        pageTitle);
  _setMeta('meta[property="og:description"]',  'property', 'og:description',  desc);
  _setMeta('meta[property="og:url"]',          'property', 'og:url',          url);
  _setMeta('meta[property="og:type"]',         'property', 'og:type',         'article');
  if(img) _setMeta('meta[property="og:image"]','property', 'og:image',        img);
  _setMeta('meta[name="twitter:card"]',        'name',     'twitter:card',    'summary_large_image');
  _setMeta('meta[name="twitter:title"]',       'name',     'twitter:title',   pageTitle);
  _setMeta('meta[name="twitter:description"]', 'name',     'twitter:description', desc);
  if(img) _setMeta('meta[name="twitter:image"]','name',    'twitter:image',   img);

  // Canonical link
  var canon = document.head.querySelector('link[rel="canonical"]');
  if(!canon){
    canon = document.createElement('link');
    canon.setAttribute('rel', 'canonical');
    document.head.appendChild(canon);
  }
  canon.setAttribute('href', url);

  // JSON-LD Article schema. Replace any previous editorial schema we
  // injected so we don't accumulate duplicates as the user navigates.
  var prevLd = document.head.querySelector('script[data-pap-ld="editorial"]');
  if(prevLd) prevLd.parentNode.removeChild(prevLd);
  try {
    var schema = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      description: desc,
      image: img ? [img] : undefined,
      url: url,
      author: { '@type': 'Organization', name: 'PAP Magazine' },
      publisher: {
        '@type': 'Organization',
        name: 'PAP Magazine',
        logo: { '@type': 'ImageObject', url: 'https://www.pap-magazine.com/pap-logo.png' }
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url }
    };
    // Strip undefined keys so the JSON is clean
    Object.keys(schema).forEach(function(k){ if(schema[k] === undefined) delete schema[k]; });
    var ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.setAttribute('data-pap-ld', 'editorial');
    ld.text = JSON.stringify(schema);
    document.head.appendChild(ld);
  } catch(_) {}
}

// Reset meta tags back to homepage defaults when leaving the editorial
// overlay (closeEditorial / popstate to non-#editorial URL). Captured
// at first call so we don't drift over time.
var _PAP_HOME_META = null;
function _captureHomeMeta(){
  if(_PAP_HOME_META) return;
  function _read(sel, attr){ var e = document.head.querySelector(sel); return e ? e.getAttribute(attr) : ''; }
  _PAP_HOME_META = {
    title: document.title,
    description: _read('meta[name="description"]', 'content'),
    ogTitle: _read('meta[property="og:title"]', 'content'),
    ogDescription: _read('meta[property="og:description"]', 'content'),
    ogUrl: _read('meta[property="og:url"]', 'content'),
    ogImage: _read('meta[property="og:image"]', 'content'),
    canonical: _read('link[rel="canonical"]', 'href')
  };
}
function _resetEditorialMeta(){
  _captureHomeMeta();
  if(!_PAP_HOME_META) return;
  document.title = _PAP_HOME_META.title || 'PAP Magazine';
  function _setIf(sel, attr, val){ var e = document.head.querySelector(sel); if(e && val) e.setAttribute(attr, val); }
  _setIf('meta[name="description"]',         'content', _PAP_HOME_META.description);
  _setIf('meta[property="og:title"]',        'content', _PAP_HOME_META.ogTitle);
  _setIf('meta[property="og:description"]',  'content', _PAP_HOME_META.ogDescription);
  _setIf('meta[property="og:url"]',          'content', _PAP_HOME_META.ogUrl);
  _setIf('meta[property="og:image"]',        'content', _PAP_HOME_META.ogImage);
  _setIf('meta[property="og:type"]',         'content', 'website');
  _setIf('link[rel="canonical"]',            'href',    _PAP_HOME_META.canonical);
  var ld = document.head.querySelector('script[data-pap-ld="editorial"]');
  if(ld) ld.parentNode.removeChild(ld);
}
// Capture homepage meta on page load (before any editorial opens).
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', _captureHomeMeta);
} else {
  _captureHomeMeta();
}
// Reset on popstate when hash leaves the editorial namespace
window.addEventListener('popstate', function(){
  if(window.location.hash.indexOf('#editorial/') !== 0){
    _resetEditorialMeta();
  }
});

// ======== DEEP LINK: open editorial from hash #editorial/Title ========
// Accepts EITHER the canonical title ("Refractions") OR a slug-style
// fragment ("refractions", "indigestible-rituals") so old pap-magazine.com
// URLs that get 301'd here (vercel.json redirects /ko/<slug>/ →
// /#editorial/<slug>) still resolve to the correct editorial.
(function(){
  var hash=window.location.hash;
  if(hash && hash.indexOf('#editorial/')===0){
    var edName=decodeURIComponent(hash.substring('#editorial/'.length));
    if(!edName) return;
    function _resolveEditorialName(input){
      if(!input) return input;
      // 1. Exact match in edDetails (most common — case-correct title)
      if(typeof edDetails === 'object' && edDetails[input]) return input;
      // 2. Case-insensitive title match — handles e.g. "refractions" → "Refractions"
      var lower = input.toLowerCase();
      if(typeof edDetails === 'object'){
        for(var k in edDetails){
          if(k.toLowerCase() === lower) return k;
        }
      }
      // 3. Slug-style match: dashes → spaces, then case-insensitive
      //    Catches "indigestible-rituals" → "Indigestible Rituals".
      var spaced = lower.replace(/-/g, ' ');
      if(typeof edDetails === 'object'){
        for(var k2 in edDetails){
          if(k2.toLowerCase() === spaced) return k2;
        }
      }
      // 4. Match against edData[].url (the original /slug/ path)
      if(typeof edData !== 'undefined' && Array.isArray(edData)){
        for(var i=0;i<edData.length;i++){
          var slug = (edData[i].url||'').replace(/^\/+|\/+$/g, '').toLowerCase();
          if(slug && (slug === lower || slug === spaced)){
            return edData[i].title;
          }
        }
      }
      // 5. Fallback — pass through, openEditorial will use its own
      //    case-insensitive lookup as last resort.
      return input;
    }
    /* Poll for edDetails / edData to populate (both load async — static
       JSON in pap-content-api-sync.js plus the API-merge IIFE that lands
       newer admin-uploaded editorials). The previous fixed 1200ms wait
       lost the race for any editorial that hadn't been baked into the
       static snapshot, leaving the overlay rendered with placeholder
       fallbacks ("photographer", "stylist", "@brand") on refresh.
       Now we poll up to 4s — once the right entry exists in either
       collection, resolve and open immediately; if the deadline hits
       without a hit we still try once with what we have so the user
       isn't left on a blank screen. */
    var hashPollStart = Date.now();
    /* Reveal body (remove the deep-link black cover injected in
       index.html <head>) once the editorial overlay is mounted, so the
       user never sees the homepage flashing through before the overlay
       paints. The cover is a body { opacity: 0 } CSS rule keyed off the
       absence of .pap-deeplink-ready. */
    function _revealHashBody(){
      if(document.body && !document.body.classList.contains('pap-deeplink-ready')){
        document.body.classList.add('pap-deeplink-ready');
      }
    }
    function tryOpenHash(){
      if(typeof openEditorial!=='function'){ setTimeout(tryOpenHash,100); return; }
      var resolved = _resolveEditorialName(edName);
      var hit = (typeof edDetails==='object' && edDetails && edDetails[resolved]);
      var elapsed = Date.now() - hashPollStart;
      if(!hit && elapsed < 4000){ setTimeout(tryOpenHash,120); return; }
      try { openEditorial(resolved, ''); } catch(e) {}
      // Fade body in shortly after the overlay starts painting.
      setTimeout(_revealHashBody, 60);
    }
    if(document.readyState==='complete') tryOpenHash();
    else window.addEventListener('load', tryOpenHash);
  }
})();

// ======== DEEP LINK: open editorial from ?ed= param ========
(function(){
  var params=new URLSearchParams(window.location.search);
  var edName=params.get('ed');
  if(!edName)return;
  // Clean ?ed= from URL immediately (before pushState from openEditorial)
  history.replaceState(null,'',window.location.pathname);
  /* Reveal body (remove the deep-link black cover injected in index.html
     <head>) once the editorial overlay is visible on top. */
  function revealBody(){
    if(document.body&&!document.body.classList.contains('pap-deeplink-ready')){
      document.body.classList.add('pap-deeplink-ready');
    }
  }
  /* Poll for edDetails to populate (loaded async from API). As soon as
     the entry is available, open the editorial — no more blind 1200ms
     wait. Falls back to opening with whatever data exists after 3s. */
  var pollStart=Date.now();
  function tryOpen(){
    if(typeof openEditorial!=='function'){
      setTimeout(tryOpen,100); return;
    }
    var ready=(typeof edDetails==='object'&&edDetails&&(edDetails[edName]||Object.keys(edDetails).length>0));
    var elapsed=Date.now()-pollStart;
    if(!ready&&elapsed<3000){setTimeout(tryOpen,100);return;}
    try{ openEditorial(edName,''); }catch(e){}
    /* Reveal shortly after openEditorial triggers its own render so the
       editorial overlay is painted before we fade in. */
    setTimeout(revealBody,60);
  }
  if(document.readyState==='complete') tryOpen();
  else window.addEventListener('load',tryOpen);
})();

