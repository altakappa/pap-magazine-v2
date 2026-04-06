# PAP Backend - Quick Reference Card

## 설정

```javascript
// HTML <head>에 추가
<script src="js/pap-backend.js"></script>

// 또는 환경변수로 API 키 설정
<script>
  window.PAP_CONFIG = {
    SUPABASE_URL: 'https://xxxxx.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGc...',
    STRIPE_PUBLIC_KEY: 'pk_live_xxxxx',
  };
</script>
<script src="js/pap-backend.js"></script>
```

---

## 인증 (Authentication)

### 회원가입
```javascript
const { user, error } = await papAuth.signUp(
  'user@example.com', 'password', 'Name'
);
```

### 로그인
```javascript
const { user, session, error } = await papAuth.signIn(
  'user@example.com', 'password'
);
```

### OAuth 로그인
```javascript
await papAuth.signInWithProvider('google');
await papAuth.signInWithProvider('apple');
```

### 로그아웃
```javascript
await papAuth.signOut();
```

### 현재 사용자
```javascript
const user = papAuth.getUser();
if (papAuth.isLoggedIn()) {
  console.log('Logged in:', user.email);
}
```

### 상태 변경 감시
```javascript
papAuth.onAuthStateChange((user) => {
  // user가 null이면 로그아웃, 아니면 로그인
});
```

### 비밀번호 재설정
```javascript
const { error } = await papAuth.resetPassword('user@example.com');
// 이메일로 재설정 링크가 발송됨

// 새 비밀번호 설정
const { error } = await papAuth.updatePassword('newPassword123');
```

---

## 프로필 (Profile)

### 프로필 가져오기
```javascript
const { profile, error } = await papUser.getProfile();
// profile = { id, email, name, avatar_url, subscription_plan, ... }
```

### 프로필 수정
```javascript
const { profile, error } = await papUser.updateProfile({
  name: 'New Name',
  bio: 'Biography',
  website: 'https://example.com',
  location: 'Seoul, Korea',
});
```

### 아바타 업로드
```javascript
const { url, error } = await papUser.uploadAvatar(fileInput.files[0]);
// 자동으로 프로필에 반영됨
```

### 구독 정보
```javascript
const { subscription, error } = await papUser.getSubscription();
// subscription = {
//   plan: 'premium_monthly',
//   billing_cycle: 'monthly',
//   status: 'active',
//   current_period_end: Date,
// }
```

---

## 결제 (Payment)

### 결제 페이지로 이동
```javascript
// 가장 간단한 방법
await papPayment.redirectToCheckout('premium_monthly');
```

### 또는 URL만 가져오기
```javascript
const { url, error } = await papPayment.createCheckout('standard_yearly');
if (url) {
  window.location.href = url;
}
```

### 플랜 목록
```
'free'                 // Free (자동 활성화)
'standard_monthly'     // $9.99/month
'standard_yearly'      // $99.99/year
'premium_monthly'      // $19.99/month
'premium_yearly'       // $199.99/year
```

### 구독 취소
```javascript
const { error } = await papPayment.cancelSubscription();
```

---

## 파일 업로드 (File Upload)

### 단일 파일
```javascript
const { url, path, error } = await papSubmit.uploadFile(
  fileInput.files[0],
  'submissions'  // 'submissions' 또는 'pullletters'
);
// url = 'https://xxxxx.supabase.co/storage/v1/object/...'
```

### 여러 파일
```javascript
const { urls, errors } = await papSubmit.uploadFiles(
  fileInput.files,
  'submissions'
);
// urls = ['https://...', 'https://...']
// errors = [] (에러가 있으면 ['file.pdf: error message'])
```

### 버킷
```
'submissions'  // 편집 자료
'pullletters'  // 풀레터
```

---

## 폼 제출 (Form Submission)

### 편집 자료 제출
```javascript
const { submission, error } = await papSubmit.submitEditorial({
  title: 'Article Title',
  description: 'Description text',
  file_urls: ['https://...'],
  credits: 'Photo by John Doe',
});
// submission = { id, user_id, status: 'pending', created_at, ... }
```

### 풀레터 요청
```javascript
const { pulletter, error } = await papSubmit.submitPullLetter({
  request_text: 'Request text here',
  file_urls: ['https://...'],
});
```

---

## 에러 처리

### 기본 패턴
```javascript
const { data, error } = await papAuth.signIn(email, password);

if (error) {
  // 에러 처리
  const friendlyMessage = window.PAP.utils.getHumanReadableError(error);
  alert('에러: ' + friendlyMessage);
} else {
  // 성공 처리
  console.log('Success:', data);
}
```

### 일반적인 에러
```
'user_already_exists'      // 이미 등록된 이메일
'invalid_grant'            // 잘못된 로그인 정보
'email_not_confirmed'      // 이메일 미확인
'weak_password'            // 약한 비밀번호
'invalid_email'            // 유효하지 않은 이메일
```

---

## 유틸리티 (Utilities)

### 에러 메시지 변환
```javascript
const message = window.PAP.utils.getHumanReadableError('invalid_grant');
// '이메일 또는 비밀번호가 잘못되었습니다.'
```

### 로컬스토리지
```javascript
// 읽기
const value = window.PAP.utils.getStorageItem('key', defaultValue);

// 쓰기
window.PAP.utils.setStorageItem('key', value);
```

### 재시도 (Retry with exponential backoff)
```javascript
const result = await window.PAP.utils.retryAsync(
  async () => { return await someAsyncFunction(); },
  3,        // max retries
  1000      // delay in ms
);
```

---

## 콘솔 출력 (Console Output)

### 초기화 메시지
```
🚀 PAP Backend Initializing...
✅ Supabase client initialized
✅ Stripe client initialized
👤 Current user: user@example.com
✅ PAP Backend initialized successfully
📦 PAP Backend module loaded
```

### 작업 성공
```
✅ Sign up successful: user@example.com
✅ File uploaded: users/xxxxx_1234567890_file.pdf
✅ Editorial submission saved: xxxxx-xxxxx-xxxxx
```

### 경고
```
⚠️  Missing API keys: SUPABASE_URL, STRIPE_PUBLIC_KEY
⚠️  Some files failed to upload: [file1.pdf: error message]
```

### 에러
```
❌ Sign in error: Invalid email or password
❌ File upload error: File size exceeds 10MB limit
```

---

## 코드 예제

### 완전한 로그인 폼
```html
<form id="loginForm">
  <input type="email" id="email" placeholder="Email" required>
  <input type="password" id="password" placeholder="Password" required>
  <button type="submit">로그인</button>
</form>

<script>
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const { user, error } = await papAuth.signIn(email, password);

  if (error) {
    alert('로그인 실패: ' + error);
  } else {
    window.location.href = '/dashboard.html';
  }
});
</script>
```

### 결제 버튼
```html
<button id="subscribeBtn">Premium 구독</button>

<script>
document.getElementById('subscribeBtn').addEventListener('click', async () => {
  if (!papAuth.isLoggedIn()) {
    alert('로그인 후 구독할 수 있습니다.');
    window.location.href = '/auth.html';
    return;
  }

  await papPayment.redirectToCheckout('premium_monthly');
});
</script>
```

### 파일 업로드 및 제출
```html
<input type="file" id="file">
<input type="text" id="title" placeholder="Title">
<textarea id="description" placeholder="Description"></textarea>
<button id="submitBtn">제출</button>

<script>
document.getElementById('submitBtn').addEventListener('click', async () => {
  const file = document.getElementById('file').files[0];

  // 파일 업로드
  const { url: fileUrl, error: uploadError } = await papSubmit.uploadFile(
    file,
    'submissions'
  );

  if (uploadError) {
    alert('파일 업로드 실패: ' + uploadError);
    return;
  }

  // 폼 제출
  const { submission, error: submitError } = await papSubmit.submitEditorial({
    title: document.getElementById('title').value,
    description: document.getElementById('description').value,
    file_urls: [fileUrl],
  });

  if (submitError) {
    alert('제출 실패: ' + submitError);
  } else {
    alert('제출되었습니다!');
  }
});
</script>
```

---

## 디버깅 팁

### 개발자 도구에서 확인
```javascript
// 콘솔에서 직접 실행
window.PAP          // 전체 모듈 확인
window.PAP.getUser() // 현재 사용자 확인
papAuth.getSession() // 세션 정보 확인
```

### 로컬스토리지 확인
```javascript
// 개발자 도구 > Application > Local Storage > https://your-domain
// 저장된 데이터 확인
```

### 네트워크 요청 모니터링
```
개발자 도구 > Network > 탭 선택
- Fetch/XHR: Supabase/Stripe API 호출 확인
- Status 200: 성공, 4xx: 클라이언트 에러, 5xx: 서버 에러
```

---

## 체크리스트

### 프로덕션 배포 전
- [ ] API 키 환경변수로 설정
- [ ] HTTPS 사용
- [ ] Stripe webhook 설정
- [ ] Supabase RLS 정책 확인
- [ ] 에러 처리 추가
- [ ] 로딩 상태 표시
- [ ] 성공/실패 알림 구현
- [ ] 테스트 완료

---

**마지막 업데이트:** 2026년 4월
