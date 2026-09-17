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
//
// QA #207 — the dropdown / nav-overlay UI used to be hydrated exactly
// once per page load. That meant:
//   - JWT expires while the tab is open → pap-api.js's 401 handler
//     clears localStorage, but the header still says "Account",
//     leaving the user staring at a logged-in shell that no longer
//     works.
//   - Another tab logs out → this tab keeps showing the dropdown.
//
// The function now also paints the LOGGED-OUT state when no token is
// present, so a stale logged-in shell is repaired the moment we
// notice. We expose it on `window` and wire a `storage` listener so
// any change to pap-token in any tab triggers a re-render here.
function _papUpdateAuthDropdown(){
  try{
    var dd=document.getElementById('accountDropdown');
    if(!dd) return;
    var lang=localStorage.getItem('pap-lang')||'ko';
    var t={
      ko:{mypage:'마이페이지',subscribe:'구독 관리',logout:'로그아웃',login:'로그인',signup:'회원가입'},
      en:{mypage:'MY PAGE',subscribe:'MANAGE SUBSCRIPTION',logout:'LOG OUT',login:'LOG IN',signup:'SIGN UP'},
      it:{mypage:'LA MIA PAGINA',subscribe:'GESTISCI ABBONAMENTO',logout:'ESCI',login:'ACCEDI',signup:'REGISTRATI'},
      fr:{mypage:'MON COMPTE',subscribe:'GÉRER L\'ABONNEMENT',logout:'DÉCONNEXION',login:'CONNEXION',signup:'INSCRIPTION'},
      ja:{mypage:'マイページ',subscribe:'購読管理',logout:'ログアウト',login:'ログイン',signup:'新規登録'},
      zh:{mypage:'我的页面',subscribe:'管理订阅',logout:'退出登录',login:'登录',signup:'注册'},
      es:{mypage:'MI PÁGINA',subscribe:'GESTIONAR SUSCRIPCIÓN',logout:'CERRAR SESIÓN',login:'INICIAR SESIÓN',signup:'REGISTRARSE'},
      ru:{mypage:'МОЯ СТРАНИЦА',subscribe:'УПРАВЛЕНИЕ ПОДПИСКОЙ',logout:'ВЫЙТИ',login:'ВОЙТИ',signup:'РЕГИСТРАЦИЯ'},
      de:{mypage:'MEINE SEITE',subscribe:'ABONNEMENT VERWALTEN',logout:'ABMELDEN',login:'ANMELDEN',signup:'REGISTRIEREN'}
    };
    var s=t[lang]||t.en;

    var u=localStorage.getItem('pap-user');
    var token=localStorage.getItem('pap-token');
    if(!u && !token){
      // QA #207 — explicitly paint the LOGGED-OUT state. The legacy
      // code returned early here, which is what produced "사람 아이콘
      // 클릭 시 로그인된 상태 UI가 그대로 노출됨" after a token expired.
      dd.innerHTML =
        '<a href="/auth?mode=login">'+s.login+'</a>'+
        '<a href="/auth?mode=signup">'+s.signup+'</a>';
      // Reset the nav-overlay login link too.
      document.querySelectorAll('[data-auth-updated="1"]').forEach(function(el){
        el.href='/auth?mode=login';
        el.textContent=s.login;
        el.removeAttribute('data-auth-updated');
        el.setAttribute('data-i18n','navLogin');
      });
      return;
    }

    var user=u?JSON.parse(u):null;
    var displayName=(user&&user.name)?user.name:(user&&user.email)?user.email:'Account';
    dd.innerHTML=
      '<a href="/mypage">'+s.mypage+'</a>'+
      '<a href="/subscribe">'+s.subscribe+'</a>'+
      '<div class="dropdown-divider"></div>'+
      '<button onclick="_papLogout()">'+s.logout+'</button>';
    // Also update nav overlay login link
    document.querySelectorAll('[data-i18n="navLogin"]').forEach(function(el){
      el.href='/mypage';
      el.textContent=displayName;
      el.removeAttribute('data-i18n');
      el.setAttribute('data-auth-updated','1');
    });
  }catch(e){console.warn('Auth dropdown error:',e);}
}
// QA #207 — expose globally so pap-api.js's 401 handler can call it
// the instant we clear the stale token, AND so other modules can
// trigger a sync after login.
window._papUpdateAuthDropdown = _papUpdateAuthDropdown;

// QA #207 — cross-tab + same-tab session sync.
// `storage` only fires in OTHER tabs (the one that wrote doesn't get
// its own event), so pap-api.js calls _papUpdateAuthDropdown()
// directly after its 401 sweep. The listener here covers the other
// half: a logout in tab A repaints tab B's header immediately.
try {
  window.addEventListener('storage', function(ev){
    if(!ev || (ev.key !== 'pap-token' && ev.key !== 'pap-user')) return;
    _papUpdateAuthDropdown();
  });
} catch(_){}

/* ── 쿠키 세션 ↔ localStorage 어긋남 (2026-09-17 도메니코 "5번만 진행") ─────────────────────
 * 서버(api/_lib/auth.js verifyToken)는 Authorization 헤더가 없으면 httpOnly 쿠키 pap_auth(7일)로
 * 로그인을 인정한다. 화면(isLoggedIn·isPremium·_papViewState)은 localStorage 만 본다. 어긋나는 두 경우:
 *   ① 헤더의 로그아웃이 localStorage 만 지우고 쿠키는 그대로 뒀다 → 서버는 최대 7일 계속 회원으로 본다.
 *      공용 PC 에서 "로그아웃" 했는데 다음 사람이 전체 이미지·다운로드 API 를 그대로 쓴다. 보안 문제다.
 *   ② 쿠키는 있고 localStorage 는 빈 상태(①의 결과, OAuth 교환 중단, 저장소 정리) → 화면은 비회원으로
 *      판단해 목록 클릭에 "가입하세요" 팝업을 띄우는데 정작 상세 API 는 전체를 내준다(Rebel Twin 실측).
 * 고침: ① 로그아웃은 서버 /api/auth/logout 을 불러 쿠키를 지우고 토큰을 무효화한다(keepalive: 이동 중에도 완료).
 *       ② localStorage 가 비어 있으면 탭 세션당 한 번 /api/auth/me 를 쿠키로 물어, 회원이면 pap-user 를 복원한다.
 *          토큰은 httpOnly 라 읽을 수 없지만 isLoggedIn 은 pap-user 만으로 참이고 API 는 쿠키로 통한다.
 *          비회원은 401 한 번(세션당) 받고 끝 — pap-api.js 의 401 청소기(/auth 로 이동)를 타지 않게 raw fetch 로 묻는다. */
function _papLogout(){
  try {
    var _t = localStorage.getItem('pap-token') || '';
    var _h = {};
    if(_t) _h['Authorization'] = 'Bearer ' + _t;
    fetch('/api/auth/logout', { method:'POST', credentials:'same-origin', keepalive:true, headers:_h }).catch(function(){});
  } catch(_){}
  localStorage.removeItem('pap-token');
  localStorage.removeItem('pap-user');
  try { sessionStorage.setItem('pap-sess-checked', '1'); } catch(_){}   // 방금 나갔다 — 다음 페이지에서 /me 를 다시 묻지 않는다
  // QA #207 — repaint immediately so the dropdown swaps to LOG IN
  // before the navigation hop finishes (matters when the user lands
  // back on an SPA route via the browser back button).
  _papUpdateAuthDropdown();
  window.location.href='/';
}
function _papSyncSessionFromCookie(){
  try{
    if(localStorage.getItem('pap-token') || localStorage.getItem('pap-user')) return false;
    try{ if(sessionStorage.getItem('pap-sess-checked')) return false; sessionStorage.setItem('pap-sess-checked','1'); }catch(_){}
    if(typeof fetch !== 'function') return false;
    fetch('/api/auth/me', { credentials:'same-origin', headers:{ 'X-Requested-With':'XMLHttpRequest' } })
      .then(function(r){ return (r && r.ok) ? r.json() : null; })
      .then(function(j){
        var u = j && j.user;
        if(!u || !(u.id || u.email)) return;
        localStorage.setItem('pap-user', JSON.stringify({ id:u.id, email:u.email, name:u.name, role:u.role,
          subscription:u.subscription || 'free', subscriptionStatus:u.subscriptionStatus }));
        _papUpdateAuthDropdown();
        try{ window.dispatchEvent(new CustomEvent('pap:session-restored')); }catch(_){}
      })
      .catch(function(){});
    return true;
  }catch(e){ return false; }
}
_papUpdateAuthDropdown();
_papSyncSessionFromCookie();

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
