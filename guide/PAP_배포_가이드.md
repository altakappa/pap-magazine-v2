# PAP Magazine 배포 가이드

> Mac 사용자를 위한 완전 초보자용 단계별 가이드
> 터미널을 처음 사용하는 분도 따라할 수 있습니다.

---

## 시작하기 전에

이 가이드를 따라하면 우리가 만든 PAP Magazine 웹사이트가 인터넷에 공개되어 전 세계 누구나 접속할 수 있게 됩니다.

**필요한 시간**: 약 2~3시간 (처음이라 천천히 해도)
**필요한 비용**: 월 약 $20~50 (처음 한 달은 대부분 무료)
**필요한 것**: Mac 컴퓨터, 이메일 주소, 신용카드(결제 서비스용)

---

## STEP 0: 터미널이란?

터미널은 Mac에 기본으로 설치된 앱입니다. 키보드로 명령어를 입력해서 컴퓨터를 조작하는 도구예요.

### 터미널 여는 방법
1. `Command(⌘) + Space` 키를 동시에 누르세요 (Spotlight 검색이 열림)
2. "터미널" 또는 "Terminal" 이라고 입력하세요
3. Terminal 앱을 클릭하세요
4. 검은색(또는 흰색) 창이 열리면 성공!

이 창에 아래 가이드의 명령어를 그대로 복사해서 붙여넣기(⌘+V) 하면 됩니다.

---

## STEP 1: 필수 도구 설치

### 1-1. Node.js 설치
Node.js는 우리 백엔드 코드를 실행하는 도구입니다.

1. 웹브라우저에서 https://nodejs.org 접속
2. **LTS** (왼쪽 초록색 버튼) 클릭하여 다운로드
3. 다운로드된 파일(.pkg)을 더블클릭하여 설치
4. "계속" → "동의" → "설치" 순서로 클릭

**확인방법**: 터미널을 열고 아래를 입력 후 Enter
```
node --version
```
`v20.x.x` 같은 버전이 나오면 성공!

### 1-2. Git 설치
Git은 코드를 GitHub에 올리는 도구입니다.

터미널에 아래를 입력:
```
git --version
```
이미 설치되어 있으면 버전이 나옵니다.
"Command Line Tools" 설치 팝업이 뜨면 "설치"를 클릭하세요.

---

## STEP 2: GitHub 계정 만들기

GitHub는 코드를 저장하고 관리하는 곳입니다.

1. https://github.com 접속
2. **Sign up** 클릭
3. 이메일, 비밀번호, 사용자명 입력
4. 이메일 인증 완료

### 2-1. GitHub에 코드 올리기

1. GitHub에 로그인 후, 우측 상단 **+** 버튼 → **New repository** 클릭
2. Repository name: `pap-magazine` 입력
3. **Private** 선택 (코드를 비공개로)
4. **Create repository** 클릭

이제 터미널에서 아래 명령어를 **한 줄씩** 입력하세요:

```bash
# 바탕화면에 프로젝트 폴더 만들기
cd ~/Desktop
mkdir pap-magazine
cd pap-magazine
```

**여기서 중요!**
Claude에서 다운로드한 `pap-admin.zip` 파일을 찾아서 이 폴더에 압축을 풀어주세요.
Finder에서 pap-admin.zip을 더블클릭하면 압축이 풀립니다.
풀린 폴더 안의 모든 파일을 `~/Desktop/pap-magazine/` 폴더로 옮기세요.

그리고 프론트엔드 HTML 파일들도 `public` 폴더에 넣어주세요:
- pap-magazine-v5.html → public/index.html (이름 변경)
- community.html → public/community.html
- subscribe.html → public/subscribe.html
- submission.html → public/submission.html
- pullletter.html → public/pullletter.html
- auth.html → public/auth.html
- about.html → public/about.html
- business.html → public/business.html
- contact.html → public/contact.html
- admin.html → public/admin.html
- pap-api.js → public/pap-api.js

터미널에서 계속:
```bash
# Git 초기화 + 코드 올리기
git init
git add .
git commit -m "PAP Magazine - initial upload"
git branch -M main
git remote add origin https://github.com/여러분의유저명/pap-magazine.git
git push -u origin main
```

GitHub 로그인 팝업이 뜨면 로그인하세요.
> "여러분의유저명" 부분을 실제 GitHub 사용자명으로 바꾸세요!

---

## STEP 3: Supabase (데이터베이스) 설정

Supabase는 회원 정보, 에디토리얼, 서브미션 등 모든 데이터를 저장하는 곳입니다.

1. https://supabase.com 접속
2. **Start your project** → GitHub 계정으로 로그인
3. **New Project** 클릭
4. 설정:
   - Organization: 기본값
   - Project name: `pap-magazine`
   - Database Password: 안전한 비밀번호 입력 (**반드시 메모해두세요!**)
   - Region: `Northeast Asia (Seoul)` 선택
5. **Create new project** 클릭 (2~3분 대기)

### 3-1. 데이터베이스 연결 주소 복사
1. 프로젝트가 만들어지면, 좌측 메뉴에서 **Settings** (톱니바퀴) 클릭
2. **Database** 클릭
3. **Connection string** 섹션에서 **URI** 탭 클릭
4. 표시된 주소를 복사하세요. 아래와 비슷한 형태:
```
postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
```
5. `[YOUR-PASSWORD]` 부분을 아까 설정한 비밀번호로 바꾸세요

**이 주소를 메모장에 저장해두세요!** (나중에 환경변수로 사용)

---

## STEP 4: Vercel (서버) 배포

Vercel은 우리 코드를 실행해서 웹사이트로 만들어주는 서비스입니다.

1. https://vercel.com 접속
2. **Sign Up** → **Continue with GitHub** 클릭
3. GitHub 계정 연동 허용

### 4-1. 프로젝트 배포
1. Vercel 대시보드에서 **Add New...** → **Project** 클릭
2. GitHub 저장소 목록에서 `pap-magazine` 찾아서 **Import** 클릭
3. **Framework Preset**: `Next.js` 선택 (자동으로 됨)
4. **Environment Variables** 섹션을 펼치세요
5. 아래 환경변수를 하나씩 추가하세요:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | STEP 3에서 복사한 PostgreSQL 주소 |
| `NEXTAUTH_SECRET` | 아무 긴 문자열 (예: `pap-secret-2026-magazine-admin-key`) |
| `NEXTAUTH_URL` | `https://pap-magazine.vercel.app` (나중에 도메인으로 변경) |
| `JWT_SECRET` | 다른 긴 문자열 (예: `pap-user-jwt-secret-key-2026`) |
| `AWS_ACCESS_KEY_ID` | 기존 AWS 키 (pap-korea-bucket 접근용) |
| `AWS_SECRET_ACCESS_KEY` | 기존 AWS 시크릿 키 |
| `AWS_REGION` | `ap-northeast-2` |
| `S3_BUCKET_NAME` | `pap-korea-bucket` |

6. **Deploy** 클릭!

**2~3분 후** "Congratulations!" 메시지가 나오면 배포 성공!
`https://pap-magazine.vercel.app` 같은 주소로 접속할 수 있습니다.

---

## STEP 5: 데이터베이스 테이블 생성

터미널에서 아래를 실행:
```bash
cd ~/Desktop/pap-magazine
npm install
npx prisma db push
```

이 명령어가 Supabase에 모든 테이블(회원, 에디토리얼, 서브미션 등)을 자동으로 만들어줍니다.

### 5-1. 관리자 계정 생성
```bash
npx prisma studio
```
브라우저가 열리면:
1. 좌측에서 **Admin** 테이블 클릭
2. **Add record** 클릭
3. 입력:
   - email: `여러분의이메일@gmail.com`
   - password: (아래 명령어로 암호화한 값)
   - name: `관리자`
   - role: `admin`
4. **Save** 클릭

비밀번호 암호화 방법 (터미널에서):
```bash
node -e "const bcrypt=require('bcryptjs');bcrypt.hash('원하는비밀번호',12).then(h=>console.log(h))"
```
출력된 `$2a$12$...` 형태의 문자열을 password 필드에 붙여넣으세요.

---

## STEP 6: 도메인 연결 (pap-magazine.com)

1. Vercel 대시보드 → 프로젝트 → **Settings** → **Domains**
2. `pap-magazine.com` 입력 → **Add**
3. Vercel이 보여주는 DNS 레코드를 도메인 관리 사이트(가비아 등)에 설정:
   - A 레코드: `76.76.21.21`
   - CNAME: `cname.vercel-dns.com`
4. `management.pap-magazine.com` → 같은 프로젝트의 `/admin.html`로 연결

**DNS 전파에 최대 24시간이 걸릴 수 있습니다** (보통 10분~1시간)

---

## STEP 7: Stripe (결제) 설정

1. https://stripe.com 접속 → 계정 생성
2. **Dashboard** → **Products** → **Add Product**
3. 4개 상품 만들기:

| 상품 | 가격 |
|------|------|
| Standard Monthly | $5.99/월 |
| Standard Yearly | $49.99/년 |
| Premium Monthly | $9.49/월 |
| Premium Yearly | $79.99/년 |

4. 각 상품의 **Price ID** (price_xxx...)를 복사
5. Vercel → Settings → Environment Variables에 추가:

| Key | Value |
|-----|-------|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API Keys에서 복사 |
| `STRIPE_PRICE_STD_M` | Standard Monthly의 Price ID |
| `STRIPE_PRICE_STD_Y` | Standard Yearly의 Price ID |
| `STRIPE_PRICE_PREM_M` | Premium Monthly의 Price ID |
| `STRIPE_PRICE_PREM_Y` | Premium Yearly의 Price ID |

6. **Redeploy** (Vercel에서 Deployments → 최신 항목 → ... → Redeploy)

---

## STEP 8: 이메일 설정

Gmail을 사용하는 경우:
1. Google 계정 → 보안 → **2단계 인증** 활성화
2. **앱 비밀번호** 생성 (검색: "Google 앱 비밀번호")
3. 16자리 앱 비밀번호를 복사

Vercel 환경변수에 추가:

| Key | Value |
|-----|-------|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `contact@pap-magazine.com` (또는 Gmail 주소) |
| `SMTP_PASS` | 위에서 만든 앱 비밀번호 |
| `EMAIL_FROM` | `PAP Magazine <contact@pap-magazine.com>` |

---

## STEP 9: Google 로그인 설정

1. https://console.cloud.google.com 접속
2. **새 프로젝트** → `PAP Magazine` 생성
3. **API 및 서비스** → **사용자 인증 정보** → **OAuth 2.0 클라이언트 ID 만들기**
4. 유형: **웹 애플리케이션**
5. 승인된 리디렉션 URI: `https://pap-magazine.com/api/auth/callback/google`
6. 클라이언트 ID와 시크릿을 Vercel 환경변수에 추가

---

## 완료! 체크리스트

배포가 끝나면 아래를 확인하세요:

- [ ] https://pap-magazine.com 접속 가능
- [ ] 언어 변경 작동
- [ ] 회원가입/로그인 작동
- [ ] 에디토리얼 상세 팝업 작동
- [ ] 커뮤니티 페이지 접속
- [ ] 관리자 (management.pap-magazine.com) 로그인
- [ ] 에디토리얼 새 게시글 작성
- [ ] 서브미션 제출 테스트
- [ ] Stripe 결제 테스트 (테스트 모드)

---

## 문제가 생겼을 때

| 증상 | 해결방법 |
|------|----------|
| Vercel 배포 실패 | Build Logs에서 빨간 에러 메시지 확인 → Claude에게 보여주세요 |
| DB 연결 오류 | DATABASE_URL이 정확한지 확인, 비밀번호에 특수문자가 있으면 URL 인코딩 필요 |
| 도메인이 안 열림 | DNS 전파 대기 (최대 24시간), Vercel Domains 설정 재확인 |
| 로그인이 안 됨 | NEXTAUTH_SECRET, NEXTAUTH_URL 환경변수 확인 |
| 이미지가 안 보임 | AWS_ACCESS_KEY_ID, S3_BUCKET_NAME 확인 |

**언제든 막히는 부분이 있으면 에러 메시지를 캡처해서 Claude에게 보여주세요!**

---

## 배포 후 운영

### 코드 수정 후 재배포
Claude에서 파일을 수정한 후:
```bash
cd ~/Desktop/pap-magazine
git add .
git commit -m "수정 내용 설명"
git push
```
→ Vercel이 자동으로 재배포합니다 (1~2분)

### 데이터 확인
Supabase 대시보드에서 직접 데이터를 조회/수정할 수 있습니다.
또는 `npx prisma studio`로 브라우저에서 데이터를 관리할 수 있습니다.

---

작성일: 2026-03-20
PAP Magazine 배포 가이드 v1.0
