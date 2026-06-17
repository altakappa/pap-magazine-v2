/* PAP Magazine — Popup Registry (QA #241)
   ------------------------------------------------------------------
   A single, shared coordinator for any "home-level" notice popup —
   beta notice today, plus event / announcement / migration popups
   the editorial team will add later. Centralises three concerns that
   were previously scattered (or simply missing) per-popup:

     1. Dismissal storage policy   — localStorage with a TTL, sessionStorage,
                                      or "show forever until dismissed".
     2. Entry-path consistency     — every navigation to the home triggers
                                      the same decision: fresh load, logo
                                      click, direct URL, AND BFCache restore
                                      via pageshow with persisted=true.
                                      (Previously back/forward restored the
                                      page from cache and the init code
                                      never re-ran, so the popup silently
                                      stayed hidden after a single dismissal
                                      in a long-lived tab — UX inconsistency
                                      flagged in QA #241.)
     3. Priority & queueing        — only one popup is shown at a time;
                                      highest-priority eligible popup wins.

   Usage from a popup module:

     window.papPopups.register({
       id: 'beta-notice',                  // unique; used as storage key
       priority: 100,                      // higher shows first
       storageType: 'localStorage',        // or 'sessionStorage'
       dismissalTTL: 7 * 24 * 60 * 60 * 1000, // 0 = forever, omitted = forever
       shouldShow: function(){ return true; },  // gate (e.g. beta window)
       render: function(api){
         // … build DOM, attach close handlers that call api.dismiss()
         //    when the user closes the popup (so the dismissal flag is
         //    recorded and queue advances).
         //    Call api.skip() if you decide at render-time not to show
         //    after all (the next popup in line will be tried).
       }
     });

   Globals exposed on window.papPopups:
     - register(opts)        — add a popup; auto-tries to show if eligible
     - isDismissed(id)       — read dismissal flag (helper for callers)
     - markDismissed(id)     — write dismissal flag (helper for callers)
     - reset(id)             — clear dismissal flag (manual / debug)
     - rerun()               — re-evaluate the queue (e.g. after login)        */

(function(){
  var REGISTRY = [];
  var ACTIVE   = null;   // currently-rendered popup opts

  function dismissalKey(id){ return 'pap-popup-dismissed-' + id; }
  function storeFor(opts){
    try{ return opts && opts.storageType === 'sessionStorage' ? sessionStorage : localStorage; }
    catch(e){ return null; }
  }

  function isDismissed(opts){
    var store = storeFor(opts);
    if(!store) return false;
    try{
      var raw = store.getItem(dismissalKey(opts.id));
      if(!raw) return false;
      var ts = parseInt(raw, 10);
      if(isNaN(ts)) return false;
      // TTL = 0 / undefined → dismissal lasts forever
      if(!opts.dismissalTTL) return true;
      return (Date.now() - ts) < opts.dismissalTTL;
    }catch(e){ return false; }
  }

  function markDismissed(opts){
    var store = storeFor(opts);
    if(!store) return;
    try{ store.setItem(dismissalKey(opts.id), String(Date.now())); }catch(e){}
  }

  function clearDismissed(opts){
    try{ if(storeFor(opts)) storeFor(opts).removeItem(dismissalKey(opts.id)); }catch(e){}
    // Also clear from the other store in case storageType changed
    var other = (opts.storageType === 'sessionStorage') ? localStorage : sessionStorage;
    try{ other.removeItem(dismissalKey(opts.id)); }catch(e){}
  }

  function findById(id){
    for(var i=0;i<REGISTRY.length;i++) if(REGISTRY[i].id === id) return REGISTRY[i];
    return null;
  }

  /* Skip popups on deep-link flows so users opening /?ed=… land
     straight on the editorial overlay without an unrelated home-level
     interruption. Mirrors the previous beta-notice behavior. */
  function isDeepLinkFlow(){
    if(window._papDeepLinkMode) return true;
    try{
      var p = new URLSearchParams(window.location.search);
      if(p.get('ed') || p.get('film') || p.get('art')) return true;
    }catch(e){}
    return false;
  }

  function next(){
    if(ACTIVE) return;
    if(isDeepLinkFlow()) return;
    for(var i=0;i<REGISTRY.length;i++){
      var opts = REGISTRY[i];
      if(isDismissed(opts)) continue;
      if(typeof opts.shouldShow === 'function'){
        try{ if(!opts.shouldShow()) continue; }catch(e){ continue; }
      }
      ACTIVE = opts;
      try{
        opts.render({
          dismiss: function(){
            markDismissed(opts);
            ACTIVE = null;
            // Don't auto-show the next popup on the same load — let the
            // user breathe. Subsequent entries (fresh load / pageshow)
            // will pick the next eligible popup.
          },
          skip: function(){
            ACTIVE = null;
            // Try the next eligible popup right away.
            setTimeout(next, 0);
          }
        });
      }catch(e){
        // Defensive — never let a buggy popup module block others.
        ACTIVE = null;
        try{ console.warn('[PAP popups] render failed for', opts.id, e); }catch(_){}
      }
      return;
    }
  }

  function register(opts){
    if(!opts || !opts.id || typeof opts.render !== 'function') return;
    // De-dup: replacing same id keeps idempotence on hot reload.
    var idx = -1;
    for(var i=0;i<REGISTRY.length;i++) if(REGISTRY[i].id === opts.id){ idx = i; break; }
    if(idx >= 0) REGISTRY.splice(idx, 1);
    REGISTRY.push(opts);
    // Highest priority first; stable for equal priorities.
    REGISTRY.sort(function(a,b){ return (b.priority||0) - (a.priority||0); });
    // If the DOM is ready, try to show now. Otherwise the DOMContentLoaded
    // hook below will fire next().
    if(document.readyState !== 'loading') next();
  }

  /* Initial run — once on document ready, then again on every pageshow
     event with persisted=true (BFCache restore). The persisted flag is
     the standard signal that the browser served the page from its
     back/forward cache without re-running script — without this hook,
     a user who clicks Back to return to the home would see the page in
     whatever state they left it (popup hidden if they previously
     dismissed it; popup still visible if they hadn't). That mismatch is
     the inconsistency QA #241 reported. */
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', next);
  } else {
    next();
  }
  window.addEventListener('pageshow', function(e){
    if(e && e.persisted){
      // BFCache restore — re-evaluate. If the popup was dismissed in
      // a previous tab/session the storage flag is honored; otherwise
      // we re-show, exactly as we would on a fresh load.
      ACTIVE = null;
      next();
    }
  });

  /* Public API */
  window.papPopups = {
    register: register,
    isDismissed: function(id){ var o = findById(id); return o ? isDismissed(o) : false; },
    markDismissed: function(id){ var o = findById(id); if(o) markDismissed(o); },
    reset: function(id){
      var o = findById(id);
      if(o){ clearDismissed(o); }
      else {
        // No registration yet — clear by raw key anyway so manual
        // debugging still works before registration runs.
        try{ localStorage.removeItem(dismissalKey(id)); }catch(e){}
        try{ sessionStorage.removeItem(dismissalKey(id)); }catch(e){}
      }
      try{ console.log('[PAP popups] dismissal reset for', id); }catch(e){}
    },
    rerun: function(){ ACTIVE = null; next(); }
  };
})();
