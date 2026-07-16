# PAP MAGAZINE — 보안 현황 및 운영 가이드

> 2026-07-04 전체 보안 감사 + 강화 작업 완료 기준. 결론: **치명/높음 이슈 0건** (강화 후).

## 감사 결과 요약

### 이미 잘 구축돼 있던 것 (변경 없음)

| 영역 | 상태 |
|---|---|
| 인증 | JWT(HS256) + httpOnly/Secure/SameSite=Lax 쿠키 — XSS로 토큰 탈취 불가 |
| 권한 | 3계층 RBAC (requireAuth → requireAdmin → requireMainAdmin), admin은 매 요청 DB 재확인 |
| CSRF | 더블 서브밋 쿠키 패턴 |
| 웹훅 | Paddle/PortOne 모두 서명 검증 (HMAC + 리플레이 가드) |
| CORS | 화이트리스트 기반 (와일드카드 아님) |
| XSS | SSR 렌더러 전체 escText/escAttr/escJson 이스케이프 |
| 인젝션 | Supabase 클라이언트 파라미터라이즈, 스토리지 경로 정규식 검증 |
| 시크릿 | 하드코딩 0건, JWT_SECRET 폴백 없음, 프론트엔드엔 anon key만 (RLS 보호) |
| HSTS | 2년 + includeSubDomains + preload |
| 어택 프로브 차단 | /.env, /.git, /wp-* 등 → 404 |

### 이번에 강화한 것 (2026-07-04)

1. **영속 레이트리밋** — 기존 인메모리 리미터는 서버리스 콜드스타트마다 리셋되어 로그인 브루트포스를 실질적으로 못 막았음. login / signup / send-code / verify-code 4개 엔드포인트를 Supabase 기반 원자적 카운터(`rl_hit` RPC)로 전환. DB 장애 시 인메모리 폴백(fail-open — 로그인 불능 사고 방지).
   - 파일: `supabase_migrations/060_rate_limits.sql`, `api/_lib/rateLimit.js` (rateLimitStrict)
2. **강제 CSP 기본선 추가** — 기존 CSP는 Report-Only(모니터링만). 사이트를 깨뜨릴 수 없는 최소 강제 정책을 병행: `object-src 'none'; base-uri 'self'; frame-ancestors 'none'; upgrade-insecure-requests`. 전체 정책은 Report-Only로 계속 관찰 후 위반 0 확인되면 강제 전환(아래 로드맵).
   - **(2026-07-16 갱신) 완전 강제 전환 완료.** 위 단계적 롤아웃이 승격되지 않은 채 방치돼(게다가 `report-uri` 미설정으로 위반 수집 자체가 불가능했음) 콘텐츠 페이지(index/editorial/articles 등, meta CSP 없는 페이지)가 사실상 무방비였음. Report-Only 정책 + 결제/로그인 페이지 5종의 `<meta>` CSP + 콘텐츠 렌더러 실측(youtube/vimeo/instagram 임베드, S3 영상)의 **합집합(superset)**으로 정식 `Content-Security-Policy` 를 구성해 enforcing 으로 승격, Report-Only 는 제거(이중 구조 해소). 보강분: `cdn.jsdelivr.net`(Supabase 라이브러리 — 기존 Report-Only 에 누락되어 그대로 승격했다면 로그인/DB 가 깨졌을 gap), `js.tosspayments.com`/`*.iamport.co`(결제), `media-src`(영상 재생), `worker-src`, GA 리전 엔드포인트(`*.google-analytics.com`). 제거: 미사용 `api.anthropic.com` connect(브라우저→Anthropic 직결은 불필요·스멜). superset 이므로 meta CSP 페이지와 교집합돼도 새로 차단되는 리소스 없음.
3. **Permissions-Policy payment 수정** — `payment=()`가 Paddle 체크아웃의 Apple Pay/Google Pay(Payment Request API)를 차단할 수 있어 `payment=(self "https://buy.paddle.com" "https://sandbox-buy.paddle.com")`로 변경.
4. **X-XSS-Protection: 1 → 0** — 구형 XSS Auditor는 오히려 취약점 벡터. 현대 권장값 0.
5. **개발 유틸 페이지 차단** — `/data-migration.html`(service key 입력 유도 마이그레이션 툴), `/index.html.backup-pre-i18n-cards` → 404. 파일은 리포에 남아있으니 필요 시 로컬에서만 사용.
6. **에러 상세 노출 제거** — `api/submissions/upload-url.js`(공개 엔드포인트)가 Supabase 내부 에러 메시지를 클라이언트에 반환하던 것 제거. `api/media/upload.js`의 상세 노출은 관리자 전용 + 의도적 디버깅(QA #100)이라 유지.

### 추가 하드닝 (2026-07-16)

7. **CSP 정식 강제 + 위반 수집** — CSP 이중구조 해소(위 2번), 강제 정책에 `report-uri /api/csp-report; report-to csp-endpoint` + `Reporting-Endpoints` 헤더 추가. 새 엔드포인트 `api/csp-report.js` 가 위반을 Vercel Logs 에 `[csp-report]` 로 기록(DB 불필요, IP당 분당 30 레이트리밋, 항상 204). 이제 "뭐가 막혔는지"가 관측 가능 → 이중구조 방치의 근본 원인(수집 부재) 해소.
8. **cron_runs RLS 활성화** — `078_cron_runs.sql` 이 RLS 없이 테이블을 만들어 방어 격차가 있었음(라이브 anon 조회는 0행이라 확정 유출은 아니나, RLS 없는 public 테이블은 anon 키만으로 읽기/쓰기 가능한 구조). `080_cron_runs_rls.sql` 로 RLS on(정책 0개=anon 전면 차단, service_role 우회라 동작 불변).
9. **시크릿 스캔 통과** — 추적 파일에 하드코딩된 비밀값 없음 확인. 프론트 Supabase 키는 전부 `role=anon`(공개 설계상 안전), service_role/개인키/실 stripe 키 커밋 없음. `.env*` gitignore 확인.

## 배포 절차 (도메니코)

1. **Supabase SQL Editor**에서 실행 (각 Success 확인):
   - `supabase_migrations/060_rate_limits.sql`
   - `supabase_migrations/080_cron_runs_rls.sql` ← 2026-07-16 추가
2. 커밋/푸시 → Vercel 자동 배포
3. 배포 후 확인:
   - 로그인 1회 정상 동작 + 구독 페이지에서 결제창 열림(Paddle/포트원/토스)
   - 응답 헤더에 통합 `Content-Security-Policy`(강제) 1개만 존재(Report-Only 없음)
   - 콘솔에 `Refused to ... Content-Security-Policy` 위반 없는지 주요 페이지 순회
   - `POST /api/csp-report` 가 204 반환하는지(위반 발생 시 Vercel Logs `[csp-report]` 확인)

> 순서 중요: SQL을 먼저 실행해야 함. (먼저 배포해도 인메모리 폴백으로 동작은 하지만 RPC 에러 로그가 쌓임)

## 운영 습관

- **월 1회**: Vercel 대시보드 → 프로젝트 → Logs에서 `429`(레이트리밋 발동)와 `[rateLimitStrict] DB fallback` 검색. 429가 비정상적으로 많으면 공격 시도 — Vercel Firewall에서 해당 IP 차단.
- **분기 1회**: Supabase 대시보드 → Authentication/Database에서 이상 트래픽 확인. `DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day';`로 카운터 정리(선택).
- **키 로테이션**: Paddle API key는 2027-07-02 만료 — 만료 전 재발급 후 Vercel env 교체. JWT_SECRET은 유출 의심 시에만 교체(전 사용자 재로그인 발생).
- 새 API 엔드포인트를 만들 때는 반드시: `handleCors` + (쓰기 작업이면) `requireAdmin`/`requireAuth` + `rateLimit` 3종 세트.

## 다음 단계 로드맵 (선택)

1. ~~**CSP 완전 강제 전환**~~ — ✅ 완료(2026-07-16, 위 "이번에 강화한 것" 2번 참조). 남은 하드닝: `script-src`에서 `'unsafe-eval'`·`'unsafe-inline'` 제거(nonce 기반 전환). **운영 프로세스:** 향후 CSP 변경분은 먼저 `Content-Security-Policy-Report-Only` 헤더로 병행 배포해 라이브 위반을 관찰(가능하면 `report-uri`/`report-to` 수집 엔드포인트 추가)한 뒤 정식 헤더로 승격할 것 — 이번처럼 승격 없이 방치되지 않도록 변경 단위로 처리.
2. **Vercel Firewall (WAF)** — Pro 플랜이면 대시보드에서 Bot 차단 + IP 레이트리밋 룰 추가 (코드 변경 없이 겹벽).
3. **의존성 자동 점검** — GitHub 리포 Settings → Security → Dependabot alerts 활성화 (무료, 1클릭).
4. **Supabase RLS 정기 감사** — 새 테이블 추가 시 RLS 활성화 여부 체크리스트화.
