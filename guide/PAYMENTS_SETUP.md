# PAP 결제 시스템 셋업 가이드 (이원화: 국내 포트원 + 해외 Paddle)

> 2026-07-03 기준. 개발(코드)은 완료 — 아래는 도메니코가 진행할 사업/설정 단계.
>
> 구조: 한국 사용자 → 포트원 빌링키 정기결제(KRW) / 해외 사용자 → Paddle Billing(EUR·USD, VAT는 Paddle이 MoR로 처리). subscribe 페이지에서 자동 추천 + 수동 선택.

---

## STEP 1. 포트원 — PG 변경 신청 (국내 레일)

1. 포트원 관리자콘솔 접속 → 결제 연동 > 채널 관리
2. 담당자/채팅으로 요청:
   > "토스페이먼츠 계약 신청이 3개월째 응답이 없어 철회하고, **나이스페이먼츠**(또는 KG이니시스)로 계약을 변경 신청합니다. 디지털 매거진 정기구독, **빌링키 정기결제** 사용 예정입니다."
3. 심사 서류: 사업자등록증, 대표자 신분증, 통장 사본, 사이트 URL (통상 1~2주)
4. 승인 후 콘솔에서 **라이브 채널 키** 발급 → STEP 4에서 교체

## STEP 2. Paddle — 계정 개설 (해외 레일)

1. paddle.com → Sign up (한국 법인 가능)
2. 사업 정보 입력: ALTAKAPPA Co., Ltd., 사업자등록번호, 웹사이트 URL
3. 심사 요건 (사이트에 있어야 함):
   - 이용약관(있음), 개인정보처리방침(있음), **환불 정책**(보강 필요 — terms에 구독 해지/환불 조항 확인)
   - 가격이 명확히 표시된 구독 페이지 (있음 — /subscribe)
4. 심사 대기 중에도 **Sandbox 계정**은 즉시 생성 가능 → sandbox.paddle.com

## STEP 3. Paddle 대시보드 설정 (Sandbox에서 먼저, 승인 후 Live 반복)

1. **Catalog > Products** — 상품 2개 생성: PAP Standard / PAP Premium
2. 각 상품에 Price 추가 (Recurring):
   - Standard Monthly (예: $5.99/월), Standard Yearly (예: $59/년)
   - Premium Monthly (예: $9.99/월), Premium Yearly (예: $99/년)
   - 통화는 USD 기본 + EUR 추가 가능 (Paddle이 지역별 자동 표시)
   - 생성된 `pri_...` ID 4개 복사
3. **Developer Tools > Authentication**:
   - API Key 생성 (서버용) → `PADDLE_API_KEY`
   - Client-side Token 생성 → `PADDLE_CLIENT_TOKEN`
4. **Developer Tools > Notifications** — Webhook 추가:
   - URL: `https://www.pap-magazine.com/api/paddle-webhook`
   - 구독 이벤트: subscription.created / updated / canceled / paused / resumed, transaction.completed / payment_failed
   - 생성된 Secret → `PADDLE_WEBHOOK_SECRET`

## STEP 4. Vercel 환경변수 등록

Vercel 대시보드 > pap-magazine 프로젝트 > Settings > Environment Variables:

```
PADDLE_ENV=sandbox            # 테스트 단계. 라이브 전환 시 production
PADDLE_API_KEY=...
PADDLE_WEBHOOK_SECRET=...
PADDLE_CLIENT_TOKEN=...
PADDLE_PRICE_STD_M=pri_...
PADDLE_PRICE_STD_Y=pri_...
PADDLE_PRICE_PREM_M=pri_...
PADDLE_PRICE_PREM_Y=pri_...
```

포트원 라이브 승인 후에는 `subscribe.html`의 `_PAP_PORTONE_CHANNEL_KEY`(현재 토스 테스트 채널)를 새 PG 라이브 채널 키로 교체.

## STEP 5. DB 마이그레이션

Supabase SQL Editor에서 `supabase_migrations/059_subscriptions_paddle.sql` 실행
(paddle_customer_id / paddle_subscription_id 컬럼 추가).

## STEP 6. 테스트 (Sandbox)

1. `PADDLE_ENV=sandbox` 상태로 배포
2. 해외 환경 시뮬레이션: 브라우저 언어 EN + subscribe 페이지 → 구독하기 → "🌍 International" 선택
3. Paddle 테스트 카드: `4242 4242 4242 4242`, 만료 미래, CVC 100
4. 결제 후 확인:
   - mypage에서 구독 상태 active
   - Supabase subscriptions 테이블에 paddle_* 값 저장
   - Paddle 대시보드 > Subscriptions에 구독 표시
5. 해지 테스트: Paddle 대시보드에서 구독 취소 → 웹훅으로 status canceled 반영 확인

## STEP 7. 라이브 전환

1. Paddle 실계정 승인 완료 후 STEP 3을 Live 대시보드에서 반복
2. Vercel 환경변수를 Live 값으로 교체 + `PADDLE_ENV=production`
3. 포트원 새 PG 승인 → 채널 키 교체
4. 실카드 소액 결제로 양쪽 레일 최종 검증

---

## 구현된 코드 (참고)

| 파일 | 역할 |
|---|---|
| `api/paddle-webhook.js` | Paddle 웹훅 — 서명 검증, 구독 생성/갱신/해지 → subscriptions + profiles 반영 |
| `api/subscriptions/paddle-config.js` | 클라이언트 설정 (환경/토큰/price ID) |
| `api/subscriptions/paddle-portal.js` | 해외 구독 해지 (기간 말 종료) |
| `frontend/pap-api.js` | `PAP.subscriptions.checkoutIntl()` — Paddle 오버레이 체크아웃 |
| `frontend/subscribe.html` | 결제 지역 선택 모달 (국내/해외), 언어·시간대 기반 기본값 |
| `supabase_migrations/059_subscriptions_paddle.sql` | paddle_* 컬럼 |

제한사항 (v1): 해외 결제는 로그인 필수 (비회원은 가입 유도). 국내 레일의 비회원 결제는 기존대로 동작.
