# PAP Magazine — Harness Refactor 현황 문서

> 작성: 2026-05-02
> 기준: HARNESS_CHECKLIST.md (10개 하네스 격리 계획)
> 대응 미션: 2 ~ 11 (총 13 missions, 11 successful + 2 follow-up cleanups)
> 결과 commit: `154632f` (main) — production 배포 완료

---

## 1. 한눈에 보기

| | Before | After |
|---|---|---|
| `pap-app.js` 라인 수 | **4,258** | **36** (스텁) |
| 기능 코드 추출률 | — | **99%** |
| Frontend JS 모듈 수 | 1 (모놀리스) | **15개 (집중 모듈)** |
| 가장 큰 모듈 | pap-app.js (200KB+) | pap-i18n.js (49KB) |
| HTML 로드 스크립트 수 (10 페이지) | 1 | 15 |

**전체 1,860+ 줄 추출, 13 commits, 2일 작업, byte-identity 검증, production 무중단 배포 완료.**

---

## 2. 모듈 다이어그램

```
┌─ Foundational (load first) ────────────────────────────┐
│  pap-utils.js  (10KB)    scroll lock, escapeHtml,      │
│                          pagination, carousel scroll    │
│  pap-i18n.js   (49KB)    9-lang T + 모든 translation   │
│                          dicts (단일 진실 출처)         │
└────────────────────────────────────────────────────────┘
                  ↓
┌─ Auth & Access ────────────────────────────────────────┐
│  pap-auth.js          (4KB)   isLoggedIn, header drop   │
│  pap-subscription.js  (15KB)  tier checks, interstitial │
└────────────────────────────────────────────────────────┘
                  ↓
┌─ Feature Modules ──────────────────────────────────────┐
│  pap-search.js        (7KB)    toggleSearch, search     │
│  pap-static.js        (2KB)    terms / privacy modal    │
│  pap-home.js          (36KB)   floating logo, signup,   │
│                                marquee (홈 전용)         │
└────────────────────────────────────────────────────────┘
                  ↓
┌─ Content (6 sub-modules) ──────────────────────────────┐
│  pap-content-editorial.js       (34KB)  에디토리얼      │
│  pap-content-film.js            (12KB)  필름            │
│  pap-content-article.js         (12KB)  아티클          │
│  pap-content-creator-shorts.js  (15KB)  크리에이터+숏츠 │
│  pap-content-api-sync.js        (24KB)  API 데이터 sync │
│  pap-content-seo.js             (11KB)  메타 + 딥링크   │
└────────────────────────────────────────────────────────┘
                  ↓
┌─ Shell Bootstrap (cross-cutting glue) ─────────────────┐
│  pap-shell-bootstrap.js  (17KB)  beta, loader, hero,    │
│                                  nav, popstate router   │
└────────────────────────────────────────────────────────┘
                  ↓
┌─ Stub (역사 문서) ─────────────────────────────────────┐
│  pap-app.js (2KB, 36줄)   기능 코드 0, 모듈 맵 주석     │
└────────────────────────────────────────────────────────┘
```

**적재 순서 (10 HTMLs 모두 동일)**:
```
pap-utils → pap-i18n → pap-auth → pap-search → pap-static
→ pap-subscription → pap-home → pap-content-editorial
→ pap-content-film → pap-content-article
→ pap-content-creator-shorts → pap-content-api-sync
→ pap-content-seo → pap-shell-bootstrap → pap-app
```

순서가 중요한 이유: 후행 모듈이 전행 모듈의 함수/데이터를 호출 시점에 reference 함. 예:
- `pap-search.js` 의 `searchEditorials` 가 `pap-i18n.js` 의 `lang` 과 `_searchTexts` 를 읽음
- `pap-shell-bootstrap.js` 의 popstate 핸들러가 `closeEditorial` (pap-content-editorial) 등을 호출
- `pap-subscription.js` 의 `isPremium` 이 `pap-app.js`의 `isBetaActive` 를 호출 (지금은 pap-shell-bootstrap.js 로 이동)

---

## 3. 모듈별 책임 + 공개 API

### `pap-utils.js` — 공통 유틸 (Shell)

**책임**: 어느 하네스에도 종속되지 않는 순수 헬퍼.

```js
// 모달 스크롤 락
window.lockScroll() / unlockScroll()
window._scrollLockCount, _savedScrollY  // 내부 상태

// 캐러셀 헬퍼
window._papUpdateArrows(track, leftBtn, rightBtn)
window._papWireCarousel(trackSel, leftSel, rightSel)
window._papSmoothScrollBy(track, dx)

// HTML 유틸
window.escapeHtml(t)
window._decHtml(s)
window._normWs(s)

// 페이지네이션
window.PAP_PER_PAGE = 20
window.PAP_PAGE_JUMP = 5
window.buildPagination(container, currentPage, totalPages, onPageChange, isDark)
```

### `pap-i18n.js` — i18n + 모든 다국어 사전 (Shell)

**책임**: 모든 다국어 텍스트의 단일 출처. 새 언어 추가 시 이 파일만 수정.

```js
// 핵심
window.T               // 메인 UI 사전 (9개 언어 × ~55개 키)
window.lang            // 현재 언어 ('ko'|'en'|'it'|'fr'|'es'|'ja'|'zh'|'ru'|'de')
window.setLang(l)      // 언어 전환
window._articleI18n    // article 카드 번역 lazy-loaded

// 흡수된 사전들 (option C 통합 결과)
window._searchTexts            // 검색 결과 라벨
window._legalNoticeTexts       // 약관/개인정보 참조 번역
window._interstitialSkipTexts  // 광고 skip 버튼
window._interstitialPremTexts  // 프리미엄 업셀 배지
window._interstitialUpsellTexts // 구독 업셀 모달
window._imageProtectMsg        // 우클릭 보호 토스트
```

**미해결**: `_papUpdateAuthDropdown` 의 마이페이지/구독/로그아웃 라벨 (3 키 × 9 langs) 은 `pap-auth.js` 안에 그대로. 작은 사이즈라 분리 비용 더 큼.

### `pap-auth.js` — Auth (Phase 1)

```js
window.isLoggedIn()                  // 토큰 또는 user JSON 으로 판정
window._papLogout()                  // localStorage 비움 + 홈 이동
window._papUpdateAuthDropdown()      // 헤더 드롭다운 업데이트
window.toggleAccountMenu(e)          // 헤더 사람 아이콘 클릭
window._closeAcct(e)                 // 외부 클릭 시 닫기
```

**localStorage 키**: `pap-token`, `pap-user`, `pap-lang`

### `pap-subscription.js` — Subscription (Phase 1)

```js
// 등급 판정
window.isPremium()
window.isStandardOrAbove()

// Interstitial
window.showPremiumInterstitial(callback)
window.navigateWithInterstitial(url)

// 내부 상태
window._interstitialCount, _navClickCount
window._brandAds  // /api/ads 에서 hydration
```

**부가 동작**: 우클릭 보호 IIFE — 비-스탠다드 회원에게 이미지 다운로드 차단.

### `pap-search.js` — Search (Shell)

```js
window.toggleSearch()                // 검색바 토글
window.searchEditorials(query)       // 검색 + 드롭다운/패널 렌더링
```

### `pap-static.js` — Terms/Privacy 모달

```js
window.openPage(id)    // termsPage / privacyPage 모달 열기
window.closePage(id)
```

### `pap-home.js` — 홈 인터랙션

```js
window._papResetFloatingLogo()  // floating logo 리셋 (외부 hook)
window._resetCursorForModal()   // 모달 열기 직전 호출
window.closeSignupPopup()       // signup 팝업 닫기
```

**부가 IIFE**: floating logo (커서 따라다니는 히어로 로고), signup 팝업 (첫 방문 유도), marquee (히어로 무한 스크롤 텍스트).

### `pap-content-editorial.js` — 에디토리얼

```js
window.edData = []                  // 에디토리얼 데이터셋
window.edDetails = {}                // 디테일 맵
window.openEditorial(title, thumb)
window._openEditorialInner(...)
window._openEditorialInner_noPush(title, thumb)  // popstate 복원용
window.closeEditorial(skipHistory)
window.openAllEditorials()
window.closeAllEditorials()
window.filterEditorialsByCategory(cat)
window.edImgError(img)               // 카드 이미지 폴백
```

### `pap-content-film.js` — 필름

```js
window.filmAllData = []
window.openAllFilms() / closeAllFilms()
window.openFilmDetail(idx) / closeFilmDetail(skipHistory)
window._findFilmByTitle(title)
window.filmSlug(title) / filmPageUrl(title)
window.playFilm(card) / stopFilm()
```

### `pap-content-article.js` — 아티클

```js
window.artData = []
window.openAllArticles() / closeAllArticles()
window.openArticleBySlug(slug)
window.openArticleFromCard(card)
window.openArticleDetail(idx) / closeArticleDetail(skipHistory)
```

### `pap-content-creator-shorts.js` — 크리에이터 + 숏츠

```js
// Creator
window.creatorData = []
window.getCreatorDB()                // slug-keyed lookup
window.openCreatorPopup(cr)
window._openCreatorPopup_noPush(cr)  // popstate 복원용
window.openProfileByHandle(handle)

// Shorts
window.shortsData = []
window.moveShort(dir)
window._papShortsRender              // pap-app.js 가 set 하는 콜백
```

### `pap-content-api-sync.js` — Lazy 데이터 + Supabase API hydration

**책임**: `data/articles.json`, `data/films.json`, `data/shorts.json`, `data/creators.json` 을 fetch 후 dataset 채움 + 렌더 콜백 호출. 이어서 `/api/editorials`, `/api/films`, `/api/articles` 로부터 admin 업로드 데이터 hydration (병합).

**Public hooks**:
```js
window._papShortsRender             // 데이터 도착 시 호출
window._papFilmAutoPlay             // 첫 필름 자동 재생
window._papArticleRenderCards       // pap-i18n.js 가 lang 변경 시 호출
window._papReapplyAIThemeLabels     // AI 테마 라벨 재번역
```

### `pap-content-seo.js` — SEO 메타 + 딥링크

```js
window._updateEditorialMeta(title, det)  // 에디토리얼 열 때 OG/twitter/JSON-LD 갱신
window._resetEditorialMeta()             // 닫을 때 홈 메타로 복원
```

**부가 IIFE**: `#editorial/<Title>` 해시 딥링크, `?ed=<Name>` 쿼리 딥링크.

### `pap-shell-bootstrap.js` — 부트스트랩 + 라우터

```js
window.PAP_BETA_END = '2026-05-06'   // 베타 종료 날짜
window.isBetaActive()                // 베타 기간 체크
window.getLangText(key, fallback)    // 단일 키 다국어 lookup

window.toggleNav() / closeNav()      // 햄버거 + 오버레이
window.moveCarousel(d)               // 패션 캐러셀
window.moveEdCarousel(d)             // 에디토리얼 캐러셀
window.scrollEdRow(btn, dir)         // 에디토리얼 row 화살표
```

**부가**: LOADER IIFE, HERO SLIDER 자동 회전, ESC/Backspace 글로벌 핸들러, **popstate 라우터** (cross-content overlay 복원), 자동 언어 감지 IIFE, 캐러셀 화살표 초기화 IIFE.

### `pap-app.js` — 36줄 스텁

기능 코드 0줄. 모듈 맵 주석만. 캐시된 외부 참조 호환성을 위해 stub 유지.

---

## 4. 공통 의존성 규칙

| 리소스 | 누가 정의 | 누가 읽음 |
|---|---|---|
| `lang` 변수 | pap-i18n.js | 거의 모든 모듈 (검색, 인터스티셜, 모달 등) |
| `T` 사전 | pap-i18n.js | pap-i18n 의 setLang 만 |
| `_*Texts` 사전들 | pap-i18n.js | 각 사용 모듈 (search, subscription 등) |
| `lockScroll`/`unlockScroll` | pap-utils.js | 모든 모달 (subscription, home, content-*) |
| `escapeHtml` | pap-utils.js | content rendering 코드들 |
| `buildPagination` | pap-utils.js | content-editorial/film/article overlays |
| `isLoggedIn` | pap-auth.js | pap-subscription (isPremium 안에서) |
| `isStandardOrAbove` | pap-subscription.js | content open\* 함수들 (interstitial 게이트) |
| `isBetaActive` | pap-shell-bootstrap.js | pap-subscription, inline static HTMLs |
| `showPremiumInterstitial` | pap-subscription.js | content open\* 함수들 |
| `_resetCursorForModal` | pap-home.js | content open\* 함수들 (모달 열기 직전) |
| `edData` / `artData` / `filmAllData` | 각 content 모듈 | search, deep-link, api-sync |
| `edDetails` | pap-content-editorial.js | api-sync, seo 딥링크, all-editorials |

**모든 cross-module 참조는 호출 시점 (click / popstate / fetch 콜백) 에 resolve.** 모듈 로드 순서가 보장하므로 안전.

---

## 5. 미션 히스토리

| # | 미션 | commit | pap-app.js 라인 |
|---|---|---|---:|
| 0 | 백업 (브랜치 + 태그 생성) | `pre-harness-2026-05-02` | 4,258 |
| 1 | pap-app.js 분석 + breakdown | `d5f3576` | 4,258 |
| 2 | Auth 추출 → pap-auth.js | `b620822` | 4,201 |
| 3 | i18n 테이블 추출 → pap-i18n.js | `9281e23` | 4,099 |
| 4 | Search 추출 + `_searchTexts` 흡수 | `d1174ec` | 3,957 |
| 7 | Static 추출 + `_legalNoticeTexts` 흡수 | `9d3cb6f` | 3,911 |
| 5 | UI 유틸 추출 → pap-utils.js | `5d9ac06` | 3,722 |
| 6 | Subscription 추출 → pap-subscription.js | `66f526e` | 3,408 |
| 9 | 홈 인터랙션 추출 → pap-home.js | `753b543` | 2,478 |
| 8a | Content/Editorial → pap-content-editorial.js | `58d1ae7` | 1,871 |
| 8b | Content/Film → pap-content-film.js | `82a1376` | 1,613 |
| 8c | Content/Article → pap-content-article.js | `731ef3c` | 1,397 |
| 8d | Content/Creator+Shorts | `5d2d056` | 1,077 |
| 8e | Content/API Sync | `9238b9e` | 552 |
| 8f | Content/SEO + 딥링크 | `c7d92cf` | 340 |
| 10 | Subscription 인라인 사전 i18n 통합 | `8ab9841` | 340 |
| 11 | 잔여 부트스트랩 → pap-shell-bootstrap.js | `154632f` | **36** |

번호 순서 ≠ 시간 순서. 안전 우선 (가장 작고 isolated 한 것부터) 으로 미션 5 → 7 → 6 → 9 → 8\* 순서로 진행.

---

## 6. 검증 방식

### 6.1 미션 진행 시 4단계 수동 검증

각 미션마다:

1. **`node -c`** — 모든 변경 파일 syntax check
2. **byte-identity diff** — 추출 함수가 origin/main 의 원본과 byte 단위 동일한지 확인 (`git show origin/main:frontend/pap-app.js | awk` ↔ 새 파일)
3. **HTML 로드 순서 grep** — 모든 10개 HTML 의 script 태그가 의존성 순서대로인지 byte 오프셋 비교
4. **vm 통합 테스트** — Node `vm.createContext` 로 모든 모듈을 한 컨텍스트에 로드, cross-module 함수 호출 동작 검증

### 6.2 자동화된 CI 안전망 (✅ 완료)

`harness-refactor` 마무리 시점 (2026-05-02) 에 GitHub Actions 자동화 셋업 완료. 이제 모든 push / PR 마다 자동 실행.

**워크플로**: [`.github/workflows/test.yml`](.github/workflows/test.yml) — 2 jobs.

**Job 1 — `vm integration test`** (~6초, 모든 push + PR 에서 실행)

`npm test` → [tests/harness-integration.test.js](tests/harness-integration.test.js)
- Phase 1: 15개 모듈 vm 로드 (HTML 순서 그대로)
- Phase 2: 51개 public surface assertion (모든 window.X 함수, var X 데이터)
- Phase 3: 6개 cross-module 행동 검증 (`setLang` 전파, `isLoggedIn` 토큰 추적, `edImgError` 폴백, `navigateWithInterstitial`, beta 액세스 등)
- Phase 4: 10개 HTML × 15개 script 태그 순서

**Job 2 — `production smoke test`** (~6초, push to main 에서만 실행)

`npm run smoke` → [tests/production-smoke.test.js](tests/production-smoke.test.js)
- Phase 0: pap-i18n.js 의 mission-10 marker (`_interstitialUpsellTexts`) 가 production 에 나타날 때까지 폴링 (max 5분)
- Phase 1: 15개 모듈 production 200 OK + canonical marker grep
- Phase 2: index.html 의 15개 script 태그가 정확한 순서로 served
- Phase 3: `/api/auth/google` → 302 to Supabase, `/` → 200

**합계**: 91 assertions, 외부 npm 의존성 0개, Node 20 builtin fetch 사용.

**검증된 회귀 검출**: setLang 함수 삭제 시뮬레이션 → exit 1, 3개 의존 검증 명시 실패. CI 가 PR 머지 차단 가능.

**최초 성공 실행**: [run #25247375913](https://github.com/altakappa/pap-magazine-v2/actions/runs/25247375913) — 두 job 모두 6초 만에 통과.

---

## 7. 안전망 / 롤백

- **`pre-harness-2026-05-02` 태그** (commit `03c501d`) — 리팩터 이전 마지막 안정 상태
- **`harness-refactor` 브랜치** — origin 에 보존, 모든 미션 커밋 그대로
- **부분 revert 가능** — 각 미션 commit 단위로 되돌리기 가능

긴급 롤백 명령:
```bash
# 전체 리팩터 되돌리기
git reset --hard pre-harness-2026-05-02 && git push origin main --force-with-lease

# 특정 미션만 되돌리기
git revert <commit-hash> && git push origin main
```

---

## 8. 알려진 제약 / 미해결 사항

1. **`pap-app.js` 36줄 stub 잔존** — 캐시 호환성 위해 유지. 향후 cleanup 미션에서 10 HTML 의 script 태그 + 파일 함께 삭제 가능.
2. **`_papUpdateAuthDropdown` 의 인라인 9-lang 사전** (pap-auth.js 내부) — 3 키 × 9 langs 만이라 분리 비용보다 그대로 유지가 합리적. 향후 Auth 자체 인터페이스 정리 시 i18n 으로 흡수 가능.
3. **`pap-magazine-v5.html`** — 별도 alternate 페이지로, 자체 inline JS 보유. 본 리팩터 범위 외.
4. **이미 inline 복사본 가진 HTMLs** (404, magazine, mypage, auth, admin) — `pap-app.js` 를 안 로드하므로 새 모듈도 안 로드. 자체 inline 코드로 동작 (예: 404.html 의 `function toggleAccountMenu`). 의도된 패턴.
5. **HARNESS_CHECKLIST.md Phase 3 미진행**:
   - **AdminCMS** (`admin.html` 내부 inline JS, ~수천 줄)
   - **MyPage** (`mypage.html` inline JS)
   - **SubmissionFlow** (`submission.html`, `pullletter.html` inline JS)
   - **Community** (`community.html`, `community-v2.js`)
   - **Social** (`pap-social.js` 이미 분리됨, 추가 정리만 필요)
6. **사전-기존 버그: `/films/` (trailing slash) 에서 모듈 404** — 본 리팩터 무관, pre-harness 시점부터 존재. 원인: `films.html` 은 `<script src="pap-utils.js">` 같은 상대 경로 사용. 사용자가 `/films/` (슬래시 포함) 로 접근하면 브라우저가 `/films/pap-utils.js` 로 resolve → Vercel 404 → 페이지 깨짐. 사이트 내부 링크는 모두 `/films` (슬래시 없음) 또는 `films.html` → 308 → `/films` 패턴이라 정상 동작. 외부에서 `/films/` 로 직링크 들어오는 경우만 영향. 해결: 모든 HTML 의 상대 script src 를 절대 경로 (`/pap-X.js`) 로 변경. 작은 작업이지만 본 리팩터 범위 외 (별도 cleanup 미션).

---

## 9. 새 기능 추가 가이드

### 새 언어 추가
**`pap-i18n.js` 만 수정.** 8개 사전 (`T`, `_searchTexts`, `_legalNoticeTexts`, 4개 interstitial 사전) 에 새 lang 키 추가.

### 새 인증/구독 로직
- 토큰/세션 → `pap-auth.js`
- 등급 게이트 → `pap-subscription.js`

### 새 콘텐츠 타입 (예: 인터뷰 카테고리)
1. `pap-content-{type}.js` 신규 (기존 article 모듈을 템플릿으로)
2. `pap-content-api-sync.js` 에 데이터 fetch 추가
3. 10 HTML 에 script 태그 추가 (다른 content 모듈들과 같은 위치)

### 새 모달 / UI 유틸
- 모달 → `pap-static.js` (terms/privacy 와 비슷한 패턴)
- 공통 유틸 → `pap-utils.js`

### 인라인 onclick 참조 (`<button onclick="X()">`)
- 호출하는 함수가 어느 모듈에 있든 top-level 선언이면 자동으로 `window.X` 에 노출됨
- 함수가 IIFE 안이면 명시적으로 `window.X = X` 필요

---

## 10. 향후 작업 후보

### ✅ 완료된 1순위 (회귀 자동화)
~~`vm` 통합 테스트 + production smoke test → GitHub Actions~~ — §6.2 참조.

### 1순위 (남은)
- **상대 경로 script src → 절대 경로** — `/films/` (trailing slash) 에서 모듈 404 되는 사전-기존 버그 해결. 10 HTML 의 `<script src="pap-X.js">` → `<script src="/pap-X.js">` 변경. 작은 작업.

### 2순위 (Phase 3)
- **AdminCMS 추출** — `admin.html` inline JS 를 `pap-admin.js` 로
- **MyPage 추출** — `mypage.html` inline JS 를 `pap-mypage.js` 로
- **SubmissionFlow 추출** — `submission.html` + `pullletter.html` inline JS 정리
- **Community 정리** — `community-v2.js` 가 v2 면 v1 파일 어디 있는지 확인, dead code 제거

### 3순위 (cosmetic cleanup)
- `pap-app.js` 36줄 stub 완전 삭제 + 10 HTML 의 script 태그 제거
- `_papUpdateAuthDropdown` 의 인라인 사전 → `pap-i18n.js` 로 흡수
- 페이지별로 필요 없는 모듈 안 로드하는 최적화 (예: about.html 은 pap-content-creator-shorts.js 안 필요)

---

## 11. 빠른 레퍼런스

### 자주 쓰는 명령

```bash
# 자동 검증 (CI 가 매 push/PR 에 돌리는 것과 동일)
npm test                # vm 통합 테스트 (~600ms, offline)
npm run smoke           # production 검증 (Vercel 폴링 + ~6초)

# 현재 모듈 라인 수 확인
wc -l frontend/pap-*.js

# 특정 함수가 어느 모듈에 있는지
grep -l "function isLoggedIn" frontend/pap-*.js

# 모든 HTML 의 script 태그 순서 확인
for f in about articles business community contact films index pullletter submission subscribe; do
  grep -oE 'src="pap-[a-z0-9-]+\.js' frontend/$f.html
done

# 회귀 시뮬레이션 (의도적으로 함수 삭제 → 테스트 실패 확인 → 복구)
cp frontend/pap-i18n.js /tmp/backup
sed -i '' '/^function setLang(l){/,/^}$/d' frontend/pap-i18n.js
npm test  # exit 1, 실패 명시
cp /tmp/backup frontend/pap-i18n.js
npm test  # exit 0, 다시 통과
```

### 자주 헷갈리는 패턴

- **`var` vs `let`/`const` at top level**:
  - `var X` → `window.X` 에 자동 노출 (cross-script 가능)
  - `let X` / `const X` → script-local lexical binding (cross-script 가능하지만 `window.X` 는 undefined)
  - 본 리팩터에선 `lang`, `_searchTexts` 등은 의도적으로 `var` 사용
- **classic-script vs module**:
  - 우리 코드는 모두 classic script (`<script>` 태그, `defer` 사용 가능)
  - top-level `function X()` → 자동 `window.X` 노출
  - 따라서 명시적 `window.X = X` 는 IIFE 안에서 export 할 때만 필요

### 모듈 의존성 한눈에 보기

```
pap-utils  ← 누구도 의존 안 함 (foundational)
pap-i18n   ← 누구도 의존 안 함 (foundational)
pap-auth   ← (cross-script 의존 없음)
pap-search ← pap-i18n (lang, _searchTexts)
pap-static ← pap-i18n (_legalNoticeTexts)
pap-subscription ← pap-auth (isLoggedIn), pap-i18n (_interstitial*)
pap-home ← pap-utils (lockScroll/unlockScroll)
pap-content-* ← pap-utils, pap-i18n, pap-subscription (gate),
                pap-home (_resetCursorForModal), 그리고 다른 content 모듈
pap-shell-bootstrap ← 거의 모든 것 (popstate router 가 모든 close* 호출)
pap-app ← (stub, 의존 없음)
```

---

**작성**: Claude Code (Cowork 모드)
**리팩터 시작**: 2026-05-02 09:30 KST (commit `03c501d`)
**리팩터 완료**: 2026-05-02 17:00 KST (commit `154632f`)
**총 소요**: ~7.5시간, 13 commits, 14개 신규 모듈
