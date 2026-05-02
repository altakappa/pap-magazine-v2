// PAP Magazine — i18n module (extracted from pap-app.js per HARNESS_CHECKLIST.md mission 3)
//
// Owns: 9-language UI dictionary (T), current language state (lang), setLang
//   apply-to-DOM logic, article-card translation map (window._articleI18n) and
//   the JSON loader that populates it.
//
// Public surface (consumed across files via globals — classic-script wiring):
//   var T              — translations dictionary, keyed by language code
//   var lang           — current language code (ISO; 'ko'|'en'|'it'|'fr'|'es'|'ja'|'zh'|'ru'|'de')
//   window.setLang(l)  — switch language; updates DOM + localStorage('pap-lang')
//   window._articleI18n — slug → {t, sub} translations map (populated lazily)
//
// Light cross-coupling (intentional, deferred — not Shell-pure):
//   - _loadArticleI18n pushes into / re-renders Content's `artData` and
//     `window._papArticleRenderCards` defensively (typeof checks). Cleaner
//     decoupling via a 'pap-lang-changed' event is a future refactor.
//
// Load order: this file MUST be loaded BEFORE pap-app.js, because pap-app.js's
// search code, modals, and pagination read `lang` and `T` as bare globals.
// `var lang` (not `let`) is intentional so it surfaces on window in classic-script
// context — that preserves the original cross-script readability.

// ======== i18n ========
const T={
ko:{about:'ABOUT',contact:'CONTACT',business:'BUSINESS',subscribe:'구독하기',submission:'서브미션',pullletter:'풀레터',ftAbout:'회사 소개',ftBusiness:'비즈니스',ftContact:'문의하기',ftSubscribe:'구독하기',ftSubmission:'서브미션',ftPullletter:'풀레터',ftCommunity:'커뮤니티',ftMagazine:'매거진',navEditorial:'에디토리얼',navMagazine:'매거진',navCommunity:'커뮤니티',navArticle:'아티클',navFilm:'필름',navBeauty:'뷰티',navInterview:'인터뷰',searchPh:'검색...',aprIssue:'4월호',junIssue:'6월호',editorialHeading:'에디토리얼',shortsHeading:'숏츠',allFilms:'모든 필름',articlesPageTitle:'아티클',fc1:'밀란 패션 위크 FW26 스트릿 스타일 PART.2',fc1d:'<PAP>가 담아온 밀란 패션 위크 현장 공개',fc2:'루이사 베카리아 FW26 백스테이지 WITH 밀란 패션 위크',fc2d:'<PAP>가 루이사 베카리아 백스테이지 현장을 담아왔다',fc3:'밀란 패션 위크 FW26 스트릿 스타일 PART.1',fc3d:'<PAP>가 담아온 밀란 패션 위크 현장 공개',footerLegal:'<strong>주식회사 알타카파</strong><br>CEO : 강동민 | 개인정보 관리자: 강동민 | 사업자번호 192-88-02644<br>서울특별시 강남구 논현로146길 18, 1F PAP 매거진 | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'이용약관',privacy:'개인정보처리방침',latestEd:'최신 에디토리얼',trendingEd:'인기 에디토리얼',dreamyEd:'몽환적인 에디토리얼',boldEd:'강렬하고 대담한',warmEd:'자연과 따뜻함',modernEd:'미래적이고 모던한',fc4:'설날을 위한 가장 세련된 선택, 에덴 보드카',fc4d:'PAP가 추천하는 에덴 보드카',latestArticle:'최신기사',coverStory:'VOL.30 커버 화보',coverTitle:'FOLIE',popupTitle:'PAP 멤버가 되어보세요',popupDesc:'에디토리얼, 필름, 아티클 등 PAP의 모든 콘텐츠를 가장 먼저 만나보세요.',popupCta:'무료로 시작하기',popupSkip:'다음에 할게요',distKitDesc:'참여 크리에이터에게 제공되는 로고·배포용 파일 — 마이페이지에서 다운로드하세요',distKitGoMypage:'마이페이지로 이동 →',loginToRate:'로그인하시면 별점을 남길 수 있습니다',loginToComment:'댓글 작성은 로그인이 필요합니다',noComments:'아직 댓글이 없습니다. 첫 댓글을 남겨주세요.',navLogin:'로그인',},
en:{about:'ABOUT',contact:'CONTACT',business:'BUSINESS',subscribe:'SUBSCRIBE',submission:'SUBMISSION',pullletter:'PULL-LETTER',ftAbout:'ABOUT',ftBusiness:'BUSINESS',ftContact:'CONTACT',ftSubscribe:'SUBSCRIBE',ftSubmission:'SUBMISSION',ftPullletter:'PULL-LETTER',ftCommunity:'COMMUNITY',ftMagazine:'MAGAZINE',navEditorial:'EDITORIAL',navMagazine:'MAGAZINE',navCommunity:'COMMUNITY',navArticle:'ARTICLE',navFilm:'FILM',navBeauty:'BEAUTY',navInterview:'INTERVIEW',searchPh:'Search...',aprIssue:'APR. ISSUE',junIssue:'JUN. ISSUE',editorialHeading:'EDITORIAL',shortsHeading:'SHORTS',allFilms:'ALL FILMS',articlesPageTitle:'ARTICLES',fc1:'Milan Fashion Week FW26 Street Style Part.2',fc1d:'PAP captures the scene from Milan Fashion Week',fc2:'Luisa Beccaria FW26 Backstage with Milan Fashion Week',fc2d:'PAP brings you the backstage of Luisa Beccaria',fc3:'Milan Fashion Week FW26 Street Style Part.1',fc3d:'PAP captures the scene from Milan Fashion Week',footerLegal:'<strong>ALTAKAPPA Co., Ltd.</strong><br>CEO : Domenico Kang | Business Registration No. 192-88-02644<br>1F, 18, Nonhyeon-ro 146-gil, Gangnam-gu, Seoul, Korea | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'Terms of Service',privacy:'Privacy Policy',latestEd:'Latest Editorials',trendingEd:'Trending Now',dreamyEd:'Dreamy & Ethereal',boldEd:'Bold & Intense',warmEd:'Warm & Organic',modernEd:'Futuristic & Modern',fc4:'The Most Stylish Choice for New Year, Eden Vodka',fc4d:'Eden Vodka recommended by PAP',latestArticle:'Latest Articles',coverStory:'VOL.30 COVER STORY',coverTitle:'FOLIE',popupTitle:'Become a PAP Member',popupDesc:'Be the first to explore our editorials, films, articles, and more.',popupCta:'GET STARTED FREE',popupSkip:'Maybe later',distKitDesc:'Logo & distribution files provided to participating creators — download from My Page',distKitGoMypage:'Go to My Page →',loginToRate:'Sign in to leave a rating',loginToComment:'Sign in to leave a comment',noComments:'No comments yet. Be the first to comment.',navLogin:'Sign In',},
it:{about:'CHI SIAMO',contact:'CONTATTI',business:'BUSINESS',subscribe:'ABBONATI',submission:'SUBMISSION',pullletter:'PULL-LETTER',ftAbout:'CHI SIAMO',ftBusiness:'BUSINESS',ftContact:'CONTATTI',ftSubscribe:'ABBONATI',ftSubmission:'SUBMISSION',ftPullletter:'PULL-LETTER',ftCommunity:'COMMUNITY',ftMagazine:'MAGAZINE',navEditorial:'EDITORIALE',navMagazine:'MAGAZINE',navCommunity:'COMMUNITY',navArticle:'ARTICOLO',navFilm:'FILM',navBeauty:'BELLEZZA',navInterview:'INTERVISTA',searchPh:'Cerca...',aprIssue:'NUM. APRILE',junIssue:'NUM. GIUGNO',editorialHeading:'EDITORIALE',shortsHeading:'SHORTS',allFilms:'TUTTI I FILM',articlesPageTitle:'ARTICOLI',fc1:'Milan Fashion Week FW26 Street Style Parte 2',fc1d:'PAP cattura la scena dalla Milan Fashion Week',fc2:'Luisa Beccaria FW26 Backstage con Milan Fashion Week',fc2d:'PAP vi porta nel backstage di Luisa Beccaria',fc3:'Milan Fashion Week FW26 Street Style Parte 1',fc3d:'PAP cattura la scena dalla Milan Fashion Week',footerLegal:'<strong>ALTAKAPPA Co., Ltd.</strong><br>CEO : Domenico Kang | P. IVA: 192-88-02644<br>1F, 18, Nonhyeon-ro 146-gil, Gangnam-gu, Seoul, Corea | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'Termini di Servizio',privacy:'Informativa sulla Privacy',latestEd:'Ultimi Editoriali',trendingEd:'Di Tendenza',dreamyEd:'Onirico & Etereo',boldEd:'Audace & Intenso',warmEd:'Caldo & Organico',modernEd:'Futuristico & Moderno',fc4:'La Scelta Più Elegante per Capodanno, Eden Vodka',fc4d:'Eden Vodka consigliata da PAP',latestArticle:'Ultimi Articoli',coverStory:'VOL.30 COVER STORY',coverTitle:'FOLIE',popupTitle:'Diventa Membro PAP',popupDesc:'Scopri per primo i nostri editoriali, film, articoli e molto altro.',popupCta:'INIZIA GRATIS',popupSkip:'Forse più tardi',distKitDesc:'Logo e file di distribuzione forniti ai creator partecipanti — scarica dalla Mia Pagina',distKitGoMypage:'Vai alla Mia Pagina →',loginToRate:'Accedi per lasciare una valutazione',loginToComment:'Accedi per lasciare un commento',noComments:'Nessun commento. Lascia il primo commento.',navLogin:'Accedi',},
fr:{about:'À PROPOS',contact:'CONTACT',business:'BUSINESS',subscribe:"S'ABONNER",submission:'SOUMISSION',pullletter:'PULL-LETTER',ftAbout:'À PROPOS',ftBusiness:'BUSINESS',ftContact:'CONTACT',ftSubscribe:"S'ABONNER",ftSubmission:'SOUMISSION',ftPullletter:'PULL-LETTER',ftCommunity:'COMMUNAUTÉ',ftMagazine:'MAGAZINE',navEditorial:'ÉDITORIAL',navMagazine:'MAGAZINE',navCommunity:'COMMUNAUTÉ',navArticle:'ARTICLE',navFilm:'FILM',navBeauty:'BEAUTÉ',navInterview:'INTERVIEW',searchPh:'Rechercher...',aprIssue:'NUM. AVRIL',junIssue:'NUM. JUIN',editorialHeading:'ÉDITORIAL',shortsHeading:'SHORTS',allFilms:'TOUS LES FILMS',articlesPageTitle:'ARTICLES',fc1:'Milan Fashion Week FW26 Street Style Partie 2',fc1d:'PAP capture la scène de la Milan Fashion Week',fc2:'Luisa Beccaria FW26 Backstage Milan Fashion Week',fc2d:'PAP vous emmène dans les coulisses de Luisa Beccaria',fc3:'Milan Fashion Week FW26 Street Style Partie 1',fc3d:'PAP capture la scène de la Milan Fashion Week',footerLegal:'<strong>ALTAKAPPA Co., Ltd.</strong><br>PDG : Domenico Kang | N° d\'entreprise: 192-88-02644<br>1F, 18, Nonhyeon-ro 146-gil, Gangnam-gu, Séoul, Corée | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'Conditions d\'Utilisation',privacy:'Politique de Confidentialité',latestEd:'Derniers Éditoriaux',trendingEd:'Tendances',dreamyEd:'Onirique & Éthéré',boldEd:'Audacieux & Intense',warmEd:'Chaleureux & Organique',modernEd:'Futuriste & Moderne',fc4:'Le Choix Le Plus Élégant pour le Nouvel An, Eden Vodka',fc4d:'Eden Vodka recommandée par PAP',latestArticle:'Derniers Articles',coverStory:'VOL.30 COVER STORY',coverTitle:'FOLIE',popupTitle:'Devenez Membre PAP',popupDesc:'Découvrez en avant-première nos éditoriaux, films, articles et bien plus.',popupCta:'COMMENCER GRATUITEMENT',popupSkip:'Peut-être plus tard',distKitDesc:'Logo et fichiers de distribution fournis aux créateurs participants — téléchargez depuis Mon Compte',distKitGoMypage:'Aller à Mon Compte →',loginToRate:'Connectez-vous pour laisser une note',loginToComment:'Connectez-vous pour laisser un commentaire',noComments:'Aucun commentaire pour le moment. Soyez le premier à commenter.',navLogin:'Connexion',},
es:{about:'ACERCA DE',contact:'CONTACTO',business:'NEGOCIOS',subscribe:'SUSCRIBIRSE',submission:'ENVÍO',pullletter:'PULL-LETTER',ftAbout:'ACERCA DE',ftBusiness:'NEGOCIOS',ftContact:'CONTACTO',ftSubscribe:'SUSCRIBIRSE',ftSubmission:'ENVÍO',ftPullletter:'PULL-LETTER',ftCommunity:'COMUNIDAD',ftMagazine:'REVISTA',navEditorial:'EDITORIAL',navMagazine:'REVISTA',navCommunity:'COMUNIDAD',navArticle:'ARTÍCULO',navFilm:'FILM',navBeauty:'BELLEZA',navInterview:'ENTREVISTA',searchPh:'Buscar...',aprIssue:'ED. ABRIL',junIssue:'ED. JUNIO',editorialHeading:'EDITORIAL',shortsHeading:'SHORTS',allFilms:'TODAS LAS PELÍCULAS',articlesPageTitle:'ARTÍCULOS',fc1:'Milan Fashion Week FW26 Street Style Parte 2',fc1d:'PAP captura la escena de Milan Fashion Week',fc2:'Luisa Beccaria FW26 Backstage Milan Fashion Week',fc2d:'PAP te trae el backstage de Luisa Beccaria',fc3:'Milan Fashion Week FW26 Street Style Parte 1',fc3d:'PAP captura la escena de Milan Fashion Week',footerLegal:'<strong>ALTAKAPPA Co., Ltd.</strong><br>CEO : Domenico Kang | Registro Comercial: 192-88-02644<br>1F, 18, Nonhyeon-ro 146-gil, Gangnam-gu, Seúl, Corea | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'Términos de Servicio',privacy:'Política de Privacidad',latestEd:'Editoriales Recientes',trendingEd:'Tendencias',dreamyEd:'Onírico & Etéreo',boldEd:'Audaz e Intenso',warmEd:'Cálido & Orgánico',modernEd:'Futurista & Moderno',fc4:'La Elección Más Elegante para Año Nuevo, Eden Vodka',fc4d:'Eden Vodka recomendado por PAP',latestArticle:'Artículos Recientes',coverStory:'VOL.30 COVER STORY',coverTitle:'FOLIE',popupTitle:'Hazte Miembro de PAP',popupDesc:'Sé el primero en descubrir nuestros editoriales, películas, artículos y más.',popupCta:'EMPIEZA GRATIS',popupSkip:'Quizás más tarde',distKitDesc:'Logo y archivos de distribución para creadores participantes — descarga desde Mi Página',distKitGoMypage:'Ir a Mi Página →',loginToRate:'Inicia sesión para dejar una valoración',loginToComment:'Inicia sesión para dejar un comentario',noComments:'Aún no hay comentarios. Sé el primero en comentar.',navLogin:'Iniciar Sesión',},
ja:{about:'アバウト',contact:'お問い合わせ',business:'ビジネス',subscribe:'購読',submission:'サブミッション',pullletter:'PULL-LETTER',ftAbout:'アバウト',ftBusiness:'ビジネス',ftContact:'お問い合わせ',ftSubscribe:'購読',ftSubmission:'サブミッション',ftPullletter:'PULL-LETTER',ftCommunity:'コミュニティ',ftMagazine:'マガジン',navEditorial:'エディトリアル',navMagazine:'マガジン',navCommunity:'コミュニティ',navArticle:'アーティクル',navFilm:'フィルム',navBeauty:'ビューティー',navInterview:'インタビュー',searchPh:'検索...',aprIssue:'4月号',junIssue:'6月号',editorialHeading:'エディトリアル',shortsHeading:'ショート',allFilms:'すべてのフィルム',articlesPageTitle:'アーティクル',fc1:'ミラノファッションウィーク FW26 ストリートスタイル Part.2',fc1d:'PAPがミラノファッションウィークの現場を公開',fc2:'ルイーザ・ベッカリア FW26 バックステージ',fc2d:'PAPがルイーザ・ベッカリアのバックステージをお届け',fc3:'ミラノファッションウィーク FW26 ストリートスタイル Part.1',fc3d:'PAPがミラノファッションウィークの現場を公開',footerLegal:'<strong>株式会社アルタカッパ</strong><br>CEO : カン・ドンミン | 事業者番号 192-88-02644<br>ソウル特別市 江南区 論峴路146ギル 18, 1F PAP マガジン | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'利用規約',privacy:'プライバシーポリシー',latestEd:'最新エディトリアル',trendingEd:'人気エディトリアル',dreamyEd:'夢幻的なエディトリアル',boldEd:'大胆で強烈な',warmEd:'自然と温もり',modernEd:'未来的でモダンな',fc4:'新年のための最もスタイリッシュな選択、エデンウォッカ',fc4d:'PAPおすすめのエデンウォッカ',latestArticle:'最新記事',coverStory:'VOL.30 カバーストーリー',coverTitle:'FOLIE',popupTitle:'PAPメンバーになろう',popupDesc:'エディトリアル、フィルム、アーティクルなど、PAPの全コンテンツをいち早くお届け。',popupCta:'無料で始める',popupSkip:'あとで',distKitDesc:'参加クリエイターに提供されるロゴ・配布用ファイル — マイページからダウンロード',distKitGoMypage:'マイページへ →',loginToRate:'ログインすると評価を残せます',loginToComment:'コメント投稿にはログインが必要です',noComments:'まだコメントがありません。最初のコメントを残してください。',navLogin:'ログイン',},
zh:{about:'关于我们',contact:'联系方式',business:'商务合作',subscribe:'订阅',submission:'投稿',pullletter:'PULL-LETTER',ftAbout:'关于我们',ftBusiness:'商务合作',ftContact:'联系方式',ftSubscribe:'订阅',ftSubmission:'投稿',ftPullletter:'PULL-LETTER',ftCommunity:'社区',ftMagazine:'杂志',navEditorial:'编辑精选',navMagazine:'杂志',navCommunity:'社区',navArticle:'文章',navFilm:'影片',navBeauty:'美妆',navInterview:'访谈',searchPh:'搜索...',aprIssue:'四月刊',junIssue:'六月刊',editorialHeading:'编辑精选',shortsHeading:'短片',allFilms:'全部影片',articlesPageTitle:'文章',fc1:'米兰时装周 FW26 街拍风格 Part.2',fc1d:'PAP带您直击米兰时装周现场',fc2:'Luisa Beccaria FW26 后台 米兰时装周',fc2d:'PAP带您走进Luisa Beccaria后台',fc3:'米兰时装周 FW26 街拍风格 Part.1',fc3d:'PAP带您直击米兰时装周现场',footerLegal:'<strong>株式会社 ALTAKAPPA</strong><br>CEO : 姜东民 | 营业执照号 192-88-02644<br>韩国首尔市江南区论岘路146街18号, 1F PAP 杂志 | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'服务条款',privacy:'隐私政策',latestEd:'最新时尚大片',trendingEd:'热门时尚大片',dreamyEd:'梦幻风格大片',boldEd:'大胆前卫风格',warmEd:'自然温暖风格',modernEd:'未来摩登风格',fc4:'新年最时尚的选择，伊甸伏特加',fc4d:'PAP推荐的伊甸伏特加',latestArticle:'最新文章',coverStory:'VOL.30 封面故事',coverTitle:'FOLIE',popupTitle:'成为PAP会员',popupDesc:'抢先探索我们的时尚大片、影片、文章等精彩内容。',popupCta:'免费开始',popupSkip:'以后再说',distKitDesc:'提供给参与创作者的徽标和分发文件 — 从我的页面下载',distKitGoMypage:'前往我的页面 →',loginToRate:'登录后可以评分',loginToComment:'发表评论需要登录',noComments:'暂无评论。来发表第一条评论吧。',navLogin:'登录',},
ru:{about:'О НАС',contact:'КОНТАКТ',business:'БИЗНЕС',subscribe:'ПОДПИСКА',submission:'ПОДАЧА',pullletter:'PULL-LETTER',ftAbout:'О НАС',ftBusiness:'БИЗНЕС',ftContact:'КОНТАКТ',ftSubscribe:'ПОДПИСКА',ftSubmission:'ПОДАЧА',ftPullletter:'PULL-LETTER',ftCommunity:'СООБЩЕСТВО',ftMagazine:'ЖУРНАЛ',navEditorial:'EDITORIAL',navMagazine:'ЖУРНАЛ',navCommunity:'СООБЩЕСТВО',navArticle:'СТАТЬЯ',navFilm:'FILM',navBeauty:'КРАСОТА',navInterview:'ИНТЕРВЬЮ',searchPh:'Поиск...',aprIssue:'АПР. ВЫПУСК',junIssue:'ИЮНЬ ВЫПУСК',editorialHeading:'EDITORIAL',shortsHeading:'ШОРТС',allFilms:'ВСЕ ФИЛЬМЫ',articlesPageTitle:'СТАТЬИ',fc1:'Миланская неделя моды FW26 уличный стиль Часть 2',fc1d:'PAP запечатлел сцены Миланской недели моды',fc2:'Luisa Beccaria FW26 бэкстейдж на Миланской неделе моды',fc2d:'PAP показывает бэкстейдж Luisa Beccaria',fc3:'Миланская неделя моды FW26 уличный стиль Часть 1',fc3d:'PAP запечатлел сцены Миланской недели моды',footerLegal:'<strong>ALTAKAPPA Co., Ltd.</strong><br>CEO : Доменико Кан | Рег. номер: 192-88-02644<br>1F, 18, Nonhyeon-ro 146-gil, Gangnam-gu, Сеул, Корея | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'Условия использования',privacy:'Политика конфиденциальности',latestEd:'Последние съёмки',trendingEd:'В тренде',dreamyEd:'Мечтательные и Воздушные',boldEd:'Смелые и Дерзкие',warmEd:'Тёплые и Природные',modernEd:'Футуристичные и Современные',fc4:'Самый стильный выбор к Новому году — Eden Vodka',fc4d:'Eden Vodka от PAP',latestArticle:'Последние статьи',coverStory:'VOL.30 ОБЛОЖКА',coverTitle:'FOLIE',popupTitle:'Станьте участником PAP',popupDesc:'Первыми узнавайте о наших редакционных материалах, фильмах, статьях и многом другом.',popupCta:'НАЧАТЬ БЕСПЛАТНО',popupSkip:'Позже',distKitDesc:'Логотипы и файлы для распространения участвующим создателям — скачать из Моей Страницы',distKitGoMypage:'Перейти в Мою Страницу →',loginToRate:'Войдите, чтобы оставить оценку',loginToComment:'Войдите, чтобы оставить комментарий',noComments:'Комментариев пока нет. Будьте первым.',navLogin:'Войти'},
de:{about:'ÜBER UNS',contact:'KONTAKT',business:'BUSINESS',subscribe:'ABONNIEREN',submission:'EINREICHUNG',pullletter:'PULL-LETTER',ftAbout:'ÜBER UNS',ftBusiness:'BUSINESS',ftContact:'KONTAKT',ftSubscribe:'ABONNIEREN',ftSubmission:'EINREICHUNG',ftPullletter:'PULL-LETTER',ftCommunity:'COMMUNITY',ftMagazine:'MAGAZIN',navEditorial:'EDITORIAL',navMagazine:'MAGAZIN',navCommunity:'COMMUNITY',navArticle:'ARTIKEL',navFilm:'FILM',navBeauty:'BEAUTY',navInterview:'INTERVIEW',searchPh:'Suchen...',aprIssue:'APR. AUSGABE',junIssue:'JUN. AUSGABE',editorialHeading:'EDITORIAL',shortsHeading:'SHORTS',allFilms:'ALLE FILME',articlesPageTitle:'ARTIKEL',fc1:'Milan Fashion Week FW26 Street Style Teil 2',fc1d:'PAP fängt die Szene der Milan Fashion Week ein',fc2:'Luisa Beccaria FW26 Backstage Milan Fashion Week',fc2d:'PAP bringt Ihnen das Backstage von Luisa Beccaria',fc3:'Milan Fashion Week FW26 Street Style Teil 1',fc3d:'PAP fängt die Szene der Milan Fashion Week ein',footerLegal:'<strong>ALTAKAPPA Co., Ltd.</strong><br>CEO : Domenico Kang | Handelsregister: 192-88-02644<br>1F, 18, Nonhyeon-ro 146-gil, Gangnam-gu, Seoul, Korea | <a href="mailto:contact@pap-magazine.com">contact@pap-magazine.com</a>',terms:'Nutzungsbedingungen',privacy:'Datenschutzerklärung',latestEd:'Neueste Editorials',trendingEd:'Im Trend',dreamyEd:'Traumhaft & Ätherisch',boldEd:'Kühn & Intensiv',warmEd:'Warm & Organisch',modernEd:'Futuristisch & Modern',fc4:'Die stilvollste Wahl zum Neujahr, Eden Vodka',fc4d:'Eden Vodka empfohlen von PAP',latestArticle:'Neueste Artikel',coverStory:'VOL.30 COVER STORY',coverTitle:'FOLIE',popupTitle:'Werden Sie PAP-Mitglied',popupDesc:'Entdecken Sie als Erste unsere Editorials, Filme, Artikel und mehr.',popupCta:'KOSTENLOS STARTEN',popupSkip:'Vielleicht später',distKitDesc:'Logo- und Distributionsdateien für teilnehmende Kreative — herunterladen auf Mein Konto',distKitGoMypage:'Zu Mein Konto →',loginToRate:'Melde dich an, um zu bewerten',loginToComment:'Melde dich an, um zu kommentieren',noComments:'Noch keine Kommentare. Sei der Erste.',navLogin:'Anmelden'}
};
// NOTE: `var` (not `let`) is intentional here. In classic-script context this
// makes `lang` a property of the global object (window.lang), so search /
// modal / pagination code in pap-app.js can read it as a bare global.
// Switching to `let` would silently break those callsites.
var lang='ko';

// ======== Search result label translations (relocated from pap-app.js per
// HARNESS_CHECKLIST.md mission 4 — option C: each harness extraction also
// migrates its inline language dictionary into this i18n module). Consumed
// by pap-search.js as a bare global; `var` for cross-script visibility.
var _searchTexts={
  ko:{found:function(q,n){return '"'+q+'" · '+n+'개 에디토리얼';},noResult:function(q){return '"'+q+'" 관련 에디토리얼을 찾지 못했습니다';}},
  en:{found:function(q,n){return '"'+q+'" · '+n+' editorials';},noResult:function(q){return 'No editorials found for "'+q+'"';}},
  it:{found:function(q,n){return '"'+q+'" · '+n+' editoriali';},noResult:function(q){return 'Nessun editoriale trovato per "'+q+'"';}},
  fr:{found:function(q,n){return '"'+q+'" · '+n+' éditoriaux';},noResult:function(q){return 'Aucun éditorial trouvé pour "'+q+'"';}},
  es:{found:function(q,n){return '"'+q+'" · '+n+' editoriales';},noResult:function(q){return 'No se encontraron editoriales para "'+q+'"';}},
  ja:{found:function(q,n){return '"'+q+'" · '+n+'件のエディトリアル';},noResult:function(q){return '"'+q+'" に関連するエディトリアルが見つかりません';}},
  zh:{found:function(q,n){return '"'+q+'" · '+n+'篇社论';},noResult:function(q){return '未找到与 "'+q+'" 相关的社论';}},
  ru:{found:function(q,n){return '"'+q+'" · '+n+' материалов';},noResult:function(q){return 'По запросу "'+q+'" ничего не найдено';}},
  de:{found:function(q,n){return '"'+q+'" · '+n+' Editorials';},noResult:function(q){return 'Keine Editorials gefunden für "'+q+'"';}}
};
// Article i18n data map — slug → {t:{ko,en,...}, sub:{...}}
window._articleI18n = window._articleI18n || {};
function _applyArticleCardI18n(l){
  try{
    var map=window._articleI18n||{};
    // 1) Static cards on index.html (.fashion-card)
    document.querySelectorAll('.fashion-card[data-slug]').forEach(function(card){
      var slug=card.getAttribute('data-slug');
      var data=map[slug];
      if(!data) return;
      var titleEl=card.querySelector('.fashion-card-title');
      if(titleEl && data.t){
        var tr = data.t[l] || data.t.en || data.t.ko;
        if(tr) titleEl.textContent = tr;
      }
      var imgEl=card.querySelector('.fashion-card-img img');
      if(imgEl && data.t){
        var alt = data.t[l] || data.t.en || data.t.ko;
        if(alt) imgEl.setAttribute('alt', alt);
      }
    });
    // 2) Dynamic cards on articles.html (.card with data-slug)
    document.querySelectorAll('.card[data-slug]').forEach(function(card){
      var slug=card.getAttribute('data-slug');
      var data=map[slug];
      if(!data) return;
      var titleEl=card.querySelector('.card-title');
      if(titleEl && data.t){
        var tr = data.t[l] || data.t.en || data.t.ko;
        if(tr) titleEl.textContent = tr.toUpperCase();
      }
    });
  }catch(e){console.warn('Card i18n error:',e);}
}
function _loadArticleI18n(){
  if(window._articleI18nLoading || (window._articleI18n && Object.keys(window._articleI18n).length)) return;
  window._articleI18nLoading=true;
  fetch('pap-article-db.json',{cache:'default'})
    .then(function(r){return r.ok ? r.json() : null;})
    .then(function(data){
      if(!Array.isArray(data)) return;
      var map={};
      var bySlug={}, byTitleKo={};
      data.forEach(function(item){
        if(item.slug && item.ti18n){
          map[item.slug]={t:item.ti18n, sub:item.subi18n||null};
        }
        if(item.slug) bySlug[item.slug]=item;
        var ko=((item.t)||(item.ti18n&&item.ti18n.ko)||'').trim().toLowerCase();
        if(ko) byTitleKo[ko]=item;
      });
      window._articleI18n=map;
      // Populate artData if empty; otherwise enrich existing items with ti18n
      if(typeof artData!=='undefined'){
        if(artData.length===0){
          data.forEach(function(a){artData.push(a);});
        } else {
          // API sync already ran — backfill translations onto existing artData items
          artData.forEach(function(a){
            var m=(a.slug && bySlug[a.slug]) || byTitleKo[(a.t||'').trim().toLowerCase()];
            if(m){
              if(!a.ti18n && m.ti18n) a.ti18n=m.ti18n;
              if(!a.subi18n && m.subi18n) a.subi18n=m.subi18n;
              if(!a.desci18n && m.desci18n) a.desci18n=m.desci18n;
            }
          });
          // Re-render so detail overlay + card text reflect translated data
          if(typeof window._papArticleRenderCards==='function'){
            window._papArticleRenderCards();
          }
        }
      }
      _applyArticleCardI18n(lang);
    })
    .catch(function(e){console.warn('Article i18n load failed:',e);});
}
function setLang(l){localStorage.setItem('pap-lang',l);
  lang=l;document.documentElement.lang=l;document.querySelectorAll('.lang-select-el,#langSelect').forEach(function(s){s.value=l;});
  const t=T[l]||T.en;
  document.querySelectorAll('[data-i18n]').forEach(e=>{const k=e.dataset.i18n;if(t[k])e.textContent=t[k]});
  document.querySelectorAll('[data-i18n-html]').forEach(e=>{const k=e.dataset.i18nHtml;if(t[k])e.innerHTML=t[k]});
  document.querySelectorAll('[data-i18n-ph]').forEach(e=>{const k=e.dataset.i18nPh;if(t[k])e.placeholder=t[k]});
  _applyArticleCardI18n(l);
  // Re-translate AI theme row headings on homepage (if present)
  if(typeof window._papReapplyAIThemeLabels==='function'){ try{ window._papReapplyAIThemeLabels(l); }catch(e){} }
}
// Auto-load article i18n data as soon as possible
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',_loadArticleI18n);
} else {
  _loadArticleI18n();
}
