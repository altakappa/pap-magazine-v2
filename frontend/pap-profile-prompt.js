/**
 * 크리에이터 프로필 안내창 (2026-09-12 도메니코)
 *   "프리미엄 회원뿐만 아니라 모든 회원의 인스타그램 아이디, 국가 및 도시에 대한 설문 및 데이터베이스
 *    확보가 필요합니다" — 목적: 나중에 커뮤니티에서 크리에이터 자동 매치.
 *
 * 로그인한 회원에게 한 번 뜨는 작은 창: 인스타그램 아이디(선택) + 주요 활동 국가(드롭다운, ISO 코드 저장)
 * + 도시. 저장은 PUT /api/auth/me (정규화·검증은 서버). "나중에" 는 7일 뒤 다시.
 * 국가·도시가 이미 있으면 뜨지 않는다. 가입 절차 코드(구글·카카오·이메일)는 건드리지 않는다.
 * 어디서 안 뜨나: 관리자 화면, /mypage(같은 칸이 이미 있다), /submission(폼 진행 중), /auth.
 * 문구는 9개 언어 미니 사전(pap-ui-i18n 런타임과 별개로 스스로 고른다).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var PATH = location.pathname || '/';
  if (/^\/(admin|studio-admin|ops-dashboard|site-analysis|mypage|submission|auth|pepperit)/.test(PATH)) return;
  var token = ''; try { token = localStorage.getItem('pap-token') || ''; } catch (_) {}
  if (!token) return;
  var DISMISS_KEY = 'pap-profile-prompt-dismissed', DONE_KEY = 'pap-profile-prompt-done';
  try {
    if (localStorage.getItem(DONE_KEY) === '1') return;
    var d = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (d && Date.now() - d < 7 * 24 * 3600 * 1000) return;
  } catch (_) {}

  var T = {
    ko: { title: '크리에이터 프로필을 완성해 주세요', body: '인스타그램 아이디와 주요 활동 국가·도시를 알려주세요. 인스타그램 공동작업자 태그와, 곧 열릴 커뮤니티의 크리에이터 자동 매칭에 쓰입니다.', ig: '인스타그램 아이디 (선택)', country: '주요 활동 국가', city: '도시', save: '저장', later: '나중에', saved: '저장했습니다. 감사합니다!', errCountry: '국가를 골라 주세요.', errCity: '도시를 적어 주세요.', errTaken: '이 인스타그램 아이디는 이미 다른 계정에 등록돼 있습니다.', errIg: '올바른 인스타그램 아이디가 아닙니다.', errGeneric: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
    en: { title: 'Complete your creator profile', body: 'Tell us your Instagram handle and your main country and city. We use them to tag Instagram collaborators and, soon, to match creators in the PAP community.', ig: 'Instagram handle (optional)', country: 'Main country of activity', city: 'City', save: 'Save', later: 'Later', saved: 'Saved. Thank you!', errCountry: 'Please pick your country.', errCity: 'Please enter your city.', errTaken: 'This Instagram handle is already registered to another account.', errIg: 'Not a valid Instagram handle.', errGeneric: 'Could not save. Please try again in a moment.' },
    de: { title: 'Vervollständigen Sie Ihr Creator-Profil', body: 'Nennen Sie uns Ihren Instagram-Handle sowie Land und Stadt Ihrer Haupttätigkeit. Wir nutzen sie für Instagram-Collaborator-Tags und bald für das Creator-Matching in der PAP-Community.', ig: 'Instagram-Handle (optional)', country: 'Hauptland der Tätigkeit', city: 'Stadt', save: 'Speichern', later: 'Später', saved: 'Gespeichert. Danke!', errCountry: 'Bitte wählen Sie Ihr Land.', errCity: 'Bitte geben Sie Ihre Stadt an.', errTaken: 'Dieser Instagram-Handle ist bereits bei einem anderen Konto hinterlegt.', errIg: 'Kein gültiger Instagram-Handle.', errGeneric: 'Speichern fehlgeschlagen. Bitte später erneut versuchen.' },
    it: { title: 'Completa il tuo profilo creator', body: 'Indicaci il tuo handle Instagram e il paese e la città in cui lavori principalmente. Li usiamo per i tag da collaboratore su Instagram e, presto, per il matching tra creator nella community PAP.', ig: 'Handle Instagram (facoltativo)', country: 'Paese principale di attività', city: 'Città', save: 'Salva', later: 'Più tardi', saved: 'Salvato. Grazie!', errCountry: 'Seleziona il paese.', errCity: 'Inserisci la città.', errTaken: 'Questo handle Instagram è già registrato su un altro account.', errIg: 'Handle Instagram non valido.', errGeneric: 'Salvataggio non riuscito. Riprova tra poco.' },
    fr: { title: 'Complétez votre profil créateur', body: 'Indiquez votre pseudo Instagram ainsi que votre pays et votre ville d’activité principale. Ils servent aux identifications de collaborateurs sur Instagram et, bientôt, au matching entre créateurs dans la communauté PAP.', ig: 'Pseudo Instagram (facultatif)', country: 'Pays d’activité principal', city: 'Ville', save: 'Enregistrer', later: 'Plus tard', saved: 'Enregistré. Merci !', errCountry: 'Veuillez choisir votre pays.', errCity: 'Veuillez indiquer votre ville.', errTaken: 'Ce pseudo Instagram est déjà enregistré sur un autre compte.', errIg: 'Pseudo Instagram invalide.', errGeneric: 'Enregistrement impossible. Réessayez dans un instant.' },
    es: { title: 'Completa tu perfil de creador', body: 'Dinos tu usuario de Instagram y tu país y ciudad principal de actividad. Los usamos para etiquetar colaboradores en Instagram y, pronto, para emparejar creadores en la comunidad PAP.', ig: 'Usuario de Instagram (opcional)', country: 'País principal de actividad', city: 'Ciudad', save: 'Guardar', later: 'Más tarde', saved: 'Guardado. ¡Gracias!', errCountry: 'Elige tu país.', errCity: 'Escribe tu ciudad.', errTaken: 'Este usuario de Instagram ya está registrado en otra cuenta.', errIg: 'Usuario de Instagram no válido.', errGeneric: 'No se pudo guardar. Inténtalo de nuevo en un momento.' },
    ja: { title: 'クリエイタープロフィールを完成させてください', body: 'Instagramアカウントと主な活動国・都市を教えてください。Instagramのコラボレータータグと、まもなく始まるPAPコミュニティのクリエイター自動マッチングに使います。', ig: 'Instagramアカウント (任意)', country: '主な活動国', city: '都市', save: '保存', later: 'あとで', saved: '保存しました。ありがとうございます！', errCountry: '国を選んでください。', errCity: '都市を入力してください。', errTaken: 'このInstagramアカウントは既に別のアカウントに登録されています。', errIg: '有効なInstagramアカウントではありません。', errGeneric: '保存できませんでした。しばらくしてからもう一度お試しください。' },
    zh: { title: '请完善您的创作者资料', body: '请告诉我们您的 Instagram 账号以及主要活动国家和城市。它们将用于 Instagram 合作者标记，以及即将上线的 PAP 社区创作者自动匹配。', ig: 'Instagram 账号 (选填)', country: '主要活动国家', city: '城市', save: '保存', later: '稍后', saved: '已保存，谢谢！', errCountry: '请选择国家。', errCity: '请填写城市。', errTaken: '此 Instagram 账号已登记在其他账户。', errIg: '不是有效的 Instagram 账号。', errGeneric: '保存失败，请稍后重试。' },
    ru: { title: 'Заполните профиль креатора', body: 'Укажите ваш Instagram-аккаунт, а также страну и город основной деятельности. Они нужны для отметок соавторов в Instagram и, вскоре, для подбора креаторов в сообществе PAP.', ig: 'Instagram-аккаунт (необязательно)', country: 'Основная страна деятельности', city: 'Город', save: 'Сохранить', later: 'Позже', saved: 'Сохранено. Спасибо!', errCountry: 'Выберите страну.', errCity: 'Укажите город.', errTaken: 'Этот Instagram-аккаунт уже зарегистрирован на другой учётной записи.', errIg: 'Недопустимый Instagram-аккаунт.', errGeneric: 'Не удалось сохранить. Повторите попытку чуть позже.' },
  };
  function lang() { var l; try { l = localStorage.getItem('pap-lang') || 'ko'; } catch (_) { l = 'ko'; } return T[l] ? l : 'en'; }
  function t(k) { return (T[lang()] || T.en)[k] || T.en[k] || k; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function loadCountries() {
    return new Promise(function (resolve) {
      if (window.papCountryOptions) return resolve();
      var s = document.createElement('script'); s.src = '/pap-countries.js?v=1'; s.onload = function () { resolve(); }; s.onerror = function () { resolve(); };
      document.head.appendChild(s);
    });
  }
  function headers() { return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }; }

  function render(u) {
    var wrap = document.createElement('div');
    wrap.id = 'papProfilePrompt';
    wrap.setAttribute('translate', 'no');
    wrap.setAttribute('data-ui-i18n-skip', '1');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit';
    var I = 'width:100%;box-sizing:border-box;background:#111;border:1px solid rgba(255,255,255,.25);color:#fff;padding:10px 12px;font-size:13px;font-family:inherit;margin-bottom:10px';
    wrap.innerHTML = '<div style="background:#0b0b0b;border:1px solid rgba(255,255,255,.18);max-width:420px;width:100%;padding:26px 24px;color:#fff">'
      + '<div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;opacity:.55;margin-bottom:10px">PAP MAGAZINE</div>'
      + '<div style="font-size:16px;font-weight:700;margin-bottom:8px">' + esc(t('title')) + '</div>'
      + '<div style="font-size:12.5px;line-height:1.7;opacity:.75;margin-bottom:18px">' + esc(t('body')) + '</div>'
      + '<label style="display:block;font-size:10.5px;letter-spacing:.08em;opacity:.6;margin-bottom:4px">' + esc(t('ig')) + '</label>'
      + '<input id="ppIg" type="text" placeholder="@instagram" autocomplete="off" spellcheck="false" style="' + I + '" value="' + esc(u.instagram ? '@' + u.instagram : '') + '">'
      + '<label style="display:block;font-size:10.5px;letter-spacing:.08em;opacity:.6;margin-bottom:4px">' + esc(t('country')) + '</label>'
      + '<select id="ppCountry" style="' + I + ';appearance:auto"><option value=""></option></select>'
      + '<label style="display:block;font-size:10.5px;letter-spacing:.08em;opacity:.6;margin-bottom:4px">' + esc(t('city')) + '</label>'
      + '<input id="ppCity" type="text" autocomplete="off" style="' + I + '" value="' + esc(u.activityCity || '') + '">'
      + '<div id="ppMsg" style="font-size:11px;line-height:1.5;min-height:16px;margin:2px 0 12px;color:#ff9d9d"></div>'
      + '<div style="display:flex;gap:10px;justify-content:flex-end">'
      + '<button type="button" id="ppLater" style="background:transparent;border:1px solid rgba(255,255,255,.25);color:#bbb;padding:10px 16px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer">' + esc(t('later')) + '</button>'
      + '<button type="button" id="ppSave" style="background:#fff;border:1px solid #fff;color:#000;padding:10px 18px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;cursor:pointer">' + esc(t('save')) + '</button>'
      + '</div></div>';
    document.body.appendChild(wrap);
    var sel = wrap.querySelector('#ppCountry');
    if (window.papCountryOptions) window.papCountryOptions(sel, lang(), u.activityCountry || '');
    var msg = wrap.querySelector('#ppMsg');
    wrap.querySelector('#ppLater').onclick = function () { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (_) {} wrap.remove(); };
    wrap.querySelector('#ppSave').onclick = async function () {
      var ig = wrap.querySelector('#ppIg').value.trim(), country = sel.value, city = wrap.querySelector('#ppCity').value.trim();
      if (!country) { msg.textContent = t('errCountry'); return; }
      if (!city) { msg.textContent = t('errCity'); return; }
      this.disabled = true; msg.textContent = '';
      try {
        var r = await fetch('/api/auth/me', { method: 'PUT', headers: headers(), body: JSON.stringify({ instagram: ig, activityCountry: country, activityCity: city }) });
        var j = await r.json().catch(function () { return {}; });
        if (r.ok) {
          try { localStorage.setItem(DONE_KEY, '1'); } catch (_) {}
          msg.style.color = 'rgba(120,220,140,.9)'; msg.textContent = t('saved');
          setTimeout(function () { wrap.remove(); }, 900);
          return;
        }
        msg.textContent = j.code === 'INSTAGRAM_TAKEN' ? t('errTaken') : j.code === 'INSTAGRAM_INVALID' ? t('errIg') : j.code === 'COUNTRY_INVALID' ? t('errCountry') : t('errGeneric');
      } catch (_) { msg.textContent = t('errGeneric'); }
      this.disabled = false;
    };
  }

  function start() {
    setTimeout(async function () {
      try {
        var r = await fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } });
        if (!r.ok) return;
        var j = await r.json(); var u = (j && j.user) || {};
        if (u.activityCountry && u.activityCity) { try { localStorage.setItem(DONE_KEY, '1'); } catch (_) {} return; }
        await loadCountries();
        if (document.getElementById('papProfilePrompt')) return;
        render(u);
      } catch (_) {}
    }, 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
