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

  // QA #167 — multi-language tooltip + inline-hint text for the
  // English-only name policy. Previously only ko/en were handled, so a
  // Chinese / Japanese / etc. submitter would see a red outline with no
  // legible explanation, fail to enter the field, and end up submitting
  // it blank — which surfaced to the editorial team as "credits missing".
  // Translations are intentionally short — they're shown as a native
  // browser tooltip + a small caption under the input.
  var TOOLTIPS = {
    ko: '영문/숫자/공백/. - \' 만 입력 가능',
    en: 'Letters, digits, space, . - \' only',
    zh: '仅可输入英文/数字/空格/. - \'',
    ja: '英字・数字・スペース・. - \' のみ入力可',
    it: 'Solo lettere, numeri, spazio, . - \'',
    fr: 'Lettres, chiffres, espace, . - \' uniquement',
    es: 'Solo letras, dígitos, espacio, . - \'',
    ru: 'Только латиница, цифры, пробел, . - \'',
    de: 'Nur Buchstaben, Ziffern, Leerzeichen, . - \'',
  };
  function _tooltipFor(lang){
    return TOOLTIPS[lang] || TOOLTIPS.en;
  }

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

  // Inline hint under the input — guarantees the user sees the message
  // even if they never hover (touch / mobile / first-time submitter).
  // We attach it as a sibling node so it follows the input no matter how
  // the surrounding row is laid out. Removed when the field becomes valid.
  function _setInlineHint(el, on){
    var hintId = el.getAttribute('data-name-hint-id');
    var hint = hintId ? document.getElementById(hintId) : null;
    if(on){
      if(!hint){
        hint = document.createElement('div');
        hint.id = 'pap-name-hint-' + Math.random().toString(36).slice(2, 8);
        hint.className = 'pap-name-hint';
        hint.style.cssText = 'font-size:10px;line-height:1.5;color:rgba(255,80,80,.95);margin:4px 0 0;font-family:Inter,sans-serif;letter-spacing:.02em;';
        if(el.parentNode){
          if(el.nextSibling) el.parentNode.insertBefore(hint, el.nextSibling);
          else el.parentNode.appendChild(hint);
        }
        el.setAttribute('data-name-hint-id', hint.id);
      }
      hint.textContent = _tooltipFor(localStorage.getItem('pap-lang') || 'en');
    } else if(hint){
      hint.parentNode && hint.parentNode.removeChild(hint);
      el.removeAttribute('data-name-hint-id');
    }
  }

  function _markInvalid(el, on){
    if(on){
      el.style.outline = '1.5px solid rgba(255,80,80,.7)';
      el.setAttribute('data-name-invalid', '1');
      el.title = _tooltipFor(localStorage.getItem('pap-lang') || 'en');
    } else {
      el.style.outline = '';
      el.removeAttribute('data-name-invalid');
      el.title = '';
    }
    _setInlineHint(el, on);
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
