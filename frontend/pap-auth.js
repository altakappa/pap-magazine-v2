// PAP Magazine — Auth harness (extracted from pap-app.js per HARNESS_CHECKLIST.md mission 2)
//
// Owns: header account dropdown wiring, logout, login-state probe.
// Does NOT own (intentionally — borderline, deferred to later mission):
//   isPremium / isStandardOrAbove (subscription tier semantics)
//   isBetaActive / PAP_BETA_END    (cross-cutting flag)
//   signup popup                   (auth-flavoured UI but lives in shell-style modal stack)
//
// Load order: this file MUST be loaded BEFORE pap-app.js, because pap-app.js
// references isLoggedIn() from isPremium / isStandardOrAbove (still in pap-app.js
// for now). Top-level function declarations attach to window automatically in
// classic-script context, so no explicit window.X = X is required.
//
// localStorage keys read/written: pap-token, pap-user, pap-lang.

function toggleAccountMenu(e){if(e)e.stopPropagation();var d=document.getElementById('accountDropdown');if(!d)return;d.classList.toggle('active');if(d.classList.contains('active')){setTimeout(function(){document.addEventListener('click',_closeAcct)},10)}else{document.removeEventListener('click',_closeAcct)}}
function _closeAcct(e){var d=document.getElementById('accountDropdown');if(d&&!d.contains(e.target)){d.classList.remove('active');document.removeEventListener('click',_closeAcct)}}

// ======== AUTH STATE → HEADER DROPDOWN ========
function _papUpdateAuthDropdown(){
  try{
    var u=localStorage.getItem('pap-user');
    var token=localStorage.getItem('pap-token');
    if(!u&&!token) return;
    var user=u?JSON.parse(u):null;
    var displayName=(user&&user.name)?user.name:(user&&user.email)?user.email:'Account';
    var dd=document.getElementById('accountDropdown');
    if(!dd) return;
    var lang=localStorage.getItem('pap-lang')||'ko';
    var t={
      ko:{mypage:'마이페이지',subscribe:'구독 관리',logout:'로그아웃'},
      en:{mypage:'MY PAGE',subscribe:'MANAGE SUBSCRIPTION',logout:'LOG OUT'},
      it:{mypage:'LA MIA PAGINA',subscribe:'GESTISCI ABBONAMENTO',logout:'ESCI'},
      fr:{mypage:'MON COMPTE',subscribe:'GÉRER L\'ABONNEMENT',logout:'DÉCONNEXION'},
      ja:{mypage:'マイページ',subscribe:'購読管理',logout:'ログアウト'},
      zh:{mypage:'我的页面',subscribe:'管理订阅',logout:'退出登录'},
      es:{mypage:'MI PÁGINA',subscribe:'GESTIONAR SUSCRIPCIÓN',logout:'CERRAR SESIÓN'},
      ru:{mypage:'МОЯ СТРАНИЦА',subscribe:'УПРАВЛЕНИЕ ПОДПИСКОЙ',logout:'ВЫЙТИ'},
      de:{mypage:'MEINE SEITE',subscribe:'ABONNEMENT VERWALTEN',logout:'ABMELDEN'}
    };
    var s=t[lang]||t.en;
    dd.innerHTML=
      '<a href="mypage.html">'+s.mypage+'</a>'+
      '<a href="subscribe.html">'+s.subscribe+'</a>'+
      '<div class="dropdown-divider"></div>'+
      '<button onclick="_papLogout()">'+s.logout+'</button>';
    // Also update nav overlay login link
    document.querySelectorAll('[data-i18n="navLogin"]').forEach(function(el){
      el.href='mypage.html';
      el.textContent=displayName;
      el.removeAttribute('data-i18n');
      el.setAttribute('data-auth-updated','1');
    });
  }catch(e){console.warn('Auth dropdown error:',e);}
}
function _papLogout(){
  localStorage.removeItem('pap-token');
  localStorage.removeItem('pap-user');
  window.location.href='/';
}
_papUpdateAuthDropdown();

// Global auth helpers (needed by openEditorial for premium logo section)
// 베타 기간 중에는 "로그인한 회원(무료 포함)"에게만 전체 접근 권한 부여
// 비로그인 방문자는 유료 서비스에 접근 불가 → 로그인/회원가입 유도
// 로그인 판별을 관대하게: pap-token 또는 파싱 가능한 pap-user 중 하나만 있어도
// 로그인 회원으로 인정. 세션 경계/토큰 리프레시 중 race로 한쪽이 일시적으로
// 비어 있어도 베타 회원이 잘못 페이월로 떨어지지 않게 방지한다.
function isLoggedIn(){
  try{
    if(localStorage.getItem('pap-token')) return true;
    var u=localStorage.getItem('pap-user');
    if(!u) return false;
    var parsed=JSON.parse(u);
    return !!(parsed && (parsed.id || parsed.email));
  }catch(e){ return false; }
}
