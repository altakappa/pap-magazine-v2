/**
 * PAP Global Image Fallback
 * --------------------------
 * Catches ALL image load errors site-wide and replaces broken images with
 * a branded SVG placeholder. Uses event capture so individual <img> tags
 * don't need their own onerror attribute.
 *
 * Include on every page.
 */
(function(){
  'use strict';

  var FALLBACK_MARK = 'data-pap-fallback';

  function buildPlaceholder(title){
    var t = encodeURIComponent((title||'PAP MAGAZINE').substring(0, 40));
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='533'%3E"
      + "%3Crect width='400' height='533' fill='%23222'/%3E"
      + "%3Ctext x='200' y='250' text-anchor='middle' fill='rgba(255,255,255,0.3)' font-family='sans-serif' font-size='13' font-weight='bold' letter-spacing='2'%3E"
      + t
      + "%3C/text%3E%3Ctext x='200' y='275' text-anchor='middle' fill='rgba(255,255,255,0.15)' font-family='sans-serif' font-size='10' letter-spacing='3'%3EPAP MAGAZINE%3C/text%3E"
      + "%3C/svg%3E";
  }

  function handleError(e){
    var img = e.target;
    if(!img || img.tagName !== 'IMG') return;
    // Prevent infinite loop
    if(img.hasAttribute(FALLBACK_MARK)) return;
    img.setAttribute(FALLBACK_MARK, '1');

    var title = img.alt || '';
    img.src = buildPlaceholder(title);
  }

  // Capture phase catches ALL img error events, even without individual onerror
  document.addEventListener('error', handleError, true);

  // Also expose as a global for existing inline onerror="edImgError(this)" callers
  if(typeof window.edImgError !== 'function'){
    window.edImgError = function(img){
      if(!img || img.hasAttribute(FALLBACK_MARK)) return;
      img.setAttribute(FALLBACK_MARK, '1');
      img.src = buildPlaceholder(img.alt);
    };
  }
})();
