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

  // 2026-09-10 도메니코: "악센트는 허용. 라틴/알파벳이 아닌 걸 넣으면 알파벳·영어로만 된다는 경고."
  // 라틴 확장(À-ÿ · Ā-ɏ · Ḁ-ỿ)을 허용한다 — Hermès·Niño·KIMHĒKIM. 서버(latinOnly.js)도 같은 폭.
  var NAME_ONLY_RE = /^[A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF .'\-]*$/;
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
    ko: '알파벳(영어)으로만 입력할 수 있습니다 — 영문 알파벳(악센트 포함)/숫자/공백/. - \'',
    en: 'English (Latin alphabet) only — letters (accents OK), digits, space, . - \'',
    zh: '仅可使用英文（拉丁字母）— 字母（可含重音）、数字、空格、. - \'',
    ja: '英語（ラテン文字）のみ入力可 — 文字（アクセント可）・数字・スペース・. - \'',
    it: 'Solo inglese (alfabeto latino) — lettere (accenti ok), numeri, spazio, . - \'',
    fr: 'Anglais (alphabet latin) uniquement — lettres (accents ok), chiffres, espace, . - \'',
    es: 'Solo inglés (alfabeto latino) — letras (acentos ok), dígitos, espacio, . - \'',
    ru: 'Только английский (латиница) — буквы (с диакритикой), цифры, пробел, . - \'',
    de: 'Nur Englisch (lateinisches Alphabet) — Buchstaben (Akzente ok), Ziffern, Leerzeichen, . - \'',
  };
  function _curLang(){ try{ return localStorage.getItem('pap-lang') || 'en'; }catch(_){ return 'en'; } }
  function _tooltipFor(lang){
    return TOOLTIPS[lang] || TOOLTIPS.en;
  }
  var LATIN_TOOLTIPS = {
    ko: '알파벳(영어)으로만 입력할 수 있습니다 — 한글·중국어·일본어·키릴 글자는 지워집니다',
    en: 'English (Latin alphabet) only — Korean/Chinese/Japanese/Cyrillic characters are removed',
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
      var _lang = _curLang();
      hint.textContent = (kind === 'latin') ? _latinTooltipFor(_lang) : _tooltipFor(_lang);
    } else if(hint){
      hint.parentNode && hint.parentNode.removeChild(hint);
      el.removeAttribute('data-name-hint-id');
    }
  }

  function _markInvalid(el, on, kind){
    var lang = _curLang();
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
  // 2026-09-10 도메니코: "중국어로 쓸 수 없게. 영어로만 가능하게." — 빨간 표시만으로는 약하다.
  // 이름·크레딧·산문 칸에 한글·중국어·일본어·키릴 등 비라틴 글자가 들어오면 그 자리에서 지운다
  // (IME 조합이 끝난 뒤 input 이벤트에서). 안내 힌트는 잠깐 띄웠다가 지운다.
  var NON_LATIN_G = new RegExp(NON_LATIN_RE.source, 'g');
  function _stripNonLatin(el){
    var v = el.value || '';
    if(!NON_LATIN_RE.test(v)) return false;
    var pos = el.selectionStart;
    var before = v.slice(0, pos == null ? v.length : pos);
    var removedBefore = (before.match(NON_LATIN_G) || []).length;
    el.value = v.replace(NON_LATIN_G, '');
    try{ if(pos != null){ var np = pos - removedBefore; el.setSelectionRange(np, np); } }catch(_){}
    // 지웠다는 사실을 알린다 — 조용히 사라지면 "타이핑이 안 된다"고 오해한다
    _markInvalid(el, true, 'latin');
    clearTimeout(el._papStripTimer);
    el._papStripTimer = setTimeout(function(){ _validateOne(el); }, 3000);
    return true;
  }
  document.addEventListener('input', function(e){
    var el = e.target;
    if(!(_isNameOnlyField(el) || _isLatinOnlyField(el))) return;
    if(e.isComposing) return;               // IME 조합 중에는 손대지 않는다 (compositionend 뒤 input 에서 지운다)
    if(_stripNonLatin(el)) return;
    _validateOne(el);
  }, true);
  document.addEventListener('compositionend', function(e){
    var el = e.target;
    if(!(_isNameOnlyField(el) || _isLatinOnlyField(el))) return;
    setTimeout(function(){ if(!_stripNonLatin(el)) _validateOne(el); }, 0);
  }, true);
  // 붙여넣기도 같은 규칙
  document.addEventListener('paste', function(e){
    var el = e.target;
    if(!(_isNameOnlyField(el) || _isLatinOnlyField(el))) return;
    setTimeout(function(){ if(!_stripNonLatin(el)) _validateOne(el); }, 0);
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
  window._papStripNonLatin = function(value){ return String(value || '').replace(NON_LATIN_G, ''); };
  window._papValidateLatinOnly = function(value){
    return !NON_LATIN_RE.test(value || '');
  };
})();
