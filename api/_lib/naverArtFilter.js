'use strict';
/**
 * 네이버 블로그 초안 대상 판별 — "이 기사가 아트 기사인가" (2026-09-15 도메니코: "검열하고 싶어" → 규칙 강화).
 *
 * 종전(2026-08-26): 제목·캡션에 '전시·작가·아티스트·artist…' 단어가 있으면 아트.
 * 그 결과 '디올 팝업'(캡션의 아티스트), '쿠사마 점 메이크업'(아티스트), 'NCT 런웨이' 같은
 * 브랜드 행사·셀럽 기사가 아트로 들어와 큐를 채웠다. 단어 하나로는 결이 안 갈린다.
 *
 * 새 규칙 — 세 겹, 순서대로. 하나라도 걸리면 거기서 끝.
 *   ① 카테고리 제외: Beauty·News 는 아트 큐에 안 넣는다 (메이크업 아티스트 기사는 뷰티 판이다).
 *   ② 차단어: 제목·태그에 브랜드 행사·셀럽·시즌 신호가 있으면 제외.
 *      팝업·캠페인·협업·컴백·런웨이·패션위크·FW26/SS27·뮤비·페스티벌·라이브·앰버서더·부티크 오픈 …
 *      전시 기사라도 '셀럽이 전시에 왔다' 류는 대개 여기서 걸린다.
 *   ③ 아트 신호: **태그**에 art(단어 단위)·exhibition·sculpture·installation·illustration·gallery·collage·
 *      craft·ceramic·photobook·biennale·conceptual·design object 가 있거나, 제목에 전시·개인전·갤러리·
 *      비엔날레·조각·회화·설치미술·공예·도예·일러스트 가 있어야 아트.
 *      '작가·아티스트' 는 뺐다 — 헤어 아티스트·메이크업 아티스트가 전부 걸리던 단어다.
 *
 * 정확도 우선(2026-09-15 도메니코 선택: 오판보다 누락이 낫다). 최근 14일 발행 121편 실측:
 *   아트 25 · 차단 55 · 뷰티 14 · 판정 없음 19. 놓친 것(예: 업사이클 가방 작가·성장형 주얼리)은
 *   관리자 /naver-blog 에서 손으로 생성하면 된다. 잘못 들어온 것은 큐에서 지워야 하니 그쪽이 더 비싸다.
 *
 * 추가 차단어는 환경변수 NAVER_DRAFT_ART_BLOCK_EXTRA (쉼표 구분, 재배포 필요). 이 파일은 아무것도 require 하지 않는다.
 */

const EXCLUDE_CATEGORIES = ['beauty', 'news'];

/* 태그·제목에서 찾는 차단 신호 (소문자 비교). 영문은 부분 일치, 시즌 코드는 단어 단위. */
const BLOCK_TERMS = [
  'popup', 'pop-up', 'campaign', 'collaboration', 'kpop', 'k-pop', 'live performance', 'festival',
  'music video', 'runway', 'lookbook', 'fashion week', 'beauty launch', 'boutique opening', 'flagship',
  'ambassador', 'comeback', 'stage', 'concert', 'blush', 'lipstick', 'serum', 'nail art', 'hair',
  '팝업', '협업', '컴백', '앰버서더', '런웨이', '페스티벌', '뮤비', '무대', '패션위크',
];
const SEASON_RE = /(^|[^a-z0-9])((fw|ss|aw)\d{2}|\d{2}(fw|ss|aw)|spring 20\d{2}|fall 20\d{2}|autumn 20\d{2}|winter 20\d{2}|summer 20\d{2})([^a-z0-9]|$)/;

/* 태그에서 찾는 아트 신호. 'art' 는 단어 단위(contemporary art·digital art·food art ✓, party·smart ✗). */
const ART_TAG_TERMS = [
  'exhibition', 'sculpture', 'installation', 'illustration', 'gallery', 'art fair', 'collage', 'craft',
  'ceramic', 'photobook', 'biennale', 'conceptual', 'design object', 'functional art', 'art collective',
  'artist award', 'painting', 'watercolor', 'printmaking',
];
const ART_WORD_RE = /(^|[^a-z])art([^a-z]|$)/;
/* 제목에서 찾는 한글 아트 신호. */
const ART_TITLE_TERMS_KO = ['전시', '개인전', '갤러리', '비엔날레', '조각', '회화', '설치미술', '공예', '도예', '일러스트', '사진집', '아트페어'];

function lc(s) { return String(s == null ? '' : s).toLowerCase(); }
function tagList(tags) {
  if (Array.isArray(tags)) return tags.map(lc).filter(Boolean);
  if (typeof tags === 'string') {
    try { const j = JSON.parse(tags); if (Array.isArray(j)) return j.map(lc).filter(Boolean); } catch (_) { /* not json */ }
    return tags.split(',').map(lc).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
function extraBlockTerms() {
  return String(process.env.NAVER_DRAFT_ART_BLOCK_EXTRA || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * @param {{title?:string, caption?:string, tags?:string[]|string, category?:string}} a
 * @returns {{art:boolean, reason:string}}  reason: 'category' | 'blocked:<term>' | 'art:<term>' | 'none'
 */
function classifyArt(a) {
  a = a || {};
  const cat = lc(a.category).trim();
  if (EXCLUDE_CATEGORIES.includes(cat)) return { art: false, reason: 'category' };

  const title = lc(a.title);
  const tags = tagList(a.tags);
  const hay = title + ' | ' + tags.join(' | ');
  for (const term of BLOCK_TERMS.concat(extraBlockTerms())) {
    if (term && hay.includes(term)) return { art: false, reason: 'blocked:' + term };
  }
  if (SEASON_RE.test(hay)) return { art: false, reason: 'blocked:season' };

  for (const tg of tags) {
    if (ART_WORD_RE.test(tg)) return { art: true, reason: 'art:' + tg };
    for (const term of ART_TAG_TERMS) if (tg.includes(term)) return { art: true, reason: 'art:' + tg };
  }
  for (const term of ART_TITLE_TERMS_KO) if (title.includes(term)) return { art: true, reason: 'art:' + term };
  return { art: false, reason: 'none' };
}

function isArtArticle(a) { return classifyArt(a).art; }

module.exports = { classifyArt, isArtArticle, EXCLUDE_CATEGORIES, BLOCK_TERMS, ART_TAG_TERMS, ART_TITLE_TERMS_KO };
