# 어필리에이트 가동 체크리스트 (2026-07-06 시스템 배포 기준)

시스템은 배포 즉시 작동한다 (SHOP THE STORY → /go → 무신사/파페치 검색 폴백 + 클릭 로그).
아래는 **수수료가 실제 입금되게 만드는** 계정 단계 — 각 15분 내외.

## 1. Skimlinks (해외 매출 — 방문자 60%+ 커버, 최우선)
1. signup.skimlinks.com 에서 퍼블리셔 가입
   - 사이트: https://www.pap-magazine.com / 카테고리: Fashion & Style / 월 트래픽: 그대로 기입
2. 승인 메일(보통 1~3일) 수신 후 대시보드에서 **Publisher ID** 확인
3. Vercel → pap-magazine-v2 → Environment Variables → `SKIMLINKS_PUB_ID` 추가 → Redeploy
   → 이 순간부터 해외 폴백(파페치 검색 포함 4만+ 몰)이 전부 수수료 링크로 자동 래핑됨
4. 확인: /go/zara 클릭 → 최종 URL 이 go.skimresources.com 경유인지

## 2. 무신사 파트너스 (국내 매출)
1. partners.musinsa.com 가입 (사업자등록증 필요)
2. 주요 브랜드별 파트너 링크 발급 → 아래 SQL 로 일괄 등록

## 3. 브랜드 파트너 링크 일괄 등록 SQL (Supabase SQL Editor)
affiliate_url_* 는 '완성된 링크'로 취급된다 (Skimlinks 재래핑 안 함).
파트너스에서 발급한 링크만 넣을 것 — 일반 쇼핑몰 URL을 넣으면 오히려 수수료를 잃는다.

```sql
-- 형식: 브랜드당 한 줄. brand_id 는 어드민/DB의 정규화 id.
UPDATE brands SET affiliate_url_korea = '<무신사 파트너스 링크>' WHERE brand_id = 'adidas';
UPDATE brands SET affiliate_url_korea = '<무신사 파트너스 링크>' WHERE brand_id = 'zara';
-- 글로벌 전용 딜(예: FARFETCH 직접 제휴)이 생기면:
-- UPDATE brands SET affiliate_url_global = '<링크>' WHERE brand_id = '<id>';

-- 등록 대상 우선순위 = 클릭이 실제로 발생한 브랜드부터:
SELECT brand_id, count(*) AS clicks
FROM affiliate_clicks
GROUP BY brand_id ORDER BY clicks DESC LIMIT 20;
```

## 4. 성과 확인
- 클릭 현황: 위 SELECT 쿼리 또는 /site-analysis (요청 시 어필리에이트 섹션 추가 가능)
- Skimlinks 대시보드: 몰별 수수료 리포트

## 원칙
- 공시 문구는 SHOP THE STORY 하단에 자동 표기됨 ("수수료가 지급될 수 있습니다")
- 에디토리얼 셀렉션이 수수료에 영향받지 않는다는 편집 독립 원칙 유지
