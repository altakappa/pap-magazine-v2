# PAP Magazine Backend Integration Guide

## 프로젝트 구조

```
PAP_Magazine_Deploy/
├── frontend/
│   ├── js/
│   │   ├── pap-backend.js              # 메인 통합 모듈 (1002 라인, 29KB)
│   │   ├── supabase-schema.sql         # 데이터베이스 스키마 (355 라인)
│   │   ├── stripe-webhook.js           # Stripe 웹훅 핸들러 (526 라인)
│   │   ├── README.md                   # 기본 사용법
│   │   ├── QUICK_REFERENCE.md          # 빠른 참고 카드
│   │   ├── BACKEND_SETUP.md            # 완전한 설정 가이드
│   │   └── INTEGRATION_GUIDE.md        # 이 파일
│   ├── index.html
│   ├── auth.html
│   ├── subscribe.html
│   ├── submission.html
│   ├── pullletter.html
│   └── (다른 HTML 파일들)
```

---

## 5단계 통합 체크리스트

### 1단계: 데이터베이스 설정 (15분)

**목표:** Supabase 데이터베이스 생성 및 스키마 설정

```bash
# 1. Supabase 계정 생성
# 2. 새 프로젝트 생성
# 3. SQL Editor에서 supabase-schema.sql 실행
# 4. Storage 버킷 3개 생성: avatars, submissions, pullletters
```

**확인:**
```sql
-- SQL Editor에서 실행하여 테이블 확인
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
```

**저장할 정보:**
- Project URL: `https://xxxxx.supabase.co`
- Anon Key: `eyJhbGc...`
- Service Key: `eyJhbGc...` (웹훅용)

---

### 2단계: Stripe 설정 (20분)

**목표:** Stripe 결제 통합 설정

```bash
# 1. Stripe 계정 생성 (https://stripe.com)
# 2. Products에서 4가지 플랜 생성:
#    - Standard (monthly: $9.99, yearly: $99.99)
#    - Premium (monthly: $19.99, yearly: $199.99)
# 3. Webhook endpoint 추가
```

**각 플랜별 설정:**

```
Standard Monthly
├─ Amount: $9.99
├─ Billing Period: Monthly
└─ Price ID: price_xxxxx (복사)

Standard Yearly
├─ Amount: $99.99
├─ Billing Period: Yearly
└─ Price ID: price_xxxxx (복사)

Premium Monthly
├─ Amount: $19.99
├─ Billing Period: Monthly
└─ Price ID: price_xxxxx (복사)

Premium Yearly
├─ Amount: $199.99
├─ Billing Period: Yearly
└─ Price ID: price_xxxxx (복사)
```

**Webhook 설정:**
```
Endpoint URL: https://your-domain.com/api/stripe-webhook
Events:
  ✓ checkout.session.completed
  ✓ customer.subscription.updated
  ✓ customer.subscription.deleted
  ✓ invoice.payment_succeeded
  ✓ invoice.payment_failed
```

**저장할 정보:**
- Publishable Key: `pk_live_xxxxx`
- Secret Key: `sk_live_xxxxx`
- Webhook Secret: `whsec_xxxxx`

---

### 3단계: 백엔드 함수 배포 (30분)

**목표:** Stripe 웹훅 및 결제 함수 배포

#### 옵션 A: Vercel (권장)

```bash
# 1. Vercel 계정 생성 및 GitHub 연동
# 2. 프로젝트 폴더 구조:
#    api/
#    ├─ stripe-webhook.js
#    ├─ create-checkout-session.js
#    └─ cancel-subscription.js

# 3. 환경 변수 설정 (Vercel Dashboard)
# 4. 배포
vercel deploy
```

**환경 변수:**
```
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_KEY=eyJhbGc... (웹훅용)
```

#### 옵션 B: Netlify

```bash
# 1. netlify.toml 생성
# 2. functions/ 폴더에 함수 배치
# 3. Netlify Dashboard > Environment에서 환경 변수 설정
# 4. 배포
netlify deploy
```

**배포 후:**
1. 배포 URL 확인
2. Stripe Webhook URL 업데이트
3. 테스트 이벤트 전송

---

### 4단계: 프론트엔드 통합 (20분)

**목표:** HTML 페이지에 pap-backend.js 추가

#### 단계 1: 스크립트 포함

모든 HTML 파일의 `</body>` 전에 추가:

```html
<!-- 선택: 환경변수 설정 -->
<script>
  window.PAP_CONFIG = {
    SUPABASE_URL: 'https://xxxxx.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGc...',
    STRIPE_PUBLIC_KEY: 'pk_live_xxxxx',
  };
</script>

<!-- 필수: 백엔드 스크립트 -->
<script src="js/pap-backend.js"></script>
```

#### 단계 2: 페이지별 기능 추가

**index.html (홈페이지):**
```javascript
// 현재 사용자 표시
if (papAuth.isLoggedIn()) {
  const user = papAuth.getUser();
  document.getElementById('username').textContent = user.email;
}
```

**auth.html (인증 페이지):**
```javascript
// 로그인/회원가입 폼 이벤트 처리
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { user, error } = await papAuth.signIn(email, password);
  if (!error) {
    window.location.href = '/dashboard.html';
  } else {
    alert('Error: ' + error);
  }
});
```

**subscribe.html (구독 페이지):**
```javascript
// 플랜 선택 및 결제
document.querySelectorAll('.plan-button').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    const planId = e.target.dataset.planId;
    await papPayment.redirectToCheckout(planId);
  });
});
```

**submission.html (제출 페이지):**
```javascript
// 파일 업로드 및 폼 제출
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // 파일 업로드
  const { url: fileUrl } = await papSubmit.uploadFile(file, 'submissions');

  // 폼 제출
  const { submission, error } = await papSubmit.submitEditorial({
    title: form.title.value,
    description: form.description.value,
    file_urls: [fileUrl],
  });

  if (!error) {
    alert('Submitted successfully!');
  }
});
```

#### 단계 3: 선택 - 보호된 페이지

일부 페이지는 로그인 필수로 설정:

```javascript
// dashboard.html 상단
window.addEventListener('load', () => {
  if (!papAuth.isLoggedIn()) {
    window.location.href = '/auth.html';
  }
});
```

---

### 5단계: 테스트 및 배포 (25분)

**목표:** 모든 기능 테스트 후 프로덕션 배포

#### 테스트 체크리스트

```
인증 (Authentication)
  ☐ 회원가입
  ☐ 이메일 확인
  ☐ 로그인
  ☐ Google OAuth
  ☐ Apple OAuth
  ☐ 비밀번호 재설정
  ☐ 로그아웃

프로필 (Profile)
  ☐ 프로필 조회
  ☐ 프로필 수정
  ☐ 아바타 업로드

결제 (Payment)
  ☐ Checkout 세션 생성
  ☐ Stripe 결제 페이지 표시
  ☐ 테스트 카드로 결제
  ☐ Webhook 수신 확인
  ☐ DB에 구독 정보 저장

파일 업로드 (File Upload)
  ☐ 단일 파일 업로드
  ☐ 여러 파일 업로드
  ☐ 파일 크기 제한 확인

폼 제출 (Form Submission)
  ☐ 편집 자료 제출
  ☐ 풀레터 요청
  ☐ DB에 저장 확인
```

#### 로컬 테스트

```bash
# 개발 서버 실행
vercel dev    # Vercel
# 또는
netlify dev   # Netlify

# 테스트 URL
http://localhost:3000
```

#### Stripe 테스트 카드

```
성공 결제:  4242 4242 4242 4242
결제 실패:  4000 0000 0000 0002
거부됨:     4000 0000 0000 9995

만료일: 아무 미래 날짜 (예: 12/25)
CVC: 아무 3자리 숫자 (예: 123)
```

#### 프로덕션 배포

```bash
# 1. API 키를 환경변수로 변경
# 2. Stripe live keys 설정
# 3. 최종 테스트
# 4. 배포
vercel deploy --prod
# 또는
netlify deploy --prod
```

---

## 주요 기능별 구현 예제

### 1. 사용자 인증

```javascript
// auth.html에 추가
const form = document.getElementById('authForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const { user, error } = await papAuth.signIn(
    emailInput.value,
    passwordInput.value
  );

  if (error) {
    alert('로그인 실패: ' + error);
  } else {
    alert('로그인 성공!');
    window.location.href = '/dashboard.html';
  }
});
```

### 2. 구독 관리

```javascript
// subscribe.html에 추가
const btn = document.getElementById('subscribe-premium');

btn.addEventListener('click', async () => {
  // 로그인 확인
  if (!papAuth.isLoggedIn()) {
    alert('먼저 로그인해주세요');
    window.location.href = '/auth.html';
    return;
  }

  // 결제 시작
  await papPayment.redirectToCheckout('premium_monthly');
});
```

### 3. 파일 업로드 및 폼 제출

```javascript
// submission.html에 추가
const form = document.getElementById('submissionForm');
const fileInput = document.getElementById('file');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // 1. 파일 업로드
  const { url: fileUrl, error: uploadError } = await papSubmit.uploadFile(
    fileInput.files[0],
    'submissions'
  );

  if (uploadError) {
    alert('파일 업로드 실패: ' + uploadError);
    return;
  }

  // 2. 폼 제출
  const { submission, error: submitError } = await papSubmit.submitEditorial({
    title: document.getElementById('title').value,
    description: document.getElementById('description').value,
    file_urls: [fileUrl],
    credits: document.getElementById('credits').value,
  });

  if (submitError) {
    alert('제출 실패: ' + submitError);
  } else {
    alert('제출되었습니다!');
    form.reset();
  }
});
```

### 4. 사용자 대시보드

```javascript
// dashboard.html에 추가
window.addEventListener('load', async () => {
  // 로그인 확인
  if (!papAuth.isLoggedIn()) {
    window.location.href = '/auth.html';
    return;
  }

  // 프로필 조회
  const { profile, error } = await papUser.getProfile();

  if (!error && profile) {
    document.getElementById('userName').textContent = profile.name;
    document.getElementById('userEmail').textContent = profile.email;
    document.getElementById('userAvatar').src = profile.avatar_url;
  }

  // 구독 정보 조회
  const { subscription } = await papUser.getSubscription();

  if (subscription) {
    document.getElementById('plan').textContent = subscription.plan;
    document.getElementById('status').textContent = subscription.status;
  }
});
```

---

## 문제 해결

### 로그인이 작동하지 않음

```javascript
// 1. 콘솔 확인
console.log('Supabase initialized:', supabaseClient !== null);
console.log('Current user:', papAuth.getUser());

// 2. API 키 확인
console.log('Config:', window.PAP_CONFIG);

// 3. Supabase 권한 확인
// Settings > Authentication > Email Auth 활성화 여부
```

### 결제가 작동하지 않음

```javascript
// 1. Stripe 초기화 확인
console.log('Stripe loaded:', stripeInstance !== null);

// 2. Public Key 확인 (pk_로 시작)
console.log('Stripe key:', window.PAP_CONFIG.STRIPE_PUBLIC_KEY);

// 3. 서버리스 함수 배포 확인
// Vercel/Netlify Dashboard에서 함수 상태 확인
```

### 파일 업로드 실패

```javascript
// 1. 파일 크기 확인 (10MB 제한)
console.log('File size:', file.size / 1024 / 1024, 'MB');

// 2. 버킷 권한 확인
// Supabase > Storage > RLS 정책 확인

// 3. 로그인 상태 확인
console.log('User logged in:', papAuth.isLoggedIn());
```

---

## 성능 최적화

### 1. 번들 크기 축소

```html
<!-- 사용하지 않는 기능 제거 후 트리 쉐이킹 -->
<!-- pap-backend.js는 1002 라인, 약 29KB로 이미 최적화됨 -->
```

### 2. 캐싱

```javascript
// 사용자 정보 캐싱
const cachedProfile = window.PAP.utils.getStorageItem('profile');
if (cachedProfile) {
  updateUI(cachedProfile);
} else {
  const { profile } = await papUser.getProfile();
  window.PAP.utils.setStorageItem('profile', profile);
}
```

### 3. 라이브러리 로딩

```javascript
// pap-backend.js가 자동으로 CDN에서 로드합니다
// - Supabase: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
// - Stripe: https://js.stripe.com/v3/
```

---

## 보안 체크리스트

```
코드 레벨
  ☐ API 키를 환경변수로 관리
  ☐ .env.local을 .gitignore에 추가
  ☐ RLS 정책 활성화 확인
  ☐ HTTPS 사용

Supabase
  ☐ Row Level Security (RLS) 활성화
  ☐ 인증 공급자 설정 (Google, Apple)
  ☐ API 키 로테이션 주기 설정

Stripe
  ☐ Webhook 서명 검증
  ☐ Restricted API key 사용 검토
  ☐ 테스트 키와 라이브 키 분리

배포
  ☐ 환경변수 암호화 저장
  ☐ CI/CD 보안 정책 설정
  ☐ 의존성 보안 취약점 스캔
```

---

## 다음 단계

### 1단계 (선택사항): 이메일 알림

```javascript
// SendGrid 또는 Mailgun 연동
// 결제 확인, 제출 승인 등의 이메일 발송
```

### 2단계 (선택사항): 관리자 패널

```javascript
// /admin.html에서 제출물 검토
// 구독 정보 관리
// 사용자 통계 조회
```

### 3단계 (선택사항): 분석

```javascript
// Google Analytics 또는 Mixpanel 추가
// 사용자 행동 추적
// 결제 퍼널 분석
```

### 4단계 (선택사항): 모니터링

```javascript
// Sentry로 에러 모니터링
// DataDog으로 성능 모니터링
// 실시간 알림 설정
```

---

## 지원 및 문서

| 주제 | 파일 |
|------|------|
| 전체 설정 | `BACKEND_SETUP.md` |
| 빠른 참고 | `QUICK_REFERENCE.md` |
| 기본 사용법 | `README.md` |
| 통합 가이드 | `INTEGRATION_GUIDE.md` (이 파일) |

| 외부 문서 | 링크 |
|----------|------|
| Supabase 문서 | https://supabase.com/docs |
| Stripe 문서 | https://stripe.com/docs |
| Vercel 배포 | https://vercel.com/docs |
| Netlify 배포 | https://docs.netlify.com |

---

## 예상 타이밍

| 단계 | 소요 시간 | 난이도 |
|------|---------|--------|
| 1. DB 설정 | 15분 | 쉬움 |
| 2. Stripe 설정 | 20분 | 쉬움 |
| 3. 백엔드 배포 | 30분 | 중간 |
| 4. 프론트엔드 통합 | 20분 | 쉬움 |
| 5. 테스트 및 배포 | 25분 | 중간 |
| **총합** | **110분 (약 2시간)** | |

---

**현재 완료도:** 0%

**다음 작업:**
1. Supabase 계정 생성
2. 데이터베이스 스키마 설정
3. Stripe 계정 생성 및 제품 설정
4. 백엔드 함수 배포
5. HTML 페이지에 스크립트 포함
6. 각 페이지별 기능 구현
7. 테스트 실행
8. 프로덕션 배포

---

**버전:** 1.0.0
**마지막 업데이트:** 2026년 4월
**작성자:** PAP Magazine Development Team
