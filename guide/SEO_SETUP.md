# PAP MAGAZINE — SEO 운영 가이드 (검색엔진 제출 체크리스트)

> 2026-07-04 기준. 코드 구현 완료 항목과 도메니코가 각 검색엔진 콘솔에서 할 일.

## 구현된 SEO 인프라 (참고)

| 자산 | URL | 용도 |
|---|---|---|
| 사이트맵 인덱스 | `/sitemap-index.xml` | 전체 사이트맵의 허브 |
| 정적+에디토리얼 | `/sitemap.xml` | 이미지 포함 |
| 기사 | `/sitemap-articles.xml` | 이미지 포함 |
| 필름 | `/sitemap-films.xml` | |
| **뉴스 (신규)** | `/sitemap-news.xml` | 최근 48시간 기사 — Google News |
| **RSS (신규)** | `/rss.xml` | 기사+에디토리얼 최신 50 — 네이버 수집 핵심 |
| **아카이브 (신규)** | `/archive` | 서버 렌더 전체 링크 인덱스 — JS 못 읽는 크롤러용 |
| 상세 SSR | `/editorial/:slug` `/article/:slug` `/film/:slug` | Article/NewsArticle/VideoObject 스키마 |

내부 링크: 홈 정적 기사 카드 64개 + 모든 동적 카드가 실제 `<a href>` (SPA 클릭 동작 유지).

---

## 1. 네이버 서치어드바이저 (searchadvisor.naver.com)

사이트는 이미 소유 확인됨 (`naver-site-verification` 메타 존재).

1. 로그인 → **웹마스터 도구** → `https://www.pap-magazine.com` 선택
2. **요청 > 사이트맵 제출**: `https://www.pap-magazine.com/sitemap-index.xml` 입력·제출
3. **요청 > RSS 제출**: `https://www.pap-magazine.com/rss.xml` 입력·제출 ← **네이버 수집에 가장 중요**
4. **요청 > 웹 페이지 수집**: 주요 URL 수동 수집 요청 (하루 최대 50건):
   - `https://www.pap-magazine.com/`
   - `https://www.pap-magazine.com/archive`
   - 최신 에디토리얼/기사 상세 몇 건
5. **검증 > robots.txt** 에서 정상 수집 확인
6. 1~2주 후 **리포트 > 색인 현황**에서 색인 수 증가 확인

## 2. Google Search Console (search.google.com/search-console)

사이트는 이미 소유 확인됨 (`google-site-verification` 메타 존재).

1. 속성 `www.pap-magazine.com` 선택
2. **Sitemaps**: `sitemap-index.xml` 제출 (기존 제출돼 있으면 상태만 확인). `sitemap-news.xml`도 개별 제출
3. **URL 검사**: `/archive` 와 최신 기사 URL 검사 → "색인 생성 요청"
4. **Google Publisher Center** (publishercenter.google.com): PAP MAGAZINE 간행물 등록 → Google News 노출 신청 (뉴스 사이트맵이 이미 준비돼 있어 심사에 유리)
5. 2주 후 **색인 생성 > 페이지**에서 커버리지 확인 — "발견됨-크롤링 안 됨"이 줄어드는지

## 3. 다음/빙 (선택)

- Bing Webmaster Tools: Google Search Console 계정 연동으로 1클릭 이전 가능
- 다음(Daum): 검색등록 (register.search.daum.net) 에서 사이트 등록

## 4. 운영 습관

- 새 에디토리얼/기사 발행 → 자동으로 사이트맵/RSS/아카이브 반영 (30분 내). 별도 작업 불필요
- 특별히 빨리 색인시키고 싶은 콘텐츠만 서치어드바이저/서치콘솔에서 수동 수집 요청
- 월 1회: 서치콘솔 "페이지" 리포트에서 색인 오류 확인

## 5. 다음 단계 후보 (추후)

- 이미지 최적화 (S3 원본 → 리사이즈/WebP CDN) — Core Web Vitals(LCP) 개선
- 에디토리얼 SSR 페이지에 관련 콘텐츠 내부링크 블록 추가 (링크 그래프 밀도 강화)
- 기사 SSR에 FAQ/HowTo 등 추가 스키마 (해당 유형 콘텐츠 발행 시)
