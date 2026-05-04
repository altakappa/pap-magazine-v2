# PAP MAGAZINE — Affiliate System & Creator Tier Spec v2.0

> **작성일**: 2026-05-04 (v2.0: 운영/회계/세무/약관 통합)  
> **대상**: 클로드코드 (Claude Code) 또는 인하우스 개발 핸드오프  
> **스택 가정**: 자체개발 Next.js + 자체 백엔드 + 자체 DB

> **v2.0 변경 요약**: 분배 모델을 **대표자 단일 지급(Lead Creator Payout)** 으로 확정. Wise 단독 채택. 회계/세무/프라이버시/운영 정책 + 약관 면책 조항 추가.

---

## 0. 빌드의 범위

### 만든다 (이번 빌드 범위)

- **Brand Master DB** — 다양한 표기를 canonical brand ID로 묶는 데이터 모델
- **Brand별 어필리에이트 URL 슬롯** (Global / Korea 분기 포함)
- **`/go/[brandId]` 리다이렉트 시스템** — 기존 크레딧 링크 destination 갈아끼움
- **Geo 자동 분기** — 한국 IP → 국내 어필리에이트 / 그 외 → 글로벌 어필리에이트
- **클릭 로그** — 어떤 에디토리얼의 어떤 브랜드가 어디서 언제 클릭됐는지 (PII 최소화)
- **크리에이터 프로필 페이지에 'Earnings & Tier' 섹션 추가**
- **티어 자동 산정 엔진** — 6차원 점수로 BRONZE → LEGACY 자동 부여
- **🆕 정산 엔진** — 월말 마감 → 매월 25일 자동 지급 (Wise API)
- **🆕 원천징수 자동 처리** — 한국 거주 대표자 3.3% 자동 차감 + 지급명세서 발급
- **🆕 약관·전자서명 시스템** — 별도 페이지 + 타임스탬프 + IP 기록
- **🆕 분쟁 처리 채널** — 마이페이지 Dispute 버튼

### 만들지 않는다 (기존 인프라 활용)

- 크리에이터 프로필 페이지 자체 (이미 존재)
- 크리에이터 대시보드 (마이페이지) — Earnings 섹션만 추가
- 커뮤니티 / 무드보드 / 팀매칭 / 디렉토리 / 스크랩북 (이미 존재)
- 회원·로그인 시스템, 다국어, 에디토리얼 CMS, Rating, Comments (이미 존재)

---

## 1. Brand Master DB

### 1.1 데이터 모델

#### Table: `brands`

| 필드 | 타입 | 설명 |
|------|------|------|
| `brand_id` | string (PK) | canonical ID. 예: `pat_mcgrath_labs` |
| `display_name` | string | 표시용 정식 브랜드명 |
| `category` | enum | `fashion` / `beauty` / `accessories` / `footwear` / `bag` / `jewelry` / `other` |
| `tier` | enum | `luxury` / `contemporary` / `indie` / `mass` |
| `affiliate_url_global` | url | 글로벌 어필리에이트 링크 |
| `affiliate_url_korea` | url | 한국 어필리에이트 링크 |
| `affiliate_network` | string | awin / ltk / skimlinks / direct |
| `commission_rate_global` | decimal | 협상된 수수료율 |
| `commission_rate_korea` | decimal | 한국 수수료율 |
| `status` | enum | `active` / `pending` / `archived` |
| `instagram_handle` | string | 메인 IG 핸들 |
| `note` | text | 자유 메모 |
| `rejected_reason` | text | (status=archived 시) 거부 사유 |
| `created_at` / `updated_at` | timestamp | |

#### Table: `brand_aliases`

| 필드 | 타입 | 설명 |
|------|------|------|
| `alias` | string (PK) | 크레딧에 적힌 그대로 |
| `brand_id` | string (FK) | brands 참조 |
| `confidence` | enum | `manual` / `auto` / `pending` |

#### Table: `editorial_brand_credits`

| 필드 | 타입 | 설명 |
|------|------|------|
| `editorial_id` | string (FK) | |
| `brand_id` | string (FK, nullable) | |
| `raw_alias` | string | 크레딧 원문 |
| `role` | enum | `fashion_by` / `beauty_by` / `accessory_by` |
| `position` | int | 표시 순서 |

### 1.2 매핑 규칙 (canonicalization)

1. `brand_aliases`에서 정확히 일치 → 즉시 매핑
2. lowercase + 공백/언더스코어/하이픈 정규화 후 일치 → 즉시 매핑
3. `instagram_handle`과 일치 (지역 suffix 제거: `_norway`, `_nordics`, `_official`, `_kr` 등) → 매핑 + alias 자동 추가
4. 위 모두 실패 → `pending` 상태로 admin 노출

### 1.3 시드 데이터 (49개)

#### Beauty (11)

| brand_id | display_name | aliases |
|----------|--------------|---------|
| pat_mcgrath_labs | PAT McGRATH LABS | patmcgrathreal, Pat McGrath |
| mac_cosmetics | M·A·C COSMETICS | maccosmetics, maccosmeticsnordics, MAC Cosmetics |
| nyx_professional_makeup | NYX PROFESSIONAL MAKEUP | nyxcosmeticsnordics, NYX Cosmetics |
| makeup_by_mario | MAKEUP BY MARIO | makeupbymario, Makeup by Mario |
| jane_iredale | JANE IREDALE | janeiredale_norway, Jane Iredale |
| maybelline_new_york | MAYBELLINE NEW YORK | Maybelline |
| caia_cosmetics | CAIA COSMETICS | caiacosmetics |
| lethal_cosmetics | LETHAL COSMETICS | Lethal Cosmetics |
| snowdrop_cosmetics | SNOWDROP COSMETICS | snowdropcosmetics |
| duff_beauty | DUFF BEAUTY | Duff Beauty |
| panduro | PANDURO | panduroofficial |

#### Fashion — Luxury (10)

balenciaga · maison_margiela · rick_owens · mugler · saint_laurent · chloe · alexander_wang · af_vandevorst · andersson_bell · calvin_klein

#### Fashion — Contemporary/Mass (5)

diesel · misbhv · calzedonia · converse · schutz

#### Fashion — Indie/Designer (16)

mark_gong · senseaweek · showroom_plus · 455emble · qingchun_chen · liwen_liang · untitlab · reserva · brasilero · zantti · penha_maia · gigil · lucas_adriano_atelier · mieli · bigandmilky · roxie_vintage

#### Fashion — Vintage/Other (7)

swissskulls · donde_misalas_melleven · eldantes · honour_clothing · jeffrey_campbell · vintage_lincanto · epoca_barcelona

> **49개 시드 brand**. 자세한 alias 매핑표는 v1.0 부록 참조.

### 1.4 자동 정규화 룰 (7단계)

1. lowercase 변환
2. 지역/공식 suffix 제거: `_official`, `_online`, `_kr`, `_korea`, `_norway`, `_nordics`, `_uk`, `_us`, `_jp`, `_eu`
3. 연속 언더스코어/하이픈 단일화
4. 양 끝 언더스코어/하이픈 제거
5. 점(`.`) 제거
6. 공백 → 언더스코어
7. 정규화된 문자열로 `brand_aliases.alias` 룩업

### 1.5 1차 자동 추출

스크립트로:
1. 모든 출판된 editorial 순회
2. `role === 'fashion_by'` or `'beauty_by'`만 추출
3. `brand_aliases`에 INSERT (ON CONFLICT DO NOTHING)
4. 매핑 룰 1~3 자동 시도
5. 매핑 실패한 alias → admin 페이지 노출 → 도메니코 수동 매핑

---

## 2. 어필리에이트 리다이렉트 시스템

### 2.1 엔드포인트

`GET /go/[brandId]`

#### 동작
1. `brandId`로 `brands` 조회 (캐시 10분)
2. Geo 헤더로 지역 감지 (`request.geo.country` 또는 `cf-ipcountry`)
3. `country === 'KR'` & `affiliate_url_korea` 있으면 한국 사용. 없으면 global
4. `affiliate_clicks`에 비동기 기록 (`waitUntil`)
5. 302 리다이렉트, `Cache-Control: no-store`

#### 에러 처리
- brand 없음 / URL 둘 다 없음 → 홈으로 fallback + 에러 로그
- timeout 5초 → 홈으로 fallback

### 2.2 클릭 로그 — PII 최소화

#### Table: `affiliate_clicks`

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | uuid (PK) | |
| `brand_id` | string (FK) | |
| `editorial_id` | string (FK, nullable) | Referrer로 추적 |
| `lead_creator_id` | string (FK) | 🆕 분배 받는 대표자 |
| `region` | enum | `KR` / `GLOBAL` |
| `referrer_path` | string | URL path만 (query string 제거) |
| `ip_hash` | string | 🆕 SHA256(ip + salt) — 풀 IP 저장 X |
| `user_agent_short` | string | 🆕 첫 100자만 |
| `device_type` | enum | `mobile` / `desktop` / `tablet` |
| `clicked_at` | timestamp | |
| `session_id` | string | 24h 후 자동 만료 |

### 2.3 봇/사기 클릭 무효화

- **동일 `ip_hash` × 동일 `brand_id` × 24시간 내 클릭**: 1회만 카운트
- 1초 내 100+ 클릭 같은 비정상 패턴: 자동 차단 + 알림
- 사후 admin이 무효 처리 가능

### 2.4 기존 크레딧 링크 재라우팅

- **이전**: 크레딧 alias의 IG 또는 직접 URL
- **이후**: `role === 'fashion_by'` or `'beauty_by'` → `/go/[brandId]`
- 그 외 role (PHOTOGRAPHER, STYLIST 등) → 크리에이터 프로필 페이지

---

## 3. 크리에이터 티어 시스템

### 3.1 티어 5단계 (A안)

`BRONZE → SILVER → GOLD → PLATINUM → LEGACY`

### 3.2 6차원 평가 (각 0~10점, 총 60점)

#### (1) VOLUME — 게재 에디토리얼 수
0:0 / 1-2:2 / 3-5:4 / 6-10:6 / 11-25:8 / 26+:10

#### (2) QUALITY — 평균 별점 (유효 평가 5+)
<3.0:1 / 3.0-3.4:3 / 3.5-3.9:5 / 4.0-4.4:7 / 4.5-4.7:9 / 4.8-5.0:10

#### (3) REVENUE — 누적 어필리에이트 GMV ($)
0:0 / 1-499:2 / 500-2499:4 / 2500-9999:6 / 10000-49999:8 / 50000+:10

#### (4) REACH — 조회수 + (공유수×10)
0-999:0 / 1k-5k:2 / 5k-20k:4 / 20k-100k:6 / 100k-500k:8 / 500k+:10

#### (5) COMMUNITY — 댓글+무드보드+팀매칭 응답
0:0 / 1-9:2 / 10-29:4 / 30-99:6 / 100-299:8 / 300+:10

#### (6) TENURE — 가입 후 개월
0-2:0 / 3-5:2 / 6-11:4 / 12-23:6 / 24-47:8 / 48+:10

### 3.3 티어 임계값

| 티어 | 총점 | 분배율 |
|------|------|--------|
| BRONZE | 0–15 | 5:5 |
| SILVER | 16–29 | 5:5 |
| GOLD | 30–43 | 6:4 |
| PLATINUM | 44–54 | 6:4 |
| LEGACY | 55–60 | 7:3 |

### 3.4 티어 베네핏

| 티어 | 추가 |
|------|------|
| BRONZE | 기본 프로필, 기본 매칭 |
| SILVER | 인기 슬롯 우선, 팀 매칭 우선 |
| GOLD | 브랜드 시딩 제안, 카테고리 큐레이션 피처 |
| PLATINUM | 어드버토리얼 협업 우선, 연 1회 PAP 행사 초청 |
| LEGACY | 멘토 권한 + 보너스 분배, 연 1회 PAP 인쇄본 표지/피처, 직접 브랜드 컨택 |

### 3.5 산정 로직

- **재계산**: 매월 1일 (UTC 0시) 배치
- **승급**: 즉시 적용
- **강등**: 2개월 연속 미달 시 한 단계 강등 (단발성 슬럼프 보호)
- **수동 보정**: 도메니코 admin에서 한 단계 상향 가능
- **신규 보호**: 첫 90일 강등 없음

### 3.6 표시 UX

#### 공개 프로필 (`/#creator/@username`)
- 티어 배지: `🟤 BRONZE · 12/60`
- 6차원 레이더 차트 (Revenue 절대값 비공개, 점수만)
- 다음 티어까지 갭 표시

#### 마이페이지 — 본인 한정 — Earnings 탭
- 누적 GMV, 누적 분배 수령액
- 월별 매출 추이 차트
- 에디토리얼별 매출 breakdown
- 클릭률, 컨버전율
- 다음 산정일 + 차원별 갭

---

## 4. 🆕 수익 분배 — 대표자 단일 지급 모델 (Lead Creator Payout)

### 4.1 핵심 원칙

> **PAP는 어필리에이트 수익(크리에이터 측 분배분)을 에디토리얼의 대표자 1명에게 전액 지급한다. 팀 내 분배는 대표자의 개인 책임이며, PAP는 일체 관여하지 않는다.**

### 4.2 대표자 정의

- **대표자(Lead Creator) = submission/pullletter 제출자**
- **PAP 회원이어야 함** (필수). 비회원이 자료 보냈으면 PAP가 등록 시점에 회원인 대표자를 지정
- 한 에디토리얼당 대표자 1명 (변경 불가; 등록 후 도메니코 admin 권한으로만 수정)

### 4.3 분배 흐름

```
어필리에이트 수익 $100
        │
        ▼
  PAP 측 (티어별)         크리에이터 측 (티어별)
    BRONZE/SILVER: $50      $50 → 대표자 1명에게 전액
    GOLD/PLATINUM: $40      $60 → 대표자 1명에게 전액
    LEGACY:        $30      $70 → 대표자 1명에게 전액
        │
        ▼
   PAP 운영비           대표자가 자체적으로 팀과 분배
                        (PAP는 관여 X, 책임 X)
```

### 4.4 출판 크레딧 vs 분배 대상의 분리

- **출판 크레딧**: photographer, art direction, stylist, makeup, hair 등 팀 모두 표시 (기존과 동일)
- **분배 대상**: 대표자 1명만
- 팀원은 본인 프로필에 그 에디토리얼이 작품 목록으로 표시되고, 티어 점수 산정 시 VOLUME/REACH/QUALITY에는 카운트됨 (단, REVENUE 차원은 대표자만)

### 4.5 미수령 처리

- 대표자에게 30일 동안 지급 시도 (실패 시 재시도)
- 90일 미수령 시 **청구권 소멸**, PAP 운영비로 흡수
- 약관 명시

### 4.6 큰 금액 발생 시 세무 알림

- 대표자 연간 누적 사업소득이 **5,000만원 임계** 도달 시 시스템 알림
- "사업자등록 검토 권장 / 종합소득세 영향 가능" 안내
- 7,500만원 초과 시 강제 안내 (그러나 처리는 본인 책임)

---

## 5. 🆕 회계 정책 (Settlement & Payouts)

### 5.1 정산 주기

- **마감**: 매월 말일 24:00 (KST)
- **지급일**: 다음 달 25일
- **임계**: 누적 $50 (≈ ₩65,000) 미만 시 다음 달로 이월
- **무한 이월 방지**: 2년 누적 미도달 시 PAP 흡수 (약관 명시)

### 5.2 통화 & 환율

- **통화**: 거주 국가 기준 자동
  - 한국 거주: KRW
  - 그 외: USD
- **환율**: 정산일 기준 한국은행 고시 환율
- **환율 변동 위험**: PAP가 흡수

### 5.3 결제 수단 — Wise 단독

- **Wise 단독 채택** (PayPal보다 수수료 압도적 저렴)
- 한국: Wise → 국내 은행 계좌 이체
- 해외: Wise → 해당 국가 통화로 송금
- 송금 수수료 PAP 부담 (분배금에서 차감 X)

### 5.4 실패 지급 처리

- 잘못된 계좌, Wise 계정 폐쇄 등 → 30일 동안 자동 재시도
- 30일 후 도메니코 알림 → 대표자에게 이메일/SMS 통보
- 90일 미수령 → 청구권 소멸 + PAP 흡수

---

## 6. 🆕 크리에이터 온보딩

### 6.1 가입 자격

- **모든 PAP 크리에이터 자동 가입** (한 편이라도 출판되면 어필리에이트 자격 자동)
- 단, 어필리에이트 분배는 대표자(submission 제출자)에게만 지급

### 6.2 사업자등록

- **필수 아님** (3.3% 사업소득 원천징수로 처리)
- 연간 누적 5,000만원 도달 시 권장 알림
- 7,500만원 초과 시 강제 안내 (처리는 본인 책임)

### 6.3 본인 인증

- 신분증 사진 1회 업로드 (Supabase Storage 암호화)
- 본인 명의 계좌 확인 (1원 입금 인증, 한국)
- 5만원 미만 누적 지급은 인증 면제

### 6.4 약관 동의

- **별도 "크리에이터 어필리에이트 약관" 페이지**
- **전자서명**: 체크박스 + 타임스탬프 + IP 기록
- 동의 시점:
  - **submission 제출 시**: "이 작품의 대표자로서 어필리에이트 분배를 받습니다" 체크박스
  - **첫 분배 직전**: 풀 약관 모달 + 최종 동의

### 6.5 지급 정보 등록

- 마이페이지 → Earnings 탭 → "Payout Settings" 서브섹션
- 한국: 은행명 + 계좌번호 + 예금주
- 해외: Wise 등록 이메일
- 변경 시 7일 cooldown (사기 방지)

---

## 7. 🆕 세금 처리

### 7.1 한국 거주 대표자

- **사업소득 3.3% 원천징수** (PAP가 떼서 신고)
- 매월 분배 시 자동 차감 후 송금
- 연말 1월: 지급명세서 자동 발급 (이메일)
- 종합소득세 신고는 본인 책임

### 7.2 해외 거주 대표자

- 자국 세무 책임 = 대표자 본인
- 매년 1월: Annual Statement 자동 이메일 발송 (전년 지급 내역)
- 자국 신고용으로 사용

### 7.3 PAP의 세무 의무

- 한국: 매월 사업소득 신고 (홈택스)
- 부가가치세: 어필리에이트 수익 = 광고대행 서비스 → **과세 사업** 처리
- 크리에이터 분배는 사업소득 지급액으로 비용 처리

> 세무 디테일은 시행 전 세무사 자문 필수.

---

## 8. 🆕 프라이버시 & 데이터 보관

### 8.1 PII 최소화 원칙

- IP: SHA256(ip + salt) 해시 후 저장 (역추적 불가)
- User-Agent: 첫 100자만
- Referrer: query string 제거 (UTM 등 노이즈 제거)
- session_id: 24시간 후 자동 만료

### 8.2 보관 기간

| 데이터 | 보관 | 이후 |
|--------|------|------|
| 클릭 로그 (PII 포함) | 24개월 | 익명화 (creator_id, brand_id만) |
| 정산 증빙 | 5년 | 한국 세법 의무 |
| 회원 탈퇴 시 PII | 즉시 삭제 | 통계 데이터는 익명화 후 유지 |
| 분쟁 기록 | 3년 | 분쟁 종료 후 |

### 8.3 쿠키

- 어필리에이트 클릭 = 서버 로그 (DB), 클라이언트 쿠키 사용 X
- GDPR/한국 ITP 추가 동의 불필요

### 8.4 크리에이터 데이터 권리

- 마이페이지 → "Download My Data": CSV 내보내기 (분배 내역 전체)
- "Delete My Data": 개인 식별자 즉시 삭제 (5년 회계 의무 외)

---

## 9. 🆕 분쟁 & 운영 정책

### 9.1 봇/사기 클릭 무효화

- 동일 `ip_hash` × 동일 `brand_id` × 24시간 내: 1회만 카운트
- 1초 내 100+ 클릭 자동 차단
- 사후 admin이 무효 처리 가능

### 9.2 브랜드 거부 권한

- PAP은 도덕적·법적·전략적 사유로 어떠한 브랜드도 사전 통지 없이 거부/제거할 수 있음 (약관 명시)
- 거부 시 `status = archived` + `rejected_reason` 기록

### 9.3 분쟁 처리 채널

- **1차**: 마이페이지 "Dispute" 버튼 (자동 티켓 생성)
- **2차**: 이메일 `contact@pap-magazine.com`
- 도메니코 검토 + 7일 내 회신 약속
- PAP의 최종 결정권 (약관 명시)

### 9.4 분배 산정 분쟁

- 대표자가 PAP 분배 금액에 이의 → Dispute 채널
- 팀원이 대표자에게 받지 못한 경우 → **PAP 책임 외**, 팀원이 대표자 상대로 직접 청구

---

## 10. 🆕 약관 핵심 조항 (초안)

> 회원가입 시 동의 + submission 제출 시 재확인 + 첫 분배 직전 풀 모달

### 제1조 (목적)
PAP MAGAZINE 어필리에이트 시스템에 참여하는 크리에이터(이하 "크리에이터")의 권리·의무 및 PAP과 크리에이터 간의 책임을 정함.

### 제2조 (대표자 단일 지급 원칙)
1. PAP은 어필리에이트 수익의 크리에이터 분배분을 에디토리얼의 **대표자 1명**(submission 또는 pullletter 제출자)에게 전액 지급한다.
2. 대표자는 PAP 회원이어야 한다. 비회원은 어필리에이트 분배 대상이 아니다.
3. 대표자는 매 에디토리얼당 1명이며, 등록 후 변경할 수 없다 (PAP의 admin 권한 예외).

### 제3조 (수익 분배의 책임 한계)
1. 대표자가 동일 에디토리얼 제작에 참여한 다른 크리에이터(이하 "팀원")와의 내부 분배는 **대표자의 개인 책임**으로 한다.
2. PAP는 다음에 대해 일체의 책임을 지지 않는다:
   - 대표자가 팀원에게 분배하지 않는 경우
   - 분배 비율에 관한 팀 내 분쟁
   - 분배 지연·미지급·부분 지급
   - 대표자의 자산 문제(파산·압류 등)로 인한 팀원 미수령
3. 팀원이 PAP에 직접 분배 청구할 권리는 인정되지 않으며, 모든 청구는 대표자를 상대로 한다.
4. PAP의 책임은 대표자에게 정확한 금액을 정확한 시점에 지급한 것으로 완료된다.

### 제4조 (정산 및 지급)
1. 정산: 매월 말일 24:00 (KST) 마감, 다음 달 25일 지급.
2. 임계: 누적 $50 미만 시 다음 달로 이월. 2년 누적 미도달 시 청구권 소멸.
3. 통화 및 환율: 정산일 기준 한국은행 고시 환율 적용.
4. 송금 수단: Wise 단독.
5. 미수령: 90일 미수령 시 청구권 소멸 + PAP 흡수.

### 제5조 (세무 책임)
1. 한국 거주 대표자: PAP이 사업소득 3.3% 원천징수 후 신고.
2. 해외 거주 대표자: 자국 세무는 본인 책임. PAP는 매년 1월 Annual Statement만 제공.
3. 대표자 연간 누적 사업소득이 5,000만원 도달 시 PAP은 사업자등록을 권고할 수 있으나, 사업자등록 의무는 대표자 본인에게 있다.

### 제6조 (브랜드 거부 권한)
PAP은 도덕적·법적·전략적 사유로 어떠한 브랜드도 사전 통지 없이 어필리에이트 시스템에서 거부·제거할 수 있다.

### 제7조 (분쟁 해결)
1. 분쟁은 마이페이지 Dispute 채널을 1차로 한다.
2. PAP은 7일 내 회신을 약속한다.
3. 분쟁의 최종 결정권은 PAP에게 있다.
4. 본 약관에 관한 소송의 관할은 서울중앙지방법원으로 한다.

### 제8조 (개인정보 처리)
1. PAP은 클릭 로그의 IP를 해시화하여 저장한다.
2. 클릭 로그는 24개월 후 익명화된다.
3. 정산 증빙은 한국 세법에 따라 5년 보관된다.
4. 회원 탈퇴 시 PII는 즉시 삭제하나, 회계 의무 데이터는 5년 보관된다.

### 제9조 (약관 변경)
PAP은 본 약관을 변경할 수 있다. 중대한 변경은 30일 전 이메일·사이트 공지로 안내한다.

---

## 11. 구현 순서 (Phase별)

### Phase 0 — 데이터 기반 (1주차)
- `brands`, `brand_aliases`, `editorial_brand_credits`, `affiliate_clicks` 테이블 생성
- 시드 brand 49개 INSERT
- 기존 에디토리얼 크레딧 자동 추출 + 자동 매핑
- 매핑 실패 alias → admin 노출

### Phase 1 — 어필리에이트 인프라 (2주차)
- `/go/[brandId]` 리다이렉트 핸들러
- Geo 분기 + 클릭 로그 (PII 최소화)
- 봇 방어 (24h 중복 1회 카운트)
- 기존 크레딧 링크 재라우팅
- 단위·E2E 테스트

### Phase 2 — 정산 + 약관 + 본인 인증 (3주차)
- `creator_lead_payouts` 테이블 (대표자별 누적 분배)
- Wise API 연동
- 약관 페이지 + 전자서명
- 신분증 업로드 + 1원 입금 인증
- 마이페이지 Earnings 탭 + Payout Settings
- 매월 25일 자동 정산 잡

### Phase 3 — 티어 시스템 (4주차)
- `creator_scores` 테이블 (6차원 점수 캐시)
- 매월 1일 배치 산정
- 프로필 페이지 티어 배지 + 레이더 차트
- 강등 보호 (2개월 룰, 신규 90일)

### Phase 4 — 운영 (5주차)
- Admin: brand 매핑 보정, 티어 수동 조정, 분쟁 처리
- 어필리에이트 매핑 우선순위 큐 (직계약 후보 식별)
- 첫 5명 베타 안내 + 약관 풀 동의
- 세무사 검토 후 라이브

---

## 12. 환경 변수

```bash
# DB
DATABASE_URL=postgresql://...

# Site
NEXT_PUBLIC_SITE_URL=https://www.pap-magazine.com

# Affiliate networks
AWIN_PUBLISHER_ID=...
LTK_API_KEY=...
SKIMLINKS_API_KEY=...

# Wise (정산)
WISE_API_TOKEN=...
WISE_PROFILE_ID=...
WISE_WEBHOOK_SECRET=...

# 환율 (한국은행)
BOK_API_KEY=...

# 보안
PAP_IP_HASH_SALT=...     # 클릭 로그 IP 해싱용
PAP_DOC_ENCRYPT_KEY=...  # 신분증 암호화

# Analytics
ANALYTICS_DOMAIN=pap-magazine.com
```

---

## 13. 완료 기준 (Acceptance Criteria)

### 데이터/매핑
- [ ] 어드민이 brand 1개 + URL 2개 입력 시 10분 내 사이트 반영
- [ ] 시드 49 brand + 자동 추출된 alias가 admin에서 검수 가능

### 어필리에이트
- [ ] 한국 IP `/go/balenciaga` 클릭 → 한국 어필리에이트 URL 리다이렉트
- [ ] 글로벌 IP 같은 클릭 → 글로벌 URL 리다이렉트
- [ ] 어필리에이트 URL이 사이트 HTML 소스에 절대 노출 X
- [ ] 모든 클릭이 PII 최소화 형태로 `affiliate_clicks` 기록
- [ ] 24시간 중복 클릭 1회 카운트 검증

### 분배
- [ ] 대표자 1명에게 전액 자동 지급
- [ ] 매월 25일 자동 정산 정상 실행
- [ ] $50 미만 다음 달 이월 검증
- [ ] 한국 거주자 3.3% 자동 차감
- [ ] 해외 거주자 1월 Annual Statement 자동 발송
- [ ] Wise API 송금 성공 + 실패 시 재시도

### 약관/보안
- [ ] 약관 동의 시 IP + 타임스탬프 기록
- [ ] 신분증 업로드 암호화 저장
- [ ] 1원 입금 인증 정상 동작
- [ ] 분쟁 채널 (마이페이지 + 이메일) 작동

### 티어
- [ ] 매월 1일 자동 재계산 잡 정상 실행
- [ ] 프로필에 티어 배지 + 레이더 차트 표시
- [ ] 강등 보호 (2개월 룰) 작동

### 성능
- [ ] Lighthouse 모바일 90+ 유지
- [ ] `/go/[id]` 응답 시간 200ms 이하 (95th percentile)

---

## 14. 향후 (이번 빌드 이후)

- 위시리스트 (어필리에이트 컨버전 30~50% 향상)
- 한정 콜라보 드롭 (PAP × 디자이너 캡슐)
- 멤버십 프리미엄 티어 ($10~30/월)
- 직계약 브랜드 협상 (상위 GMV)
- 어드버토리얼 정식 상품화 (어필리에이트와 별도 처리, 광고비는 PAP 100%, 출연료 별도)
- 팀 내 자동 분배 옵션 (대표자가 PAP 시스템 안에서 분배 비율 설정해서 자동 송금) — 옵션 기능, 강제 X
