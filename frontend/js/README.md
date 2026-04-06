# PAP Magazine Backend Integration

완전한 백엔드 통합 모듈입니다. Supabase + Stripe를 사용하여 인증, 결제, 파일 업로드, 폼 제출 기능을 제공합니다.

## 파일 구조

```
js/
├── pap-backend.js           # 메인 통합 모듈 (프론트엔드)
├── supabase-schema.sql      # 데이터베이스 스키마
├── stripe-webhook.js        # Stripe 웹훅 핸들러 (백엔드)
├── BACKEND_SETUP.md         # 상세 설정 가이드
└── README.md               # 이 파일
```

## 빠른 시작

### 1. HTML 페이지에 포함

```html
<script src="js/pap-backend.js"></script>
```

### 2. 백엔드 설정

`pap-backend.js` 상단의 `PAP_CONFIG`를 수정:

```javascript
const PAP_CONFIG = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGc...',
  STRIPE_PUBLIC_KEY: 'pk_live_xxxxx',
};
```

### 3. 기능 사용

#### 인증 (Authentication)

```javascript
// 회원가입
const { user, error } = await papAuth.signUp(
  'user@example.com',
  'password123',
  'User Name'
);

// 로그인
const { user, session, error } = await papAuth.signIn(
  'user@example.com',
  'password123'
);

// Google/Apple 로그인
await papAuth.signInWithProvider('google');

// 로그아웃
await papAuth.signOut();

// 현재 사용자
const user = papAuth.getUser();

// 로그인 여부 확인
if (papAuth.isLoggedIn()) {
  console.log('User logged in');
}

// 인증 상태 변경 리스너
papAuth.onAuthStateChange((user) => {
  console.log('Auth state changed:', user);
});
```

#### 사용자 프로필 (User Profile)

```javascript
// 프로필 가져오기
const { profile, error } = await papUser.getProfile();

// 프로필 수정
const { profile, error } = await papUser.updateProfile({
  name: 'New Name',
  bio: 'User biography',
});

// 구독 정보 확인
const { subscription, error } = await papUser.getSubscription();

// 아바타 업로드
const { url, error } = await papUser.uploadAvatar(file);
```

#### 결제 (Payment)

```javascript
// 결제 페이지로 리다이렉트
await papPayment.redirectToCheckout('premium_monthly');

// 또는 URL만 가져오기
const { url, error } = await papPayment.createCheckout('standard_yearly');

// 구독 취소
const { error } = await papPayment.cancelSubscription();
```

**플랜 ID:**
- `free` - Free 플랜 (자동 활성화)
- `standard_monthly` - Standard 월간 ($9.99)
- `standard_yearly` - Standard 연간 ($99.99)
- `premium_monthly` - Premium 월간 ($19.99)
- `premium_yearly` - Premium 연간 ($199.99)

#### 파일 업로드 (File Upload)

```javascript
// 단일 파일 업로드
const { url, path, error } = await papSubmit.uploadFile(file, 'submissions');

// 여러 파일 업로드
const { urls, errors } = await papSubmit.uploadFiles(fileList, 'submissions');
```

**버킷:**
- `submissions` - 편집 자료 업로드
- `pullletters` - 풀레터 파일

#### 폼 제출 (Form Submission)

```javascript
// 편집 자료 제출
const { submission, error } = await papSubmit.submitEditorial({
  title: 'My Article Title',
  description: 'Article description',
  file_urls: ['https://...'],
  credits: 'Photo credit',
});

// 풀레터 요청
const { pulletter, error } = await papSubmit.submitPullLetter({
  request_text: 'Pull letter request text',
  file_urls: ['https://...'],
});
```

## 제공되는 개체

### `papAuth` - 인증 모듈

| 메서드 | 설명 |
|--------|------|
| `signUp(email, password, name)` | 회원가입 |
| `signIn(email, password)` | 로그인 |
| `signInWithProvider(provider)` | OAuth (google, apple) |
| `signOut()` | 로그아웃 |
| `getUser()` | 현재 사용자 |
| `getSession()` | 현재 세션 |
| `isLoggedIn()` | 로그인 여부 |
| `onAuthStateChange(callback)` | 상태 변경 리스너 |
| `resetPassword(email)` | 비밀번호 재설정 |
| `updatePassword(newPassword)` | 비밀번호 변경 |

### `papUser` - 프로필 관리

| 메서드 | 설명 |
|--------|------|
| `getProfile(userId?)` | 프로필 조회 |
| `updateProfile(updates)` | 프로필 수정 |
| `getSubscription()` | 구독 정보 |
| `uploadAvatar(file)` | 아바타 업로드 |
| `createProfile(data)` | 프로필 생성 (내부용) |

### `papPayment` - 결제 처리

| 메서드 | 설명 |
|--------|------|
| `createCheckout(planId, billingCycle)` | Checkout 세션 생성 |
| `redirectToCheckout(planId, billingCycle)` | 결제 페이지 리다이렉트 |
| `updateSubscription(data)` | 구독 정보 업데이트 |
| `cancelSubscription()` | 구독 취소 |

### `papSubmit` - 폼 제출

| 메서드 | 설명 |
|--------|------|
| `submitEditorial(formData)` | 편집 자료 제출 |
| `submitPullLetter(formData)` | 풀레터 요청 |
| `uploadFile(file, bucket)` | 파일 업로드 |
| `uploadFiles(files, bucket)` | 여러 파일 업로드 |

### `window.PAP` - 전역 인터페이스

```javascript
window.PAP.auth      // papAuth 동일
window.PAP.user      // papUser 동일
window.PAP.payment   // papPayment 동일
window.PAP.submit    // papSubmit 동일
window.PAP.config    // PAP_CONFIG
window.PAP.getUser() // 현재 사용자
window.PAP.isLoggedIn() // 로그인 여부
window.PAP.utils     // 유틸리티 함수
```

## 에러 처리

모든 메서드는 `{ data, error }` 형식으로 반환합니다:

```javascript
const { user, error } = await papAuth.signIn(email, password);

if (error) {
  // error.message에 에러 설명
  console.error('Login failed:', error);
} else {
  // user에 데이터
  console.log('Logged in:', user.email);
}
```

## 환경별 설정

### 개발 환경

```javascript
// .env.local 파일 생성
REACT_APP_SUPABASE_URL=https://xxxxx.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGc...
REACT_APP_STRIPE_PUBLIC_KEY=pk_test_xxxxx
```

### 프로덕션 환경

배포 플랫폼의 환경 변수 설정:
- Vercel: Settings > Environment Variables
- Netlify: Site settings > Build & deploy > Environment
- AWS: Systems Manager > Parameter Store

## 보안

### 주의사항

- **절대** Secret Key를 클라이언트에서 사용하지 마세요
- **절대** API 키를 GitHub에 커밋하지 마세요
- RLS(Row Level Security)가 기본으로 활성화됨
- Webhook 서명 검증 필수

### 권장사항

- 환경 변수로 API 키 관리
- HTTPS 사용
- CORS 설정 확인
- 정기적인 보안 업데이트

## 배포

### 서버리스 함수 배포

1. **Vercel** (권장)
   - `/api/stripe-webhook.js` 배포
   - `/api/create-checkout-session.js` 배포
   - `/api/cancel-subscription.js` 배포

2. **Netlify**
   - `/functions/stripe-webhook.js` 배포

3. **AWS Lambda**
   - API Gateway 설정
   - Lambda 함수 배포

자세한 설정은 `BACKEND_SETUP.md` 참고

## 예제

### 완전한 인증 흐름

```javascript
// 1. 회원가입
const { user: newUser, error: signupError } = await papAuth.signUp(
  'user@example.com',
  'password123',
  'John Doe'
);

if (signupError) {
  alert('회원가입 실패: ' + signupError);
  return;
}

// 2. 프로필 완성
await papUser.updateProfile({
  name: 'John Doe',
  bio: 'I am a photographer',
});

// 3. 아바타 업로드
const avatarFile = document.getElementById('avatar').files[0];
const { url: avatarUrl } = await papUser.uploadAvatar(avatarFile);

// 4. 결제 페이지로 이동
await papPayment.redirectToCheckout('premium_monthly');
```

### 편집 자료 제출 흐름

```javascript
// 파일 업로드
const { url: fileUrl } = await papSubmit.uploadFile(
  document.getElementById('submission-file').files[0],
  'submissions'
);

// 제출
const { submission, error } = await papSubmit.submitEditorial({
  title: document.getElementById('title').value,
  description: document.getElementById('description').value,
  file_urls: [fileUrl],
  credits: document.getElementById('credits').value,
});

if (!error) {
  alert('제출되었습니다!');
}
```

## 브라우저 콘솔

초기화 시 콘솔에서 상태를 확인할 수 있습니다:

```
🚀 PAP Backend Initializing...
✅ Supabase client initialized
✅ Stripe client initialized
👤 Current user: user@example.com
✅ PAP Backend initialized successfully
📦 PAP Backend module loaded. Access via: window.PAP or papAuth, papUser, papPayment, papSubmit
```

## 문제 해결

### API 키가 설정되지 않음

```
⚠️  Missing API keys: SUPABASE_URL, SUPABASE_ANON_KEY
```

**해결:** `pap-backend.js`의 `PAP_CONFIG` 확인

### 인증이 작동하지 않음

- Supabase URL과 키 확인
- 브라우저 콘솔에서 에러 메시지 확인
- Supabase 대시보드에서 프로젝트 상태 확인

### 결제가 작동하지 않음

- Stripe Public Key 확인 (pk_로 시작)
- Stripe 계정 활성화 확인
- 서버리스 함수 배포 확인

## 문서

- **전체 설정 가이드**: `BACKEND_SETUP.md`
- **Supabase 문서**: https://supabase.com/docs
- **Stripe 문서**: https://stripe.com/docs

## 지원

버그를 발견하거나 기능을 요청하려면 GitHub Issues를 사용하세요.

---

**버전:** 1.0.0
**마지막 업데이트:** 2026년 4월
**작성자:** PAP Magazine Development Team
