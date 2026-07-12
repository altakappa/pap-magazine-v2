# 프론트 코드 규칙 (frontend/** 작업 시)

- `pap-*.js` 수정 시 참조 HTML(10개)의 `?v=` 캐시버스트 동반 — 빠뜨리면 사용자에게 옛 코드가 서빙됨
- 회원 등급 게이트 변경 시 3종(Free/Standard/Premium) 전부 + subscribe 9개 언어 문구 정합 확인
- SEO SSR 페이지(api/seo/*)와 SPA 화면의 내용 불일치 금지
- 신규 UI는 frontend-design 스킬 기준(밋밋한 템플릿 디자인 금지) + 50_Brand 가이드
