/**
 * PAP Scroll Reveal — unified fade-in-up entrance animation.
 *
 * Spec (per QA Scroll Interaction Guideline):
 *   • Type:     Fade-in + Move Up (translateY 16 → 0, opacity 0 → 1)
 *   • Duration: 0.6s
 *   • Easing:   cubic-bezier(0.22, 1, 0.36, 1)
 *   • Trigger:  IntersectionObserver, threshold 0.2, run once
 *   • Stagger:  0.08s between consecutive list items
 *   • Performance: transform + opacity only; will-change cleared after
 *   • Reduced motion: animation disabled, content shown immediately
 *
 * Implementation note: uses INLINE STYLES (not CSS classes) so no
 * cascade specificity battle — inline always wins over stylesheets.
 * Cards in our existing CSS have varying single-class rules with
 * inherited opacity that any class-based reveal would lose against
 * unintentional !important declarations elsewhere on the site.
 */
(function(){
  'use strict';

  if(window.__papRevealLoaded) return;
  window.__papRevealLoaded = true;

  var DURATION_S = 0.6;
  var EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
  var STAGGER_MS = 80;
  var STAGGER_CAP_MS = 600;
  /* threshold + rootMargin tuned to fire reliably for horizontally
     scrolling card tracks (where strict viewport-intersection checks
     can miss cards that are mostly visible vertically). 0.05 means
     "any 5% pixel visible triggers"; rootMargin 100px expands the
     observation zone slightly above and below the actual viewport. */
  var THRESHOLD = 0.05;
  var ROOT_MARGIN = '100px 0px 100px 0px';

  var reduceMotion = (typeof window.matchMedia === 'function')
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* IntersectionObserver with graceful degradation */
  var supported = typeof IntersectionObserver === 'function';
  var observer = (supported && !reduceMotion) ? new IntersectionObserver(function(entries){
    for(var i = 0; i < entries.length; i++){
      var e = entries[i];
      if(e.isIntersecting){
        _show(e.target);
        observer.unobserve(e.target);
      }
    }
  }, {threshold: THRESHOLD, rootMargin: ROOT_MARGIN}) : null;

  /** Apply hidden state via inline style — wins over any stylesheet rule. */
  function _hide(el, delaySeconds){
    el.style.opacity = '0';
    el.style.transform = 'translateY(16px)';
    el.style.transition =
      'opacity '   + DURATION_S + 's ' + EASING + ' ' + delaySeconds + 's, ' +
      'transform ' + DURATION_S + 's ' + EASING + ' ' + delaySeconds + 's';
    el.style.willChange = 'transform, opacity';
  }

  /** Animate to visible state. */
  function _show(el){
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    // Clear will-change after the transition finishes to free GPU layers.
    var done = function(){
      el.style.willChange = 'auto';
      el.removeEventListener('transitionend', done);
    };
    el.addEventListener('transitionend', done);
  }

  function _observe(el){
    if(!el || el.__papObs) return;
    el.__papObs = true;
    if(observer){
      observer.observe(el);
    } else {
      // No support / reduced motion: show immediately, no transition
      _showInstant(el);
    }
  }
  function _showInstant(el){
    el.style.opacity = '';
    el.style.transform = '';
    el.style.transition = '';
    el.style.willChange = '';
  }

  /* ---- Auto-bind selectors ---- */
  var AUTO_BIND = [
    '.ed-row-label',
    '.shorts-title',
    '.fashion-section h2',
    '.ed-row-track > .ed-row-card',
    '.fashion-grid > .fashion-card',
    '.fashion-section .fashion-card',  /* fallback when no .fashion-grid wrapper */
    '#cardGrid > .card',
    '#filmGrid > .film-card',
    '.ed-all-grid > .ed-row-card',
    '.film-all-grid > .film-all-card',
    '.art-all-grid > .art-all-card',
    '.ed-gallery-grid > .ed-gallery-item',
    '#artDetailGallery > *',
    '.about-content > *',
    '.subscribe-section > *, .subscribe-content > *, .plan-card',
    '.contact-form > *',
    '.business-section > *, .business-content > *',
    '.pullletter-section > *',
    '[data-reveal]'
  ];

  function _bind(){
    if(reduceMotion){
      // Honor the user preference — skip animation entirely
      return;
    }
    AUTO_BIND.forEach(function(sel){
      var nodes;
      try { nodes = document.querySelectorAll(sel); }
      catch(_){ return; }
      var byParent = new Map();
      for(var i = 0; i < nodes.length; i++){
        var n = nodes[i];
        if(n.__papObs) continue;
        var p = n.parentElement || document.body;
        if(!byParent.has(p)) byParent.set(p, []);
        byParent.get(p).push(n);
      }
      byParent.forEach(function(siblings){
        for(var j = 0; j < siblings.length; j++){
          var el = siblings[j];
          var delayMs = Math.min(j * STAGGER_MS, STAGGER_CAP_MS);
          _hide(el, delayMs / 1000);
          _observe(el);
        }
      });
    });
  }

  function _start(){
    _bind();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _start);
  } else {
    _start();
  }

  /* ---- Public API for dynamic content ---- */
  window.papReveal = {
    refresh: _bind,
    add: function(el){
      if(!el || !el.style) return;
      _hide(el, 0);
      _observe(el);
    },
    show: function(el){
      if(!el || !el.style) return;
      _show(el);
    }
  };
})();
