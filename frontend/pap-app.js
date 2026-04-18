

// ======== MODAL SCROLL LOCK (공통) ========
// 모달이 열릴 때 배경 스크롤을 잠그고, 닫힐 때 원래 위치로 복원합니다.
var _scrollLockCount=0;
var _savedScrollY=0;
function lockScroll(){
  if(_scrollLockCount===0){
    _savedScrollY=window.scrollY;
    document.body.style.overflow='hidden';
    document.body.style.position='fixed';
    document.body.style.top=(-_savedScrollY)+'px';
    document.body.style.left='0';
    document.body.style.right='0';
  }
  _scrollLockCount++;
}
function unlockScroll(){
  _scrollLockCount--;
  if(_scrollLockCount<=0){
    _scrollLockCount=0;
    document.body.style.overflow='';
    document.body.style.position='';
    document.body.style.top='';
    document.body.style.left='';
    document.body.style.right='';
    window.scrollTo(0,_savedScrollY);
  }
}

// ======== i18n ========
const T={
ko:{about:'ABOUT',contact:'CONTACT',business:'BUSINESS',subscribe:'구독하기',submission:'서브미션',pullletter:'풀레터',ftAbout:'회사 소개',ftBusiness:'비즈니스',ftContact:'문의하기',ftSubscribe:'구독하기',ftSubmission:'서브미션',ftPullletter:'풀레터',ftCommunity:'커뮤니티',ftMagazine:'매거진',navEditorial:'에디토리얼',navMagazine:'매거진',navCommunity:'커뮤니티',navArticle:'아티클',navFilm:'필름',navBeauty:'뷰티',navInterview:'인터뷰',searchPh:'검색...',aprIssue:'4월호',junIssue:'6월호',editorialHeading:'에디토리얼',fc1:'밀란 패션 위크 FW26 스트릿 스타일 PART.2',fc1d:'<PAP>가 담아온 밀란 패션 위크 현장 공개',fc2:'루이사 베카리아 FW26 백스테이지 WITH 밀란 패션 위크',fc2d:'<PAP>가 루이사 베카리아 백스테이지 현장을 담아왔다',fc3:'밀란 패션 위크 FW26 스트릿 스타일 PART.1',fc3d:'<PAP>가 담아온 밀란 패션 위크 현장 공개',footerLegal:'<strong>주식회사 알타카파</strong><br>CEO : 강동민 | 개인정보 관리자: 강동민 | 사업자번호 192-88-02644<br>서울특별시 강남구 논현로146길 18, 1F PAP 매거진 | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'이용약관',privacy:'개인정보처리방침',latestEd:'최신 에디토리얼',trendingEd:'인기 에디토리얼',dreamyEd:'몽환적인 에디토리얼',boldEd:'강렬하고 대담한',warmEd:'자연과 따뜻함',modernEd:'미래적이고 모던한',fc4:'설날을 위한 가장 세련된 선택, 에덴 보드카',fc4d:'PAP가 추천하는 에덴 보드카',latestArticle:'최신기사',coverStory:'4월 커버 화보',coverTitle:'FOLIE',popupTitle:'PAP 멤버가 되어보세요',popupDesc:'에디토리얼, 필름, 아티클 등 PAP의 모든 콘텐츠를 가장 먼저 만나보세요.',popupCta:'무료로 시작하기',popupSkip:'다음에 할게요',},
en:{about:'ABOUT',contact:'CONTACT',business:'BUSINESS',subscribe:'SUBSCRIBE',submission:'SUBMISSION',pullletter:'PULL-LETTER',ftAbout:'ABOUT',ftBusiness:'BUSINESS',ftContact:'CONTACT',ftSubscribe:'SUBSCRIBE',ftSubmission:'SUBMISSION',ftPullletter:'PULL-LETTER',ftCommunity:'COMMUNITY',ftMagazine:'MAGAZINE',navEditorial:'EDITORIAL',navMagazine:'MAGAZINE',navCommunity:'COMMUNITY',navArticle:'ARTICLE',navFilm:'FILM',navBeauty:'BEAUTY',navInterview:'INTERVIEW',searchPh:'Search...',aprIssue:'APR. ISSUE',junIssue:'JUN. ISSUE',editorialHeading:'EDITORIAL',fc1:'Milan Fashion Week FW26 Street Style Part.2',fc1d:'PAP captures the scene from Milan Fashion Week',fc2:'Luisa Beccaria FW26 Backstage with Milan Fashion Week',fc2d:'PAP brings you the backstage of Luisa Beccaria',fc3:'Milan Fashion Week FW26 Street Style Part.1',fc3d:'PAP captures the scene from Milan Fashion Week',footerLegal:'<strong>ALTAKAPPA Co., Ltd.</strong><br>CEO : Domenico Kang | Business Registration No. 192-88-02644<br>1F, 18, Nonhyeon-ro 146-gil, Gangnam-gu, Seoul, Korea | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'Terms of Service',privacy:'Privacy Policy',latestEd:'Latest Editorials',trendingEd:'Trending Now',dreamyEd:'Dreamy & Ethereal',boldEd:'Bold & Intense',warmEd:'Warm & Organic',modernEd:'Futuristic & Modern',fc4:'The Most Stylish Choice for New Year, Eden Vodka',fc4d:'Eden Vodka recommended by PAP',latestArticle:'Latest Articles',coverStory:'APR. COVER STORY',coverTitle:'FOLIE',popupTitle:'Become a PAP Member',popupDesc:'Be the first to explore our editorials, films, articles, and more.',popupCta:'GET STARTED FREE',popupSkip:'Maybe later',},
it:{about:'CHI SIAMO',contact:'CONTATTI',business:'BUSINESS',subscribe:'ABBONATI',submission:'SUBMISSION',pullletter:'PULL-LETTER',ftAbout:'CHI SIAMO',ftBusiness:'BUSINESS',ftContact:'CONTATTI',ftSubscribe:'ABBONATI',ftSubmission:'SUBMISSION',ftPullletter:'PULL-LETTER',ftCommunity:'COMMUNITY',ftMagazine:'MAGAZINE',navEditorial:'EDITORIALE',navMagazine:'MAGAZINE',navCommunity:'COMMUNITY',navArticle:'ARTICOLO',navFilm:'FILM',navBeauty:'BELLEZZA',navInterview:'INTERVISTA',searchPh:'Cerca...',aprIssue:'NUM. APRILE',junIssue:'NUM. GIUGNO',editorialHeading:'EDITORIALE',fc1:'Milan Fashion Week FW26 Street Style Parte 2',fc1d:'PAP cattura la scena dalla Milan Fashion Week',fc2:'Luisa Beccaria FW26 Backstage con Milan Fashion Week',fc2d:'PAP vi porta nel backstage di Luisa Beccaria',fc3:'Milan Fashion Week FW26 Street Style Parte 1',fc3d:'PAP cattura la scena dalla Milan Fashion Week',footerLegal:'<strong>ALTAKAPPA Co., Ltd.</strong><br>CEO : Domenico Kang | P. IVA: 192-88-02644<br>1F, 18, Nonhyeon-ro 146-gil, Gangnam-gu, Seoul, Corea | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'Termini di Servizio',privacy:'Informativa sulla Privacy',latestEd:'Ultimi Editoriali',trendingEd:'Di Tendenza',dreamyEd:'Onirico & Etereo',boldEd:'Audace & Intenso',warmEd:'Caldo & Organico',modernEd:'Futuristico & Moderno',fc4:'La Scelta Più Elegante per Capodanno, Eden Vodka',fc4d:'Eden Vodka consigliata da PAP',latestArticle:'Ultimi Articoli',coverStory:'APR. COVER STORY',coverTitle:'FOLIE',popupTitle:'Diventa Membro PAP',popupDesc:'Scopri per primo i nostri editoriali, film, articoli e molto altro.',popupCta:'INIZIA GRATIS',popupSkip:'Forse più tardi',},
fr:{about:'À PROPOS',contact:'CONTACT',business:'BUSINESS',subscribe:"S'ABONNER",submission:'SOUMISSION',pullletter:'PULL-LETTER',ftAbout:'À PROPOS',ftBusiness:'BUSINESS',ftContact:'CONTACT',ftSubscribe:"S'ABONNER",ftSubmission:'SOUMISSION',ftPullletter:'PULL-LETTER',ftCommunity:'COMMUNAUTÉ',ftMagazine:'MAGAZINE',navEditorial:'ÉDITORIAL',navMagazine:'MAGAZINE',navCommunity:'COMMUNAUTÉ',navArticle:'ARTICLE',navFilm:'FILM',navBeauty:'BEAUTÉ',navInterview:'INTERVIEW',searchPh:'Rechercher...',aprIssue:'NUM. AVRIL',junIssue:'NUM. JUIN',editorialHeading:'ÉDITORIAL',fc1:'Milan Fashion Week FW26 Street Style Partie 2',fc1d:'PAP capture la scène de la Milan Fashion Week',fc2:'Luisa Beccaria FW26 Backstage Milan Fashion Week',fc2d:'PAP vous emmène dans les coulisses de Luisa Beccaria',fc3:'Milan Fashion Week FW26 Street Style Partie 1',fc3d:'PAP capture la scène de la Milan Fashion Week',footerLegal:'<strong>ALTAKAPPA Co., Ltd.</strong><br>PDG : Domenico Kang | N° d\'entreprise: 192-88-02644<br>1F, 18, Nonhyeon-ro 146-gil, Gangnam-gu, Séoul, Corée | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'Conditions d\'Utilisation',privacy:'Politique de Confidentialité',latestEd:'Derniers Éditoriaux',trendingEd:'Tendances',dreamyEd:'Onirique & Éthéré',boldEd:'Audacieux & Intense',warmEd:'Chaleureux & Organique',modernEd:'Futuriste & Moderne',fc4:'Le Choix Le Plus Élégant pour le Nouvel An, Eden Vodka',fc4d:'Eden Vodka recommandée par PAP',latestArticle:'Derniers Articles',coverStory:'APR. COVER STORY',coverTitle:'FOLIE',popupTitle:'Devenez Membre PAP',popupDesc:'Découvrez en avant-première nos éditoriaux, films, articles et bien plus.',popupCta:'COMMENCER GRATUITEMENT',popupSkip:'Peut-être plus tard',},
es:{about:'ACERCA DE',contact:'CONTACTO',business:'NEGOCIOS',subscribe:'SUSCRIBIRSE',submission:'ENVÍO',pullletter:'PULL-LETTER',ftAbout:'ACERCA DE',ftBusiness:'NEGOCIOS',ftContact:'CONTACTO',ftSubscribe:'SUSCRIBIRSE',ftSubmission:'ENVÍO',ftPullletter:'PULL-LETTER',ftCommunity:'COMUNIDAD',ftMagazine:'REVISTA',navEditorial:'EDITORIAL',navMagazine:'REVISTA',navCommunity:'COMUNIDAD',navArticle:'ARTÍCULO',navFilm:'FILM',navBeauty:'BELLEZA',navInterview:'ENTREVISTA',searchPh:'Buscar...',aprIssue:'ED. ABRIL',junIssue:'ED. JUNIO',editorialHeading:'EDITORIAL',fc1:'Milan Fashion Week FW26 Street Style Parte 2',fc1d:'PAP captura la escena de Milan Fashion Week',fc2:'Luisa Beccaria FW26 Backstage Milan Fashion Week',fc2d:'PAP te trae el backstage de Luisa Beccaria',fc3:'Milan Fashion Week FW26 Street Style Parte 1',fc3d:'PAP captura la escena de Milan Fashion Week',footerLegal:'<strong>ALTAKAPPA Co., Ltd.</strong><br>CEO : Domenico Kang | Registro Comercial: 192-88-02644<br>1F, 18, Nonhyeon-ro 146-gil, Gangnam-gu, Seúl, Corea | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'Términos de Servicio',privacy:'Política de Privacidad',latestEd:'Editoriales Recientes',trendingEd:'Tendencias',dreamyEd:'Onírico & Etéreo',boldEd:'Audaz e Intenso',warmEd:'Cálido & Orgánico',modernEd:'Futurista & Moderno',fc4:'La Elección Más Elegante para Año Nuevo, Eden Vodka',fc4d:'Eden Vodka recomendado por PAP',latestArticle:'Artículos Recientes',coverStory:'APR. COVER STORY',coverTitle:'FOLIE',popupTitle:'Hazte Miembro de PAP',popupDesc:'Sé el primero en descubrir nuestros editoriales, películas, artículos y más.',popupCta:'EMPIEZA GRATIS',popupSkip:'Quizás más tarde',},
ja:{about:'アバウト',contact:'お問い合わせ',business:'ビジネス',subscribe:'購読',submission:'サブミッション',pullletter:'PULL-LETTER',ftAbout:'アバウト',ftBusiness:'ビジネス',ftContact:'お問い合わせ',ftSubscribe:'購読',ftSubmission:'サブミッション',ftPullletter:'PULL-LETTER',ftCommunity:'コミュニティ',ftMagazine:'マガジン',navEditorial:'エディトリアル',navMagazine:'マガジン',navCommunity:'コミュニティ',navArticle:'アーティクル',navFilm:'フィルム',navBeauty:'ビューティー',navInterview:'インタビュー',searchPh:'検索...',aprIssue:'4月号',junIssue:'6月号',editorialHeading:'エディトリアル',fc1:'ミラノファッションウィーク FW26 ストリートスタイル Part.2',fc1d:'PAPがミラノファッションウィークの現場を公開',fc2:'ルイーザ・ベッカリア FW26 バックステージ',fc2d:'PAPがルイーザ・ベッカリアのバックステージをお届け',fc3:'ミラノファッションウィーク FW26 ストリートスタイル Part.1',fc3d:'PAPがミラノファッションウィークの現場を公開',footerLegal:'<strong>株式会社アルタカッパ</strong><br>CEO : カン・ドンミン | 事業者番号 192-88-02644<br>ソウル特別市 江南区 論峴路146ギル 18, 1F PAP マガジン | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'利用規約',privacy:'プライバシーポリシー',latestEd:'最新エディトリアル',trendingEd:'人気エディトリアル',dreamyEd:'夢幻的なエディトリアル',boldEd:'大胆で強烈な',warmEd:'自然と温もり',modernEd:'未来的でモダンな',fc4:'新年のための最もスタイリッシュな選択、エデンウォッカ',fc4d:'PAPおすすめのエデンウォッカ',latestArticle:'最新記事',coverStory:'4月 カバーストーリー',coverTitle:'FOLIE',popupTitle:'PAPメンバーになろう',popupDesc:'エディトリアル、フィルム、アーティクルなど、PAPの全コンテンツをいち早くお届け。',popupCta:'無料で始める',popupSkip:'あとで',},
zh:{about:'关于我们',contact:'联系方式',business:'商务合作',subscribe:'订阅',submission:'投稿',pullletter:'PULL-LETTER',ftAbout:'关于我们',ftBusiness:'商务合作',ftContact:'联系方式',ftSubscribe:'订阅',ftSubmission:'投稿',ftPullletter:'PULL-LETTER',ftCommunity:'社区',ftMagazine:'杂志',navEditorial:'编辑精选',navMagazine:'杂志',navCommunity:'社区',navArticle:'文章',navFilm:'影片',navBeauty:'美妆',navInterview:'访谈',searchPh:'搜索...',aprIssue:'四月刊',junIssue:'六月刊',editorialHeading:'编辑精选',fc1:'米兰时装周 FW26 街拍风格 Part.2',fc1d:'PAP带您直击米兰时装周现场',fc2:'Luisa Beccaria FW26 后台 米兰时装周',fc2d:'PAP带您走进Luisa Beccaria后台',fc3:'米兰时装周 FW26 街拍风格 Part.1',fc3d:'PAP带您直击米兰时装周现场',footerLegal:'<strong>株式会社 ALTAKAPPA</strong><br>CEO : 姜东民 | 营业执照号 192-88-02644<br>韩国首尔市江南区论岘路146街18号, 1F PAP 杂志 | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'服务条款',privacy:'隐私政策',latestEd:'最新时尚大片',trendingEd:'热门时尚大片',dreamyEd:'梦幻风格大片',boldEd:'大胆前卫风格',warmEd:'自然温暖风格',modernEd:'未来摩登风格',fc4:'新年最时尚的选择，伊甸伏特加',fc4d:'PAP推荐的伊甸伏特加',latestArticle:'最新文章',coverStory:'四月 封面故事',coverTitle:'FOLIE',popupTitle:'成为PAP会员',popupDesc:'抢先探索我们的时尚大片、影片、文章等精彩内容。',popupCta:'免费开始',popupSkip:'以后再说',},
ru:{about:'О НАС',contact:'КОНТАКТ',business:'БИЗНЕС',subscribe:'ПОДПИСКА',submission:'ПОДАЧА',pullletter:'PULL-LETTER',navEditorial:'EDITORIAL',navMagazine:'ЖУРНАЛ',navArticle:'СТАТЬЯ',navFilm:'FILM',navCommunity:'СООБЩЕСТВО',searchPh:'Поиск...',coverStory:'АПР. ОБЛОЖКА',coverTitle:'FOLIE',popupTitle:'Станьте участником PAP',popupDesc:'Первыми узнавайте о наших редакционных материалах, фильмах, статьях и многом другом.',popupCta:'НАЧАТЬ БЕСПЛАТНО',popupSkip:'Позже'}
};
let lang='ko';
function setLang(l){localStorage.setItem('pap-lang',l);
  lang=l;document.documentElement.lang=l;var _ls=document.getElementById('langSelect');if(_ls)_ls.value=l;
  const t=T[l]||T.en;
  document.querySelectorAll('[data-i18n]').forEach(e=>{const k=e.dataset.i18n;if(t[k])e.textContent=t[k]});
  document.querySelectorAll('[data-i18n-html]').forEach(e=>{const k=e.dataset.i18nHtml;if(t[k])e.innerHTML=t[k]});
  document.querySelectorAll('[data-i18n-ph]').forEach(e=>{const k=e.dataset.i18nPh;if(t[k])e.placeholder=t[k]});
}

// ======== LOADER ========
(function(){
  var bg=document.getElementById('loaderBg');
  if(bg){
    var slides=document.querySelectorAll('.hero-slide-img');
    if(slides.length){
      var src=slides[Math.floor(Math.random()*slides.length)].src;
      var img=new Image();
      img.onload=function(){bg.style.backgroundImage='url('+src+')';bg.classList.add('loaded');};
      img.src=src;
    }
  }
})();
window.addEventListener('load',()=>{var _l=document.getElementById('loader');if(_l)setTimeout(()=>_l.classList.add('hidden'),800);});
setTimeout(()=>{var _l=document.getElementById('loader');if(_l)_l.classList.add('hidden');},3000);

// Safety: force unlock scroll if body is stuck after page load
setTimeout(function(){
  var bs=document.body.style;
  if(bs.overflow==='hidden' && bs.position==='fixed'){
    var noOverlay=!document.getElementById('premiumInterstitial')&&!document.querySelector('.signupPopup.active,.access-gate-overlay');
    if(noOverlay){ _scrollLockCount=0; unlockScroll(); console.warn('Scroll was stuck — force unlocked'); }
  }
},4000);

// ======== HERO SLIDER ========
let hCur=0;const hSlides=document.querySelectorAll('.hero-slide');
function heroGo(n){if(!hSlides.length)return;hSlides[hCur].classList.remove('active');hCur=(n+hSlides.length)%hSlides.length;hSlides[hCur].classList.add('active')}
if(hSlides.length)setInterval(()=>heroGo(hCur+1),3000);

// ======== SEARCH ========
// ======== LANG HELPER ========
function getLangText(key,fallback){var lang=localStorage.getItem('pap-lang')||'ko';var msgs={edAccessFree:{ko:'에디토리얼 전체보기는 스탠다드 이상 회원만 이용 가능합니다.',en:'Standard membership or above is required to browse all editorials.',it:'Per accedere a tutti gli editoriali è necessario un abbonamento Standard o superiore.',fr:'Un abonnement Standard ou supérieur est requis pour parcourir tous les éditoriaux.',es:'Se requiere una membresía Estándar o superior para ver todos los editoriales.',ja:'全エディトリアルの閲覧にはスタンダード以上の会員登録が必要です。',zh:'浏览所有社论需要标准会员或以上。',ru:'Для просмотра всех редакционных материалов требуется подписка Standard или выше.'}};var m=msgs[key];if(!m)return fallback||'';return m[lang]||m.en||fallback||'';}

function toggleSearch(){const o=document.getElementById('searchBar');if(!o)return;o.classList.toggle('active');if(o.classList.contains('active')){setTimeout(()=>{var si=document.getElementById('searchInput');if(si)si.focus();},300);}else{var dd=document.getElementById('searchDropdown');if(dd)dd.classList.remove('active');var si=document.getElementById('searchInput');if(si)si.value='';}}
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
      es:{mypage:'MI PÁGINA',subscribe:'GESTIONAR SUSCRIPCIÓN',logout:'CERRAR SESIÓN'}
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

var _si=document.getElementById('searchInput');if(_si)_si.addEventListener('input',function(){searchEditorials(this.value);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='Backspace'){var isInput=e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable;if(e.key==='Backspace'&&isInput)return;var _sb=document.getElementById('searchBar');if(_sb)_sb.classList.remove('active');var _sdd=document.getElementById('searchDropdown');if(_sdd)_sdd.classList.remove('active');var _ssi=document.getElementById('searchInput');if(_ssi)_ssi.value='';var _ad=document.getElementById('accountDropdown');if(_ad)_ad.classList.remove('active');closeNav();var edOv=document.getElementById('edOverlay');if(edOv&&edOv.classList.contains('active')){closeEditorial();e.preventDefault();return;}closeAllEditorials();closeAllFilms();closeAllArticles();if(document.getElementById('filmDetailOverlay'))document.getElementById('filmDetailOverlay').classList.remove('active');if(document.getElementById('artDetailOverlay'))document.getElementById('artDetailOverlay').classList.remove('active');if(e.key==='Backspace')e.preventDefault();}});

// ======== NAV ========
function toggleNav(){
  var _n=document.getElementById('navOverlay');
  if(!_n) return;
  var opening = !_n.classList.contains('active');
  _n.classList.toggle('active');

  // Hamburger ≡ ↔ X morph
  var hb = document.querySelector('.hamburger');
  if(hb){
    if(opening) hb.classList.add('is-active');
    else hb.classList.remove('is-active');
  }

  // Scroll lock
  if(opening) lockScroll();
  else unlockScroll();

  // Floating logo
  var fLogo=document.getElementById('floatingLogo');
  var heroEl=document.querySelector('.hero');
  if(fLogo){
    if(opening){
      fLogo.style.display='none';
      if(heroEl) heroEl.style.cursor='';
    } else {
      fLogo.style.display='';
    }
  }
}
function closeNav(){
  var _n=document.getElementById('navOverlay');
  if(_n && _n.classList.contains('active')) toggleNav();
}

// ======== FASHION CAROUSEL ========
let fPos=0;
function moveCarousel(d){const t=document.getElementById('fashionTrack');if(!t||!t.firstElementChild)return;const w=t.firstElementChild.offsetWidth+24;fPos=Math.max(0,Math.min(fPos+d,2));t.style.transform=`translateX(-${fPos*w}px)`}

// ======== ED CAROUSEL ========
let ePos=0;
function moveEdCarousel(d){const t=document.getElementById('edTrack');if(!t||!t.firstElementChild)return;const w=t.firstElementChild.offsetWidth+20;ePos=Math.max(0,Math.min(ePos+d,3));t.style.transform=`translateX(-${ePos*w}px)`}

// ======== SCROLL REVEAL ========
const obs=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('v')}),{threshold:.05});
document.querySelectorAll('.sr').forEach(e=>obs.observe(e));

// ======== INIT ========

// ======== TERMS & PRIVACY PAGES ========
function openPage(id){
  document.getElementById(id).classList.add('active');
  document.body.style.overflow='hidden';
}
function closePage(id){
  document.getElementById(id).classList.remove('active');
  document.getElementById(id).scrollTop=0;
  document.body.style.overflow='';
}

// ======== EDITORIAL ROWS SCROLL ========
function scrollEdRow(btn,dir){
  var track=btn.parentElement.querySelector('.ed-row-track');
  if(track) track.scrollBy({left:dir*460,behavior:'smooth'});
}

// ======== EDITORIAL SEARCH (tag-based) ========
// ======== EDITORIAL SEARCH (tag-based) ========
var edData=[];

function searchEditorials(query){
  // Dropdown search (works on all pages with search-bar)
  var dd=document.getElementById('searchDropdown');
  var ddGrid=document.getElementById('searchDropdownGrid');
  var ddLabel=document.getElementById('searchDropdownLabel');

  // Legacy panel search (magazine page etc.)
  var results=document.getElementById('edSearchResults');
  var grid=document.getElementById('edSearchGrid');
  var label=document.getElementById('edSearchLabel');
  var rows=document.getElementById('edRows')||document.querySelector('.ed-rows-block');
  var crResults=document.getElementById('creatorResults');
  var crCards=document.getElementById('creatorCards');
  var crLabel=document.getElementById('creatorLabel');

  if(!query||query.trim().length<1){
    if(dd)dd.classList.remove('active');
    if(results)results.style.display='none';
    if(crResults)crResults.style.display='none';
    if(rows)rows.style.display='block';
    return;
  }

  var q=query.toLowerCase().trim();
  var scored=[];

  edData.forEach(function(ed){
    var score=0;
    if(ed.title.toLowerCase().indexOf(q)>-1) score+=10;
    if(ed.tags){ed.tags.forEach(function(tag){
      if(tag.indexOf(q)>-1) score+=5;
      if(q.length>2 && tag.indexOf(q.substring(0,3))>-1) score+=2;
    });}
    if(score>0) scored.push({ed:ed,score:score});
  });

  scored.sort(function(a,b){return b.score-a.score;});

  // --- Dropdown rendering (primary) ---
  if(dd&&ddGrid&&ddLabel){
    ddGrid.innerHTML='';
    if(scored.length>0){
      ddLabel.textContent='"'+query+'" · '+scored.length+'개 에디토리얼';
      var maxShow=Math.min(scored.length,12);
      for(var i=0;i<maxShow;i++){
        var e=scored[i].ed;
        var item=document.createElement('div');
        item.className='search-dropdown-item';
        (function(ed){item.onclick=function(){toggleSearch();openEditorial(ed.title,ed.img);};})(e);
        item.innerHTML='<img src="'+e.img+'" alt="'+e.title+'"><div class="search-dropdown-item-info"><div class="search-dropdown-item-cat">EDITORIAL · '+e.date+'</div><div class="search-dropdown-item-title">'+e.title+'</div></div>';
        ddGrid.appendChild(item);
      }
    } else {
      ddLabel.textContent='';
      ddGrid.innerHTML='<div class="search-no-result">"'+query+'" 관련 에디토리얼을 찾지 못했습니다</div>';
    }
    dd.classList.add('active');
  }

  // --- Legacy panel rendering (for pages with edSearchResults) ---
  if(crResults&&crCards&&crLabel&&typeof creatorData!=='undefined'&&creatorData.length>0){
    var cq=q;
    var matchedCreators=creatorData.filter(function(cr){
      return cr.name.toLowerCase().indexOf(cq)>-1 || cr.role.toLowerCase().indexOf(cq)>-1 || cr.instagram.toLowerCase().indexOf(cq)>-1;
    });
    if(matchedCreators.length>0){
      crLabel.textContent='CREATORS · '+matchedCreators.length+' found';
      crCards.innerHTML='';
      matchedCreators.forEach(function(cr){
        var card=document.createElement('div');
        card.className='creator-card';
        card.onclick=function(){openCreatorPopup(cr);};
        card.innerHTML='<div class="creator-card-name">'+cr.name+'</div><div class="creator-card-role">'+cr.role+'</div><div class="creator-card-count">'+cr.editorials.length+' editorial'+(cr.editorials.length>1?'s':'')+'</div>';
        crCards.appendChild(card);
      });
      crResults.style.display='block';
    } else {
      crResults.style.display='none';
    }
  }

  if(results&&grid&&label){
    if(scored.length>0){
      label.textContent='"'+query+'" 관련 에디토리얼 '+scored.length+'개';
      grid.innerHTML='';
      scored.forEach(function(item){
        var e=item.ed;
        var card=document.createElement('div');
        card.className='ed-row-card';
        card.onclick=function(){openEditorial(e.title,e.img);};
        card.innerHTML='<div class="ed-row-card-img"><img src="'+e.img+'" alt="'+e.title+'"></div><div class="ed-row-card-info"><div class="ed-row-card-cat">EDITORIAL - '+e.date+'</div><div class="ed-row-card-title">'+e.title+'</div></div>';
        grid.appendChild(card);
      });
      results.style.display='block';
      if(rows)rows.style.display='none';
    } else {
      label.textContent='"'+query+'" 관련 에디토리얼을 찾지 못했습니다';
      grid.innerHTML='';
      results.style.display='block';
      if(rows)rows.style.display='none';
    }
  }
}


// ======== EDITORIAL DETAIL DATA ========
var edDetails={};
var edLogoFolders={
'2Much':'1vc8OQ6k1Kf4-_u7B6DRZMsnc8dBbrQO8',
'A Mertale':'10r1p_jWraQExWqVyx_SVPYc60sjq0fz6',
'A knights Tale':'13CH4Bmw65dVcR5wtDewzT-2owfQmzliD',
'Aerial':'16jJ3wDDgOc_d08tm1z_CadchsU2mxPGK',
'Air Bag':'1MnlZ3u7IlWIwoiZoPgYgkXofjQzUmYYc',
'Becoming Form':'11E4pYzVD9RpMTm8aPNIsYJYWzAedXAL2',
'Birds Don\'t Cry':'1-K4fJrzi6sAV8x8_6HIpqBq9DrpbbORH',
'Black Radiance':'1Mt7lv_nxCvMToHz4DKGLCx4jrFFGNSvD',
'Bloom of Silence':'1PC7A2Yyip8_R-iM6URqGzWLpxwy03256',
'Blooming Flesh':'1GEn7Gx6RmjLPz73_Og49MnVtShgEB3J3',
'Candelaria del Desierto':'1sj9u3RPRfLDpl-oY3XhvYbhZq6Zw0fxO',
'Constructed Fantasies':'13qw0hjxEpqoKTVXs60Wq2KjRTb6FJy8z',
'Couture Macabre':'1lqevxzZ5Xn5JGjXefELvoswGEfci9oT3',
'Cyber Love':'1QDs9X7NgAfg8p2v_ugZvuea-M69ZdYNj',
'Dates to Remember':'1Mz-6VO-wqPIpO_RI1IvECKJNTaupNJIZ',
'Distorted Memories':'1ayOA8Qji_tGrI6Ftc6AIyOu4Y9ogVikZ',
'Doll':'1zVVSOdgg_TrnsfJd0jOFOUqNMp86f77_',
'Echo of the Souls':'1qH0JH_bt0_KMaIk4EFGWISbA6wmOf5QL',
'Echoes of the forgotten':'1sEQ4cl63Mzk3ojbB0_6pRc7LY2pT1t4v',
'Eclat':'1cjHIht8hcTSiWfwB-fUxVkZX65lnw2lY',
'Eidolon':'1GPkOHx4ewWsHgWnLlyql71PLFSaRPhzp',
'Equipoise':'1V8UjzPFqvhRvVbuL5Yt09bDuXmWf9emX',
'Folie':'1XZGqAPOuN9jAnwNpfFlESIqrpCGmKLVQ',
'For I Have Sinned':'1WyoH47h-YVlsRgYFHTc6qrtpQG3OGbCY',
'GODLESS':'1JwzshZTubdzVLLo3t_0dNNplrroWAtTX',
'Haunted':'1QxaiazFCfYDBC9au0JxVt7wFEAf0tYqj',
'Her and The Hair':'1gMecao9j3qfIHr2S3Zm3PnyqXZ3ZlCM4',
'I daydream about you online':'1fJRKpjq_DZ4PMjPDzuiplseY8-X1-QWI',
'Inner Eclipse':'1SZCdOaLzaNZ8e_HU_MoN0VT62u78gWcE',
'Insecta':'1G4wC88dB8QFWE7NpLVc9bpQiBpveCthK',
'Inside The Castle':'10iOsuVcwXNkDb605bVtALugaSNmBmxXe',
'L\'AN 01':'1pyMVmYkZoGM-WwDbxTMlGeBkS7JZOzCx',
'Life After':'17SXzwP1XNjR3WMHZLd8YtNAE-7WrKMXs',
'Love Lasts Three Years':'181rsfPfGsRC59J-up_bDcOLppAk_K5Eg',
'Lune Blanche':'1MMg9v2EA0oBflvhwOHByCFyCgWYMGboT',
'Metamorphosis of the Armour':'1Ce1fAMGx0PPYMlrIGJKt9_999_y2A2ch',
'Modern Samurai':'1CHQHgKeYTNoPhnBG0QvoC6sL2VoqozeC',
'Multicolour Dreams Of You':'1U4h2nUlYM4uxcHKgtsL1qq0AOL5Vm77l',
'Neo Goth Me':'1nmBsM6KFvSQqIooLG01YvYfSl7nudTs9',
'Nightmare':'1P4nGQ8EmP751gOUTPQetgSejUNefgK0V',
'Noir':'1Bk_0278jzBQGnSblnxd9YLshpylOMIYK',
'Power Play':'1AGWaaoDlRangKKDRZURTxBsfc_NBNUwH',
'Primal Spectrum':'1TBgZ9U2-ftRnjS8sJJshPRhK3g9_UrUD',
'Radiance':'126AD4JTDkvxcZYcoYd_E9jo8c2rfvIDw',
'Salvia':'1glcyq6lhFI3rF3THZyZMTMB8DZdR_oP7',
'Scarlet Blossom':'1UcfN11qWoWFVVHbMjpM4SVU1lJfkZTTF',
'Sculpted Silence':'1wmK_Pe2Uw9bCzxGoQwIv0raHMi3vI0w8',
'Second Surface':'1_m5zGtlPPNYlzUIKkd_M9CCTisCy2wvD',
'Severance':'1oEBOSSHaObGwHdfIQhQQh69jAMSmBN26',
'Shadow':'1FVWQ0Pqew7et7gD32ghC8F-NpCmC7oOb',
'Sharp Objects':'1J-BtXY2DrRiec41db-Metjo2VGWU5L72',
'She Was Never a Myth':'1YVUSUxvhxWN9UXle9b9meLR5A4bRBbtU',
'Shiny Darks':'1vQTr9zthES5pVF9Zfcx4mqVitqoUBLjq',
'Silent Gaze':'1xIaMemz0XL8BSE_acZBha874oXVcAOx0',
'Silenzio Ottico':'1tlgvz5uQZHf632DD65qsq2T3m8y5Yg4p',
'Silver':'1x4TO1rcQd-PjcDcF3hBA7UPi_z8INnro',
'Slash':'13yExNZIpJMXxhd1M86-PTrrbLOWUz-cR',
'Subliminal':'13rx75tvSsn7D7aBokdrWcUM4HIj248lq',
'Take A Bow':'1PCcf3IhAu62cDbr4Nr-n1bog9NCE_iMD',
'The Many Faces of Nina':'1yLM-sliFUt7UVa87iTxMOzJKJVNTrUOL',
'The Modern Muse':'1y-PMMA0yyXxaB28b4AIW_XACIO1f88OI',
'The Order of Her':'1su_fIVWmJvDX-jTAxu79SgdWfCDM_RYU',
'The Weight of Control':'1YKPOlZLPTRszp-11eptB9ZyLIHpF17hF',
'Theatrical Honor':'1F0SM86OsHBVYzW-1wvd1hS49Pf4PoSem',
'Voyage in the Box':'1jLPqFnyzxVTyd8dXLitVtCVL6638IHnq',
'Welcome to the Circus':'1XbirV_4OTXN4fcJqgBVnF2mi0WQIOCK4',
'Whilst the Lights are Burning':'1IEJeOIc3VwPI2_U1fB43bVGURVTc6lfY',
'geOmetry':'1e9ATGQ4x4WhZ07Mkp6MyS5XEmB8cynoE'
};
// Case-insensitive lookup helper for edLogoFolders
function getLogoFolderId(t){if(edLogoFolders[t])return edLogoFolders[t];var tL=t.toLowerCase();for(var k in edLogoFolders){if(k.toLowerCase()===tL)return edLogoFolders[k];}return null;}

// Global auth helpers (needed by openEditorial for premium logo section)
function isPremium(){try{var u=localStorage.getItem('pap-user');if(!u)return false;var user=JSON.parse(u);return user&&user.subscription==='premium';}catch(e){return false;}}
function isStandardOrAbove(){try{var u=localStorage.getItem('pap-user');if(!u)return false;var user=JSON.parse(u);return user&&(user.subscription==='standard'||user.subscription==='premium');}catch(e){return false;}}
function isLoggedIn(){return !!localStorage.getItem('pap-token');}

// ======== INTERSTITIAL AD + PREMIUM UPSELL ========
var _interstitialCount = 0;   // 실제 광고 노출 횟수
var _navClickCount = 0;       // 에디토리얼 클릭 횟수
var _INTERSTITIAL_MAX = 5;    // 세션당 최대 광고 노출
var _INTERSTITIAL_EVERY = 3;  // N번째 클릭마다 광고 노출 (3,6,9,12...)

// ---- BRAND AD CONFIGURATION ----
// To add a brand ad, add an object to this array.
// type: 'image' or 'video'
// src: image URL or video URL (mp4/webm)
// poster: (video only) poster image while loading
// link: click-through URL (opens in new tab)
// brand: brand name for "AD · BRAND" label
// duration: seconds before skip is enabled (default 5 for video, 3 for image)
//
// Example:
// { type:'video', src:'https://cdn.example.com/gucci-fw26.mp4', poster:'https://cdn.example.com/gucci-poster.jpg', link:'https://www.gucci.com', brand:'GUCCI', duration:5 }
// { type:'image', src:'https://cdn.example.com/prada-campaign.jpg', link:'https://www.prada.com', brand:'PRADA', duration:3 }
//
// When this array is empty, the premium upsell is shown instead.
var _brandAds = [
  { type:'image', src:'pap-studio-campaign-banner.jpg', link:'https://www.pap-studios.com', brand:'PAP STUDIO', duration:4 }
];

function _getNextBrandAd(){
  if(!_brandAds || _brandAds.length === 0) return null;
  // Rotate through ads sequentially per session
  if(typeof _brandAdIdx === 'undefined') _brandAdIdx = 0;
  var ad = _brandAds[_brandAdIdx % _brandAds.length];
  _brandAdIdx++;
  return ad;
}

function showPremiumInterstitial(callback){
  // Skip for standard+ members (ad-free benefit)
  if(isStandardOrAbove()){ if(callback) callback(); return; }
  // Session limit
  if(_interstitialCount >= _INTERSTITIAL_MAX){ if(callback) callback(); return; }
  // Count navigation clicks
  _navClickCount++;
  // Show ad every N clicks (3rd, 6th, 9th...)
  if(_navClickCount % _INTERSTITIAL_EVERY !== 0){ if(callback) callback(); return; }
  _interstitialCount++;

  var brandAd = _getNextBrandAd();
  if(brandAd){
    _showBrandAdInterstitial(brandAd, callback);
  } else {
    _showPremiumUpsellInterstitial(callback);
  }
}

// ---- BRAND AD INTERSTITIAL (image or video) ----
function _showBrandAdInterstitial(ad, callback){
  try{
  var overlay = document.createElement('div');
  overlay.id = 'premiumInterstitial';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center;flex-direction:column;opacity:0;transition:opacity .4s;';

  // AD label
  var label = document.createElement('div');
  label.textContent = 'AD' + (ad.brand ? ' · ' + ad.brand : '');
  label.style.cssText = 'position:absolute;top:16px;left:20px;font-size:9px;font-weight:700;letter-spacing:.2em;color:rgba(255,255,255,.35);font-family:Montserrat,sans-serif;z-index:2;';
  overlay.appendChild(label);

  // Media container
  var mediaWrap = document.createElement('div');
  mediaWrap.style.cssText = 'position:relative;max-width:90vw;max-height:75vh;display:flex;align-items:center;justify-content:center;cursor:pointer;';

  var duration = ad.duration || 3;

  if(ad.type === 'video'){
    var video = document.createElement('video');
    video.src = ad.src;
    if(ad.poster) video.poster = ad.poster;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.style.cssText = 'max-width:90vw;max-height:75vh;object-fit:contain;border-radius:2px;';
    mediaWrap.appendChild(video);
  } else {
    var img = document.createElement('img');
    img.src = ad.src;
    img.alt = ad.brand || 'Ad';
    img.style.cssText = 'max-width:90vw;max-height:75vh;object-fit:contain;border-radius:2px;';
    mediaWrap.appendChild(img);
  }

  // Click-through
  if(ad.link){
    mediaWrap.onclick = function(){ window.open(ad.link, '_blank'); };
  }

  overlay.appendChild(mediaWrap);

  // Skip button
  var lang = localStorage.getItem('pap-lang') || 'ko';
  var skipTexts = { ko:'건너뛰기', en:'Skip', it:'Salta', fr:'Passer', es:'Saltar', ja:'スキップ', zh:'跳过' };
  var skipLabel = skipTexts[lang] || skipTexts.en;

  var skip = document.createElement('button');
  skip.style.cssText = 'position:absolute;bottom:24px;right:24px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:rgba(255,255,255,.55);font-size:11px;font-weight:600;letter-spacing:.1em;cursor:pointer;font-family:Montserrat,sans-serif;padding:8px 20px;border-radius:2px;transition:all .2s;z-index:2;';
  skip.onmouseover = function(){ this.style.background='rgba(255,255,255,.15)'; this.style.color='rgba(255,255,255,.9)'; };
  skip.onmouseout = function(){ this.style.background='rgba(255,255,255,.1)'; this.style.color='rgba(255,255,255,.55)'; };

  var _countdown = duration;
  var _timer = null;
  skip.textContent = skipLabel + ' (' + _countdown + ')';
  skip.disabled = true;

  function closeAd(){
    if(_timer) clearInterval(_timer);
    if(ad.type === 'video'){ var v=overlay.querySelector('video'); if(v) v.pause(); }
    overlay.style.opacity = '0';
    unlockScroll();
    setTimeout(function(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 400);
    if(callback) callback();
  }

  skip.onclick = function(){ closeAd(); };
  overlay.appendChild(skip);

  // Premium upsell (below skip button area)
  var premWrap = document.createElement('div');
  premWrap.style.cssText = 'position:absolute;bottom:24px;left:50%;transform:translateX(-50%);text-align:center;z-index:2;';

  var premBadge = document.createElement('a');
  premBadge.href = 'subscribe.html';
  var premTexts = { ko:'Premium 구독으로 광고 없이 이용하기 →', en:'Subscribe to Premium for ad-free →', it:'Abbonati a Premium senza pubblicità →', fr:'Abonnez-vous Premium sans pub →', es:'Suscríbete a Premium sin anuncios →', ja:'Premiumで広告なし →', zh:'订阅Premium去除广告 →' };
  premBadge.textContent = premTexts[lang] || premTexts.en;
  premBadge.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:.05em;color:rgba(255,255,255,.45);text-decoration:none;font-family:Montserrat,sans-serif;transition:all .2s;border-bottom:1px solid rgba(255,255,255,.15);padding-bottom:2px;';
  premBadge.onmouseover = function(){ this.style.color='rgba(255,255,255,.85)'; this.style.borderBottomColor='rgba(255,255,255,.5)'; };
  premBadge.onmouseout = function(){ this.style.color='rgba(255,255,255,.45)'; this.style.borderBottomColor='rgba(255,255,255,.15)'; };
  premWrap.appendChild(premBadge);
  overlay.appendChild(premWrap);

  document.body.appendChild(overlay);
  lockScroll();
  requestAnimationFrame(function(){ overlay.style.opacity = '1'; });

  _timer = setInterval(function(){
    _countdown--;
    if(_countdown > 0){
      skip.textContent = skipLabel + ' (' + _countdown + ')';
    } else {
      clearInterval(_timer);
      skip.textContent = skipLabel;
      skip.disabled = false;
      skip.style.color = 'rgba(255,255,255,.7)';
    }
  }, 1000);
  }catch(e){ console.error('Ad error:',e); unlockScroll(); if(callback) callback(); }
}

// ---- PREMIUM UPSELL INTERSTITIAL (fallback when no brand ads) ----
function _showPremiumUpsellInterstitial(callback){
  try{
  var lang = localStorage.getItem('pap-lang') || 'ko';
  var texts = {
    ko: { tag:'SUBSCRIBE', title:'광고 없이\n모든 콘텐츠를 즐기세요', desc:'구독으로 에디토리얼, 매거진,\n독점 콘텐츠를 제한 없이 감상하세요.', btn:'구독하기', skip:'건너뛰기' },
    en: { tag:'SUBSCRIBE', title:'Enjoy all content\nwithout interruptions', desc:'Subscribe for unlimited access\nto editorials, magazines, and exclusive content.', btn:'Subscribe', skip:'Skip' },
    it: { tag:'SUBSCRIBE', title:'Goditi tutti i contenuti\nsenza interruzioni', desc:'Abbonati per accesso illimitato\na editoriali, riviste e contenuti esclusivi.', btn:'Abbonati', skip:'Salta' },
    fr: { tag:'SUBSCRIBE', title:'Profitez de tout le contenu\nsans interruption', desc:'Abonnez-vous pour un accès illimité\naux éditoriaux, magazines et contenus exclusifs.', btn:'S\'abonner', skip:'Passer' },
    es: { tag:'SUBSCRIBE', title:'Disfruta todo el contenido\nsin interrupciones', desc:'Suscríbete para acceso ilimitado\na editoriales, revistas y contenido exclusivo.', btn:'Suscríbete', skip:'Saltar' },
    ja: { tag:'SUBSCRIBE', title:'すべてのコンテンツを\n中断なくお楽しみください', desc:'購読でエディトリアル、マガジン、\n限定コンテンツに無制限アクセス。', btn:'購読する', skip:'スキップ' },
    zh: { tag:'SUBSCRIBE', title:'无干扰地\n享受所有内容', desc:'订阅后无限访问\n社论、杂志和独家内容。', btn:'订阅', skip:'跳过' }
  };
  var t = texts[lang] || texts.en;

  var overlay = document.createElement('div');
  overlay.id = 'premiumInterstitial';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .4s;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';

  var box = document.createElement('div');
  box.style.cssText = 'text-align:center;max-width:420px;padding:48px 32px;';

  // Tag
  var tag = document.createElement('div');
  tag.textContent = t.tag;
  tag.style.cssText = 'font-size:10px;font-weight:800;letter-spacing:.3em;color:rgba(255,255,255,.4);margin-bottom:24px;';

  // Title
  var h = document.createElement('h2');
  h.textContent = t.title;
  h.style.cssText = 'font-size:22px;font-weight:800;letter-spacing:.06em;line-height:1.5;color:#fff;margin-bottom:16px;white-space:pre-line;font-family:Montserrat,sans-serif;';

  // Description
  var desc = document.createElement('p');
  desc.textContent = t.desc;
  desc.style.cssText = 'font-size:12px;color:rgba(255,255,255,.5);line-height:1.9;margin-bottom:32px;white-space:pre-line;font-family:Montserrat,sans-serif;';

  // CTA button
  var btn = document.createElement('a');
  btn.href = 'subscribe.html';
  btn.textContent = t.btn;
  btn.style.cssText = 'display:inline-block;padding:14px 40px;background:#fff;color:#000;font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;text-decoration:none;font-family:Montserrat,sans-serif;transition:all .3s;border:1.5px solid #fff;';
  btn.onmouseover = function(){ this.style.background='transparent'; this.style.color='#fff'; };
  btn.onmouseout = function(){ this.style.background='#fff'; this.style.color='#000'; };

  // Skip button
  var skip = document.createElement('button');
  skip.textContent = t.skip;
  skip.style.cssText = 'display:block;margin:16px auto 0;background:none;border:none;color:rgba(255,255,255,.55);font-size:11px;font-weight:600;letter-spacing:.1em;cursor:pointer;font-family:Montserrat,sans-serif;transition:color .2s;padding:8px 16px;';
  skip.onmouseover = function(){ this.style.color='rgba(255,255,255,.9)'; };
  skip.onmouseout = function(){ this.style.color='rgba(255,255,255,.55)'; };

  var _countdown = 3;
  var _timer = null;
  skip.textContent = t.skip + ' (' + _countdown + ')';
  skip.disabled = true;
  skip.style.opacity = '0.4';

  function closeInterstitial(){
    if(_timer) clearInterval(_timer);
    overlay.style.opacity = '0';
    unlockScroll();
    setTimeout(function(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 400);
    if(callback) callback();
  }

  skip.onclick = function(){ closeInterstitial(); };

  box.appendChild(tag);
  box.appendChild(h);
  box.appendChild(desc);
  box.appendChild(btn);
  box.appendChild(skip);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  lockScroll();

  // Fade in
  requestAnimationFrame(function(){ overlay.style.opacity = '1'; });

  // Countdown then enable skip
  _timer = setInterval(function(){
    _countdown--;
    if(_countdown > 0){
      skip.textContent = t.skip + ' (' + _countdown + ')';
    } else {
      clearInterval(_timer);
      skip.textContent = t.skip;
      skip.disabled = false;
      skip.style.opacity = '1';
    }
  }, 1000);
  }catch(e){ console.error('Upsell error:',e); unlockScroll(); if(callback) callback(); }
}

// Navigate to page with interstitial check
function navigateWithInterstitial(url){
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ window.location.href=url; });
    return;
  }
  window.location.href=url;
}

function openEditorial(title,thumb){
  // Show interstitial for free users (session limited)
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){
      _openEditorialInner(title,thumb);
    });
    return;
  }
  _openEditorialInner(title,thumb);
}

function _openEditorialInner(title,thumb){
  var d=edDetails[title];
  if(!d){var titleLower=title.toLowerCase();for(var key in edDetails){if(key.toLowerCase()===titleLower){d=edDetails[key];break;}}}
  d=d||{};
  var det={issue:d.issue||'MAR. ISSUE',thumb:d.thumb||thumb,images:d.images||[thumb,thumb],credits:d.credits||[{r:'Photography',h:['@photographer']},{r:'Stylist',h:['@stylist']}],fashion:d.fashion||['@brand']};

  var heroImg=document.getElementById('edDetailHero');
  heroImg.onerror=function(){edImgError(this);};
  heroImg.src=det.thumb;
  document.getElementById('edDetailTitle').textContent=title;
  document.getElementById('edDetailIssue').textContent=det.issue;

  // Gallery 2-col with hover credits
  var gal=document.getElementById('edDetailGallery');
  gal.innerHTML='';
  det.images.forEach(function(url,idx){
    var credits='';
    // Show fashion brands as hover overlay on each image (rotate through)
    var fLen=det.fashion.length;
    if(fLen>0){
      var perImg=Math.max(2,Math.ceil(fLen/det.images.length));
      var start=(idx*perImg)%fLen;
      for(var fi=0;fi<perImg&&fi<fLen;fi++){
        var f=det.fashion[(start+fi)%fLen];
        var u=f.replace('@','');
        credits+='<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+f.replace(/'/g,"")+'\')">'+f+'</a>';
      }
    }
    gal.innerHTML+='<div class="ed-gallery-item"><img src="'+url+'" alt="'+title+'" loading="lazy" onerror="edImgError(this)"><div class="ed-img-credits">'+credits+'</div></div>';
  });

  // Credits table
  var cr=document.getElementById('edDetailCredits');
  var ch='';
  det.credits.forEach(function(c){
    var handles=c.h.map(function(h){return '<a href="#" onclick="event.preventDefault();openProfileByHandle(\''+h.replace(/'/g,"")+'\')">'+h+'</a>';}).join('  ');
    ch+='<div class="ed-cred-row"><div class="ed-cred-role">'+c.r+'</div><div class="ed-cred-val">'+handles+'</div></div>';
  });
  // Fashion by — removed (shown as hover credits on images)
  cr.innerHTML=ch;

  // Premium logo download section — links to per-editorial Google Drive "editorial for distribution" folder
  var logoSection=document.getElementById('edLogoDownload');
  if(!logoSection){
    logoSection=document.createElement('div');
    logoSection.id='edLogoDownload';
    logoSection.style.cssText='margin:24px 0;padding:16px 0;border-top:1px solid #333;';
    cr.parentNode.insertBefore(logoSection,cr.nextSibling);
  }
  var logoFolderId=getLogoFolderId(title);
  if(isPremium() && logoFolderId){
    logoSection.innerHTML='<div style="display:flex;align-items:center;gap:12px;"><span style="font-size:10px;font-weight:700;letter-spacing:.15em;color:#999;">LOGO FILES</span><a href="https://drive.google.com/drive/folders/'+logoFolderId+'" target="_blank" rel="noopener" style="display:inline-block;padding:6px 16px;border:1px solid #555;color:#fff;font-size:9px;font-weight:700;letter-spacing:.12em;text-decoration:none;transition:all .3s;" onmouseover="this.style.borderColor=\'#fff\'" onmouseout="this.style.borderColor=\'#555\'">DOWNLOAD</a></div>';
    logoSection.style.display='';
  } else {
    logoSection.style.display='none';
  }

  // Social: rating + comments
  var socialSlot=document.getElementById('edSocialSlot');
  if(socialSlot && typeof PAPSocial!=='undefined'){
    PAPSocial.renderEditorialSocial(socialSlot, title);
  }

  // More content carousel
  var track=document.getElementById('edMoreTrack');
  track.innerHTML='';
  var shown=0;
  edData.forEach(function(ed){
    if(ed.title===title||shown>=8) return;
    var esc=ed.title.replace(/'/g,"\\'");
    track.innerHTML+='<div class="ed-more-card" onclick="openEditorial(\''+esc+'\',\''+ed.img+'\')"><img src="'+ed.img+'" alt="'+ed.title+'" onerror="edImgError(this)"><div class="ed-more-card-cat">EDITORIAL & FASHION - '+ed.date+'</div><div class="ed-more-card-title">'+ed.title+'</div></div>';
    shown++;
  });

  // Hide All Editorials overlay if open (z-index conflict)
  var allOv=document.getElementById('edAllOverlay');
  if(allOv && allOv.classList.contains('active')){
    allOv.style.display='none';
    window._edAllWasOpen=true;
  }

  document.getElementById('edOverlay').classList.add('active');
  document.getElementById('edOverlay').scrollTop=0;
  document.body.style.overflow='hidden';
  if(typeof _resetCursorForModal==='function') _resetCursorForModal();
  try{history.pushState({editorial:true,title:title},'',window.location.pathname+'#editorial/'+encodeURIComponent(title));}catch(e){window.location.hash='#editorial/'+encodeURIComponent(title);}
}

function closeEditorial(skipHistory){
  document.getElementById('edOverlay').classList.remove('active');
  var allOv=document.getElementById('edAllOverlay');
  if(window._edAllWasOpen && allOv){
    allOv.style.display='';
    window._edAllWasOpen=false;
    document.body.style.overflow='hidden';
  } else {
    document.body.style.overflow='';
  }
  if(!skipHistory && window.location.hash.indexOf('#editorial/')===0){
    history.back();
  }
}

window.addEventListener('popstate',function(e){
  var edOv=document.getElementById('edOverlay');
  if(edOv && edOv.classList.contains('active')){
    closeEditorial(true);
    return;
  }
  // Close all-editorials overlay
  var edAll=document.getElementById('edAllOverlay');
  if(edAll && edAll.classList.contains('active')){closeAllEditorials(true);return;}
  // Close film/article overlays on back button
  var filmDet=document.getElementById('filmDetailOverlay');
  if(filmDet && filmDet.classList.contains('active')){closeFilmDetail(true);return;}
  var filmAll=document.getElementById('filmAllOverlay');
  if(filmAll && filmAll.classList.contains('active')){closeAllFilms();return;}
  var artDet=document.getElementById('artDetailOverlay');
  if(artDet && artDet.classList.contains('active')){closeArticleDetail(true);return;}
  var artAll=document.getElementById('artAllOverlay');
  if(artAll && artAll.classList.contains('active')){closeAllArticles();return;}
});

// ======== IMAGE ERROR HANDLER ========
function edImgError(img){
  if(img.dataset.fallback) return;
  img.dataset.fallback='1';
  var title=img.alt||'EDITORIAL';
  img.src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='533'%3E%3Crect width='400' height='533' fill='%23222'/%3E%3Ctext x='200' y='250' text-anchor='middle' fill='rgba(255,255,255,0.3)' font-family='sans-serif' font-size='13' font-weight='bold' letter-spacing='2'%3E"+encodeURIComponent(title)+"%3C/text%3E%3Ctext x='200' y='275' text-anchor='middle' fill='rgba(255,255,255,0.15)' font-family='sans-serif' font-size='10' letter-spacing='3'%3EPAP MAGAZINE%3C/text%3E%3C/svg%3E";
}

// ======== ALL EDITORIALS OVERLAY ========
var edAllBuilt=false;
var edAllCurrentPage=1;
function openAllEditorials(){
  // Show interstitial for free users (session limited)
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ _openAllEditorialsInner(); });
    return;
  }
  _openAllEditorialsInner();
}
function _openAllEditorialsInner(){
  // Membership check: free members cannot access all editorials
  if(!isStandardOrAbove()){
    alert(getLangText('edAccessFree','에디토리얼 전체보기는 스탠다드 이상 회원만 이용 가능합니다.\nStandard membership or above is required to browse all editorials.'));
    return;
  }
  var overlay=document.getElementById('edAllOverlay');
  if(!overlay) return;
  _renderEdAllPage();
  edAllBuilt=true;
  overlay.classList.add('active');
  document.body.style.overflow='hidden';
  history.pushState({allEditorials:true},'',window.location.pathname+'#all-editorials');
}
function _renderEdAllPage(){
  var grid=document.getElementById('edAllGrid');
  var count=document.getElementById('edAllCount');
  var pagContainer=document.getElementById('edAllPagination');
  grid.innerHTML='';
  var premium=isPremium();
  var standard=isStandardOrAbove()&&!premium;
  var limit=premium?edData.length:100;
  var availableData=edData.slice(0,limit);
  var totalPages=Math.ceil(availableData.length/PAP_PER_PAGE);
  if(edAllCurrentPage>totalPages) edAllCurrentPage=totalPages||1;
  var startIdx=(edAllCurrentPage-1)*PAP_PER_PAGE;
  var pageItems=availableData.slice(startIdx,startIdx+PAP_PER_PAGE);
  pageItems.forEach(function(e){
    var card=document.createElement('div');
    card.className='ed-row-card';
    card.onclick=function(){openEditorial(e.title,e.img);};
    card.innerHTML='<div class="ed-row-card-img"><img src="'+e.img+'" alt="'+e.title+'" onerror="edImgError(this)"></div><div class="ed-row-card-info"><div class="ed-row-card-cat">EDITORIAL & FASHION · '+e.date+'</div><div class="ed-row-card-title">'+e.title+'</div></div>';
    grid.appendChild(card);
  });
  if(standard&&edAllCurrentPage===totalPages&&edData.length>100){
    var upsell=document.createElement('div');
    upsell.style.cssText='grid-column:1/-1;text-align:center;padding:40px 20px;';
    upsell.innerHTML='<p style="color:#999;font-size:12px;letter-spacing:.1em;margin-bottom:12px;">PREMIUM MEMBERS CAN ACCESS ALL '+edData.length+' EDITORIALS</p><a href="subscribe.html" style="display:inline-block;padding:10px 28px;background:#fff;color:#000;font-size:11px;font-weight:700;letter-spacing:.1em;text-decoration:none;">UPGRADE TO PREMIUM</a>';
    grid.appendChild(upsell);
  }
  count.textContent=availableData.length+' EDITORIALS'+(premium?'':' (PREMIUM: '+edData.length+')');
  if(pagContainer){
    buildPagination(pagContainer,edAllCurrentPage,totalPages,function(page){
      edAllCurrentPage=page;
      _renderEdAllPage();
      var overlay=document.getElementById('edAllOverlay');
      if(overlay) overlay.scrollTo({top:0,behavior:'smooth'});
    },false);
  }
}
function closeAllEditorials(skipHistory){
  var overlay=document.getElementById("edAllOverlay");
  if(overlay && overlay.classList.contains("active")){
    overlay.classList.remove("active");
    document.body.style.overflow="";
    if(!skipHistory && window.location.hash==='#all-editorials'){history.back();}
  }
}

// ======== ALL FILMS OVERLAY ========
function openAllFilms(){
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ _openAllFilmsInner(); });
    return;
  }
  _openAllFilmsInner();
}
function _openAllFilmsInner(){
  var overlay=document.getElementById('filmAllOverlay');
  if(!overlay) return;
  var grid=document.getElementById('filmAllGrid');
  var count=document.getElementById('filmAllCount');
  var filterWrap=document.getElementById('filmFilterWrap');
  grid.innerHTML='';
  // Gather unique categories
  var cats={};
  filmAllData.forEach(function(f){(f.cat||'').split(',').forEach(function(c){c=c.trim();if(c)cats[c]=1;});});
  var catList=Object.keys(cats).sort();
  // Build category filter
  filterWrap.innerHTML='<button class="film-filter-btn active" data-cat="all">ALL</button>'+catList.map(function(c){return '<button class="film-filter-btn" data-cat="'+c+'">'+c.toUpperCase()+'</button>';}).join('');
  filterWrap.querySelectorAll('.film-filter-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      filterWrap.querySelectorAll('.film-filter-btn').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      filterFilms(btn.getAttribute('data-cat'));
    });
  });
  // Build film cards
  filmAllData.forEach(function(f,i){
    var card=document.createElement('div');
    card.className='film-all-card';
    card.setAttribute('data-cats',(f.cat||'').toLowerCase());
    card.setAttribute('data-idx',i);
    card.onclick=function(){openFilmDetail(i);};
    var dateStr=f.d?f.d.substring(0,10):'';
    card.innerHTML='<div class="film-all-thumb"><img src="'+f.th+'" alt="'+escapeHtml(f.t)+'" loading="lazy" onerror="edImgError(this)"><div class="film-play-icon"><svg viewBox="0 0 24 24" fill="#fff" width="32" height="32"><path d="M8 5v14l11-7z"/></svg></div></div><div class="film-all-info"><div class="film-all-cat">'+(f.cat||'FILM').toUpperCase()+' · '+dateStr+'</div><div class="film-all-title">'+escapeHtml(f.t)+'</div></div>';
    grid.appendChild(card);
  });
  count.textContent=filmAllData.length+' FILMS';
  history.pushState({overlay:'films'},'','#films-all');
  overlay.classList.add('active');
  document.body.style.overflow='hidden';
}
function filterFilms(cat){
  var cards=document.querySelectorAll('.film-all-card');
  var shown=0;
  cards.forEach(function(c){
    if(cat==='all'||c.getAttribute('data-cats').indexOf(cat.toLowerCase())>=0){c.style.display='';shown++;}
    else{c.style.display='none';}
  });
  var count=document.getElementById('filmAllCount');
  if(count) count.textContent=shown+' FILMS';
}
function closeAllFilms(){
  var overlay=document.getElementById('filmAllOverlay');
  if(overlay&&overlay.classList.contains('active')){
    overlay.classList.remove('active');
    document.body.style.overflow='';
  }
}
function openFilmDetail(idx){
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ _openFilmDetailInner(idx); });
    return;
  }
  _openFilmDetailInner(idx);
}
function _openFilmDetailInner(idx){
  var f=filmAllData[idx];if(!f) return;
  var overlay=document.getElementById('filmDetailOverlay');
  if(!overlay) return;
  document.getElementById('filmDetailPlayer').src='https://www.youtube.com/embed/'+f.yt+'?autoplay=1&rel=0';
  document.getElementById('filmDetailTitle').textContent=f.t||'';
  var catStr=(f.cat||'Film');
  if(f.d) catStr+=' · '+f.d;
  document.getElementById('filmDetailCat').textContent=catStr;
  var credEl=document.getElementById('filmDetailCredits');
  if(credEl){
    var cr=f.cr||[];
    credEl.innerHTML=cr.map(function(c){
      var handles=(c.p||'').split(',').map(function(h){
        h=h.trim();if(!h) return '';
        return '<a href="#" class="film-cred-link" data-handle="'+h.replace(/"/g,'')+'" style="color:#fff;text-decoration:none;cursor:pointer">'+escapeHtml(h)+'</a>';
      }).filter(Boolean).join('&nbsp;&nbsp;');
      return '<div class="ed-cred-row"><div class="ed-cred-role">'+escapeHtml(c.r||'')+'</div><div class="ed-cred-val">'+handles+'</div></div>';
    }).join('');
    // Event delegation for credit link clicks (more robust than inline onclick)
    credEl.onclick=function(e){
      var link=e.target.closest('.film-cred-link');
      if(link){
        e.preventDefault();
        var handle=link.getAttribute('data-handle');
        if(handle){try{openProfileByHandle(handle);}catch(err){console.error('openProfileByHandle error:',err);}}
      }
    };
    credEl.onmouseover=function(e){var link=e.target.closest('.film-cred-link');if(link)link.style.textDecoration='underline';};
    credEl.onmouseout=function(e){var link=e.target.closest('.film-cred-link');if(link)link.style.textDecoration='none';};
  }
  overlay.classList.add('active');
  document.body.style.overflow='hidden';
  try{history.pushState({film:true,idx:idx},'',window.location.pathname+'#film/'+encodeURIComponent(f.t||''));}catch(e){}
}
function _findFilmByTitle(title){
  if(!title) return -1;
  var n=_normWs(title);
  for(var i=0;i<filmAllData.length;i++){
    if(_normWs(filmAllData[i].t||'')===n) return i;
  }
  return -1;
}
function closeFilmDetail(skipHistory){
  var overlay=document.getElementById('filmDetailOverlay');
  if(overlay&&overlay.classList.contains('active')){
    overlay.classList.remove('active');
    document.getElementById('filmDetailPlayer').src='about:blank';
    // Check if films list overlay is open underneath
    var filmAll=document.getElementById('filmAllOverlay');
    if(filmAll&&filmAll.classList.contains('active')){
      document.body.style.overflow='hidden';
    } else {
      document.body.style.overflow='';
    }
    if(!skipHistory){try{history.back();}catch(e){}}
  }
}

// ======== ALL ARTICLES OVERLAY ========
function openAllArticles(){
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ _openAllArticlesInner(); });
    return;
  }
  _openAllArticlesInner();
}
function _openAllArticlesInner(){
  var overlay=document.getElementById('artAllOverlay');
  if(!overlay) return;
  var grid=document.getElementById('artAllGrid');
  var count=document.getElementById('artAllCount');
  var filterWrap=document.getElementById('artFilterWrap');
  grid.innerHTML='';
  // Gather unique categories
  var cats={};
  artData.forEach(function(a){(a.cat||'').split(',').forEach(function(c){c=c.trim();if(c)cats[c]=1;});});
  var catList=Object.keys(cats).sort();
  // Build filter
  filterWrap.innerHTML='<button class="art-filter-btn active" data-cat="all">ALL</button>'+catList.map(function(c){return '<button class="art-filter-btn" data-cat="'+c+'">'+c.toUpperCase()+'</button>';}).join('');
  filterWrap.querySelectorAll('.art-filter-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      filterWrap.querySelectorAll('.art-filter-btn').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      filterArticles(btn.getAttribute('data-cat'));
    });
  });
  // Build article cards
  artData.forEach(function(a,i){
    var card=document.createElement('div');
    card.className='art-all-card';
    card.setAttribute('data-cats',(a.cat||'').toLowerCase());
    card.setAttribute('data-idx',i);
    card.onclick=function(){openArticleDetail(i);};
    var dateStr=a.d?a.d.substring(0,10):'';
    card.innerHTML='<div class="art-all-thumb"><img src="'+(a.img||a.th)+'" alt="'+escapeHtml(a.t)+'" loading="lazy" onerror="edImgError(this)"></div><div class="art-all-info"><div class="art-all-cat">'+(a.cat||'ARTICLE').toUpperCase()+' · '+dateStr+'</div><div class="art-all-title">'+escapeHtml(a.t)+'</div>'+(a.sub?'<div class="art-all-sub">'+escapeHtml(a.sub)+'</div>':'')+'</div>';
    grid.appendChild(card);
  });
  count.textContent=artData.length+' ARTICLES';
  history.pushState({overlay:'articles'},'','#articles-all');
  overlay.classList.add('active');
  document.body.style.overflow='hidden';
}
function filterArticles(cat){
  var cards=document.querySelectorAll('.art-all-card');
  var shown=0;
  cards.forEach(function(c){
    if(cat==='all'||c.getAttribute('data-cats').indexOf(cat.toLowerCase())>=0){c.style.display='';shown++;}
    else{c.style.display='none';}
  });
  var count=document.getElementById('artAllCount');
  if(count) count.textContent=shown+' ARTICLES';
}
function closeAllArticles(){
  var overlay=document.getElementById('artAllOverlay');
  if(overlay&&overlay.classList.contains('active')){
    overlay.classList.remove('active');
    document.body.style.overflow='';
  }
}
function escapeHtml(t){if(!t)return '';return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function openArticleBySlug(slug){
  for(var i=0;i<artData.length;i++){if(artData[i].slug===slug){openArticleDetail(i);return;}}
}
function _decHtml(s){var d=document.createElement('div');d.innerHTML=s;return d.textContent||d.innerText||'';}
function _normWs(s){return s.replace(/[\u2018\u2019\u201C\u201D]/g,"'").replace(/\s+/g,' ').trim();}
function openArticleFromCard(card){
  var titleEl=card.querySelector('.fashion-card-title')||card.querySelector('.art-all-title');
  if(!titleEl) return;
  var raw=titleEl.innerHTML||'';
  var title=_normWs(_decHtml(raw));
  for(var i=0;i<artData.length;i++){
    var at=_normWs(artData[i].t||'');
    if(at===title||at.toUpperCase()===title){openArticleDetail(i);return;}
  }
  for(var i=0;i<artData.length;i++){
    var at=_normWs(artData[i].t||'');
    if(at.length>3&&title.length>3&&(at.indexOf(title)===0||title.indexOf(at)===0)){openArticleDetail(i);return;}
  }
}
function _renderArticleDetail(a,det){
  document.getElementById('artDetailImg').src=a.img||a.th;
  document.getElementById('artDetailTitle').textContent=a.t||'';
  document.getElementById('artDetailCat').textContent=(a.cat||'ARTICLE')+' · '+(a.d||'');
  document.getElementById('artDetailSub').textContent=a.sub||'';
  var descEl=document.getElementById('artDetailDesc');
  if(descEl){
    if(a.desc){
      if(a.desc.indexOf('<')!==-1&&a.desc.indexOf('>')!==-1){
        descEl.innerHTML=a.desc;
      } else {
        descEl.innerHTML=a.desc.split('\n').filter(function(p){return p.trim();}).map(function(p){return '<p style="margin:0 0 12px">'+escapeHtml(p)+'</p>';}).join('');
      }
      descEl.style.display='';
    } else { descEl.innerHTML='';descEl.style.display='none'; }
  }
  var creditsEl=document.getElementById('artDetailCredits');
  if(det&&det.credits&&det.credits.length){
    creditsEl.innerHTML=det.credits.map(function(c){
      var handles=(c.h||[]).map(function(h){var u=h.replace('@','');return '<a href="https://www.instagram.com/'+u+'" target="_blank" rel="noopener" style="color:#aaa;text-decoration:none">'+h+'</a>';}).join('  ');
      return '<div style="margin-bottom:8px"><span style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.08em">'+c.r+'</span><br>'+handles+'</div>';
    }).join('');
    if(det.fashion&&det.fashion.length){
      creditsEl.innerHTML+='<div style="margin-bottom:8px"><span style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.08em">Fashion</span><br>'+det.fashion.map(function(f){var u=f.replace('@','');return '<a href="https://www.instagram.com/'+u+'" target="_blank" rel="noopener" style="color:#aaa;text-decoration:none">'+f+'</a>';}).join('  ')+'</div>';
    }
    creditsEl.style.display='';
  } else if(a.cr&&a.cr.length){
    creditsEl.innerHTML=a.cr.map(function(c){
      var people=(c.p||'').split(',').map(function(p){p=p.trim();return p?'<a href="https://www.instagram.com/'+p+'" target="_blank" rel="noopener" style="color:#aaa;text-decoration:none">@'+p+'</a>':'';}).filter(Boolean).join(', ');
      return '<div style="margin-bottom:8px"><span style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.08em">'+escapeHtml(c.r)+'</span><br>'+people+'</div>';
    }).join('');
    creditsEl.style.display='';
  } else { creditsEl.style.display='none'; }
  var tagsEl=document.getElementById('artDetailTags');
  if(a.tags){
    var tagArr=Array.isArray(a.tags)?a.tags:(typeof a.tags==='string'?a.tags.split(','):[]);
    tagsEl.innerHTML=tagArr.map(function(t){return '<span style="display:inline-block;padding:3px 10px;background:rgba(255,255,255,.08);border-radius:12px;font-size:10px;color:#aaa;letter-spacing:.05em;margin:2px 4px 2px 0">#'+escapeHtml(typeof t==='string'?t.trim():String(t))+'</span>';}).join('');
    tagsEl.style.display='';
  } else { tagsEl.style.display='none'; }
  var galEl=document.getElementById('artDetailGallery');
  if(galEl){
    var galImgs=(det&&det.images&&det.images.length>0)?det.images:(a.gallery&&a.gallery.length>0?a.gallery:null);
    if(galImgs){
      galEl.innerHTML=galImgs.map(function(url){return '<div style="overflow:hidden;border-radius:2px;background:#111"><img src="'+url+'" alt="'+escapeHtml(a.t)+'" loading="lazy" style="width:100%;display:block" onerror="edImgError(this)"></div>';}).join('');
      galEl.style.display='grid';
    } else { galEl.innerHTML='';galEl.style.display='none'; }
  }
  var linkEl=document.getElementById('artDetailLink');
  if(linkEl){ linkEl.style.display='none'; }
  // Social: comments
  var socialSlot=document.getElementById('artSocialSlot');
  if(socialSlot && typeof PAPSocial!=='undefined'){
    PAPSocial.renderArticleSocial(socialSlot, a.slug||a.t, a.t);
  }
}
/* PAP API fetch removed - using local gallery data */
function openArticleDetail(idx){
  if(!isStandardOrAbove() && _interstitialCount < _INTERSTITIAL_MAX){
    showPremiumInterstitial(function(){ _openArticleDetailInner(idx); });
    return;
  }
  _openArticleDetailInner(idx);
}
function _openArticleDetailInner(idx){
  var a=artData[idx];if(!a) return;
  var overlay=document.getElementById('artDetailOverlay');
  if(!overlay) return;
  var det=null;
  if(typeof edDetails!=='undefined'){
    det=edDetails[a.t];
    if(!det){var tLow=a.t.toLowerCase();for(var key in edDetails){if(key.toLowerCase()===tLow){det=edDetails[key];break;}}}
  }
  // Check if article needs dynamic content fetch
  
  _renderArticleDetail(a,det);
  overlay.classList.add('active');
  overlay.scrollTop=0;
  document.body.style.overflow='hidden';
  
  // Push state for back button
  try{history.pushState({article:true,idx:idx},'',window.location.pathname+'#article/'+encodeURIComponent(a.slug||a.t));}catch(e){}
}
function closeArticleDetail(skipHistory){
  var overlay=document.getElementById('artDetailOverlay');
  if(overlay&&overlay.classList.contains('active')){
    overlay.classList.remove('active');
    // Check if articles list overlay is open underneath
    var artAll=document.getElementById('artAllOverlay');
    if(artAll&&artAll.classList.contains('active')){
      document.body.style.overflow='hidden';
    } else {
      document.body.style.overflow='';
    }
    if(!skipHistory){try{history.back();}catch(e){}}
  }
}


// AUTO LANGUAGE DETECTION
(function(){
  var saved=localStorage.getItem('pap-lang');
  if(!saved){
    var tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';
    var lang=navigator.language||navigator.userLanguage||'';
    lang=lang.toLowerCase();
    if(lang.startsWith('ko')||tz.indexOf('Seoul')>-1) saved='ko';
    else if(lang.startsWith('ja')||tz.indexOf('Tokyo')>-1) saved='ja';
    else if(lang.startsWith('zh')||tz.indexOf('Shanghai')>-1||tz.indexOf('Beijing')>-1||tz.indexOf('Hong_Kong')>-1||tz.indexOf('Taipei')>-1) saved='zh';
    else if(lang.startsWith('it')||tz.indexOf('Rome')>-1) saved='it';
    else if(lang.startsWith('fr')||tz.indexOf('Paris')>-1) saved='fr';
    else if(lang.startsWith('es')||tz.indexOf('Madrid')>-1||tz.indexOf('Mexico')>-1) saved='es';
    else if(lang.startsWith('ru')||tz.indexOf('Moscow')>-1||tz.indexOf('Petersburg')>-1) saved='ru';
    else saved='en';
    localStorage.setItem('pap-lang',saved);
  }
  setLang(saved);
})();


// ======== CREATOR DATA (demo) ========
var creatorData=[];


// ======== CREATOR PROFILE SYSTEM ========
function getLevel(count){
  if(count>=20) return {name:'DIAMOND',icon:'💎',cls:'lvl-diamond'};
  if(count>=10) return {name:'PLATINUM',icon:'✦',cls:'lvl-platinum'};
  if(count>=5) return {name:'GOLD',icon:'★',cls:'lvl-gold'};
  if(count>=3) return {name:'SILVER',icon:'☆',cls:'lvl-silver'};
  return {name:'BRONZE',icon:'●',cls:'lvl-bronze'};
}

// Build creator database from edDetails
function buildCreatorDB(){
  var db={};
  for(var title in edDetails){
    var ed=edDetails[title];
    // Process credits
    (ed.credits||[]).forEach(function(cr){
      (cr.h||[]).forEach(function(handle){
        var key=handle.toLowerCase();
        if(!db[key]){db[key]={name:handle.replace('@',''),handle:handle,role:cr.r,editorials:[],imgs:[]};}
        if(db[key].editorials.indexOf(title)===-1){
          db[key].editorials.push(title);
          if(ed.thumb) db[key].imgs.push({title:title,img:ed.thumb});
        }
      });
    });
    // Process fashion
    (ed.fashion||[]).forEach(function(handle){
      var key=handle.toLowerCase();
      if(!db[key]){db[key]={name:handle.replace('@',''),handle:handle,role:'Fashion Brand',editorials:[],imgs:[]};}
      db[key].isBrand=true;
      if(db[key].editorials.indexOf(title)===-1){
        db[key].editorials.push(title);
        if(ed.thumb) db[key].imgs.push({title:title,img:ed.thumb});
      }
    });
  }
  return db;
}
var creatorDB=null;
function getCreatorDB(){if(!creatorDB)creatorDB=buildCreatorDB();return creatorDB;}

function openCreatorPopup(cr){
  // cr can be: {name,role,instagram,editorials,img} or {name,handle,role,editorials,imgs}
  var name=cr.name||'';
  var handle=cr.handle||cr.instagram||'';
  var role=cr.role||'';
  var editorials=cr.editorials||[];
  var imgs=cr.imgs||[];
  
  // If no imgs provided, try to find from edDetails (case-insensitive)
  if(imgs.length===0 && editorials.length>0){
    editorials.forEach(function(t){
      var ed=edDetails[t];
      if(!ed){var tL=t.toLowerCase();for(var k in edDetails){if(k.toLowerCase()===tL){ed=edDetails[k];break;}}}
      if(ed && ed.thumb) imgs.push({title:t,img:ed.thumb});
    });
  }

  var isBrand=cr.isBrand||(role==='Fashion Brand');

  document.getElementById('cpName').textContent=name.replace('@','');
  document.getElementById('cpRole').textContent=role;

  var lvlEl=document.getElementById('cpLevel');
  if(isBrand){
    lvlEl.className='creator-popup-level';
    lvlEl.innerHTML=editorials.length+' EDITORIAL'+(editorials.length!==1?'S':'');
  } else {
    var level=getLevel(editorials.length);
    lvlEl.className='creator-popup-level '+level.cls;
    lvlEl.innerHTML='<span class="lvl-icon">'+level.icon+'</span> '+level.name+' · '+editorials.length+' EDITORIAL'+(editorials.length!==1?'S':'');
  }
  
  // Instagram button
  var igBtn=document.getElementById('cpIgBtn');
  var igHandle=handle.replace('@','');
  if(igHandle){
    igBtn.href='https://www.instagram.com/'+igHandle+'/';
    igBtn.textContent='@'+igHandle;
    igBtn.style.display='inline-flex';
  } else {
    igBtn.style.display='none';
  }
  
  // Stats
  document.getElementById('cpCount').textContent=editorials.length;
  document.getElementById('cpFirst').textContent=editorials.length>0?editorials[editorials.length-1].substring(0,15):'—';
  document.getElementById('cpLatest').textContent=editorials.length>0?editorials[0].substring(0,15):'—';

  // Average editorial rating from audience
  var ratingSlot=document.getElementById('cpAvgRating');
  if(!ratingSlot){
    ratingSlot=document.createElement('div');
    ratingSlot.id='cpAvgRating';
    var lvlEl2=document.getElementById('cpLevel');
    if(lvlEl2 && lvlEl2.parentNode) lvlEl2.parentNode.insertBefore(ratingSlot, lvlEl2.nextSibling);
  }
  if(typeof PAPSocial!=='undefined'){
    ratingSlot.innerHTML='<div class="pap-profile-rating-empty">별점 불러오는 중...</div>';
    Promise.resolve(PAPSocial.getCreatorAvgRating(handle)).then(function(cav){
      if(cav && cav.count>0){
        ratingSlot.innerHTML='<div class="pap-profile-rating">'+
          '<span class="pap-profile-rating-num">'+cav.avg.toFixed(1)+'</span>'+
          '<span class="pap-profile-rating-stars">'+PAPSocial.starHTML(cav.avg,false)+'</span>'+
          '<span class="pap-profile-rating-count">'+cav.count+'명 평가 · '+(cav.ratedEditorials||0)+'/'+(cav.editorials||editorials.length)+' 에디토리얼</span>'+
        '</div>';
      } else if(editorials.length>0){
        ratingSlot.innerHTML='<div class="pap-profile-rating-empty">아직 별점이 등록되지 않았습니다</div>';
      } else {
        ratingSlot.innerHTML='';
      }
    }).catch(function(err){
      console.error('[creatorAvg] load failed:', err);
      ratingSlot.innerHTML='';
    });
  }
  
  // Editorial works grid
  var grid=document.getElementById('cpWorks');
  grid.innerHTML='';
  imgs.forEach(function(item){
    var div=document.createElement('div');
    div.className='creator-work-card';
    div.innerHTML='<img src="'+item.img+'" alt="'+item.title+'"><div class="creator-work-title">'+item.title+'</div>';
    div.onclick=function(){closeCreatorPopup();openEditorial(item.title,item.img);};
    grid.appendChild(div);
  });
  
  document.getElementById('creatorPopup').classList.add('active');
  lockScroll();
  if(typeof _resetCursorForModal==='function') _resetCursorForModal();
}

function closeCreatorPopup(){
  document.getElementById('creatorPopup').classList.remove('active');
  unlockScroll();
}

// Open profile by handle (from editorial credits)
function openProfileByHandle(handle){
  var db=getCreatorDB();
  var key=handle.toLowerCase();
  if(db[key]){
    openCreatorPopup(db[key]);
  } else {
    // Create minimal profile
    openCreatorPopup({name:handle.replace('@',''),handle:handle,role:'Contributor',editorials:[],imgs:[]});
  }
}


// ======== FILM DATABASE (141 films) ========
var filmAllData=[];

// ======== ARTICLE DATABASE ========
var artData=[];




window.artData=artData;window.filmAllData=filmAllData;
// ======== FILM SLUG HELPER ========
function filmSlug(title){
  if(!title) return '';
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
}
function filmPageUrl(title){
  return 'https://www.pap-magazine.com/ko/'+filmSlug(title)+'-film/';
}

// ======== FILM — Netflix hover + scroll ========
function scrollFilm(dir){
  var s=document.getElementById('filmScroll');
  if(s) s.scrollBy({left:dir*420,behavior:'smooth'});
}

// Netflix popup interaction
(function(){
  var cards=document.querySelectorAll('.nf-card');
  var popup=document.getElementById('nfPopup');
  var popImg=document.getElementById('nfPopupImg');
  var popSlot=document.getElementById('nfPopupSlot');
  var popTitle=document.getElementById('nfPopupTitle');
  var popCat=document.getElementById('nfPopupCat');
  var popPlay=document.getElementById('nfPopupPlay');
  var hTimer=null,lTimer=null,curTitle='';

  if(!popup||!popImg||!popTitle) return;

  function showPopup(card){
    var rect=card.getBoundingClientRect();
    var pw=320;
    var l=rect.left+rect.width/2-pw/2;
    var t=rect.top-75;
    if(l<8)l=8;
    if(l+pw>window.innerWidth-8)l=window.innerWidth-pw-8;
    popup.style.left=l+'px';
    popup.style.top=t+'px';

    var thumb=card.getAttribute('data-thumb');
    if(thumb) popImg.src=thumb;
    popTitle.textContent=card.getAttribute('data-title')||'';
    popCat.textContent=card.getAttribute('data-cat')||'';
    curTitle=card.getAttribute('data-title')||'';

    // Show thumbnail instead of YouTube embed
    if(popSlot) popSlot.innerHTML='';
    popup.classList.add('active');
  }

  function hidePopup(){
    popup.classList.remove('active');
    if(popSlot) popSlot.innerHTML='';
    curTitle='';
  }

  for(var i=0;i<cards.length;i++){
    (function(card){
      card.addEventListener('mouseenter',function(){
        clearTimeout(lTimer);
        hTimer=setTimeout(function(){showPopup(card);},400);
      });
      card.addEventListener('mouseleave',function(){
        clearTimeout(hTimer);
        lTimer=setTimeout(hidePopup,300);
      });
    })(cards[i]);
  }

  popup.addEventListener('mouseenter',function(){clearTimeout(lTimer);});
  popup.addEventListener('mouseleave',function(){lTimer=setTimeout(hidePopup,300);});

  if(popPlay){
    popPlay.addEventListener('click',function(){
      if(curTitle){var fi=_findFilmByTitle(curTitle);if(fi>=0)openFilmDetail(fi);}
    });
  }
  // ⓘ Info button — navigate to films page
  var popInfo=popup.querySelector('.nf-popup-info');
  if(popInfo){
    popInfo.addEventListener('click',function(){
      if(curTitle){
        var fi=_findFilmByTitle(curTitle);
        if(fi>=0) openFilmDetail(fi);
        else window.location.href='films.html';
      } else {
        window.location.href='films.html';
      }
    });
  }
})();



// ======== FLOATING LOGO (cursor follow on hero) ========
(function(){
  const fLogo = document.getElementById('floatingLogo');
  if(!fLogo) return;
  // On mobile/touch devices, keep logo fixed in header — skip all floating logic
  if('ontouchstart' in window || navigator.maxTouchPoints > 0){
    fLogo.classList.add('in-header');
    fLogo.style.left = '50%';
    fLogo.style.top = '0';
    fLogo.style.transform = 'translateX(-50%)';
    fLogo.style.position = 'fixed';
    return;
  }
  const header = document.querySelector('.header');
  const heroEl = document.querySelector('.hero');
  const headerLogo = document.querySelector('.logo-wrap');
  if(!headerLogo) return;
  let onHero = false;
  let mouseX = 0, mouseY = 0;
  let rafId = null;

  function getHeaderLogoPos(){
    const r = headerLogo.getBoundingClientRect();
    return { x: window.innerWidth / 2, y: r.top + r.height/2 };
  }

  var edgeBouncing = false;
  var EDGE_THRESHOLD = 40; // px from edge to trigger bounce

  // ======== BOUNCE COIN COUNTER (below header logo, flash then fade) ========
  var bounceCount = 0;
  var bounceCooldown = false;
  var scoreEl = document.createElement('span');
  scoreEl.id = 'bounceScore';
  var heroSymbol = document.querySelector('.hero-symbol');
  if(heroSymbol){
    var symbolWrap = document.createElement('div');
    symbolWrap.id = 'symbolScoreWrap';
    heroSymbol.parentNode.insertBefore(symbolWrap, heroSymbol);
    symbolWrap.appendChild(heroSymbol);
    symbolWrap.appendChild(scoreEl);
  } else { document.body.appendChild(scoreEl); }

  function positionScore(){
    /* score is centered inside #symbolScoreWrap via CSS */
  }

  function triggerBounceScore(){
    if(bounceCooldown) return;
    if('ontouchstart' in window || navigator.maxTouchPoints > 0) return;
    bounceCooldown = true;
    bounceCount++;
    // Position score below header logo
    positionScore();
    scoreEl.textContent = bounceCount;
    scoreEl.classList.remove('show');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('show');
    // Spawn "+1" at the logo's current position (where it hit the edge)
    var plus = document.createElement('div');
    plus.className = 'bounce-plus-one';
    plus.textContent = '+1';
    var logoRect = fLogo.getBoundingClientRect();
    plus.style.left = (logoRect.left + logoRect.width / 2) + 'px';
    plus.style.top = (logoRect.top + logoRect.height / 2) + 'px';
    document.body.appendChild(plus);
    // Combo text for milestones
    if(bounceCount === 100){
      var love = document.createElement('div');
      love.className = 'bounce-combo bounce-love';
      love.textContent = 'PAP Loves You';
      love.style.left = '50%';
      love.style.top = '40%';
      document.body.appendChild(love);
      setTimeout(function(){ if(love.parentNode) love.parentNode.removeChild(love); }, 2500);
    } else if(bounceCount % 10 === 0){
      var combo = document.createElement('div');
      combo.className = 'bounce-combo';
      combo.textContent = bounceCount + ' COMBO!';
      combo.style.left = '50%';
      combo.style.top = '35%';
      document.body.appendChild(combo);
      setTimeout(function(){ if(combo.parentNode) combo.parentNode.removeChild(combo); }, 1200);
    }
    setTimeout(function(){ if(plus.parentNode) plus.parentNode.removeChild(plus); }, 800);
    setTimeout(function(){ bounceCooldown = false; }, 300);
  }

  // Reset counter when hero scrolls out of view
  var heroObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting && bounceCount > 0){
        bounceCount = 0;
        scoreEl.classList.remove('show');
        scoreEl.textContent = '';
      }
    });
  }, {threshold: 0});
  if(heroEl) heroObserver.observe(heroEl);

  function updateFloatingLogo(){
    if(!heroEl) return;
    const heroRect = heroEl.getBoundingClientRect();
    // Exclude header area — cursor must be below header to activate custom cursor
    var headerEl = document.querySelector('.header');
    var headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom + 8 : 80; // +8px buffer
    // Also exclude auth-btn-wrap & active dropdown area from hero cursor zone
    var authWrap = document.querySelector('.auth-btn-wrap');
    var acctDD = document.getElementById('accountDropdown');
    var overAuth = false;
    if(authWrap){var ar=authWrap.getBoundingClientRect();if(mouseX>=ar.left-8&&mouseX<=ar.right+8&&mouseY>=ar.top-8&&mouseY<=ar.bottom+8)overAuth=true;}
    if(acctDD&&acctDD.classList.contains('active')){var dr=acctDD.getBoundingClientRect();if(mouseX>=dr.left-8&&mouseX<=dr.right+8&&mouseY>=dr.top-8&&mouseY<=dr.bottom+8)overAuth=true;}
    const isInHero = !overAuth && heroRect.top <= mouseY && mouseY <= heroRect.bottom && heroRect.left <= mouseX && mouseX <= heroRect.right && mouseY > headerBottom;

    // Detect if cursor is near left or right edge of hero
    var nearLeftEdge = isInHero && (mouseX - heroRect.left) < EDGE_THRESHOLD;
    var nearRightEdge = isInHero && (heroRect.right - mouseX) < EDGE_THRESHOLD;
    var nearEdge = nearLeftEdge || nearRightEdge;

    // Squish zone: wider than bounce threshold, logo folds outward as it nears edge
    var SQUISH_ZONE = 120;
    var distFromLeft = mouseX - heroRect.left;
    var distFromRight = heroRect.right - mouseX;
    var foldDeg = 0; // rotateY degrees for 3D fold effect
    if(isInHero && distFromRight < SQUISH_ZONE){
      // Near right edge — fold outward (rotate toward viewer on right side)
      var t = 1 - Math.max(0, distFromRight / SQUISH_ZONE);
      foldDeg = t * 75; // max 75deg
    } else if(isInHero && distFromLeft < SQUISH_ZONE){
      // Near left edge — fold outward (rotate toward viewer on left side)
      var t = 1 - Math.max(0, distFromLeft / SQUISH_ZONE);
      foldDeg = -(t * 75);
    }

    if(isInHero && heroRect.top < window.innerHeight * 0.5 && !nearEdge){
      // Cursor is on hero area, not near edges
      if(!onHero || edgeBouncing){
        onHero = true;
        edgeBouncing = false;
        fLogo.classList.remove('in-header');
        fLogo.classList.add('on-cursor');
        heroEl.style.cursor = 'none';
      }
      fLogo.style.left = mouseX + 'px';
      fLogo.style.top = mouseY + 'px';
      fLogo.style.transform = 'translate(-50%,-50%) perspective(300px) rotateY(' + foldDeg + 'deg)';
    } else {
      // Outside hero OR near edge — bounce logo up to header position
      if(onHero || !fLogo.classList.contains('in-header')){
        // Score when logo was following cursor (onHero) and bounces back
        if(onHero) triggerBounceScore();
        onHero = false;
        edgeBouncing = nearEdge;
        fLogo.classList.add('in-header');
        fLogo.classList.remove('on-cursor');
        heroEl.style.cursor = '';
      }
      const hp = getHeaderLogoPos();
      fLogo.style.left = hp.x + 'px';
      fLogo.style.top = hp.y + 'px';
      fLogo.style.transform = 'translate(-50%,-50%)';
    }
  }

  // Trail pool
  const TRAIL_COUNT = 8;
  const trailPool = [];
  const logoSrc = fLogo.querySelector('img').src;
  for(let i=0;i<TRAIL_COUNT;i++){
    const t = document.createElement('div');
    t.className = 'logo-trail';
    t.innerHTML = '<img src="'+logoSrc+'" alt="">';
    document.body.appendChild(t);
    trailPool.push(t);
  }
  let trailIdx = 0;
  let lastTrailTime = 0;

  function spawnTrail(x, y){
    const now = performance.now();
    if(now - lastTrailTime < 40) return; // throttle: ~25fps
    lastTrailTime = now;
    const t = trailPool[trailIdx % TRAIL_COUNT];
    trailIdx++;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
    t.style.animation = 'none';
    t.offsetHeight;
    t.style.animation = 'trailFade .5s ease forwards';
  }

  // Check if any modal/popup/overlay is active (disable cursor interaction)
  function isModalActive(){
    var signupPopup = document.getElementById('signupPopup');
    var creatorPopup = document.getElementById('creatorPopup');
    var cookieBanner = document.getElementById('cookieConsent');
    var navOverlay = document.getElementById('navOverlay');
    var papModal = document.querySelector('.pap-modal-overlay');
    var interstitial = document.getElementById('premiumInterstitial');
    var brandAd = document.querySelector('[id^="brandAd"]');
    var pageOverlay = document.querySelector('.page-overlay.active');
    if(signupPopup && signupPopup.classList.contains('active')) return true;
    if(creatorPopup && creatorPopup.classList.contains('active')) return true;
    if(navOverlay && navOverlay.classList.contains('active')) return true;
    if(cookieBanner) return true;
    if(papModal) return true;
    if(interstitial) return true;
    if(brandAd) return true;
    if(pageOverlay) return true;
    return false;
  }

  document.addEventListener('mousemove', function(e){
    // Skip cursor tracking when any modal/popup is active — return logo to header
    if(isModalActive()){
      if(onHero){
        onHero = false;
        var hp = getHeaderLogoPos();
        fLogo.style.transition = 'all .4s cubic-bezier(.22,1,.36,1)';
        fLogo.style.left = hp.x + 'px';
        fLogo.style.top = hp.y + 'px';
        fLogo.classList.add('in-header');
        fLogo.classList.remove('on-cursor');
        if(heroEl) heroEl.style.cursor = '';
      }
      return;
    }
    mouseX = e.clientX;
    mouseY = e.clientY;
    if(onHero) spawnTrail(mouseX, mouseY);
    if(!rafId){
      rafId = requestAnimationFrame(function(){
        updateFloatingLogo();
        rafId = null;
      });
    }
  });

  // Re-evaluate floating logo on scroll (cursor may have left hero due to scroll)
  document.addEventListener('scroll', function(){
    if(onHero && !rafId){
      rafId = requestAnimationFrame(function(){
        updateFloatingLogo();
        rafId = null;
      });
    }
  }, {passive: true});

  // Initial position — also serves as re-initialization when navigating back to main
  window.addEventListener('load', function(){
    fLogo.style.display = ''; // ensure logo is visible
    fLogo.style.opacity = '1';
    fLogo.classList.add('in-header');
    var hp = getHeaderLogoPos();
    fLogo.style.left = hp.x + 'px';
    fLogo.style.top = hp.y + 'px';
    fLogo.style.transform = 'translate(-50%,-50%)';
  });

  window.addEventListener('resize', function(){
    if(!onHero){
      const hp = getHeaderLogoPos();
      fLogo.style.left = hp.x + 'px';
      fLogo.style.top = hp.y + 'px';
    }
  });

  // ======== BFCACHE / TAB-SWITCH RESTORATION ========
  // Safari (and some other browsers) aggressively cache pages in bfcache.
  // On back/forward navigation the page is restored from memory without
  // re-executing scripts, so the closure state (onHero, logo position,
  // event listeners) may be stale.  Reset the cursor to a known good state.
  function _resetFloatingLogoToHeader(){
    onHero = false;
    edgeBouncing = false;
    rafId = null;
    fLogo.classList.add('in-header');
    fLogo.classList.remove('on-cursor');
    if(heroEl) heroEl.style.cursor = '';
    fLogo.style.transition = 'none';
    var hp = getHeaderLogoPos();
    fLogo.style.left = hp.x + 'px';
    fLogo.style.top = hp.y + 'px';
    fLogo.style.transform = 'translate(-50%,-50%)';
    // Restore CSS transition after a paint frame
    requestAnimationFrame(function(){
      fLogo.style.transition = '';
    });
  }

  window.addEventListener('pageshow', function(e){
    // ALWAYS reset cursor on pageshow — whether from bfcache or normal navigation
    // This fixes the bug where custom cursor disappears after returning from sub-pages
    _resetFloatingLogoToHeader();
  });

  // When the tab regains visibility, re-sync logo position (header may have
  // shifted due to resize while tab was hidden).
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden && !onHero){
      var hp = getHeaderLogoPos();
      fLogo.style.left = hp.x + 'px';
      fLogo.style.top = hp.y + 'px';
    }
  });

  // Expose reset for external callers (e.g. _resetCursorForModal)
  window._papResetFloatingLogo = _resetFloatingLogoToHeader;

  // Extra safety: also reset on DOMContentLoaded in case load already fired
  if(document.readyState === 'complete' || document.readyState === 'interactive'){
    _resetFloatingLogoToHeader();
  } else {
    document.addEventListener('DOMContentLoaded', function(){
      _resetFloatingLogoToHeader();
    });
  }

  // ======== PAP PONG GAME (double-click on header logo) ========
  var gameActive = false;
  var gameCanvas = null;
  var gameCtx = null;
  var gameRaf = null;
  var gameLevel = 1;
  var gameMaxLevel = 10;
  var gameScore = 0;
  var gameLives = 3;
  var gamePaddle = null;
  var gameBalls = [];
  var gameLogoImg = null;
  var gameStarted = false;
  var gameLevelUpTimer = 0;
  var gameParticles = [];
  var gameCombo = 0;
  var gameMaxCombo = 0;

  // Preload logo image for the game
  gameLogoImg = new Image();
  gameLogoImg.src = fLogo.querySelector('img').src;

  function initGame(){
    if(gameActive) return;
    if('ontouchstart' in window || navigator.maxTouchPoints > 0) return;
    gameActive = true;
    gameLevel = 1;
    gameScore = 0;
    gameLives = 3;
    gameCombo = 0;
    gameMaxCombo = 0;
    gameLevelUpTimer = 0;
    gameParticles = [];

    gameCanvas = document.createElement('canvas');
    gameCanvas.id = 'papGameCanvas';
    gameCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;cursor:none;';
    document.body.appendChild(gameCanvas);
    gameCanvas.width = window.innerWidth;
    gameCanvas.height = window.innerHeight;
    gameCtx = gameCanvas.getContext('2d');

    fLogo.style.display = 'none';
    setupGameLevel(gameLevel);
    gameStarted = true;
    gameLoop();

    gameCanvas.addEventListener('mousemove', function(e){
      if(gamePaddle) gamePaddle.x = e.clientX - gamePaddle.w / 2;
    });
    document.addEventListener('keydown', gameKeyHandler);
  }

  function gameKeyHandler(e){
    if(e.key === 'Escape' && gameActive) closeGame();
  }

  function closeGame(){
    gameActive = false;
    gameStarted = false;
    if(gameRaf) cancelAnimationFrame(gameRaf);
    if(gameCanvas) gameCanvas.remove();
    gameCanvas = null;
    fLogo.style.display = '';
    document.removeEventListener('keydown', gameKeyHandler);
  }

  function setupGameLevel(level){
    var cw = gameCanvas.width;
    var ch = gameCanvas.height;
    gameBalls = [];
    gameLevelUpTimer = 0;
    gamePaddle = {
      x: cw / 2 - 60, y: ch - 50,
      w: Math.max(80, 150 - level * 6), h: 14
    };
    // Start with 1 ball, add more as level increases
    var ballCount = Math.min(level, 6);
    for(var i = 0; i < ballCount; i++){
      spawnBall(cw, ch, level, i === 0);
    }
  }

  function spawnBall(cw, ch, level, isFirst){
    var size = 32 + Math.random() * 12;
    var baseSpeed = 2.5 + level * 0.4;
    // Random angle upward (between -30deg and -150deg from horizontal)
    var angle = -(0.3 + Math.random() * 0.4) * Math.PI;
    if(Math.random() > 0.5) angle = Math.PI + angle;
    var vx = Math.cos(angle) * baseSpeed * (0.8 + Math.random() * 0.4);
    var vy = -Math.abs(Math.sin(angle) * baseSpeed * (0.8 + Math.random() * 0.4));
    // First ball starts from paddle area, others from random top positions
    var startX, startY;
    if(isFirst){
      startX = cw / 2;
      startY = ch - 100;
      vy = -Math.abs(vy); // ensure going up
    } else {
      startX = 60 + Math.random() * (cw - 120);
      startY = 60 + Math.random() * (ch * 0.3);
      // Random direction but with some downward component
      vy = Math.abs(vy) * (Math.random() > 0.5 ? 1 : -1);
    }
    gameBalls.push({
      x: startX,
      y: startY,
      vx: vx,
      vy: vy,
      size: size,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.06,
      trail: [],
      bounceFlash: 0
    });
  }

  function spawnParticles(x, y, color, count){
    for(var i = 0; i < count; i++){
      var angle = Math.random() * Math.PI * 2;
      var speed = 1 + Math.random() * 3;
      gameParticles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.02 + Math.random() * 0.03,
        size: 2 + Math.random() * 3,
        color: color
      });
    }
  }

  function gameLoop(){
    if(!gameActive) return;
    gameRaf = requestAnimationFrame(gameLoop);
    var ctx = gameCtx;
    var cw = gameCanvas.width;
    var ch = gameCanvas.height;

    ctx.clearRect(0, 0, cw, ch);

    // Background with subtle gradient
    var bgGrad = ctx.createRadialGradient(cw/2, ch/2, 0, cw/2, ch/2, cw * 0.7);
    bgGrad.addColorStop(0, 'rgba(15,15,15,0.92)');
    bgGrad.addColorStop(1, 'rgba(0,0,0,0.95)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, cw, ch);

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for(var gx = 0; gx < cw; gx += 80){
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, ch); ctx.stroke();
    }
    for(var gy = 0; gy < ch; gy += 80){
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cw, gy); ctx.stroke();
    }

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.setLineDash([8, 12]);
    ctx.beginPath(); ctx.moveTo(0, ch/2); ctx.lineTo(cw, ch/2); ctx.stroke();
    ctx.setLineDash([]);

    // HUD
    ctx.fillStyle = '#fff';
    ctx.font = '600 14px Montserrat, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('LEVEL ' + gameLevel + '/' + gameMaxLevel, 20, 30);
    ctx.textAlign = 'center';
    ctx.fillText('SCORE: ' + gameScore, cw / 2, 30);
    ctx.textAlign = 'right';
    var heartsStr = '';
    for(var hi = 0; hi < gameLives; hi++) heartsStr += '\u2665 ';
    ctx.fillStyle = '#ff6b6b';
    ctx.fillText(heartsStr, cw - 20, 30);

    // Combo display
    if(gameCombo > 1){
      ctx.fillStyle = 'rgba(255,215,0,' + Math.min(1, 0.4 + gameCombo * 0.1) + ')';
      ctx.font = 'bold ' + (12 + gameCombo) + 'px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('COMBO x' + gameCombo, cw / 2, 55);
    }

    // Ball count & ESC hint
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '400 11px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BALLS: ' + gameBalls.length + '  |  ESC TO EXIT', cw / 2, ch - 15);

    // Level up flash
    if(gameLevelUpTimer > 0){
      gameLevelUpTimer--;
      var flashAlpha = gameLevelUpTimer / 60;
      ctx.fillStyle = 'rgba(255,215,0,' + (flashAlpha * 0.15) + ')';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = 'rgba(255,215,0,' + flashAlpha + ')';
      ctx.font = 'bold 42px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LEVEL ' + gameLevel + '!', cw / 2, ch / 2 - 40);
      if(gameLevel > 1){
        ctx.font = '400 14px Montserrat, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,' + (flashAlpha * 0.7) + ')';
        ctx.fillText('+1 BALL', cw / 2, ch / 2);
      }
    }

    // Update & draw particles
    for(var pi = gameParticles.length - 1; pi >= 0; pi--){
      var p = gameParticles[pi];
      p.x += p.vx; p.y += p.vy;
      p.life -= p.decay;
      if(p.life <= 0){ gameParticles.splice(pi, 1); continue; }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Update & draw bouncing logo balls
    for(var i = gameBalls.length - 1; i >= 0; i--){
      var ball = gameBalls[i];

      // Physics: move
      ball.x += ball.vx;
      ball.y += ball.vy;
      // Slight gravity pull
      ball.vy += 0.04;
      ball.rotation += ball.rotSpeed;
      if(ball.bounceFlash > 0) ball.bounceFlash -= 0.05;

      // Wall bounces (left, right, top)
      var r = ball.size / 2;
      if(ball.x - r <= 0){
        ball.x = r;
        ball.vx = Math.abs(ball.vx);
        ball.rotSpeed = -ball.rotSpeed;
        spawnParticles(ball.x, ball.y, 'rgba(255,255,255,0.5)', 3);
      }
      if(ball.x + r >= cw){
        ball.x = cw - r;
        ball.vx = -Math.abs(ball.vx);
        ball.rotSpeed = -ball.rotSpeed;
        spawnParticles(ball.x, ball.y, 'rgba(255,255,255,0.5)', 3);
      }
      if(ball.y - r <= 0){
        ball.y = r;
        ball.vy = Math.abs(ball.vy);
        spawnParticles(ball.x, ball.y, 'rgba(255,255,255,0.5)', 3);
      }

      // Paddle collision
      if(ball.vy > 0 &&
         ball.y + r >= gamePaddle.y &&
         ball.y - r <= gamePaddle.y + gamePaddle.h &&
         ball.x + r >= gamePaddle.x &&
         ball.x - r <= gamePaddle.x + gamePaddle.w){
        // Bounce up
        ball.y = gamePaddle.y - r;
        // Angle depends on where ball hits paddle
        var hitPos = (ball.x - gamePaddle.x) / gamePaddle.w; // 0 to 1
        var bounceAngle = (hitPos - 0.5) * 1.2; // -0.6 to 0.6
        var speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        speed = Math.min(speed * 1.02, 8 + gameLevel * 0.5); // slight acceleration, cap speed
        ball.vx = Math.sin(bounceAngle) * speed;
        ball.vy = -Math.abs(Math.cos(bounceAngle) * speed);
        ball.rotSpeed = bounceAngle * 0.1;
        ball.bounceFlash = 1;

        // Score & combo
        gameCombo++;
        if(gameCombo > gameMaxCombo) gameMaxCombo = gameCombo;
        var pts = 10 * Math.min(gameCombo, 5);
        gameScore += pts;

        spawnParticles(ball.x, gamePaddle.y, '#FFD700', 8);

        // Show points popup
        gameParticles.push({
          x: ball.x, y: gamePaddle.y - 20,
          vx: 0, vy: -1,
          life: 1, decay: 0.025,
          size: 0, color: '#FFD700',
          text: '+' + pts
        });
      }

      // Missed — fell below screen
      if(ball.y - r > ch + 20){
        gameBalls.splice(i, 1);
        gameLives--;
        gameCombo = 0;
        spawnParticles(ball.x, ch, '#ff4444', 12);
        // Respawn if still alive
        if(gameLives > 0 && gameBalls.length === 0){
          setTimeout(function(){
            if(gameActive){
              var bc = Math.min(gameLevel, 6);
              for(var bi = 0; bi < bc; bi++) spawnBall(cw, ch, gameLevel, bi === 0);
            }
          }, 500);
        }
        continue;
      }

      // Ball trail
      ball.trail.push({x: ball.x, y: ball.y, a: 0.4});
      if(ball.trail.length > 8) ball.trail.shift();

      // Draw trail
      for(var ti = 0; ti < ball.trail.length; ti++){
        var t = ball.trail[ti];
        t.a *= 0.85;
        ctx.globalAlpha = t.a * 0.3;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(t.x, t.y, ball.size * 0.3 * (ti / ball.trail.length), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Draw rotating logo ball
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.rotate(ball.rotation);

      // Glow effect on bounce
      if(ball.bounceFlash > 0){
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 20 * ball.bounceFlash;
      }

      ctx.globalAlpha = 0.92;
      if(gameLogoImg.complete && gameLogoImg.naturalWidth > 0){
        ctx.drawImage(gameLogoImg, -ball.size / 2, -ball.size / 2, ball.size, ball.size);
      } else {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + Math.floor(ball.size * 0.45) + 'px Montserrat, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PAP', 0, 0);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Draw text particles (score popups)
    for(var tpi = gameParticles.length - 1; tpi >= 0; tpi--){
      var tp = gameParticles[tpi];
      if(tp.text){
        ctx.globalAlpha = tp.life;
        ctx.fillStyle = tp.color;
        ctx.font = 'bold 16px Montserrat, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(tp.text, tp.x, tp.y);
        tp.y += tp.vy;
        tp.life -= tp.decay;
        if(tp.life <= 0) gameParticles.splice(tpi, 1);
      }
    }
    ctx.globalAlpha = 1;

    // Draw paddle (stylized PAP bar)
    ctx.save();
    var padGrad = ctx.createLinearGradient(gamePaddle.x, gamePaddle.y, gamePaddle.x + gamePaddle.w, gamePaddle.y);
    padGrad.addColorStop(0, 'rgba(255,255,255,0.9)');
    padGrad.addColorStop(0.5, '#fff');
    padGrad.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.fillStyle = padGrad;
    // Glow under paddle
    ctx.shadowColor = 'rgba(255,255,255,0.4)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.roundRect(gamePaddle.x, gamePaddle.y, gamePaddle.w, gamePaddle.h, 4);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.font = 'bold 9px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAP', gamePaddle.x + gamePaddle.w / 2, gamePaddle.y + 11);
    ctx.textAlign = 'left';
    ctx.restore();

    // Check level clear
    var levelGoal = gameLevel * 150;
    if(gameScore >= levelGoal){
      if(gameLevel >= gameMaxLevel){
        // WIN!
        gameActive = false;
        cancelAnimationFrame(gameRaf);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, cw, ch);
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 48px Montserrat, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('YOU WIN!', cw / 2, ch / 2 - 50);
        ctx.fillStyle = '#fff';
        ctx.font = '600 20px Montserrat, sans-serif';
        ctx.fillText('FINAL SCORE: ' + gameScore, cw / 2, ch / 2);
        ctx.font = '400 13px Montserrat, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('MAX COMBO: x' + gameMaxCombo, cw / 2, ch / 2 + 30);
        ctx.fillText('CLICK TO CLOSE', cw / 2, ch / 2 + 65);
        gameCanvas.onclick = function(){ closeGame(); };
        return;
      }
      // Level up!
      gameLevel++;
      gameLevelUpTimer = 60;
      // Keep existing balls, add a new one
      spawnBall(cw, ch, gameLevel, false);
      // Shrink paddle slightly
      gamePaddle.w = Math.max(80, 150 - gameLevel * 6);
    }

    // Game over
    if(gameLives <= 0){
      gameActive = false;
      cancelAnimationFrame(gameRaf);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 48px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', cw / 2, ch / 2 - 50);
      ctx.fillStyle = '#fff';
      ctx.font = '600 20px Montserrat, sans-serif';
      ctx.fillText('SCORE: ' + gameScore + '  |  LEVEL: ' + gameLevel, cw / 2, ch / 2);
      ctx.font = '400 13px Montserrat, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('MAX COMBO: x' + gameMaxCombo, cw / 2, ch / 2 + 30);
      ctx.fillText('CLICK TO RESTART', cw / 2, ch / 2 + 65);
      gameCanvas.onclick = function(){
        gameCanvas.onclick = null;
        gameActive = true;
        gameLevel = 1; gameScore = 0; gameLives = 3;
        gameCombo = 0; gameMaxCombo = 0;
        gameParticles = [];
        setupGameLevel(gameLevel);
        gameLoop();
      };
      return;
    }
  }

  // Double-click on FLOATING LOGO (center top) to start game
  if(fLogo){
    fLogo.style.cursor = 'pointer';
    var logoClickTimer = null;
    fLogo.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      if(logoClickTimer) clearTimeout(logoClickTimer);
      logoClickTimer = setTimeout(function(){ window.location.href = '/'; }, 300);
    });
    fLogo.addEventListener('dblclick', function(e){
      e.preventDefault();
      e.stopPropagation();
      if(logoClickTimer){ clearTimeout(logoClickTimer); logoClickTimer = null; }
      initGame();
    });

    // Add click-invite indicator (pulsing glow)
    var playHint = document.createElement('div');
    playHint.className = 'logo-play-hint';
    playHint.textContent = 'DOUBLE CLICK TO PLAY';
    playHint.style.cssText = 'position:absolute;top:100%;left:50%;transform:translateX(-50%);white-space:nowrap;font-family:Montserrat,sans-serif;font-size:8px;font-weight:600;letter-spacing:.15em;color:rgba(255,255,255,0);padding-top:4px;pointer-events:none;transition:color .3s;';
    fLogo.appendChild(playHint);

    // Show hint on hover
    fLogo.addEventListener('mouseenter', function(){
      playHint.style.color = 'rgba(255,255,255,0.5)';
    });
    fLogo.addEventListener('mouseleave', function(){
      playHint.style.color = 'rgba(255,255,255,0)';
    });
  }
})();


// ======== MODAL CURSOR RESET (proactively disable floating cursor when popup opens) ========
function _resetCursorForModal(){
  // Prefer the internal reset (also resets closure state like onHero)
  if(window._papResetFloatingLogo){
    window._papResetFloatingLogo();
    return;
  }
  // Fallback: DOM-only reset (closure state unreachable)
  var fLogo=document.getElementById('floatingLogo');
  var heroEl=document.querySelector('.hero');
  if(fLogo){
    fLogo.classList.add('in-header');
    fLogo.classList.remove('on-cursor');
    fLogo.style.transition='all .4s cubic-bezier(.22,1,.36,1)';
    var hLogo=document.querySelector('.logo-wrap');
    if(hLogo){
      var r=hLogo.getBoundingClientRect();
      fLogo.style.left=(window.innerWidth/2)+'px';
      fLogo.style.top=(r.top+r.height/2)+'px';
    }
    fLogo.style.transform='translate(-50%,-50%)';
  }
  if(heroEl) heroEl.style.cursor='';
}

// ======== SIGNUP POPUP ========
// INDEPENDENT from cookie consent — both popups show SIMULTANEOUSLY on first visit.
// Cookie popup (bottom bar, z-index:10000) + Signup popup (center modal, z-index:5000)
// Each popup has its own state in localStorage and closes independently.
(function(){
  var SIGNUP_KEY = 'pap-signup-shown';
  // Check localStorage (persists across pages AND sessions)
  var dismissed;
  try { dismissed = localStorage.getItem(SIGNUP_KEY); } catch(e) { dismissed = null; }
  if(dismissed) return;

  function _showSignupPopup(){
    try{
      var el = document.getElementById('signupPopup');
      if(!el) return;
      el.classList.add('active');
      lockScroll();
      if(typeof _resetCursorForModal === 'function') _resetCursorForModal();
    }catch(e){ console.error('Signup popup error:', e); }
  }

  // Show immediately after DOM is ready (no waiting for cookie consent)
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(_showSignupPopup, 800); });
  } else {
    setTimeout(_showSignupPopup, 800);
  }
})();
function closeSignupPopup(){
  var el = document.getElementById('signupPopup');
  if(el) el.classList.remove('active');
  unlockScroll();
  // Save to localStorage so it persists across pages and doesn't reappear
  try { localStorage.setItem('pap-signup-shown', '1'); } catch(e) {}
}
// ======== FILM AUTO-PLAY ========
var filmInView=false;
var filmPlaying=false;

function playFilm(card){
  var title=card.getAttribute('data-title');
  if(!title) return;
  var idx=_findFilmByTitle(title);
  if(idx>=0) openFilmDetail(idx);
}

function stopFilm(){
  var fp=document.getElementById('filmMainPlayer');
  if(fp) fp.src='about:blank';
  filmPlaying=false;
}

// Film section visibility (no auto-play since films now link to PAP website)
var filmObserver=new IntersectionObserver(function(entries){
  entries.forEach(function(e){
    filmInView=e.isIntersecting;
  });
},{threshold:0.3});

var filmSec=document.getElementById('films');
if(filmSec) filmObserver.observe(filmSec);

// ======== SHORTS CAROUSEL ========
var shortsData=[];
var shortsIdx=0;
var shortsAutoTimer=null;
var shortsInView=false;

function buildShortsCarousel(){
  var track=document.getElementById('shortsTrack');
  var dots=document.getElementById('shortsDots');
  if(!track)return;
  track.innerHTML='';dots.innerHTML='';
  shortsData.forEach(function(s,i){
    var div=document.createElement('div');
    div.className='shorts-item';
    div.setAttribute('data-idx',i);
    div.onclick=function(){if(i!==shortsIdx){shortsIdx=i;updateShortsPositions();}};
    div.innerHTML='<iframe src="about:blank" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen loading="lazy"></iframe><div class="shorts-item-title">'+s.title+'</div>';
    track.appendChild(div);
    var dot=document.createElement('div');
    dot.className='shorts-dot';
    dot.onclick=function(){shortsIdx=i;updateShortsPositions();};
    dots.appendChild(dot);
  });
  updateShortsPositions();
}

function getShortsVisibleCount(){
  var w=window.innerWidth;
  if(w>=1800) return 4;
  if(w>=1400) return 3;
  if(w>=900) return 2;
  return 1;
}

function updateShortsPositions(){
  var items=document.querySelectorAll('.shorts-item');
  var dots=document.querySelectorAll('.shorts-dot');
  var n=shortsData.length;
  var trackEl=document.getElementById('shortsTrack');
  var trackW=trackEl.offsetWidth;
  var sides=getShortsVisibleCount();
  var itemW=240;
  var gap=Math.min(30, (trackW - itemW) / (sides * 2 + 1));
  var step=itemW * 0.82 + gap;

  items.forEach(function(item,i){
    var diff=i-shortsIdx;
    if(diff>n/2) diff-=n;
    if(diff<-n/2) diff+=n;

    item.className='shorts-item';
    var x=0;
    var ad=Math.abs(diff);
    if(diff===0){item.classList.add('center');x=0;}
    else if(ad<=sides){
      var cls=diff<0?'left':'right';
      item.classList.add(cls+ad);
      x=diff*step;
    }
    else{item.classList.add('hidden');x=diff<0?-(sides+1)*step:(sides+1)*step;}

    item.style.left='calc(50% - 120px + '+x+'px)';

    var iframe=item.querySelector('iframe');
    if(ad<=sides){
      var autoplay=diff===0?'&autoplay=1&mute=1':'';
      var src='https://www.youtube.com/embed/'+shortsData[i].id+'?rel=0&loop=1&playlist='+shortsData[i].id+autoplay;
      if(iframe.src!==src) iframe.src=src;
    } else {
      if(iframe.src!=='about:blank') iframe.src='about:blank';
    }
  });

  dots.forEach(function(d,i){d.className='shorts-dot'+(i===shortsIdx?' on':'');});

  // Reset auto-advance timer
  clearTimeout(shortsAutoTimer);
  if(shortsInView){
    shortsAutoTimer=setTimeout(function(){moveShort(1);},15000);
  }
}

function moveShort(dir){
  shortsIdx=(shortsIdx+dir+shortsData.length)%shortsData.length;
  updateShortsPositions();
}

// IntersectionObserver: auto-play when scrolled into view
var shortsObserver=new IntersectionObserver(function(entries){
  entries.forEach(function(e){
    shortsInView=e.isIntersecting;
    if(e.isIntersecting){
      updateShortsPositions();
    } else {
      clearTimeout(shortsAutoTimer);
      // Pause center iframe
      var center=document.querySelector('.shorts-item.center iframe');
      if(center) center.src=center.src; // reload to stop
    }
  });
},{threshold:0.4});

var shortsSec=document.getElementById('shortsSection');
if(shortsSec) shortsObserver.observe(shortsSec);

// ======== SUPABASE API AUTO-SYNC ========

// Define render callbacks BEFORE lazy loading so they're available when JSON arrives
window._papShortsRender = function(){ buildShortsCarousel(); };

// Auto-play first film in main player when film data loads (muted for autoplay policy)
window._papFilmAutoPlay = function(){
  if(filmAllData.length > 0){
    var fp = document.getElementById('filmMainPlayer');
    if(fp && (fp.src === 'about:blank' || fp.src === '')){
      fp.src = 'https://www.youtube.com/embed/' + filmAllData[0].yt + '?rel=0&autoplay=1&mute=1&loop=1&playlist=' + filmAllData[0].yt;
    }
  }
};

// ======== LAZY DATA LOADING ========
(function(){
  function loadJSON(url, target, renderCb){
    fetch(url).then(function(r){ return r.json(); }).then(function(data){
      target.length = 0;
      data.forEach(function(item){ target.push(item); });
      if(renderCb) renderCb();
      console.log('[PAP] Loaded ' + target.length + ' items from ' + url);
    }).catch(function(e){
      console.warn('[PAP] Could not load ' + url + ', using API sync fallback');
    });
  }
  // Only load JSON if not running from file:// protocol
  if(window.location.protocol !== 'file:'){
    // Use late-binding wrappers so callbacks are resolved when JSON arrives, not when loadJSON is called
    loadJSON('data/films.json', filmAllData, function(){ if(window._papFilmRenderCards) window._papFilmRenderCards(); if(window._papFilmAutoPlay) window._papFilmAutoPlay(); });
    loadJSON('data/articles.json', artData, function(){ if(window._papArticleRenderCards) window._papArticleRenderCards(); });
    loadJSON('data/editorials.json', edData);
    loadJSON('data/creators.json', creatorData);
    loadJSON('data/shorts.json', shortsData, function(){ if(window._papShortsRender) window._papShortsRender(); });
    // For edDetails (object, not array):
    fetch('data/editorial-details.json').then(function(r){return r.json();}).then(function(data){
      Object.keys(data).forEach(function(k){ edDetails[k]=data[k]; });
      console.log('[PAP] Loaded editorial details');
    }).catch(function(e){ console.warn('[PAP] Could not load editorial details'); });
  }
})();
// Fetches films/articles from Supabase API and merges with hardcoded data.
// API data (from admin uploads) is prepended; hardcoded data serves as fallback.
// Works on all pages: index.html, films.html, articles.html, pap-magazine-v5.html
(function(){
  var PAP_API_BASE='';
  (function detectBase(){
    var h=window.location.hostname;
    if(h==='localhost'||h==='127.0.0.1'){
      PAP_API_BASE='http://localhost:3000/api';
    } else if(h.includes('vercel.app')){
      PAP_API_BASE=window.location.origin+'/api';
    } else if(h.includes('pap-magazine.com')){
      PAP_API_BASE='https://www.pap-magazine.com/api';
    } else {
      // Local file:// or unknown host — skip sync
      PAP_API_BASE='';
    }
  })();

  if(!PAP_API_BASE){
    console.log('[PAP Sync] No API detected (local file mode). Using hardcoded data only.');
    return;
  }

  console.log('[PAP Sync] API base:',PAP_API_BASE);

  // Convert Supabase film record → hardcoded filmAllData format
  function apiFilmToLocal(f){
    return {
      t: f.title||'',
      yt: f.youtube_id||'',
      th: f.thumbnail_url||'',
      d: f.published_date||'',
      cat: Array.isArray(f.categories)? f.categories.join(',') : (f.categories||'Film'),
      tags: Array.isArray(f.tags)? f.tags.join(',') : (f.tags||''),
      cr: Array.isArray(f.credits)? f.credits : [],
      _api_id: f.id
    };
  }

  // Convert Supabase article record → hardcoded artData format
  function apiArticleToLocal(a){
    return {
      t: a.title||'',
      sub: a.subtitle||'',
      d: a.published_date||'',
      slug: a.slug||'',
      url: a.custom_url||a.slug||'',
      cat: a.category||'',
      th: a.thumbnail_url||'',
      img: a.hero_image_url||'',
      tags: Array.isArray(a.tags)? a.tags : [],
      cr: Array.isArray(a.credits)? a.credits : [],
      desc: a.content||'',
      gallery: Array.isArray(a.gallery)? a.gallery : [],
      _api_id: a.id
    };
  }

  // Merge: API items first, then hardcoded (deduplicated by title)
  function mergeData(apiItems, localItems){
    var seen={};
    var merged=[];
    apiItems.forEach(function(item){
      var key=(item.t||'').trim().toLowerCase();
      if(key && !seen[key]){
        seen[key]=true;
        merged.push(item);
      }
    });
    localItems.forEach(function(item){
      var key=(item.t||'').trim().toLowerCase();
      if(key && !seen[key]){
        seen[key]=true;
        merged.push(item);
      }
    });
    return merged;
  }

  // Fetch all pages of a collection
  function fetchAll(endpoint, converter, callback){
    var all=[];
    var page=1;
    var limit=100;
    function fetchPage(){
      fetch(PAP_API_BASE+endpoint+'?status=published&limit='+limit+'&page='+page)
        .then(function(r){return r.json();})
        .then(function(res){
          if(res.data && res.data.length>0){
            res.data.forEach(function(item){
              all.push(converter(item));
            });
            if(res.pagination && page<res.pagination.pages){
              page++;
              fetchPage();
            } else {
              callback(all);
            }
          } else {
            callback(all);
          }
        })
        .catch(function(err){
          console.warn('[PAP Sync] Fetch error:',endpoint,err);
          callback(all);
        });
    }
    fetchPage();
  }

  // Sync films
  function syncFilms(){
    if(typeof filmAllData==='undefined') return;
    fetchAll('/films',apiFilmToLocal,function(apiFilms){
      if(apiFilms.length>0){
        var origLen=filmAllData.length;
        var merged=mergeData(apiFilms, filmAllData);
        // Replace filmAllData in-place (preserve reference)
        filmAllData.length=0;
        merged.forEach(function(f){filmAllData.push(f);});
        console.log('[PAP Sync] Films synced: '+apiFilms.length+' from API, '+origLen+' hardcoded → '+filmAllData.length+' total');
      } else {
        console.log('[PAP Sync] No API films found. Using '+filmAllData.length+' hardcoded films.');
      }
      // Re-render film cards if the page has a renderCards function (films.html)
      if(typeof window._papFilmRenderCards==='function'){
        window._papFilmRenderCards();
      }
    });
  }

  // Sync articles
  function syncArticles(){
    if(typeof artData==='undefined') return;
    fetchAll('/articles',apiArticleToLocal,function(apiArticles){
      if(apiArticles.length>0){
        var origLen=artData.length;
        var merged=mergeData(apiArticles, artData);
        artData.length=0;
        merged.forEach(function(a){artData.push(a);});
        console.log('[PAP Sync] Articles synced: '+apiArticles.length+' from API, '+origLen+' hardcoded → '+artData.length+' total');
      } else {
        console.log('[PAP Sync] No API articles found. Using '+artData.length+' hardcoded articles.');
      }
      // Re-render article cards if available (articles.html)
      if(typeof window._papArticleRenderCards==='function'){
        window._papArticleRenderCards();
      }
    });
  }

  // Run sync after DOM is ready
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){
      syncFilms();
      syncArticles();
    });
  } else {
    // DOM already loaded — small delay to let page scripts initialize first
    setTimeout(function(){
      syncFilms();
      syncArticles();
    },100);
  }
})();

// buildShortsCarousel() is now called via _papShortsRender callback after data loads

var shortsResizeTimer=null;
window.addEventListener('resize',function(){
  clearTimeout(shortsResizeTimer);
  shortsResizeTimer=setTimeout(updateShortsPositions,150);
});

/* ── Infinite marquee (JS-driven, seamless) ── */
(function(){
  function initMarquee(){
    var track=document.getElementById('marqueeTrack');
    if(!track) return;
    // Remove CSS animation — JS takes over
    track.style.animation='none';
    // Collect original items
    var origItems=Array.prototype.slice.call(track.children);
    // Clone enough sets to fill 3x viewport
    var setWidth=0;
    origItems.forEach(function(el){ setWidth+=el.offsetWidth; });
    if(setWidth===0) return;
    var copies=Math.ceil((window.innerWidth*3)/setWidth)+1;
    for(var c=0;c<copies;c++){
      origItems.forEach(function(el){ track.appendChild(el.cloneNode(true)); });
    }
    var pos=0;
    var speed=window.innerWidth<768?0.6:0.8;
    var raf;
    function step(){
      pos-=speed;
      if(Math.abs(pos)>=setWidth) pos+=setWidth;
      track.style.transform='translate3d('+pos+'px,0,0)';
      raf=requestAnimationFrame(step);
    }
    raf=requestAnimationFrame(step);
    // Pause on hover
    track.addEventListener('mouseenter',function(){ cancelAnimationFrame(raf); });
    track.addEventListener('mouseleave',function(){ raf=requestAnimationFrame(step); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initMarquee);
  else setTimeout(initMarquee,200);
})();

// ======== PAGINATION UTILITY ========
var PAP_PER_PAGE=18;
function buildPagination(container,currentPage,totalPages,onPageChange,isDark){
  container.innerHTML='';
  if(totalPages<=1) return;
  container.className='pap-pagination'+(isDark?' dark':'');
  // helper
  function btn(label,page,isActive,isDisabled,cls){
    var b=document.createElement('button');
    b.textContent=label;
    if(isActive) b.className='active';
    if(isDisabled) b.disabled=true;
    if(cls) b.className=(b.className?b.className+' ':'')+cls;
    if(!isDisabled&&!isActive) b.onclick=function(){onPageChange(page);};
    container.appendChild(b);
    return b;
  }
  function dots(){
    var d=document.createElement('span');
    d.className='pag-dots';
    d.textContent='···';
    container.appendChild(d);
  }
  // prev
  btn('‹',currentPage-1,false,currentPage===1);
  // page numbers
  var pages=[];
  if(totalPages<=9){
    for(var i=1;i<=totalPages;i++) pages.push(i);
  } else {
    // always first
    pages.push(1);
    if(currentPage>4) pages.push('«');
    // window around current
    var start=Math.max(2,currentPage-1);
    var end=Math.min(totalPages-1,currentPage+1);
    if(currentPage<=4){start=2;end=Math.min(5,totalPages-1);}
    if(currentPage>=totalPages-3){start=Math.max(2,totalPages-4);end=totalPages-1;}
    if(start>2) pages.push('...');
    for(var i=start;i<=end;i++) pages.push(i);
    if(end<totalPages-1) pages.push('...');
    // always last
    pages.push(totalPages);
  }
  pages.forEach(function(p){
    if(p==='...') dots();
    else if(p==='«') btn('«',Math.max(1,currentPage-5),false,false);
    else btn(String(p),p,p===currentPage,false);
  });
  // next
  btn('›',currentPage+1,false,currentPage===totalPages);
}

