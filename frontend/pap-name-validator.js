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

  // 2026-07-21 (도메니코 지시) — 서브미션·풀레터의 '크레딧 포함 모든 작성'을
  // 영어(라틴)로만. 이름 필드는 위 엄격 규칙, 그 외(인스타 핸들·산문)는 아래
  // '라틴 전용' — 문장부호/기호는 허용하되 한글·CJK·키릴 등 비라틴 문자만 차단.
  var NON_LATIN_RE = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u0400-\u052F\u0590-\u05FF\u0600-\u06FF]/;
  var LATIN_ONLY_IDS = [
    // submission.html — 산문
    'artistStatement',
    // pullletter.html — 산문 + 크레딧 인스타 + 포트폴리오
    'additionalMsg', 'proposalInput',
    'phInsta', 'stInsta', 'vgInsta',
    'phPortfolio', 'stPortfolio', 'vgPortfolio',
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
  var LATIN_TOOLTIPS = {
    ko: '영어로만 입력해 주세요 (한글·중국어·일본어 등 사용 불가)',
    en: 'Please write in English only (no Korean/CJK/Cyrillic)',
    zh: '请仅用英文填写(不可使用中文/韩文/日文等)',
    ja: '英語のみで入力してください(日本語・韓国語・中国語などは不可)',
    it: 'Scrivi solo in inglese (niente coreano/CJK/cirillico)',
    fr: 'Veuillez écrire uniquement en anglais (pas de coréen/CJK/cyrillique)',
    es: 'Escriba solo en inglés (sin coreano/CJK/cirílico)',
    ru: 'Пишите только на английском (без корейского/CJK/кириллицы)',
    de: 'Bitte nur auf Englisch schreiben (kein Koreanisch/CJK/Kyrillisch)',
  };
  function _latinTooltipFor(lang){
    return LATIN_TOOLTIPS[lang] || LATIN_TOOLTIPS.en;
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

  function _isLatinOnlyField(el){
    if(!el) return false;
    var tag = el.tagName;
    if(tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
    if(tag === 'INPUT' && el.type && el.type !== 'text') return false;
    if(el.id && LATIN_ONLY_IDS.indexOf(el.id) !== -1) return true;
    // 이름 검증이 건너뛰던 인스타/링크 핸들을 라틴 전용으로.
    if(el.classList){
      if(el.classList.contains('team-link-input')) return true;
      if(el.classList.contains('look-input')){
        var ph = (el.placeholder || '').trim();
        if(ph.charAt(0) === '@' || /instagram/i.test(ph)) return true;
      }
    }
    return false;
  }

  // Inline hint under the input — guarantees the user sees the message
  // even if they never hover (touch / mobile / first-time submitter).
  // We attach it as a sibling node so it follows the input no matter how
  // the surrounding row is laid out. Removed when the field becomes valid.
  function _setInlineHint(el, on, kind){
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
      var _lang = localStorage.getItem('pap-lang') || 'en';
      hint.textContent = (kind === 'latin') ? _latinTooltipFor(_lang) : _tooltipFor(_lang);
    } else if(hint){
      hint.parentNode && hint.parentNode.removeChild(hint);
      el.removeAttribute('data-name-hint-id');
    }
  }

  function _markInvalid(el, on, kind){
    var lang = localStorage.getItem('pap-lang') || 'en';
    var msg = (kind === 'latin') ? _latinTooltipFor(lang) : _tooltipFor(lang);
    if(on){
      el.style.outline = '1.5px solid rgba(255,80,80,.7)';
      el.setAttribute('data-name-invalid', '1');
      el.title = msg;
    } else {
      el.style.outline = '';
      el.removeAttribute('data-name-invalid');
      el.title = '';
    }
    _setInlineHint(el, on, kind);
  }

  function _validateOne(el){
    if(_isNameOnlyField(el)){
      var ok = NAME_ONLY_RE.test(el.value || '');
      _markInvalid(el, !ok, 'name');
      return ok;
    }
    if(_isLatinOnlyField(el)){
      var okL = !NON_LATIN_RE.test(el.value || '');
      _markInvalid(el, !okL, 'latin');
      return okL;
    }
    return true;
  }

  // Live validation on input
  document.addEventListener('input', function(e){
    if(_isNameOnlyField(e.target) || _isLatinOnlyField(e.target)) _validateOne(e.target);
  }, true);

  // Public: scan a scope (default document) for any invalid name-only field.
  // Re-marks all of them (so the user sees what's wrong on submit).
  window._papHasInvalidNameField = function(scope){
    var root = scope || document;
    var anyInvalid = false;
    var inputs = root.querySelectorAll('input.team-input, input.look-input, input.team-link-input, input#editorialTitle, input#studioName, input#phName, input#vgName, input#stName, input#contactName, input#phInsta, input#stInsta, input#vgInsta, input#phPortfolio, input#stPortfolio, input#vgPortfolio, #artistStatement, #additionalMsg, #proposalInput');
    inputs.forEach(function(el){
      if(!_validateOne(el)) anyInvalid = true;
    });
    return anyInvalid;
  };

  // Convenience for callers that want to validate one value (no DOM)
  window._papValidateNameOnly = function(value){
    return NAME_ONLY_RE.test(value || '');
  };

  // 라틴 전용 검증(비라틴 문자만 차단, 문장부호 허용) — 산문·인스타 핸들용.
  window._papValidateLatinOnly = function(value){
    return !NON_LATIN_RE.test(value || '');
  };
})();
