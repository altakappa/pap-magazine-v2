# PAP Magazine Backend Integration Setup Guide

## 개요 (Overview)

이 가이드는 PAP Magazine 웹사이트의 완전한 백엔드 통합을 설정하는 방법을 설명합니다.

**포함되는 기능:**
- 사용자 인증 (Supabase Auth)
- 결제 처리 (Stripe)
- 사용자 프로필 관리
- 파일 업로드
- 폼 제출 (편집자료, 풀레터)

---

## 1. Supabase 설정

### 1.1 Supabase 프로젝트 생성

1. [Supabase Dashboard](https://app.supabase.com/)에 접속
2. **New Project** 클릭
3. 프로젝트 이름 입력 (예: "pap-magazine")
4. 데이터베이스 비밀번호 설정
5. Region 선택 (Asia Seoul 권장)
6. **Create new project** 클릭

### 1.2 데이터베이스 스키마 설정

1. Supabase 대시보드 > **SQL Editor** 클릭
2. **New Query** 클릭
3. `supabase-schema.sql` 전체 내용 복사하여 붙여넣기
4. **Run** 클릭 (실행)

스키마가 생성되면:
- `profiles` 테이블 (사용자 프로필)
- `submissions` 테이블 (편집 자료)
- `pullletters` 테이블 (풀레터 요청)
- `subscribers` 테이블 (구독 정보)

### 1.3 Storage 버킷 생성

1. **Storage** > **Buckets** 클릭
2. **Create a new bucket** 클릭
3. 다음 3개 버킷 생성:

#### Bucket 1: avatars (공개)
```
Name: avatars
Public: ON (공개)
File size limit: 10MB
```

#### Bucket 2: submissions (비공개)
```
Name: submissions
Public: OFF
File size limit: 50MB
```

#### Bucket 3: pullletters (비공개)
```
Name: pullletters
Public: OFF
File size limit: 50MB
```

### 1.4 API 키 확인

1. **Settings** > **API** 클릭
2. 다음 정보 복사:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **Anon (Public) Key**: `eyJhbGc...` (일반 사용자용)
   - **Service Role Key**: `eyJhbGc...` (서버용)

이 정보를 나중에 필요합니다.

### 1.5 인증 제공자 설정 (OAuth)

선택사항: Google/Apple 로그인을 사용하려면:

#### Google OAuth
1. **Authentication** > **Providers** > **Google** 클릭
2. Google Cloud Console에서:
   - OAuth 2.0 Client ID 생성
   - Authorized redirect URI 추가: `https://xxxxx.supabase.co/auth/v1/callback`
   - Client ID와 Secret 복사
3. Supabase에서 입력하고 **Save** 클릭

#### Apple OAuth
1. **Authentication** > **Providers** > **Apple** 클릭
2. Apple Developer Account에서:
   - Service ID 생성
   - Private Key 다운로드
3. 필요한 정보 입력 후 **Save** 클릭

---

## 2. Stripe 설정

### 2.1 Stripe 계정 생성

1. [Stripe Dashboard](https://dashboard.stripe.com/)에 접속
2. 계정 생성 및 가입 완료
3. 비즈니스 정보 입력

### 2.2 제품 및 가격 설정

**Stripe Dashboard > Products**에서:

#### 제품 1: Standard Plan
```
Product Name: Standard Plan
Type: Recurring (정기 결제)

Price 1:
- Amount: $9.99 USD
- Billing Period: Monthly
- Price ID 복사: price_xxxxx

Price 2:
- Amount: $99.99 USD
- Billing Period: Yearly
- Price ID 복사: price_xxxxx
```

#### 제품 2: Premium Plan
```
Product Name: Premium Plan
Type: Recurring

Price 1:
- Amount: $19.99 USD
- Billing Period: Monthly
- Price ID 복사: price_xxxxx

Price 2:
- Amount: $199.99 USD
- Billing Period: Yearly
- Price ID 복사: price_xxxxx
```

### 2.3 API 키 확인

1. **Developers** > **API Keys** 클릭
2. 다음 정보 복사:
   - **Publishable Key**: `pk_live_xxxxx` (또는 `pk_test_xxxxx`)
   - **Secret Key**: `sk_live_xxxxx` (또는 `sk_test_xxxxx`)

### 2.4 Webhook 설정

1. **Developers** > **Webhooks** 클릭
2. **Add endpoint** 클릭
3. Webhook URL 입력:
   ```
   https://your-domain.com/api/stripe-webhook
   또는
   https://your-domain.netlify.app/.netlify/functions/stripe-webhook
   ```
4. 다음 이벤트 선택:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. **Add endpoint** 클릭
6. Signing secret 복사: `whsec_xxxxx`

---

## 3. 서버리스 함수 배포

### 3.1 Vercel에 배포 (권장)

#### 사전 조건:
- [Vercel 계정](https://vercel.com/) 생성
- GitHub 연동

#### 단계:

1. **프로젝트 구조 생성:**
   ```
   frontend/
   ├─ js/
   │  ├─ pap-backend.js
   │  └─ (다른 파일들)
   ├─ api/
   │  ├─ stripe-webhook.js
   │  └─ create-checkout-session.js
   └─ vercel.json
   ```

2. **API 함수 생성:**

   `/api/stripe-webhook.js`:
   ```javascript
   // stripe-webhook.js에서 제공된 Vercel 코드 사용
   ```

   `/api/create-checkout-session.js`:
   ```javascript
   const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

   export default async function handler(req, res) {
     if (req.method !== 'POST') {
       return res.status(405).json({ error: 'Method not allowed' });
     }

     try {
       const { priceId, userId, email, successUrl, cancelUrl } = req.body;

       const session = await stripe.checkout.sessions.create({
         payment_method_types: ['card'],
         customer_email: email,
         line_items: [{ price: priceId, quantity: 1 }],
         mode: 'subscription',
         success_url: successUrl,
         cancel_url: cancelUrl,
         metadata: { user_id: userId },
       });

       return res.status(200).json({ sessionId: session.id, url: session.url });
     } catch (error) {
       return res.status(500).json({ error: error.message });
     }
   }
   ```

   `/api/cancel-subscription.js`:
   ```javascript
   const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
   const { createClient } = require('@supabase/supabase-js');

   const supabase = createClient(
     process.env.SUPABASE_URL,
     process.env.SUPABASE_SERVICE_KEY
   );

   export default async function handler(req, res) {
     if (req.method !== 'POST') {
       return res.status(405).json({ error: 'Method not allowed' });
     }

     try {
       const { userId } = req.body;

       const { data: subscriber } = await supabase
         .from('subscribers')
         .select('stripe_subscription_id')
         .eq('user_id', userId)
         .single();

       if (!subscriber) {
         return res.status(404).json({ error: 'Subscription not found' });
       }

       await stripe.subscriptions.del(subscriber.stripe_subscription_id);

       return res.status(200).json({ success: true });
     } catch (error) {
       return res.status(500).json({ error: error.message });
     }
   }
   ```

3. **환경 변수 설정:**

   Vercel Dashboard에서:
   - Project 선택
   - **Settings** > **Environment Variables**
   - 다음 변수 추가:

   ```
   STRIPE_SECRET_KEY = sk_live_xxxxx (또는 sk_test_xxxxx)
   STRIPE_PUBLIC_KEY = pk_live_xxxxx
   STRIPE_WEBHOOK_SECRET = whsec_xxxxx
   SUPABASE_URL = https://xxxxx.supabase.co
   SUPABASE_ANON_KEY = eyJhbGc...
   SUPABASE_SERVICE_KEY = eyJhbGc... (webhook 처리용)
   ```

4. **배포:**
   ```bash
   npm install -g vercel
   vercel deploy
   ```

### 3.2 Netlify에 배포

1. **netlify.toml 생성:**
   ```toml
   [build]
   command = "npm run build"
   functions = "functions"

   [[redirects]]
   from = "/api/*"
   to = "/.netlify/functions/:splat"
   status = 200
   ```

2. **환경 변수 설정:**
   - Netlify Dashboard > **Site settings** > **Environment**
   - 위의 환경 변수 추가

3. **배포:**
   ```bash
   npm install -g netlify-cli
   netlify deploy
   ```

---

## 4. 프론트엔드 설정

### 4.1 pap-backend.js 설정

HTML 페이지에 포함:
```html
<script src="js/pap-backend.js"></script>
```

### 4.2 API 키 설정

`pap-backend.js`에서 다음 부분 수정:

```javascript
const PAP_CONFIG = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGc...',
  STRIPE_PUBLIC_KEY: 'pk_live_xxxxx',
  // ... 나머지 설정
};
```

또는 HTML의 `<head>` 섹션에서 설정:
```html
<script>
  window.PAP_CONFIG = {
    SUPABASE_URL: 'https://xxxxx.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGc...',
    STRIPE_PUBLIC_KEY: 'pk_live_xxxxx',
  };
</script>
<script src="js/pap-backend.js"></script>
```

### 4.3 페이지에서 사용 예제

#### 회원가입
```javascript
const { user, error } = await papAuth.signUp('user@example.com', 'password123', 'User Name');
if (error) {
  console.error('Sign up failed:', error);
} else {
  console.log('Sign up successful:', user.email);
}
```

#### 로그인
```javascript
const { user, session, error } = await papAuth.signIn('user@example.com', 'password123');
if (!error) {
  console.log('Logged in:', user.email);
  window.location.href = '/dashboard.html';
}
```

#### 결제 처리
```javascript
// 결제 페이지로 리다이렉트
await papPayment.redirectToCheckout('premium_monthly', 'monthly');
```

#### 파일 업로드
```javascript
const fileInput = document.getElementById('file');
const { url, error } = await papSubmit.uploadFile(fileInput.files[0], 'submissions');
if (!error) {
  console.log('File uploaded:', url);
}
```

#### 폼 제출
```javascript
const { submission, error } = await papSubmit.submitEditorial({
  title: 'My Article',
  description: 'Article description',
  file_urls: ['https://...'],
  credits: 'Photo by John Doe',
});
```

---

## 5. 환경별 설정

### 개발 (Development)
```javascript
// Stripe test keys 사용
STRIPE_PUBLIC_KEY = 'pk_test_xxxxx'
STRIPE_SECRET_KEY = 'sk_test_xxxxx'

// 테스트 카드 사용 가능:
// 4242 4242 4242 4242 (성공)
// 4000 0000 0000 0002 (결제 실패)
```

### 프로덕션 (Production)
```javascript
// Stripe live keys 사용
STRIPE_PUBLIC_KEY = 'pk_live_xxxxx'
STRIPE_SECRET_KEY = 'sk_live_xxxxx'

// 실제 카드 결제 처리됨
```

---

## 6. 테스트

### 6.1 로컬 테스트

```bash
# Vercel 로컬 개발 서버
vercel dev

# 또는 Netlify
netlify dev
```

### 6.2 Webhook 테스트

Stripe CLI 사용:
```bash
# Stripe CLI 설치
brew install stripe/stripe-cli/stripe

# 로그인
stripe login

# Webhook 포워딩
stripe listen --forward-to localhost:3000/api/stripe-webhook

# 테스트 이벤트 전송
stripe trigger checkout.session.completed
```

### 6.3 결제 테스트

테스트 카드 번호:
- **성공**: 4242 4242 4242 4242
- **실패**: 4000 0000 0000 0002
- **거부**: 4000 0000 0000 9995

만료일: 아무 미래 날짜
CVC: 아무 3자리 숫자

---

## 7. 보안 주의사항

### 7.1 환경 변수 관리

**절대 하면 안 될 것:**
- ❌ API 키를 코드에 직접 포함
- ❌ API 키를 GitHub에 커밋
- ❌ Public key를 secret으로 사용

**해야 할 것:**
- ✅ 환경 변수 사용
- ✅ `.env.local` 파일 (로컬 전용, .gitignore에 추가)
- ✅ 프로덕션 배포 시 CI/CD 플랫폼의 환경 변수 사용

### 7.2 Row Level Security (RLS)

모든 테이블에 RLS가 활성화되어 있습니다:
- 사용자는 자신의 데이터만 조회/수정 가능
- 서버(service key)는 모든 데이터 접근 가능

### 7.3 Webhook 검증

Stripe webhook은 항상 서명을 검증합니다:
```javascript
const event = stripe.webhooks.constructEvent(body, sig, secret);
```

---

## 8. 문제 해결

### 문제: "API keys not configured" 경고

**해결:**
1. `pap-backend.js`의 `PAP_CONFIG` 확인
2. Supabase URL과 키가 올바르게 설정되었는지 확인
3. Stripe public key 확인

### 문제: Webhook이 실행되지 않음

**확인:**
1. Webhook URL이 정확한지 확인
2. Stripe dashboard에서 endpoint가 활성화되었는지 확인
3. 환경 변수 (`STRIPE_WEBHOOK_SECRET`) 확인
4. 서버 로그 확인

### 문제: CORS 에러

**해결:**
1. 서버 함수의 CORS 헤더 확인
2. 요청 Origin 확인
3. Vercel/Netlify의 CORS 설정 확인

---

## 9. 다음 단계

1. ✅ 각 페이지에 인증 체크 로직 추가
2. ✅ 사용자 대시보드 페이지 생성
3. ✅ 구독 관리 페이지 생성
4. ✅ 이메일 알림 설정 (SendGrid, Mailgun 등)
5. ✅ 애널리틱스 추가 (Google Analytics, Mixpanel 등)
6. ✅ 모니터링 설정 (Sentry, DataDog 등)

---

## 10. 지원

**문제가 있거나 질문이 있으면:**
- Supabase 문서: https://supabase.com/docs
- Stripe 문서: https://stripe.com/docs
- GitHub Issues에 문의

---

**마지막 업데이트:** 2026년 4월
**버전:** 1.0.0
