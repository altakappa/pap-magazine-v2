# pap-app.js Harness Breakdown

> 분석 대상: `frontend/pap-app.js` (총 4,258 줄)
> 작성: 2026-05-02
> 기준: HARNESS_CHECKLIST.md (Phase 1/2/3 — 10 하네스)

---

## 요약

- **총 라인 수**: 4,258
- **식별된 섹션 수**: 56 (top-level function / IIFE / 데이터 블록 단위)
- **하네스별 라인 분포 (대략 %)**:

| 하네스 | 대략 라인 | 비율 |
|---|---|---|
| **Content** (에디토리얼/필름/아티클/숏츠/크리에이터/딥링크/SEO) | ~2,180 | 51% |
| **Shell** (i18n/검색/네비/페이지네이션/캐러셀/모달락/플로팅로고/게임) | ~1,440 | 34% |
| **Subscription** (인터스티셜 광고 + 프리미엄 업셀 + 권한 게이트) | ~330 | 8% |
| **Static** (terms/privacy 다국어 노티스 + 서명업 팝업) | ~75 | 1.7% |
| **Auth** (isLoggedIn / 로그아웃 / 헤더 드롭다운 갱신) | ~55 | 1.3% |
| **Shared/유틸** (베타 플래그, scroll lock, escape) | ~50 | 1.2% |
| **AdminCMS / MyPage / SubmissionFlow / Community / Social** | 0–소량 | <1% (직접 소유 코드는 없음 — PAPSocial 호출만 존재) |

> 핵심 발견: 이 파일은 사실상 **홈페이지(index.html) 통합 번들**이다. Auth 하네스는 거의 없고, Subscription 하네스의 결제/체크아웃 로직도 여기에 없다. 가장 무거운 짐은 **Content 하네스**(에디토리얼/아티클/필름/크리에이터 전체 렌더링)와 **Shell 하네스**(i18n/검색/네비/플로팅 로고/게임)다.

---

## 섹션별 매핑 (라인 순서대로)

### [Shared/유틸] L3–L15 — `PAP_BETA_END`, `isBetaActive()`
- 무엇: 베타 종료 날짜(`2026-05-06`) 상수와 활성 여부 판정
- 어디서 쓰임: `isPremium()`, `isStandardOrAbove()` 내부에서 분기
- 추출 시 주의: Auth 또는 Subscription 양쪽 모두 참조 → **공용 `pap-flags.js` 또는 Shared 유틸**에 두는 게 맞음. Subscription에 두면 Auth가 Subscription을 의존해야 해서 부자연스러움.
- 의존: 없음 (순수 함수)

### [Shared/유틸 — Shell 후보] L17–L43 — `lockScroll()`, `unlockScroll()`, `_scrollLockCount`, `_savedScrollY`
- 무엇: 모달 오픈 시 배경 스크롤 잠금/복원 (참조 카운터 방식)
- 어디서 쓰임: 거의 모든 모달 (interstitial, signup popup, creator popup, nav, …)
- 추출 시 주의: 여러 하네스에서 호출 → **Shell**의 공통 UI 유틸로 분리. `window.PAP.ui.lockScroll` 같은 형태로 노출.
- 의존: `document.body.style`, `window.scrollY`

### [Shell/i18n] L45–L56 — `const T = {ko, en, it, fr, es, ja, zh, ru, de}`
- 무엇: **9개 언어 i18n 사전** (네비/푸터/카드 헤딩/팝업/공지 등 ~55개 키)
- 어디서 쓰임: `setLang(l)` 안에서 `data-i18n` / `data-i18n-html` / `data-i18n-ph` 속성 적용
- 추출 시 주의: HARNESS_CHECKLIST.md §3 (Shell) 명시 — `pap-i18n.js`로 분리 권장. **분리 우선순위 2위**(매우 안전, 의존 거의 없음).
- 의존: 없음. `setLang()`이 이걸 읽음.

### [Shell/i18n] L57 — `let lang='ko';`
- 무엇: 전역 현재 언어 변수 (모듈 스코프). `setLang()`이 갱신.
- 추출 시 주의: 다른 함수들(`searchEditorials`, `_renderArticleDetail`, `_openEditorialInner` 등)이 이 변수를 직접 참조 → 분리 시 `localStorage.getItem('pap-lang')`로 통일하거나 `window.PAP.lang` 게터 제공.

### [Shell/i18n] L58–L133 — `_applyArticleCardI18n(l)`, `_loadArticleI18n()`, `window._articleI18n`
- 무엇: `pap-article-db.json` 페칭 → 슬러그 기반 아티클 카드 제목 i18n. `artData` 보강도 수행.
- 어디서 쓰임: `setLang()`, DOMContentLoaded 시 자동 호출
- 추출 시 주의: i18n 본체이지만 **Content/Article 데이터 동기화 로직이 섞여 있음** (113–128줄: `artData.push`, `_papArticleRenderCards` 호출). 분리 시 Shell이 Content에 의존하면 안 되므로 **Shell은 이벤트만 발행 (`pap-lang-changed`), Content가 듣고 카드 재렌더**가 깨끗.
- 의존: `window._articleI18n`, `artData`, `window._papArticleRenderCards`

### [Shell/i18n] L134–L143 — `setLang(l)`
- 무엇: 언어 전환 핵심. localStorage 저장 → DOM의 `[data-i18n*]` 노드 업데이트 → 카드 i18n 적용 → AI 테마 라벨 재적용
- 어디서 쓰임: 헤더 언어 셀렉터, geo-lang 자동 감지, 초기 로드(L2003–L2006)
- HARNESS_CHECKLIST.md 권장 인터페이스: `window.setLang(lang)` (Shell이 export)
- 의존: `T`, `lang`, `_applyArticleCardI18n`, `window._papReapplyAIThemeLabels`

### [Shell/i18n] L144–L149 — `_loadArticleI18n` 자동 호출 부트스트랩
- DOMContentLoaded에서 article i18n 즉시 로드.

### [Shell — 홈 전용] L151–L165 — LOADER (IIFE)
- 무엇: 히어로 슬라이드 중 랜덤 이미지로 `#loaderBg` 배경 설정 + 로더 페이드아웃 타이머
- 어디서 쓰임: index.html (홈)만 해당
- 추출 시 주의: index.html 전용 로직. Shell에 두되 "홈 전용 부트" 모듈로 분리하거나 그대로 인라인 가능.

### [Shell] L167–L174 — Safety scroll unlock 타이머
- 무엇: 4초 후 body가 스크롤 락 상태로 박혀 있으면 강제 해제 (오버레이 없을 때만)
- 추출 시 주의: `lockScroll`/`unlockScroll`과 함께 Shell 공통 UI 유틸로 이동.

### [Content — 홈 히어로] L176–L179 — HERO SLIDER (`heroGo`, `hCur`, `hSlides`)
- 무엇: index.html 히어로 슬라이드 자동 회전 (3초 간격)
- 어디서 쓰임: 홈
- 추출 시 주의: 홈 페이지 전용. **Content 하네스 (또는 홈 전용 분리 파일)**.

### [Shell — 다국어 헬퍼] L181–L183 — `getLangText(key, fallback)`
- 무엇: 인라인 다국어 메시지 룩업 (현재 `edAccessFree` 한 키만 정의)
- 어디서 쓰임: `_openAllEditorialsInner`의 비-스탠다드 차단 alert
- 추출 시 주의: i18n 시스템 우회. 통합하거나 Shell 유틸로 흡수.

### [Shell/Search] L185 — `toggleSearch()`
- 무엇: `#searchBar` 토글 + `#searchInput` 포커스
- HARNESS_CHECKLIST.md: `window.toggleSearch()` (Shell export)

### [Shell/Header — 계정 드롭다운] L186–L187 — `toggleAccountMenu(e)`, `_closeAcct(e)`
- 무엇: `#accountDropdown` 토글 + 외부 클릭 시 닫기
- 추출 시 주의: 헤더 내부 컴포넌트 → **Shell의 `pap-header.js`** 소관.

### [Auth] L189–L231 — `_papUpdateAuthDropdown()`, `_papLogout()`, 즉시 호출
- 무엇:
  - `_papUpdateAuthDropdown` (L190–L225): localStorage의 `pap-token`/`pap-user` 읽고 9개 언어로 헤더 드롭다운(`<a>마이페이지</a>`, `<a>구독관리</a>`, `<button>로그아웃</button>`) 렌더 + 네비 오버레이 로그인 링크 갱신
  - `_papLogout` (L226–L230): localStorage 비움 + 홈 이동
  - L231: 즉시 호출
- HARNESS_CHECKLIST.md §3 (Auth): `pap-auth.js`로 추출 대상 정확히 일치
- 추출 시 주의:
  - `_papLogout`은 dropdown HTML에 `onclick="_papLogout()"`로 박혀 있음 → **window 전역 노출 필수**
  - 9개 언어 텍스트 사전이 인라인 → 이건 사실 i18n 영역. 깔끔히 하려면 텍스트는 `pap-i18n.js`로 빼고 함수만 `pap-auth.js`에.
  - 검증: 헤더 우측 상단 사람 아이콘 메뉴가 로그인 상태에 따라 변하는지
- 의존: `localStorage('pap-token','pap-user','pap-lang')`, `#accountDropdown`, `[data-i18n="navLogin"]`

### [Shell/Search] L233–L251 — search input 이벤트 + 글로벌 ESC/Backspace 핸들러
- 무엇: `#searchInput` 입력 → `searchEditorials(value)` / Enter → 첫 결과 클릭 또는 `/?q=...` fallback. 그리고 글로벌 ESC/Backspace로 모든 오버레이 닫기.
- 추출 시 주의: ESC 핸들러는 **Content의 모든 오버레이**(`closeEditorial`, `closeAllEditorials`, `closeAllFilms`, `closeAllArticles`, `filmDetailOverlay`, `artDetailOverlay`)를 호출 → **Shell의 글로벌 키 핸들러가 Content 함수에 의존**. 추출 시 Shell이 이벤트 발행하고 Content가 듣는 구조로 바꾸거나 ESC 핸들러는 Content 쪽으로.
- 의존: `searchEditorials`, `closeNav`, `closeEditorial`, `closeAllEditorials`, `closeAllFilms`, `closeAllArticles`

### [Shell/Nav] L253–L296 — `toggleNav()`, `closeNav()`
- 무엇: 햄버거 ≡ ↔ X 모프 + scroll lock + 플로팅 로고 숨김. QA #98 — `is-active` & `active` 둘 다 토글.
- HARNESS_CHECKLIST.md: `window.toggleNav()` (Shell export)
- 추출 시 주의: 플로팅 로고 부분(`#floatingLogo`) 의존 → Shell 안에서 자체 해결.
- 의존: `#navOverlay`, `.hamburger`, `lockScroll/unlockScroll`, `#floatingLogo`

### [Shell — Carousel 인프라] L298–L336 — `_papUpdateArrows()`, `_papWireCarousel()`
- 무엇: 가로 스크롤 캐러셀의 좌/우 화살표 disabled 상태 통합 관리. 모든 홈 캐러셀에서 사용.
- 추출 시 주의: 범용 UI 유틸. **Shell의 carousel/scroll 헬퍼 모듈**(예: `pap-carousels.js` 또는 `pap-styles.js` 부속).
- 의존: 없음 (순수 DOM)

### [Shell — Carousel] L338–L386 — `_papSmoothScrollBy()`, `moveCarousel()`
- 무엇: scroll-behavior 우회 부드러운 스크롤 + 패션 캐러셀(홈 "최신기사" 트랙) 좌/우 이동
- 추출 시 주의: `moveCarousel(d)`는 `onclick="moveCarousel(-1)"` 식으로 인라인 호출 가능 → window 노출 필요.

### [Content — 홈 ED 캐러셀] L388–L390 — `moveEdCarousel(d)`, `ePos`
- 무엇: 홈 "에디토리얼" 트랙 transform 기반 좌우 이동 (legacy)
- 추출 시 주의: 홈 페이지의 에디토리얼 캐러셀 전용 → **Content 하네스** 영역.

### [Shell — Reveal] L392–L394 — Scroll Reveal IntersectionObserver
- 무엇: `.sr` 요소들에 viewport 진입 시 `.v` 클래스 부여
- HARNESS_CHECKLIST.md: 별도 파일 `pap-reveal.js` 존재 (Shell 소관). **Shell**.

### [Static] L398–L447 — `_legalNoticeTexts{terms, privacy}`, `openPage()`, `closePage()`
- 무엇: 9개 언어 약관/개인정보 참고 번역 노티스 텍스트 + `#termsPage`/`#privacyPage` 모달 열고 닫기
- 어디서 쓰임: terms/privacy 페이지 인라인 모달 (홈에 임베드)
- HARNESS_CHECKLIST.md §5 (Static): `terms.html`, `privacy.html` 소유 → **Static 하네스**.
- 추출 시 주의: 텍스트는 i18n과 별도 위치. 분리할 때 `pap-static-legal.js` 또는 페이지 자체로 흡수.

### [Content — 홈 ED 캐러셀] L449–L453 — `scrollEdRow(btn, dir)`
- 무엇: 홈 페이지의 에디토리얼 row 좌/우 화살표 클릭 → 460px 스크롤
- 추출 시 주의: 홈 전용. Content.

### [Shell — Carousel 초기화] L455–L524 — `_papInitCarouselArrows` IIFE
- 무엇: DOMContentLoaded 시 fashion / ed-row / nf(film) 캐러셀에 화살표 상태 동기화 자동 와이어
- 추출 시 주의: Shell의 캐러셀 유틸 일부지만, 셀렉터(`.fashion-section`, `.ed-row-wrap`, `.nf-wrap`)가 **홈 페이지의 DOM**에만 존재. 분리 시 페이지에서 명시적 init 호출하는 형태로 변환 권장.

### [Content — 검색 데이터/검색 함수] L526–L656 — `edData`, `_searchTexts`, `searchEditorials(query)`
- 무엇:
  - L528: `var edData = []` — 모든 에디토리얼의 메타 (검색·overlay·home 데이터 소스)
  - L529–L539: 9개 언어 검색 결과 텍스트
  - L541–L656: 검색 함수. 드롭다운 + 레거시 패널 + 크리에이터 결과 모두 처리.
- 추출 시 주의:
  - HARNESS_CHECKLIST.md §3 (Shell): "검색 로직(searchEditorials, searchInput handler 등) → `pap-search.js`로 이동"이라고 명시. **즉, Shell 소관**.
  - 다만 `edData`는 Content가 가진 데이터 → **Shell의 검색 모듈이 Content의 edData를 읽음**. 인터페이스: `window.papContent.search(query)` 또는 `window.papSearch.setProvider(fn)`.
  - `creatorData`, `openCreatorPopup`도 호출함 → 크리에이터 검색 부분은 Content/Social.
- 의존: `edData`, `creatorData`, `openCreatorPopup`, `openEditorial`, `lang`, `toggleSearch`

### [Content — 에디토리얼 상세] L658–L698 — `edDetails`, `_normalizeCreditsForDisplay(raw)`
- 무엇: 에디토리얼별 상세 데이터 맵 + 3가지 credits 형식(legacy dict / new admin array / display array) 통일 정규화
- 추출 시 주의: **Content** 핵심. `edDetails`는 detail overlay·creator DB·deep link 모두 의존.

### [Content — 데이터] L700–L775 — `edLogoFolders` (60+ 에디토리얼별 Google Drive 폴더 ID), `getLogoFolderId(t)`
- 무엇: 디스트리뷰션 키트(로고/배포 파일) Google Drive 폴더 매핑 + case-insensitive 룩업
- 추출 시 주의: HARNESS_CHECKLIST.md §5 (MyPage)에 "다운로드 키트"가 있고, 현재 코드도 mypage로 CTA 보냄. **데이터 자체는 `pap-logos-data.js`로 이미 외부화**되어 있음 (L704). 이 인라인 fallback은 Content 또는 별도 `pap-distribution-kit.js`로.
- 의존: `window.PAP_LOGO_FOLDERS` (외부)

### [Auth/Subscription — 권한 게이트] L777–L809 — `isLoggedIn()`, `isPremium()`, `isStandardOrAbove()`
- 무엇:
  - `isLoggedIn` (L783–L791): pap-token 또는 파싱 가능한 pap-user 중 하나만 있어도 로그인 인정
  - `isPremium` (L792–L800): 베타 활성 시 isLoggedIn = premium 취급, 그 외엔 user.subscription === 'premium'
  - `isStandardOrAbove` (L801–L809): 베타 활성 시 isLoggedIn, 그 외 'standard'|'premium'
- 추출 시 주의:
  - HARNESS_CHECKLIST.md `window.papAuth.isLoggedIn()` 인터페이스와 일치 → **Auth로 이동**.
  - 단, `isPremium`/`isStandardOrAbove`는 **subscription 등급 체크**라 Subscription 영역. 베타 중에는 둘이 사실상 같은 함수가 되지만, 프로덕션 분리 시: Auth는 `isLoggedIn` + `getUser`만 노출, Subscription이 `getCurrentPlan()` / `hasAccess(level)` 노출이 깔끔.
  - **이 3개 함수를 Content/Subscription/이미지 보호/검색 등 광범위에서 호출** → 가장 먼저 빼야 할 코드.
- 의존: `localStorage('pap-token','pap-user')`, `isBetaActive`

### [Subscription/Ads] L811–L1089 — INTERSTITIAL AD + PREMIUM UPSELL
- 세부 구성:
  - L811–L815: `_interstitialCount`, `_navClickCount`, `_INTERSTITIAL_MAX=5`, `_INTERSTITIAL_EVERY=3`
  - L817–L837: `_brandAds` 폴백 배열 (PAP STUDIO 1개)
  - L840–L852: `_loadBrandAdsFromAPI` IIFE — `/api/ads` 페칭
  - L854–L861: `_getNextBrandAd()`
  - L863–L880: `showPremiumInterstitial(callback)` — N번째 클릭마다 광고 노출 결정
  - L883–L983: `_showBrandAdInterstitial(ad, callback)` — image/video 광고 오버레이 (9개 언어 SKIP 라벨 + 프리미엄 업셀 링크)
  - L986–L1080: `_showPremiumUpsellInterstitial(callback)` — 광고 없을 때 폴백 (9개 언어)
  - L1083–L1089: `navigateWithInterstitial(url)`
- 추출 시 주의:
  - HARNESS_CHECKLIST.md §5 (Content): `api/ads/index.js`는 Content 영역에 적혀 있음. 그러나 **인터스티셜 광고 + 프리미엄 업셀 흐름은 Subscription 하네스**가 자연스러움 (구독 유도/등급 체크와 묶임).
  - 또는 별도 "Ads" 미니 하네스. 이 문서에서는 **Subscription**으로 분류.
  - `isStandardOrAbove`(Subscription)에 의존하고, openEditorial / openAllEditorials / openFilmDetail / openArticleDetail 등 모든 콘텐츠 진입점에서 호출됨 → 인터페이스: `window.papSubscription.maybeShowInterstitial(callback)`.
- 의존: `isStandardOrAbove`, `lockScroll`, `unlockScroll`, `localStorage('pap-lang')`

### [Content — 에디토리얼 상세 오버레이] L1091–L1372 — `openEditorial()`, `_openEditorialInner()`, `_openEditorialInner_noPush()`, `closeEditorial()`
- 무엇:
  - `openEditorial` (L1091–L1100): 인터스티셜 게이트 후 inner 호출
  - `_openEditorialInner` (L1102–L1265): hero/title/issue/desc/gallery/credits/logo-section/social/more-carousel 렌더, history.pushState
  - `_openEditorialInner_noPush` (L1268–L1357): popstate에서 호출 (히스토리 푸시 없음)
  - `closeEditorial` (L1359–L1372): 오버레이 닫고 history.back
- HARNESS_CHECKLIST.md §5 (Content) 추출 작업: `_openEditorialInner`, `_resolveEditorialName`, `_normalizeIssueLabel`, `_populateEdDetailsFromApi`, `apiEditorialToLocal`, `_updateEditorialMeta`, `_resetEditorialMeta` 모두 명시 → **Content 핵심**.
- 추출 시 주의:
  - `PAPSocial.renderEditorialSocial`(L1226, L1340) 호출 → **Social 하네스**(`pap-social.js`)에 의존. Content는 Social을 import 또는 `window.papSocial?.mount(...)` 식으로.
  - 인터스티셜 호출 → Subscription 의존
  - SEO meta 갱신(`_updateEditorialMeta`) → 같은 Content 모듈 내부.
- 의존: `edDetails`, `_normalizeCreditsForDisplay`, `getLogoFolderId`, `_brandAds`/인터스티셜, `PAPSocial`, `edData`, `T`/`lang`, `_updateEditorialMeta`, `edImgError`

### [Content/Shell — popstate 핸들러] L1374–L1438 — `window.addEventListener('popstate', ...)`
- 무엇: 뒤로가기 시 creator/editorial/film/article 오버레이 상태 복원 + 닫기
- 추출 시 주의: **Content가 거의 전체 책임**. Shell이 popstate에 라우팅 디스패처 두고 각 하네스가 핸들러 등록하는 구조가 깨끗하지만, 단기로는 Content에 묶어 두기.
- 의존: `_openEditorialInner_noPush`, `_openCreatorPopup_noPush`, `getCreatorDB`, `closeEditorial`, `closeAllEditorials`, `closeAllFilms`, `closeAllArticles`, `closeFilmDetail`, `closeArticleDetail`

### [Content — 이미지 에러 핸들러] L1440–L1446 — `edImgError(img)`
- 무엇: 이미지 onerror → 검은 SVG placeholder
- HARNESS_CHECKLIST.md: `pap-img-fallback.js` (Shell 소관)으로 별도 파일 존재. 이 함수는 Content 전용 placeholder라 **Content** 또는 통합.

### [Content — 전체 에디토리얼 오버레이] L1448–L1634 — `openAllEditorials`, `_openAllEditorialsInner`, `edAllCurrentCategory`, `_edEditorialMatchesCategory`, `filterEditorialsByCategory`, `_renderEdAllPage`, `closeAllEditorials`, `_autoOpenEditorialsFromHash`
- 무엇: `#all-editorials` 오버레이 — 카테고리 필터 + 페이지네이션 + 등급별 슬라이싱 + free 회원 차단 alert + 해시 자동 오픈
- 추출 시 주의:
  - **Content** 영역.
  - free → standard upsell 분기는 Subscription 의존.
  - `buildPagination`(Shell) 의존.
  - `getLangText`(Shell) 의존.
- 의존: `edData`, `isPremium`, `isStandardOrAbove`, `PAP_PER_PAGE`, `buildPagination`, `getLangText`, `openEditorial`, `edImgError`

### [Content — 전체 필름 오버레이] L1636–L1777 — `openAllFilms`, `_openAllFilmsInner`, `filterFilms`, `closeAllFilms`, `openFilmDetail`, `_openFilmDetailInner`, `_findFilmByTitle`, `closeFilmDetail`
- 무엇: 필름 그리드 + 카테고리 필터 + 디테일 오버레이(YouTube 임베드) + 크레딧 핸들 클릭
- 추출 시 주의: **Content** 영역(films).
- 의존: `filmAllData`, `isStandardOrAbove`, 인터스티셜, `escapeHtml`, `openProfileByHandle`, `_normWs`

### [Content — 전체 아티클 오버레이] L1779–L1996 — `openAllArticles`, `_openAllArticlesInner`, `filterArticles`, `closeAllArticles`, `escapeHtml`, `openArticleBySlug`, `_decHtml`, `_normWs`, `openArticleFromCard`, `_renderArticleDetail`, `openArticleDetail`, `_openArticleDetailInner`, `closeArticleDetail`
- 무엇: 아티클 그리드 + 카테고리 필터 + 디테일 오버레이 (i18n 제목/서브타이틀, 갤러리, 태그 칩 → articles.html?tag=)
- 추출 시 주의: **Content** 영역(articles). `escapeHtml`/`_decHtml`/`_normWs`는 범용 → **Shared/Shell 유틸**로 분리 가능.
- 의존: `artData`, `edDetails`, `isStandardOrAbove`, `PAPSocial.renderArticleSocial`, `lang`, `edImgError`

### [Shell — geo lang 적용] L1998–L2006 — 초기 언어 적용 IIFE
- 무엇: `localStorage.getItem('pap-lang') || 'en'` → `setLang(saved)`
- 추출 시 주의: pap-geo-lang.js와 협력. **Shell**.

### [Content/Social — 크리에이터 시스템] L2008–L2226 — `creatorData`, `getLevel`, `buildCreatorDB`, `getCreatorDB`, `creatorDB`, `openCreatorPopup`, `_openCreatorPopup_noPush`, `closeCreatorPopup`, `openProfileByHandle`
- 무엇: 에디토리얼 credits/fashion에서 크리에이터 DB 빌드 → 크리에이터 팝업(이름·레벨·인스타·통계·평균별점·작품 그리드)
- 추출 시 주의:
  - Content와 Social 양쪽 걸침. **Content**(크리에이터 DB는 edDetails에서 파생)로 두되, 평균 별점 부분(L2117–L2135, `PAPSocial.getCreatorAvgRating`)은 Social 의존.
  - `openProfileByHandle`은 에디토리얼 credits 인라인 onclick에서 호출됨 → window 노출 필수.
- 의존: `edDetails`, `_normalizeCreditsForDisplay`, `PAPSocial`, `lockScroll`, `unlockScroll`

### [Content — 데이터 슬롯] L2228–L2238 — `filmAllData`, `artData`, `window.artData`, `window.filmAllData`
- 무엇: 빈 배열로 선언 → JSON/API에서 채워짐 + window 노출(다른 페이지가 참조)
- 추출 시 주의: **Content** (각 콘텐츠 타입의 메모리 데이터 슬롯).

### [Content — 필름 헬퍼] L2239–L2252 — `filmSlug`, `filmPageUrl`, `scrollFilm`
- 무엇: 슬러그화 + 필름 페이지 URL + 필름 트랙 가로 스크롤
- 추출 시 주의: **Content** (films).

### [Content — Netflix-style 호버 팝업] L2254–L2328 — `(function(){ ... })()` IIFE
- 무엇: `.nf-card` 호버 → `#nfPopup` 팝업 표시 (썸네일·카테고리·재생/info 버튼)
- 추출 시 주의: 홈의 필름 섹션 전용. **Content**.

### [Shell — 플로팅 로고 + 게임] L2330–L3132 — FLOATING LOGO IIFE (가장 큰 IIFE, ~800줄)
- 세부 구성:
  - L2332–L2342: 모바일 가드 (touch는 헤더 고정)
  - L2344–L2356: `getHeaderLogoPos`
  - L2358–L2418: 바운스 카운터 + `triggerBounceScore`
  - L2420–L2430: 히어로 IntersectionObserver (카운터 리셋)
  - L2432–L2494: `updateFloatingLogo` (커서 추적 + 폴드 효과)
  - L2496–L2521: 트레일 풀 + `spawnTrail`
  - L2523–L2542: `isModalActive`
  - L2544–L2597: mousemove / scroll / load / resize 핸들러
  - L2599–L2648: bfcache/visibility/`_resetFloatingLogoToHeader` (`window._papResetFloatingLogo` 노출)
  - L2650–L3131: **PAP PONG GAME** — 더블 클릭 시 풀 캔버스 벽돌깨기/퐁 (10 레벨, 콤보, 파티클, HUD)
- 추출 시 주의:
  - 홈 페이지(인덱스) 인터랙션 — **Shell의 별도 모듈**(`pap-floating-logo.js` 또는 `pap-hero-fx.js`)로 분리. 홈 외 페이지에서는 로드 안 해도 됨.
  - 게임은 더더욱 격리 가능 — 별도 `pap-game.js`.
  - `_resetCursorForModal`(L3136)와 짝꿍.
- 의존: `#floatingLogo`, `.hero`, `.logo-wrap`, `.header`, `#accountDropdown`, `#signupPopup`, `#creatorPopup`, `#cookieConsent`, `#navOverlay`, `#premiumInterstitial`

### [Shell] L3134–L3158 — `_resetCursorForModal()`
- 무엇: 모달 열릴 때 플로팅 로고를 헤더 위치로 리셋
- 추출 시 주의: 위 IIFE와 함께 Shell의 hero-fx 모듈로.

### [MyPage 후보 / Shell — Signup 팝업] L3160–L3194 — Signup popup IIFE + `closeSignupPopup`
- 무엇: 첫 방문자에게 가입 유도 팝업 (localStorage `pap-signup-shown` 플래그)
- 추출 시 주의:
  - Auth 회원가입 유도이지만 표시는 모든 페이지 공통 → **Shell의 별도 모듈**(`pap-signup-popup.js`)이 자연. `cookie-consent.js`와 같은 격.
  - 또는 Auth에 묶을 수도 있음(가입 유도이므로). 결정 필요(아래 미해결 질문).
- 의존: localStorage, `lockScroll/unlockScroll`, `_resetCursorForModal`

### [Content — 필름 자동재생/IO] L3195–L3220 — `filmInView`, `filmPlaying`, `playFilm`, `stopFilm`, `filmObserver`
- 무엇: 홈의 필름 섹션 가시성 감지 + 카드 클릭 → `openFilmDetail`
- 추출 시 주의: **Content**.

### [Content — 숏츠 캐러셀] L3222–L3325 — `shortsData`, `shortsIdx`, `shortsAutoTimer`, `shortsInView`, `buildShortsCarousel`, `getShortsVisibleCount`, `updateShortsPositions`, `moveShort`, `shortsObserver`
- 무엇: 숏츠(YouTube) 코베르플로우 캐러셀 — 자동 회전(15s), IntersectionObserver로 화면 진입 시 활성화
- 추출 시 주의: **Content**(shorts). HARNESS_CHECKLIST.md §5에 `shorts.json` 명시.

### [Content/Shell — 데이터 로딩] L3327–L3368 — `window._papShortsRender`, `window._papFilmAutoPlay`, LAZY DATA LOADING IIFE
- 무엇: `data/films.json`, `data/articles.json`, `data/editorials.json`, `data/creators.json`, `data/shorts.json`, `data/editorial-details.json` 페칭 + 콜백
- 추출 시 주의:
  - HARNESS_CHECKLIST.md §3 (Shell): `pap-api.js` (API 클라이언트, fetch wrapper) 명시. 본 IIFE는 Content 데이터 로딩이라 **Content 부트스트랩**.
  - 결합도: 6개 데이터 슬롯에 모두 직접 접근. Content 모듈로 함께.
- 의존: `filmAllData`, `artData`, `edData`, `creatorData`, `shortsData`, `edDetails`, render 콜백들

### [Content — Supabase API 동기화] L3370–L3846 — SUPABASE API AUTO-SYNC IIFE
- 세부 구성:
  - L3372–L3393: `PAP_API_BASE` detect + early return
  - L3396–L3407: `apiFilmToLocal`
  - L3410–L3430: `apiArticleToLocal`
  - L3435–L3466: `mergeData(apiItems, localItems)` — slug/title 디듀프 + i18n 보강
  - L3469–L3497: `fetchAll(endpoint, converter, callback)` — 페이지네이션
  - L3500–L3518: `syncFilms`
  - L3521–L3538: `syncArticles`
  - L3544–L3572: `apiEditorialToLocal` — slug/thumb/hero/issue/credits/fashion/gallery/description 매핑
  - L3578–L3595: `mergeEditorials`
  - L3604–L3698: `_normalizeIssueLabel` — 발행호 라벨 정규화 (Korean "4월호", English "MAR. ISSUE", ISO date → "VOL.30 ISSUE")
  - L3700–L3744: `_populateEdDetailsFromApi`
  - L3746–L3829: `syncEditorials` — 홈 그리드 update-in-place + prepend, edAll 재렌더
  - L3832–L3845: DOMContentLoaded 시 sync 실행
- HARNESS_CHECKLIST.md §5 (Content): 모든 함수 추출 대상으로 명시 (`apiEditorialToLocal`, `_normalizeIssueLabel`, `_populateEdDetailsFromApi`).
- 추출 시 주의: **Content** 핵심. 매우 큰 블록 (~470줄). `pap-api.js`(Shell)가 fetch 추상화하면 깔끔.
- 의존: `filmAllData`, `artData`, `edData`, `edDetails`, `_normalizeCreditsForDisplay`, `_renderEdAllPage`, `edAllBuilt`, render 콜백들

### [Content/Shell — 숏츠 리사이즈] L3848–L3854
- 무엇: 윈도우 resize → debounced `updateShortsPositions`
- **Content** (shorts).

### [Shell — 마키] L3856–L3924 — Marquee IIFE
- 무엇: `#marqueeTrack` 무한 스크롤 (CSS animation, 폰트 로드 후 width 측정 → 클론 → keyframes)
- 추출 시 주의: 홈 전용 헤더 섹션. **Shell의 hero/marquee 컴포넌트** 또는 인덱스 인라인.

### [Shell — 페이지네이션] L3926–L4018 — `PAP_PER_PAGE`, `PAP_PAGE_JUMP`, `buildPagination()`
- 무엇: 통합 페이지네이션 컴포넌트 (이전/다음 ±5 점프 ellipsis 포함, 모바일 터치 reveal)
- HARNESS_CHECKLIST.md §3 (Shell): 명시 안 됐지만 모든 리스트 페이지(에디토리얼/아티클/필름)에서 공유 → **Shell**의 공용 UI 유틸.
- 의존: 없음 (순수 DOM)

### [Content — SEO 메타 갱신] L4020–L4146 — `_updateEditorialMeta`, `_PAP_HOME_META`, `_captureHomeMeta`, `_resetEditorialMeta`, popstate 리셋
- 무엇: 에디토리얼 오버레이 열림 → document.title / og:* / twitter:* / canonical / JSON-LD Article 갱신. 닫힘 → 홈 메타로 복원.
- HARNESS_CHECKLIST.md §5 (Content) 명시.
- 추출 시 주의: **Content**. _captureHomeMeta는 페이지 로드 시 1회 캡쳐.

### [Content — 딥링크] L4148–L4198 — `#editorial/<title>` 해시 IIFE + `_resolveEditorialName(input)`
- 무엇: URL 해시(`#editorial/Refractions`) → 에디토리얼 자동 오픈. 슬러그 형태(`indigestible-rituals`)도 처리.
- HARNESS_CHECKLIST.md §5 (Content) 명시 (`_resolveEditorialName`).
- 추출 시 주의: **Content**.

### [Content — 딥링크 ?ed=] L4200–L4232 — `?ed=<name>` 쿼리 IIFE
- 무엇: `?ed=` 파라미터 → 폴링하며 edDetails 준비되면 오픈 → URL 정리
- 추출 시 주의: **Content**.

### [Subscription/Content — 우클릭 보호] L4234–L4257 — IMAGE RIGHT-CLICK PROTECTION IIFE
- 무엇: 비-Standard 사용자는 이미지 우클릭/드래그 금지 + 9개 언어 토스트
- 추출 시 주의:
  - 이미지(콘텐츠) 보호 = Content 영역. 권한 게이트(`isStandardOrAbove`)는 Subscription/Auth 의존.
  - **Content**로 분류 (보호 대상이 콘텐츠 이미지). 또는 별도 작은 모듈 `pap-image-protect.js`.
- 의존: `isStandardOrAbove`, localStorage('pap-lang')

---

## 의존 그래프 (요약)

### Auth 추출 시 함께 봐야 하는 것
- **`isLoggedIn` / `isPremium` / `isStandardOrAbove` (L783–L809)**: 광범위하게 호출됨 (Content overlays, 이미지 보호, 인터스티셜, 검색…). Auth/Subscription 분리 결정 필요.
- **`_papUpdateAuthDropdown` (L190–L225)**: 9개 언어 텍스트 사전 인라인 → i18n 흡수 여부 결정.
- **`_papLogout` (L226–L230)**: 인라인 onclick에서 호출 → window 전역 노출 보장.
- 같은 베타 가드(`isBetaActive`)도 함께. 위치를 Auth에 둘지 Shared에 둘지 결정.

### Content 추출 시 깨지기 쉬운 부분
- **`PAPSocial` 의존 3곳**: `_openEditorialInner` L1226, `_openEditorialInner_noPush` L1340, `_renderArticleDetail` L1944, 크리에이터 평균 별점 L2117/L2191. Social 하네스가 로드되어 있다는 가정 — 없으면 graceful fallback (`typeof PAPSocial!=='undefined'`).
- **인터스티셜 광고 호출 8곳**: `openEditorial`, `openAllEditorials`, `openAllFilms`, `openFilmDetail`, `openAllArticles`, `openArticleDetail`. Subscription이 로드 안 되면 그냥 콜백 즉시 실행되도록 fallback 필요.
- **`buildPagination`**(Shell)에 강하게 결합. Shell이 먼저 로드돼야 함.
- **`_papInitCarouselArrows`**(Shell) IIFE가 DOMContentLoaded 시 셀렉터로 홈 캐러셀에 와이어 → Content 그리드 DOM이 그때 존재해야 함. 순서 주의.
- **`edData` / `edDetails` / `artData` / `filmAllData` / `creatorData` / `shortsData`**: 6개 전역 슬롯이 LAZY DATA LOADING IIFE와 SUPABASE API SYNC IIFE 둘 다에서 채워짐. 둘 다 같이 옮겨야 함.
- **popstate 핸들러 2개** (L1374, L4142): 둘 다 등록되어 직렬 실행. 분리 시 충돌 안 나도록 라우팅 디스패처가 깔끔.

### Shell 분리 시 로드 순서 주의
1. `pap-i18n.js` (`T`, `lang`, `setLang`) — 다른 모든 모듈이 의존 가능.
2. `pap-api.js` (papApi 헬퍼) — Content 데이터 로딩에 사용.
3. `pap-header.js` (toggleNav, toggleSearch, toggleAccountMenu, `_papUpdateAuthDropdown` 트리거 지점).
4. `pap-search.js` (searchEditorials) — Content의 `edData` 필요 (Content가 먼저 init돼야 검색 결과 있음).
5. `pap-floating-logo.js` + `pap-game.js` — 홈 페이지에서만 로드.
6. `cookie-consent.js`, `pap-signup-popup.js` — 마지막.

### 다른 위험 지점
- `var lang='ko';` (L57)이 모듈 스코프인데 `setLang` 외에서도 직접 참조. 분리 시 `localStorage.getItem('pap-lang')`로 통일 필요.
- `getLangText`(L183)와 `T`(L46) 두 가지 i18n 사전이 공존. 단일화 결정.
- `_papUpdateAuthDropdown`이 즉시 호출(L231)되는데 토큰/유저가 비동기 로딩 중일 수 있음 → Auth 모듈은 storage event 리스너로 재호출 필요.

---

## 추출 우선순위 권장

### 1. **첫 추출 — Auth (~55 줄)**
- 대상: `_papLogout` (L226–L230), `isLoggedIn` (L783–L791), `_papUpdateAuthDropdown` (L190–L225), `toggleAccountMenu`/`_closeAcct` (L186–L187), 즉시 호출(L231)
- 함께 가야 할 의문점: `isPremium`/`isStandardOrAbove`도 Auth로 보낼지, Subscription에 둘지. 추천: **베타 기간엔 Auth에 임시 alias 두고 Subscription에 본체 둠**.
- 추출 라인 수: ~55 (또는 105 — 등급 헬퍼 포함 시)
- 깨질 수 있는 곳:
  - 인라인 `onclick="_papLogout()"` → window 노출 누락 시 헤더 로그아웃 안 됨
  - 9개 언어 드롭다운 텍스트 빠뜨리지 말 것
  - `_papUpdateAuthDropdown` 즉시 호출 타이밍 (DOM ready 필요)
- 검증: 헤더 사람 아이콘 → 로그인 상태별 메뉴, 로그아웃 클릭 → localStorage 비움 + 홈 이동.

### 2. **두 번째 — i18n 테이블 (Shell, ~95 줄)**
- 대상: `T` (L46–L56), `lang` (L57), `setLang` (L134–L143), `_applyArticleCardI18n`/`_loadArticleI18n`/자동 호출 (L60–L149)
- HARNESS_CHECKLIST.md §3 명시. **매우 안전**. 다른 모듈은 `T`/`setLang` 만 보면 됨.
- 추출 라인 수: ~95
- 깨질 수 있는 곳:
  - `lang` 변수 직접 참조하는 함수 7곳 (`searchEditorials`, `_renderArticleDetail`, `_openEditorialInner` 등) → `localStorage.getItem('pap-lang')`로 변경하거나 Shell이 export하는 게터 사용.
  - `_loadArticleI18n` 안에서 `artData.push`, `_papArticleRenderCards` 호출 → Content 의존. 분리 시 Shell→Content 이벤트로.

### 3. **세 번째 — Search (Shell, ~135 줄)**
- 대상: `searchEditorials` (L541–L656), search input 이벤트 핸들러 (L233–L251) 일부, `_searchTexts` (L529–L539)
- HARNESS_CHECKLIST.md §3 명시.
- 추출 라인 수: ~135
- 깨질 수 있는 곳:
  - `edData`/`creatorData` 의존 → Content가 먼저 채워줘야 결과 나옴. Shell은 빈 결과 대비.
  - 글로벌 ESC/Backspace 핸들러(L251)가 Content overlays 함수 모두 호출 → Content가 등록한 콜백을 Shell이 실행하는 구조로.

### 4. **네 번째 — UI 공통 유틸 (Shell, ~100 줄)**
- 대상: `lockScroll`/`unlockScroll` (L17–L43), safety unlock 타이머 (L167–L174), `escapeHtml`/`_decHtml`/`_normWs` (L1845, L1849, L1850), `buildPagination`/`PAP_PER_PAGE`/`PAP_PAGE_JUMP` (L3926–L4018), 캐러셀 헬퍼 `_papUpdateArrows`/`_papWireCarousel`/`_papSmoothScrollBy` (L298–L386)
- 추출 라인 수: ~250
- 깨질 수 있는 곳: 거의 없음 (순수 함수). Content가 import만 하면 됨.

### 5. **다섯 번째 — Subscription (~330 줄)**
- 대상: 인터스티셜/광고 블록 (L811–L1089), `navigateWithInterstitial`, 우클릭 보호 (L4234–L4257)
- HARNESS_CHECKLIST.md §3.
- 추출 라인 수: ~330
- 깨질 수 있는 곳:
  - 인터스티셜 호출 지점 8곳 (`openEditorial`, `openAllEditorials`, `openAllFilms`, `openFilmDetail`, `openAllArticles`, `openArticleDetail`) — `window.papSubscription.maybeShowInterstitial(cb)` 인터페이스로 통일.
  - `_brandAds` 폴백 + `/api/ads` 페칭. CORS / credentials 옵션 유지.
  - `isStandardOrAbove` 본체와 함께 가는 게 자연스러움.

### 6. **여섯 번째 — Static (~75 줄)**
- 대상: `_legalNoticeTexts`, `openPage`, `closePage` (L398–L447)
- 추출 라인 수: ~75
- 깨질 수 있는 곳: 거의 없음. terms/privacy 모달이 홈에 임베드된 형태라 분리 시 페이지 자체로 이동 권장.

### 7. **일곱 번째 — Content 본체 (~2,180 줄, 가장 큰 덩어리)**
- 대상: edData/edDetails/artData/filmAllData/creatorData/shortsData 슬롯, openEditorial 패밀리, openCreatorPopup 패밀리, openAllX 오버레이 3종, 데이터 로딩 IIFE, Supabase 동기화 IIFE, SEO 메타, 딥링크 IIFE 2개, 기타 카드 렌더
- 추출 라인 수: ~2,180
- 깨질 수 있는 곳:
  - **PAPSocial 호출 지점**: graceful fallback 유지.
  - **인터스티셜 호출 지점 8곳**: Subscription 인터페이스로 위임.
  - **데이터 슬롯들의 window 노출**(`window.artData`, `window.filmAllData`): articles.html / films.html / pap-article-render.js 등 다른 페이지가 참조하는지 grep 후 인터페이스 정리.
  - **popstate 핸들러 2개** (L1374, L4142): 합치거나 라우팅 디스패처로.
  - 홈 캐러셀 셀렉터 의존이 깊음 → 분리 시 페이지에서 명시적 mount 함수 호출.
- 권장 서브분할: `pap-content-editorial.js`, `pap-content-article.js`, `pap-content-film.js`, `pap-content-shorts.js`, `pap-content-creator.js`, `pap-content-api-sync.js`.

### 8. **여덟 번째 — 홈 인터랙션 (Shell — 분리 가능, ~870 줄)**
- 대상: 플로팅 로고 IIFE (L2330–L3132), `_resetCursorForModal` (L3136–L3158), 마키 IIFE (L3856–L3924)
- 추출 라인 수: ~870
- 깨질 수 있는 곳:
  - `isModalActive`(L2524)가 `#signupPopup`, `#creatorPopup`, `#cookieConsent`, `#navOverlay`, `#premiumInterstitial` 모두 참조 → 다른 하네스의 DOM ID 의존. ID 명세 변경 시 깨짐.
  - **Shell의 옵션 모듈**로 둬서 홈 외 페이지에서는 로드하지 않음.

### 9. **아홉 번째 — 가입 팝업 (~35 줄)**
- 대상: signup popup IIFE + `closeSignupPopup` (L3160–L3194)
- 추출 라인 수: ~35
- 위치: Shell 또는 Auth — 결정 필요.

---

## 주의 / 미해결 질문

1. **`isPremium` / `isStandardOrAbove` 위치 (L792–L809)**: 토큰 기반 판정이라 Auth, 등급 판정이라 Subscription. 베타 동안엔 둘이 같음. 결정 필요. 
   - 추천: **Subscription 본체 + Auth가 thin wrapper**. `window.papSubscription.hasAccess('standard'|'premium')` 노출.

2. **`isBetaActive` / `PAP_BETA_END` (L8, L10)**: Auth/Subscription 양쪽 의존. 
   - 추천: **Shared 작은 `pap-flags.js`** 또는 Subscription 안.

3. **9개 언어 인라인 텍스트 사전이 5곳**:
   - `_papUpdateAuthDropdown`(L200) — Auth/dropdown 라벨
   - `_searchTexts`(L529) — search 결과 라벨
   - `_legalNoticeTexts`(L402) — terms/privacy
   - 인터스티셜 텍스트(L928, L959, L989) — Subscription
   - 우클릭 보호 토스트(L4245)
   - **결정**: 모두 `pap-i18n.js`의 `T` 사전으로 통합 vs 각 모듈 자체 보유. 통합이 깨끗하지만 PR 크기 증가.

4. **i18n 변수 `lang` 직접 참조 7곳**: `setLang` 외에서도 모듈 스코프 변수를 그대로 읽음. 분리 시 통일 (`localStorage.getItem('pap-lang')`).

5. **popstate 핸들러 2개 등록 (L1374, L4142)**: 둘 다 살아 있으면 둘 다 호출됨. 첫 번째는 오버레이 복원, 두 번째는 SEO 메타 리셋. 분리 후에도 같이 동작은 하지만 라우팅 디스패처 패턴이 권장.

6. **싱글톤 init 코드 (즉시 호출 IIFE)**: L152(LOADER), L840(_loadBrandAdsFromAPI), L2003(setLang 부트), L2255(NF popup), L2333(FLOATING LOGO), L3164(SIGNUP), L3343(LAZY DATA LOADING), L3372(API SYNC), L3863(MARQUEE), L4153(딥링크 hash), L4201(딥링크 ?ed=), L4236(우클릭 보호) — **총 12개**. 분리 시 각 모듈이 자체 init하도록 export. 페이지가 어떤 모듈을 import할지 명확히.

7. **`window` 전역 노출 함수**: 인라인 `onclick=...` HTML 속성에서 호출되는 함수는 반드시 window에 노출돼야 함. 후보: `_papLogout`, `openEditorial`, `openCreatorPopup`, `openProfileByHandle`, `openArticleDetail`, `openArticleFromCard`, `openFilmDetail`, `closeXxx` 다수, `toggleNav`, `toggleSearch`, `toggleAccountMenu`, `setLang`, `closePage`, `openPage`, `closeSignupPopup`, `moveCarousel`, `moveEdCarousel`, `scrollEdRow`, `scrollFilm`, `moveShort`, `filterEditorialsByCategory`, `navigateWithInterstitial`, `closeAllEditorials`, `closeAllFilms`, `closeAllArticles`. 분리 모듈이 `window.X = X` 명시.

8. **Signup popup 위치 (L3160–L3194)**: 가입 유도라 Auth와 의미적 연결, 표시는 모든 페이지 공통이라 Shell. 결정 필요.

9. **`escapeHtml`/`_decHtml`/`_normWs` (L1845–L1850)**: Content 내부에 있지만 범용. Shell의 `pap-utils.js`로.

10. **`edImgError` (L1441)**: HARNESS_CHECKLIST.md는 `pap-img-fallback.js`(Shell)을 별도 파일로 명시. 이 함수와 통합 또는 Content placeholder만 따로.

11. **`getLogoFolderId`와 `edLogoFolders` (L700–L775)**: 이미 외부 파일(`pap-logos-data.js`)이 존재. 인라인 fallback은 보안용 사본이므로 그대로 두거나 제거 후 외부 파일 의존.

12. **데이터 슬롯의 window 노출 (`window.artData`, `window.filmAllData`)**: 다른 페이지(`articles.html`, `films.html`)가 참조한다고 추정. 분리 시 인터페이스 명세 필요 — `window.papContent.getArticles()`로 게터 제공.

---

## 페이지별 로드 매트릭스 (참고용)

이 파일을 분리하면 다음과 같이 페이지별 import:

| 페이지 | 이 파일에서 가져갈 부분 |
|---|---|
| `index.html` (홈) | 거의 전체 (i18n + Auth + Search + Nav + Carousels + Editorial/Article/Film/Shorts/Creator + 인터스티셜 + Floating logo + Marquee + 딥링크 + SEO) |
| `magazine.html` | i18n + Auth + Search + Nav + Editorial overlays + 페이지네이션 + 검색 |
| `articles.html` | i18n + Auth + Search + Nav + Article overlays + 페이지네이션 + Article API sync |
| `films.html` | i18n + Auth + Search + Nav + Film overlays + 페이지네이션 + Film API sync |
| `mypage.html` | i18n + Auth + Nav + (디스트리뷰션 키트 폴더 ID) |
| `auth.html` | i18n + Auth + Nav |
| `subscribe.html` | i18n + Auth + Nav (인터스티셜은 자기가 노출되면 안 됨) |
| `terms.html`/`privacy.html` | i18n + Nav + `_legalNoticeTexts`/`openPage`/`closePage` |
| `community.html` | i18n + Auth + Nav |
| `admin.html` | i18n + Auth + Nav |

---

**결론**: 이 파일은 사실상 6 하네스(Auth, Subscription, Shell, Content, Static, +Social 의존)에 걸친 **홈페이지 통합 번들**이다. Phase 1 작업으로 **Auth만 먼저 빼는 게 가장 안전** (~55줄, 의존 적음). 이후 i18n 테이블(~95줄), Search(~135줄)까지 추출하면 파일이 ~3,900줄 정도로 줄고, 그 다음 Content 본체(~2,180줄) 분리로 본격적인 슬림화 가능. AdminCMS / MyPage / SubmissionFlow / Community 하네스의 직접 코드는 이 파일에 거의 없음 (해당 코드는 각자의 HTML 파일에 인라인되어 있을 것).
