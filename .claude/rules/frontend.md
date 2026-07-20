# 프론트 코드 규칙 (frontend/** 작업 시)

- `pap-*.js` 수정 시 참조 HTML(10개)의 `?v=` 캐시버스트 동반 — 빠뜨리면 사용자에게 옛 코드가 서빙됨
- 회원 등급 게이트 변경 시 3종(Free/Standard/Premium) 전부 + subscribe 9개 언어 문구 정합 확인
- SEO SSR 페이지(api/seo/*)와 SPA 화면의 내용 불일치 금지
- 신규 UI는 frontend-design 스킬 기준(밋밋한 템플릿 디자인 금지) + 50_Brand 가이드

## 아티클 상세페이지 — 단일 템플릿 원칙 (2026-07-20, QA 재발 방지)
- 아티클 상세는 **정확히 2개의 렌더러만** 존재하며 그 외 신규 생성 금지:
  - SSR: `api/seo/article/[slug].js` → `seoRenderer.renderSeoHtml('article', …)`
  - SPA: `frontend/pap-content-article.js` `_renderArticleDetail()` (컨테이너 `#artDetail*` 공용)
- **데이터 소스(관리자 등록 / 인스타그램 연동 / 향후 신규 연동)가 달라도 템플릿 분기 금지.**
  새 소스는 반드시 **어댑터**(`apiArticleToLocal` 등 `frontend/pap-content-api-sync.js`)에서
  공통 포맷 `{t, th, d, cat, ig, gallery, videos, content, …}` 으로 매핑만 한다.
- 소스별로 달라 보이는 건 **데이터 유무에 따른 조건부 블록**(예: `source_instagram_url` 있으면
  IG 원본 CTA, 이미지 여러 장이면 `seo-gallery`)이어야 하며, 이는 정상. 새 템플릿·새 상세 페이지
  파일을 만드는 것은 금지.
- 신규 기사 관련 기능 개발 시 이 원칙을 먼저 확인하고, 위 2개 렌더러를 확장하는 방식으로만 작업.
