/**
 * PAP Magazine — Name-field validator
 * -----------------------------------------------
 * Restricts name/title input fields to: A–Z, a–z, 0–9, space, hyphen,
 * apostrophe, period. Used by submission.html and pullletter.html so all
 * formal credits land in PAP's editorial pipeline as romanized text.
 *
 * Auto-applies (no per-page wiring) via event delegation on document.
 *
 * What counts as a "name-only" field:
 *   - <input> with id in NAME_ONLY_IDS (explicit list — editorialTitle,
 *     studioName, photographer/videographer/stylist/contact name fields)
 *   - <input class="team-input"> or <input class="look-input"> whose
 *     placeholder does NOT look like an Instagram/URL field (heuristic:
 *     starts with '@' or contains 'instagram'/'website'/'url'/'http'
 *     case-insensitively)
 *
 * NOT applied to:
 *   - URL / email / Instagram-handle inputs (those need their own chars)
 *   - Long free-text fields (artistStatement, additionalMsg, etc.) — users
 *     write these in their native language
 *
 * Public surface:
 *   window._papValidateNameOnly(value)        true / false
 *   window._papHasInvalidNameField(scopeEl?)  true if any name-only field
 *                                             in `scopeEl` (or document)
 *                                             contains invalid chars; also
 *                                             marks them visually
 */

(function(){
  'use strict';

  var NAME_ONLY_RE = /^[A-Za-z0-9 .'\-]*$/;
  var NAME_ONLY_IDS = [
    // pullletter.html
    'phName', 'vgName', 'stName', 'contactName',
    // submission.html
    'editorialTitle', 'studioName',
  ];

  function _isNameOnlyField(el){
    if(!el || el.tagName !== 'INPUT') return false;
    if(el.type && el.type !== 'text') return false; // skip url/email/file/etc.
    if(el.id && NAME_ONLY_IDS.indexOf(el.id) !== -1) return true;
    // team-input / look-input — distinguish name vs instagram/url by placeholder
    if(el.classList.contains('team-input') || el.classList.contains('look-input')){
      var ph = (el.placeholder || '').trim();
      if(ph.charAt(0) === '@') return false;
      if(/instagram|website|url|http/i.test(ph)) return false;
      // Also skip explicitly tagged Instagram-link inputs
      if(el.classList.contains('team-link-input')) return false;
      return true;
    }
    return false;
  }

  function _markInvalid(el, on){
    if(on){
      el.style.outline = '1.5px solid rgba(255,80,80,.7)';
      el.setAttribute('data-name-invalid', '1');
      el.title = (localStorage.getItem('pap-lang') === 'en')
        ? 'Letters, digits, space, . - \' only'
        : '영문/숫자/공백/. - \' 만 입력 가능';
    } else {
      el.style.outline = '';
      el.removeAttribute('data-name-invalid');
      el.title = '';
    }
  }

  function _validateOne(el){
    if(!_isNameOnlyField(el)) return true;
    var ok = NAME_ONLY_RE.test(el.value || '');
    _markInvalid(el, !ok);
    return ok;
  }

  // Live validation on input
  document.addEventListener('input', function(e){
    if(_isNameOnlyField(e.target)) _validateOne(e.target);
  }, true);

  // Public: scan a scope (default document) for any invalid name-only field.
  // Re-marks all of them (so the user sees what's wrong on submit).
  window._papHasInvalidNameField = function(scope){
    var root = scope || document;
    var anyInvalid = false;
    var inputs = root.querySelectorAll('input.team-input, input.look-input, input#editorialTitle, input#studioName, input#phName, input#vgName, input#stName, input#contactName');
    inputs.forEach(function(el){
      if(!_validateOne(el)) anyInvalid = true;
    });
    return anyInvalid;
  };

  // Convenience for callers that want to validate one value (no DOM)
  window._papValidateNameOnly = function(value){
    return NAME_ONLY_RE.test(value || '');
  };
})();
