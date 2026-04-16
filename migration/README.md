# 🔄 AWS S3 → Supabase Storage 마이그레이션

AWS S3 `pap-korea-bucket`의 모든 이미지를 Supabase Storage로 이전하는 패키지입니다.

---

## 📋 전체 흐름

```
1. 준비      → AWS Key 생성 + Supabase Storage 버킷 생성 + Node.js 설치
2. 탐색      → probe로 버킷 크기/파일수 확인 (1분)
3. 이전      → migrate 스크립트로 S3 → Supabase 복사 (몇 시간)
4. URL 변경  → update-urls로 데이터 파일의 URL 일괄 변환 (10초)
5. 배포      → Git commit & push
6. 정리      → AWS S3 해지 (선택)
```

---

## 🚀 1단계: 사전 준비

### 1-1. Node.js 설치 (Mac)

터미널에서 확인:
```bash
node --version
```

- `v18` 이상 나오면 OK
- 없으면 설치:
  ```bash
  # Homebrew 이용
  brew install node

  # 또는 공식 사이트에서 다운로드
  # https://nodejs.org
  ```

### 1-2. AWS Access Key 생성

1. AWS 콘솔 → 우측 상단 본인 이름 클릭 → **"보안 자격 증명"**
2. 스크롤해서 **"액세스 키"** 섹션 → **"액세스 키 만들기"**
3. 사용 사례: **"명령줄 인터페이스(CLI)"** 선택
4. 확인 체크 → 다음
5. 설명 태그: `pap-migration` (아무거나)
6. **액세스 키 만들기** 클릭
7. 나타난 두 값을 안전한 곳에 복사:
   - **액세스 키 ID**: `AKIAXXXXXXXXXXXXXXXX`
   - **비밀 액세스 키**: (여기서 복사 안 하면 다시 못 봄!)

### 1-3. Supabase Storage 버킷 생성

1. Supabase 대시보드 → **SQL Editor** → **New query**
2. `1-supabase-setup.sql` 파일 내용 복사 → 붙여넣기 → **Run**
3. 성공 메시지 확인

### 1-4. Supabase Service Role Key 확인

1. Supabase 대시보드 → **Settings** → **API Keys**
2. **"Secret keys"** 섹션에서 이전에 만드신 **`newline`** 키 사용
3. **👁️ 아이콘** 클릭해서 전체 키 복사
4. 형식: `sb_secret_xxxxxxxxxxxx...`

---

## 🏗️ 2단계: 프로젝트 세팅

터미널에서:

```bash
# migration 폴더로 이동
cd ~/Downloads/PAP_Magazine_Deploy/migration

# 패키지 설치
npm install

# 환경 변수 파일 생성
cp .env.example .env
```

그 다음 `.env` 파일을 텍스트 편집기로 열어서 실제 값 입력:

```bash
# 텍스트 편집기로 열기 (예: VS Code)
open -e .env
```

편집할 항목:
- `AWS_ACCESS_KEY_ID`: 1-2단계에서 얻은 액세스 키 ID
- `AWS_SECRET_ACCESS_KEY`: 1-2단계에서 얻은 비밀 키
- `SUPABASE_URL`: `https://igcazquhkwxtqsaqpznx.supabase.co` (이미 설정됨)
- `SUPABASE_SERVICE_ROLE_KEY`: 1-4단계에서 얻은 secret 키

저장 (`Cmd + S`).

> ⚠️ **`.env` 파일은 절대 Git에 커밋하지 마세요.** `.gitignore`에 이미 추가되어 있어요.

---

## 🔍 3단계: 버킷 탐색 (1분)

```bash
npm run probe
```

출력 예시:
```
📊 Probing bucket: pap-korea-bucket

✅ Bucket summary:
   Total objects:  8,421
   Total size:     4.32 GB

💡 Supabase Plan 추천:
   ⚠️  Pro ($25/월, 100GB) 플랜 필요

⏱️ 예상 이전 시간:
   약 1시간 10분
```

### 이 결과에 따라 판단:

- **1GB 미만** → Free 플랜 유지 가능
- **1~100GB** → **Supabase Pro 플랜 필요** ($25/월)
  - Supabase 대시보드 → Settings → Billing에서 업그레이드
- **100GB 초과** → Pro + 추가 과금

Pro 플랜 업그레이드 후 다음 단계 진행.

---

## 🚚 4단계: 이전 실행 (몇 시간)

```bash
npm run migrate
```

진행 상황이 실시간으로 보임:
```
🚀 S3 → Supabase Storage 마이그레이션 시작

   진행: 2,341/8,421 (27.8%) | 업로드 2341 | 건너뜀 0 | 실패 0 | 4.2 files/s
```

### 중단되었을 때

Ctrl+C나 실수로 터미널 닫아도 괜찮아요. 다시 이어서:

```bash
npm run resume
```

이미 완료된 파일은 건너뛰고 나머지만 처리합니다.

### 실패한 파일이 있을 때

완료 후 `migration-failed.json` 파일 확인:
- 일시적 네트워크 오류 → 다시 실행하면 복구됨
- 파일 자체 문제 → 수동 확인 필요

---

## 🔗 5단계: URL 변경 (10초)

데이터 파일(JSON, HTML, JS)의 S3 URL을 Supabase URL로 일괄 변환:

```bash
# 먼저 미리보기 (안전)
npm run update-urls

# 확인 후 실제 적용
node update-data-urls.js --apply
```

출력 예시:
```
🔍 URL 변환 실행

      812 × frontend/data/media.json
       70 × frontend/data/articles.json
      141 × frontend/data/films.json
       ...

📊 요약:
   변경 대상 파일:  12개
   총 URL 치환:     1,487개

✅ 변경 완료. 백업: 각 파일의 .bak 파일 참조
```

### 검증

```bash
cd ..
git diff frontend/data/media.json
```

S3 URL이 Supabase URL로 바뀌었는지 확인.

---

## 🚢 6단계: 배포

```bash
cd ~/Downloads/PAP_Magazine_Deploy
rm -f .git/index.lock
git add frontend/
git commit -m "feat: AWS S3 → Supabase Storage 이미지 마이그레이션"
git push origin main
```

**배포 후 확인:**
1. `https://papkorea.com` 접속
2. 이미지들이 정상적으로 보이는지 확인
3. 브라우저 콘솔(F12)에서 네트워크 요청이 `supabase.co`로 가는지 확인
4. 문제 없으면 → 완료! 🎉

---

## 🧹 7단계: AWS 정리 (선택)

모든 이미지가 정상 작동하는 것을 확인한 후:

### 비용 절감

1. AWS 콘솔 → S3 → `pap-korea-bucket`
2. 당분간은 **그대로 유지** (백업용)
3. 1~2주 운영 문제 없으면:
   - 버킷 내용 다운로드하여 로컬 백업 (선택)
   - 버킷 삭제 또는 Glacier로 이전 (저렴한 스토리지)
4. AWS Access Key 삭제 (보안)

### CDN 최적화 (선택)

Supabase Storage는 자체 CDN이 있지만, 더 빠른 속도가 필요하면:
- Cloudflare 무료 플랜 → Supabase 앞단에 배치
- 전 세계 엣지 캐싱

---

## 🆘 트러블슈팅

### `InvalidAccessKeyId` 에러
→ `.env`의 `AWS_ACCESS_KEY_ID` 재확인

### `SignatureDoesNotMatch` 에러
→ `.env`의 `AWS_SECRET_ACCESS_KEY` 재확인 (공백 포함 여부)

### `Row level security policy violated`
→ Supabase service_role 키를 쓰고 있는지 확인 (anon 키는 안 됨)

### 속도가 느림
→ `.env`에서 `CONCURRENCY=20`으로 늘리기 (단, 너무 높으면 rate limit)

### 중간에 컴퓨터 꺼짐
→ `npm run resume` 로 재개

### 일부 파일만 실패
→ `migration-failed.json` 확인 후 `npm run resume` 재실행

---

## 📁 파일 구조

```
migration/
├── README.md                      # 이 파일
├── package.json                   # npm 의존성
├── .env.example                   # 환경 변수 템플릿
├── .env                           # 실제 설정 (Git 제외)
├── .gitignore                     # Git 제외 목록
├── 1-supabase-setup.sql           # Supabase Storage 설정 SQL
├── probe-bucket.js                # 버킷 탐색 스크립트
├── migrate-s3-to-supabase.js      # 메인 이전 스크립트
├── update-data-urls.js            # URL 변환 스크립트
├── migration-progress.json        # 진행 상황 (자동 생성)
└── migration-failed.json          # 실패 목록 (자동 생성)
```

---

## 📞 도움이 필요하면

각 단계에서 에러나 이상한 점 있으면 Claude에게 스크린샷과 함께 질문해주세요.
