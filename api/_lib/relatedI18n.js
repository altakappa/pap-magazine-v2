/**
 * PAP Magazine — 관련 콘텐츠 카드 제목 현지화 (2026-08-25)
 *
 * 왜: GSC "중복 페이지, Google 이 다른 표준 선택" 1,655건(전부 언어판) 진단에서,
 * /it 기사·화보의 관련 카드 제목이 한국어 원제로 나가는 것을 실측했다. 언어판에
 * 남는 한국어 텍스트는 ko 정본과의 중복 신호이자 해당 언어 독자에게 죽은 UI 다.
 *
 * 순수 함수 — 라우트(api/seo/editorial·article/[slug].js)가 seo_translations 를
 * 조회해 titleById 로 넘긴다. 규칙이 라우트마다 두 벌이 되지 않게 여기 한 곳에 둔다.
 * 의존성 0 — 테스트가 실행으로 검증한다.
 */
'use strict';

/**
 * 관련 카드 항목들의 title 을 요청 언어로 덮어쓴다 (제자리 변경).
 *
 * @param {Array}  items     [{ id, title, title_en?, ... }] — null 섞여도 안전
 * @param {string} lang      'en' | 'it' | 'fr' | ... ('ko' 면 아무것도 안 함)
 * @param {Object} titleById 비-en 언어용: { [content_id]: 번역 title } (en 이면 무시)
 *
 * 규칙:
 *  - en  → title_en 이 비어있지 않으면 그것으로. (DB 원본 필드 — 항상 존재한다는
 *          보장은 없어 폴백은 ko 원제)
 *  - 기타 → titleById 에 비어있지 않은 번역 제목이 있으면 그것으로.
 *  - 번역이 없으면 ko 원제 유지 — 빈 제목을 만들지 않는다.
 */
function overlayRelatedTitles(items, lang, titleById) {
  if (!Array.isArray(items) || !lang || lang === 'ko') return;
  for (const e of items) {
    if (!e) continue;
    if (lang === 'en') {
      const t = e.title_en && String(e.title_en).trim();
      if (t) e.title = t;
    } else {
      const t = titleById && titleById[e.id] && String(titleById[e.id]).trim();
      if (t) e.title = t;
    }
  }
}

module.exports = { overlayRelatedTitles };
