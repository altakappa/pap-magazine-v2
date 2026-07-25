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

## 언어 정책 (2026-07-26, 감사 C-2 명문화)

**"영어로 설정하면 전부 영어, 한국어로 설정하면 전부 한국어."** 회원 대면 화면과
운영자 대면 화면을 구분해 적용한다.

- **회원 대면(9개 언어 필수)** — `ko en de it fr es ja zh ru`.
  정상 흐름뿐 아니라 **오류·검증·빈 상태 문구까지** 사전을 거친다.
  서버 응답의 영문 `message` 를 화면에 그대로 쓰지 말고, 응답의 `code` 를
  언어별 문구로 매핑한다(예: `frontend/submission.html` 의 `_localizeApiError`).
- **운영자 대면(한국어 고정 허용)** — `frontend/pap-admin.js` 관리자 콘솔 UI,
  텔레그램 알림(`api/_lib/telegram.js` 호출부), 크론/브리핑 로그.
  운영진이 한국어권이라 의도적으로 고정한 것이며 번역 대상이 아니다.
  단, 관리자 화면이라도 **회원에게 그대로 전달되는 문구**(거절 사유, 이메일 본문)는
  회원 대면 규칙을 따른다.

### 언어 전환이 깨지는 두 가지 함정 (재발 방지)
1. **폴백은 반드시 영어**. `L[l] || L.ko` 로 두면 사전에 없는 언어가 통째로
   한국어로 뜬다. `L[l] || L.en` + 키 단위 폴백(`d[k] || L.en[k]`)까지 건다.
   마크업 리터럴에 한글을 남기지 않는 것도 같은 이유다.
2. **전역 `setLang` 충돌**. `pap-i18n.js` 는 defer 로 로드되며 전역 `setLang` 을
   덮어쓴다. 인라인 스크립트가 먼저 실행되므로 페이지의 `setLang` 은 항상 진다.
   최초 로드만 정상이고 **선택기로 바꾸면 페이지 전용 사전이 반영되지 않는다.**
   페이지에 자체 `setLang` 을 두면 반드시 아래를 함께 넣는다:
   ```js
   var _papPageSetLang = setLang;                  // 덮어쓰이기 전에 참조 확보
   document.addEventListener('DOMContentLoaded', function(){
     var g = window.setLang;
     if(typeof g !== 'function'){ window.setLang = _papPageSetLang; return; }
     if(g === _papPageSetLang || g._papPageChained) return;
     var chained = function(l){
       try{ g.apply(this, arguments); }catch(e){}
       try{ _papPageSetLang(l); }catch(e){}
     };
     chained._papPageChained = true;
     window.setLang = chained;
   });
   ```
   (`community.html` 은 `<html lang>` MutationObserver 로 같은 효과를 내고 있어 예외)
- 회귀 검증: `node tests/lang-consistency.test.js` — 9개 페이지 × 9개 언어에서
  한글 잔존·`undefined` 를 0으로 강제한다. 새 페이지를 만들면 `PAGES` 에 추가할 것.

## 관리자 렌더 안전 규칙 (2026-07-26, 감사 A-1·B-6)

**컨텍스트마다 헬퍼가 다르다. 셋을 섞어 쓰면 뚫린다.**

| 넣는 위치 | 헬퍼 | 이유 |
|---|---|---|
| 텍스트 노드 `>…<` | `esc()` | `<`, `>`, `&` 를 엔티티화 |
| 속성 값 `value="…"` | **`escAttr()`** | `esc()` 는 **따옴표를 이스케이프하지 않는다** |
| `href` / `src` | **`safeUrl()`** | 스킴 검사 + 내부적으로 `escAttr()` |

- `esc()` 는 `textContent → innerHTML` 직렬화라 `"` 가 그대로 남는다.
  `value="'+esc(x)+'"` 에 `x = '" onerror="alert(1)'` 를 넣으면 브라우저 파서가
  **`value=""` + `onerror="alert(1)"` 두 속성으로 쪼갠다** (2026-07-26 실측 확인).
  속성 안에는 반드시 `escAttr()`.
- URL 은 `escAttr()` 만으로도 부족하다 — 스킴을 보지 않아 `javascript:` / `data:`
  가 통과한다. `safeUrl()` 을 쓰고, 반환값이 비면 링크 대신 텍스트로 표시한다.
- 예외로 둘 값(코드 고정 라벨, 관리자 본인의 FileReader `data:` URL 등)은
  테스트의 `ATTR_ALLOW` / `BODY_ALLOW` 에 **근거와 함께** 등록한다.
- 회귀 검증: `node tests/submission-pullletter-audit.test.js`
  (속성/본문에 이스케이프 없는 API 값 삽입을 0건으로 강제)
