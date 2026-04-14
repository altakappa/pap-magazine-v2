/**
 * PAP Auth Link Redirect Enhancer
 * --------------------------------
 * Automatically adds a `?return=<current-url>` parameter to every link
 * pointing at auth.html, so users return to their current page (including
 * hash) after login. Also patches a global helper for JS-driven redirects.
 *
 * Include this on every page that might have a login link.
 * Safe to include multiple times.
 */
(function(){
  'use strict';

  function buildReturnParam(){
    try{
      return encodeURIComponent(location.pathname + location.search + location.hash);
    }catch(e){ return ''; }
  }

  function shouldSkipUrl(urlStr){
    // Skip absolute URLs to other origins
    if(!urlStr) return true;
    if(urlStr.indexOf('//') === 0) return true;
    if(/^https?:\/\//i.test(urlStr) && urlStr.indexOf(location.origin) !== 0) return true;
    return false;
  }

  function addReturnParam(href){
    if(shouldSkipUrl(href)) return href;
    // Already has return param? leave it
    if(/[?&]return=/.test(href)) return href;
    // Don't override admin redirect (server-side flow)
    if(/[?&]redirect=admin/.test(href)) return href;

    var ret = buildReturnParam();
    if(!ret) return href;

    var sep = href.indexOf('?') === -1 ? '?' : '&';
    return href + sep + 'return=' + ret;
  }

  function enhanceLinks(root){
    if(!root || !root.querySelectorAll) return;
    var links = root.querySelectorAll('a[href*="auth.html"]');
    for(var i=0; i<links.length; i++){
      var a = links[i];
      var href = a.getAttribute('href');
      if(!href) continue;
      // Only process auth.html targets
      if(href.indexOf('auth.html') === -1) continue;
      // Skip same-page anchors (e.g. "#", "javascript:")
      if(href.charAt(0) === '#' || /^javascript:/i.test(href)) continue;

      a.setAttribute('href', addReturnParam(href));
      a.setAttribute('data-pap-auth-enhanced', '1');
    }
  }

  // Run immediately + on DOMContentLoaded + on future DOM mutations
  function init(){
    enhanceLinks(document);

    // Handle dynamically-added login links (e.g., rendered by JS)
    if(typeof MutationObserver !== 'undefined'){
      var observer = new MutationObserver(function(mutations){
        for(var i=0; i<mutations.length; i++){
          var m = mutations[i];
          for(var j=0; j<m.addedNodes.length; j++){
            var node = m.addedNodes[j];
            if(node.nodeType === 1){
              if(node.matches && node.matches('a[href*="auth.html"]')){
                var href = node.getAttribute('href');
                if(href && !node.hasAttribute('data-pap-auth-enhanced')){
                  node.setAttribute('href', addReturnParam(href));
                  node.setAttribute('data-pap-auth-enhanced', '1');
                }
              }
              if(node.querySelectorAll) enhanceLinks(node);
            }
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // Global helper for JS-driven redirects:
  //   location.href = window.papLoginUrl('auth.html') — returns URL with return param
  window.papLoginUrl = function(base){
    base = base || 'auth.html?mode=login';
    return addReturnParam(base);
  };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
