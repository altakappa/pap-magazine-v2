# PAP Magazine — 하네스 격리 체크리스트

> 작성일: 2026-05-02  
> 대상: Claude Code (또는 어떤 코딩 에이전트든)  
> 목표: 10개 하네스로 코드베이스 격리, 변경 사이드이펙트 최소화

---

## 1. 일반 원칙 (모든 하네스에 적용)

### 1.1 디렉토리/파일 명명 규칙

```
frontend/
├── shell/                  # Shell 하네스 (헤더, i18n, 등)
│   ├── pap-header.js
│   ├── pap-i18n.js
│   └── ...
├── auth/                   # Auth 하네스
│   ├── pap-auth.js
│   ├── auth.html (기존 위치 유지 가능)
│   └── ...
├── editorial/              # Content 하네스 (서브: editorial)
│   ├── pap-editorial.js
│   └── ...
├── subscription/
└── ...
```

또는 **prefix 명명** 방식 (디렉토리 안 옮기기):
```
frontend/
├── pap-shell-header.js
├── pap-shell-i18n.js
├── pap-auth.js
├── pap-content-editorial.js
├── pap-subscription.js
└── ...
```

→ **권장: prefix 방식**. 디렉토리 이동은 모든 import 경로 변경 필요해서 더 위험. prefix는 점진 가능.

### 1.2 하네스 간 통신 규칙

각 하네스가 다른 하네스에 노출하는 것은 다음 3가지만:

1. **localStorage 표준 키**:
   - `pap-token` (JWT)
   - `pap-user` (사용자 정보 JSON)
   - `pap-lang` (현재 언어)
   - `pap-cookie-consent` (쿠키 동의 상태)
   - `pap-{harness}-{key}` (하네스별 자체 데이터)

2. **REST API 엔드포인트**: `/api/{harness}/...` 만 호출

3. **window 전역 함수** (최소화):
   - `window.toggleNav()` (Shell이 export)
   - `window.setLang(lang)` (Shell이 export)
   - 다른 건 가능하면 import 형태로

### 1.3 변경 정책

- 한 PR/커밋 = 한 하네스
- 커밋 메시지: `feat(auth): ...`, `fix(content): ...`, `style(shell): ...`
- **여러 하네스 동시 변경 = 위험 신호**. 분리 가능한지 재검토.

### 1.4 각 하네스 분리 후 검증 체크리스트 (공통)

- [ ] 코드 syntax 검증 (`node -c`)
- [ ] 로컬에서 페이지 열어서 동작 확인 (가능한 경우)
- [ ] git diff 확인 — 의도 외 파일 변경 없는지
- [ ] 커밋 후 푸시 → Vercel 배포 Ready
- [ ] 라이브 사이트 (papkorea + pap-magazine 둘 다)에서 핵심 기능 검증
- [ ] 다른 하네스 페이지에서 회귀 없는지 확인

---

## 2. 작업 순서 (3 페이즈)

```
Phase 1 — 긴급 격리 (1~2주)
├── Auth
└── Subscription

Phase 2 — 핵심 격리 (2~3주)
├── Shell
├── AdminCMS
└── Content

Phase 3 — 점진적 격리 (1~2주)
├── MyPage
├── SubmissionFlow
├── Community
├── Social
└── Static
```

---

## 3. Phase 1 — 긴급 격리

### 🔒 하네스 1: Auth

**위험도**: 🔴 매우 높음 (모든 다른 하네스가 의존)  
**의존**: 없음 (가장 기반)  
**변경 빈도**: 낮아야 함 (한번 안정되면 거의 안 건드림)

#### 소유 파일 (Owns)

```
frontend/auth.html
frontend/pap-auth.js              ← 새로 생성, pap-app.js에서 추출
frontend/pap-auth-link.js          ← 기존, 정리해서 포함

api/auth/callback.js
api/auth/exchange.js
api/auth/facebook.js
api/auth/google.js
api/auth/kakao.js
api/auth/kakao-callback.js
api/auth/login.js
api/auth/logout.js
api/auth/me.js
api/auth/oauth-token.js
api/auth/send-code.js
api/auth/signup.js
api/auth/verify-code.js
```

#### 공개 인터페이스 (Public)

```js
// localStorage
'pap-token'        // JWT 문자열
'pap-user'         // {id, email, name, role, subscription} JSON

// window 전역
window.papAuth = {
  isLoggedIn(): boolean,
  getToken(): string | null,
  getUser(): object | null,
  logout(): void,
  redirectToLogin(returnUrl?: string): void
}
```

→ 다른 하네스는 위 인터페이스만 사용. 직접 `localStorage.getItem('pap-token')` 호출도 OK (역사적으로 그렇게 됐음).

#### 추출 작업 (Tasks)

- [ ] `pap-app.js`에서 다음 영역을 `pap-auth.js`로 이동:
  - 토큰/사용자 정보 관련 helper 함수
  - 로그아웃 로직
  - 로그인 상태 체크
- [ ] `auth.html`에서 인라인 JS 정리, `pap-auth.js`로 이동
- [ ] `api/auth/*` 13개 파일 그대로 유지 (이미 분리됨)
- [ ] 다른 페이지 HTML에서 `pap-auth.js` 로드 (token check만 필요한 페이지에는 minimal 버전)

#### 검증 (Validation)

- [ ] `papkorea.com/auth` Google 로그인 → mypage 이동 ✓
- [ ] `pap-magazine.com/auth` Google 로그인 → mypage 이동 ✓ ← **현재 깨짐, 이것도 같이 해결**
- [ ] 카카오 로그인 ✓
- [ ] 페이스북 로그인 ✓
- [ ] 이메일/비밀번호 로그인 ✓
- [ ] 회원가입 (이메일 인증코드) ✓
- [ ] 로그아웃 → 홈으로 이동 + localStorage 비워짐 ✓
- [ ] 비로그인 상태로 mypage 접근 → auth.html로 리다이렉트 ✓

#### Done 기준

- [ ] auth.html, mypage.html, subscribe.html 헤더 우측 상단의 사람 아이콘 메뉴가 로그인 상태에 따라 정확히 변함
- [ ] `pap-magazine.com`에서 OAuth 작동 ← **현재 미해결 과제**
- [ ] OAuth 회귀 테스트 시나리오를 README에 명시

---

### 💳 하네스 2: Subscription

**위험도**: 🔴 매우 높음 (결제 관련)  
**의존**: Auth  
**변경 빈도**: 낮음

#### 소유 파일

```
frontend/subscribe.html
frontend/pap-subscription.js      ← 신규 생성

api/subscriptions/checkout.js
api/subscriptions/guest-checkout.js
api/subscriptions/portal.js
api/portone-webhook.js
api/stripe-webhook.js              ← deprecated, 정리 또는 삭제
```

#### 공개 인터페이스

```js
// MyPage 하네스에서 사용
window.papSubscription = {
  getCurrentPlan(): 'free' | 'standard_monthly' | ... | null,
  openCheckout(plan): void,
  openPortal(): void  // 결제 관리 페이지
}
```

#### 추출 작업

- [ ] `subscribe.html`의 인라인 JS → `pap-subscription.js`로 이동
- [ ] PortOne 결제 연동 코드 분리
- [ ] mypage의 구독 카드 부분 → 이 하네스가 노출하는 컴포넌트로 분리
  - 예: `window.papSubscription.renderCard(elementId)`
- [ ] Stripe 관련 코드는 정리 (사용 안 함, deprecated 라벨)

#### 검증

- [ ] 비로그인 게스트 결제 (`guest-checkout.js`)
- [ ] 로그인 사용자 결제 → 구독 활성화
- [ ] 마이페이지 구독 카드 정확히 표시 (현재 플랜)
- [ ] 결제 portal 접근 (구독 취소/변경)
- [ ] PortOne webhook 정상 처리 (DB에 구독 정보 저장)

#### Done 기준

- [ ] subscribe.html에 인라인 JS 30줄 이하 (모두 pap-subscription.js로 이동)
- [ ] mypage 구독 카드가 pap-subscription.js의 함수로 렌더링
- [ ] 결제 webhook 변경해도 다른 하네스 영향 없음

---

## 4. Phase 2 — 핵심 격리

### 🐚 하네스 3: Shell

**위험도**: 🟠 높음 (모든 페이지 공통)  
**의존**: 없음 (다른 하네스의 기반)  
**변경 빈도**: 매우 낮아야 함

#### 소유 파일

```
frontend/pap-styles.css           # 전역 스타일
frontend/pap-header.js            # 헤더 + 햄버거 메뉴
frontend/pap-i18n.js              ← 신규, pap-app.js에서 추출
frontend/pap-geo-lang.js          # 지리 기반 언어 자동 감지
frontend/cookie-consent.js        # 쿠키 동의 배너
frontend/pap-api.js               # API 클라이언트 (fetch wrapper)
frontend/pap-img-fallback.js      # 이미지 에러 처리
frontend/pap-lightbox.js          # 이미지 라이트박스
frontend/pap-search.js            ← 신규, pap-app.js의 검색 로직 추출
frontend/pap-reveal.js            # 스크롤 리빌 애니메이션

api/_lib/cors.js
api/_lib/auth.js
api/_lib/supabase.js
api/_lib/email.js
api/_lib/imageOptimize.js
api/_lib/upload.js
api/_lib/csrf.js
api/_lib/rateLimit.js
api/_lib/validate.js
```

#### 공개 인터페이스

```js
// 모든 페이지에서 사용 가능
window.toggleNav()                 // 햄버거 메뉴 열기/닫기
window.toggleSearch()              // 검색바 열기/닫기
window.setLang(lang)               // 언어 전환
window.papApi = {                  // API 클라이언트
  get(path, opts),
  post(path, body, opts),
  put(path, body, opts),
  delete(path, opts)
}
window.PAP = {                     // UI 유틸 (toast 등)
  ui: { toast(msg, type) }
}
```

#### 추출 작업

- [ ] `pap-app.js`에서 i18n 테이블 (`var T = {ko:{...},en:{...},...}`) → `pap-i18n.js`로 이동
- [ ] `pap-app.js`에서 검색 로직 (`searchEditorials`, `searchInput` handler 등) → `pap-search.js`로 이동
- [ ] `pap-header.js`는 그대로 두고 위 두 모듈 의존 명시
- [ ] 모든 HTML 페이지가 Shell 모듈을 표준 순서로 로드:
  ```html
  <link rel="stylesheet" href="pap-styles.css">
  <script src="pap-i18n.js"></script>
  <script src="pap-api.js"></script>
  <script src="pap-header.js"></script>
  <script src="pap-search.js"></script>
  <script src="cookie-consent.js"></script>
  ```

#### 검증

- [ ] 모든 페이지에서 헤더 햄버거 메뉴 정상 작동
- [ ] 언어 전환 시 모든 페이지의 텍스트가 정확히 번역됨
- [ ] 쿠키 동의 배너 한 번 닫으면 다시 안 뜸
- [ ] 검색이 모든 페이지에서 작동
- [ ] 모바일 메뉴 (햄버거) 정상 작동

#### Done 기준

- [ ] `pap-app.js`가 5,000줄 이하 (현재 10,000+)
- [ ] i18n 변경 시 `pap-i18n.js`만 수정하면 모든 페이지 적용
- [ ] 새 페이지 추가 시 5줄 표준 로드만으로 헤더/메뉴/검색 작동

---

### 🛠️ 하네스 4: AdminCMS

**위험도**: 🔴 (관리자 권한)  
**의존**: Auth (admin role 필요)  
**변경 빈도**: 중간

#### 소유 파일

```
frontend/admin.html
frontend/pap-admin.js             ← 신규 생성, admin.html 인라인 JS 분리
frontend/data-migration.html

api/admin/members.js
api/admin/member-update.js
api/admin/member-delete.js
api/admin/stats.js

# 에디토리얼 작성 부분 (이게 admin이 vs content인지 결정 필요)
api/editorials/[id].js  (관리자만 PUT/DELETE 가능, GET은 public)
```

#### 추출 작업

- [ ] `admin.html` 인라인 JS (현재 거대) → `pap-admin.js`로 이동
- [ ] `data-migration.html`의 일회성 마이그레이션 도구 정리 (사용 안 하면 보관 폴더로)
- [ ] 에디토리얼 작성 폼 (관리자 페이지 안의 큰 부분) → `pap-admin-editorial.js`로 분리

#### 검증

- [ ] 관리자 로그인으로 admin 페이지 접근
- [ ] 비관리자 → admin 페이지 차단 (auth.html로 리다이렉트)
- [ ] 회원 목록 조회/수정/삭제
- [ ] 에디토리얼 작성 (모든 필드 + 갤러리 + 크레딧)
- [ ] 에디토리얼 수정/삭제

#### Done 기준

- [ ] admin.html 안의 JS 100줄 이하 (모두 pap-admin.js로)
- [ ] 관리자 권한 체크가 한 곳 (`pap-admin.js` 진입 시)에서만

---

### 📚 하네스 5: Content

**위험도**: 🟡 중간  
**의존**: Auth (선택적, 로그인 표시용), Social (댓글)  
**변경 빈도**: 낮음 (콘텐츠는 admin이 추가)

#### 소유 파일

```
frontend/index.html              # 홈 (히어로 + 에디토리얼 섹션)
frontend/magazine.html           # 매거진 (전체 에디토리얼 목록)
frontend/articles.html
frontend/films.html
frontend/pap-content.js          ← 신규, pap-app.js에서 콘텐츠 표시 로직 추출
frontend/data/editorials.json
frontend/data/editorial-details.json
frontend/data/articles.json
frontend/data/films.json
frontend/data/shorts.json
frontend/data/creators.json

api/editorials/index.js
api/editorials/[id].js  (GET 부분, PUT/DELETE는 Admin)
api/articles/index.js
api/articles/[id].js
api/films/index.js
api/films/[id].js
api/shorts/index.js
api/shorts/[id].js
api/ads/index.js                 # 콘텐츠 사이의 광고 카드
```

#### 공개 인터페이스

```js
window.papContent = {
  openEditorial(slug),
  openArticle(slug),
  openFilm(slug),
  // 다른 하네스가 콘텐츠 페이지로 이동시킬 때 사용
}
```

#### 추출 작업

- [ ] `pap-app.js`에서 다음 함수들 → `pap-content.js`로 이동:
  - `_openEditorialInner`, `_resolveEditorialName`, `_normalizeIssueLabel`
  - `_populateEdDetailsFromApi`, `apiEditorialToLocal`
  - `_updateEditorialMeta`, `_resetEditorialMeta`
  - 에디토리얼 갤러리 + 크레딧 렌더링
  - 아티클/필름 카드 렌더링
- [ ] 데이터 fetch 함수 표준화 (papApi 사용)

#### 검증

- [ ] 홈 페이지에서 에디토리얼 클릭 → 상세 표시
- [ ] 매거진 페이지에서 페이지네이션
- [ ] 아티클/필름 페이지 정상 표시
- [ ] 에디토리얼 직접 링크 (`/#editorial/slug`) 동작
- [ ] SEO 메타 태그 동적 변경 (에디토리얼 열 때)

#### Done 기준

- [ ] `pap-app.js`가 2,000줄 이하
- [ ] 새 콘텐츠 타입 추가 시 (예: 인터뷰 카테고리) 패턴 따라 쉽게 추가

---

## 5. Phase 3 — 점진적 격리

### 👤 하네스 6: MyPage

**파일**: `mypage.html`, `pap-mypage.js`, `data-deletion.html`, `api/auth/me`  
**의존**: Auth (필수), Subscription (구독 카드), SubmissionFlow (제출 내역)

**주의**: MyPage는 다른 하네스의 위젯을 모아놓는 컨테이너로 가는 게 좋음:
- 구독 카드 = Subscription 하네스가 제공
- 제출 내역 = SubmissionFlow 하네스가 제공
- 다운로드 키트 = (별도 작은 하네스 또는 MyPage 안)

**Done**: mypage.html 안의 각 섹션이 해당 하네스 함수로 렌더링

---

### 📤 하네스 7: SubmissionFlow

**파일**: `submission.html`, `pullletter.html`, `pap-submission.js`, `pap-pullletter.js`, `submission-terms.js`, `api/submissions/*`, `api/pullletters/*`  
**의존**: Auth (선택)

**주의**: 작품 제출 + 풀레터 요청을 묶음. 둘 다 "사용자가 폼 제출" 패턴이라 검증/UI 코드 공유 가능.

---

### 💬 하네스 8: Community

**파일**: `community.html`, `community-v2.js`, `api/community/*` (8개 서브)  
**의존**: Auth (필수)

**정리 필요**:
- [ ] `community.html` vs `community_updated.html` 어느 게 운영 중인지 확인 후 다른 거 삭제
- [ ] `community-v2.js`가 v2면 v1은 어디?

---

### 💭 하네스 9: Social

**파일**: `pap-social.js`  
**의존**: Auth (로그인 필요)

**용도**: 댓글 + 별점. 현재 에디토리얼에서만 사용. 향후 아티클/필름으로 확장 가능하게 분리.

**Done**: `window.papSocial.mount(targetEl, contentType, contentId)` 식의 인터페이스로 깔끔하게.

---

### 📄 하네스 10: Static

**파일**:
- `about.html`, `business.html`, `contact.html` (정보 페이지)
- `terms.html`, `privacy.html`, `data-deletion.html` (법적 페이지)
- `404.html` (에러)
- `api/sitemap.js`, `frontend/robots.txt` (SEO)
- `api/translate/index.js` (AI 번역, 거의 안 쓰임)
- `beta-notice.js` (베타 안내)

**특징**: 거의 안 변경. 변경해도 다른 곳 영향 없음.

**Done**: 하네스 디렉토리 또는 prefix만 통일, 추가 작업 거의 없음.

---

## 6. 페이지별 로드 매트릭스

각 페이지가 어떤 하네스의 JS를 로드해야 하는지 표준화:

| 페이지 | Shell | Auth | Content | Subscription | Social | Other |
|---|---|---|---|---|---|---|
| `index.html` | ✅ | minimal | ✅ | — | — | — |
| `magazine.html` | ✅ | minimal | ✅ | — | — | — |
| `articles.html` | ✅ | minimal | ✅ | — | — | — |
| `films.html` | ✅ | minimal | ✅ | — | — | — |
| `auth.html` | ✅ | ✅ full | — | — | — | — |
| `mypage.html` | ✅ | ✅ full | — | ✅ widget | — | MyPage, SubmissionFlow widgets |
| `subscribe.html` | ✅ | minimal | — | ✅ full | — | — |
| `submission.html` | ✅ | minimal | — | — | — | SubmissionFlow |
| `pullletter.html` | ✅ | minimal | — | — | — | SubmissionFlow |
| `community.html` | ✅ | ✅ full | — | — | — | Community |
| `admin.html` | ✅ | ✅ admin | — | — | — | AdminCMS |
| `about.html` etc | ✅ | minimal | — | — | — | — |

**minimal Auth** = 토큰 체크만 (로그인 안 되어 있어도 페이지 동작)  
**full Auth** = 로그인 안 되면 redirect

---

## 7. 우선순위 작업 — Claude Code 첫 미션

### 미션 0 (사전 준비) — 보존

```bash
# 현재 상태 백업
cd ~/Documents/문서/PAP_Magazine_Deploy
git checkout -b harness-refactor
git tag pre-harness-2026-05-02
```

### 미션 1: pap-app.js 분석 + 분할 계획서 작성

Claude Code에 다음을 시켜보세요:

```
"frontend/pap-app.js 파일을 분석해서 어느 부분이 어느 하네스 소관인지 
줄 번호 단위로 매핑해줘. HARNESS_CHECKLIST.md 참고해.
결과를 PAP_APP_BREAKDOWN.md 로 저장해줘."
```

### 미션 2: Auth 하네스 추출 (가장 긴급)

```
"PAP_APP_BREAKDOWN.md 보고 Auth 관련 코드를 pap-auth.js로 추출해줘.
1. pap-app.js에서 해당 코드 제거
2. pap-auth.js 새 파일 생성
3. auth.html에 새 파일 로드 추가
4. node -c 로 syntax 검증
5. git commit + push
6. Vercel 배포 ready 후 papkorea.com에서 OAuth 동작 확인"
```

### 미션 3: pap-magazine.com OAuth 미해결 이슈 진단

```
"www.pap-magazine.com에서 OAuth 안 되는 문제를 진단해줘.
HARNESS_CHECKLIST.md의 Auth 섹션 참고. 
디버그 로그 추가하고 Vercel 로그 분석해서 정확한 원인 찾아줘."
```

---

## 8. 위험 시나리오 (사전 대비)

| 시나리오 | 대비책 |
|---|---|
| 하네스 분리 중 papkorea.com 깨짐 | `git tag pre-harness-2026-05-02` 백업 → 즉시 revert 가능 |
| `pap-app.js` 분리 시 의존성 누락 | 각 단계마다 `node -c` + 페이지 열어서 콘솔 에러 체크 |
| import 순서 문제 (pap-i18n.js가 pap-header.js보다 먼저 로드되어야 함) | HTML에서 명시적 순서로 script 태그 배치 |
| 같은 함수가 여러 곳에서 쓰이는데 하나만 옮김 | 분리 후 grep으로 사용처 모두 검증 |
| Vercel 배포 후 모바일에서만 깨짐 | 배포 후 `papkorea` + `pap-magazine` × `데스크톱` + `모바일` = 4개 케이스 검증 |

---

## 9. 다음 작업

이 문서를 가지고:

1. **터미널에서 Claude Code 실행**:
   ```bash
   cd ~/Documents/문서/PAP_Magazine_Deploy
   claude
   ```

2. **첫 메시지**:
   ```
   HARNESS_CHECKLIST.md 읽어줘. 우리 프로젝트의 하네스 격리 작업을 시작하려고 해.
   먼저 미션 0 (백업) 부터 차례대로 진행해줘.
   ```

3. **각 미션 완료 시**:
   - PR 또는 commit 단위로 작업
   - 각 하네스 분리 후 papkorea + pap-magazine에서 회귀 테스트
   - 막히는 부분 있으면 Cowork(데스크톱 Claude)로 와서 시각/UX 검토

---

## 10. 참고: 하네스 최종 매트릭스

```
┌─────────────────────────────────────────────────────────────┐
│  Shell (모든 페이지의 기반)                                    │
│  pap-styles.css, pap-header.js, pap-i18n.js,                │
│  pap-api.js, cookie-consent.js, etc.                        │
└─────────────────────────────────────────────────────────────┘
              ↑                                          ↑
              │                                          │
   ┌──────────┴──────────┐                ┌─────────────┴────────────┐
   │                     │                │                          │
┌──┴───┐  ┌──────────┐  ┌┴────────┐  ┌──┴──────┐  ┌──────────┐  ┌──┴──────┐
│ Auth │  │ Content  │  │  Sub-   │  │ Comm-   │  │  Social  │  │  Static │
│  🔒  │  │  📚      │  │script   │  │unity 💬 │  │   💭     │  │   📄    │
│      │  │          │  │ 💳      │  │         │  │          │  │         │
└──┬───┘  └──────────┘  └─┬───────┘  └─────────┘  └──────────┘  └─────────┘
   │                      │
   │  의존                │
   ▼                      ▼
┌──────────┐  ┌──────────────┐
│ MyPage   │  │ SubmissionFlow│
│   👤     │  │   📤          │
└──────────┘  └──────────────┘

격리 1순위:  Auth, Subscription
격리 2순위:  Shell, AdminCMS, Content
격리 3순위:  나머지
```

---

**작성**: Claude (Cowork 모드)  
**Phase 1 시작 전 검토 필수**: 도메니코의 OK 받은 후 Claude Code로 실행
