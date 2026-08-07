/**
 * PAP Magazine — 셀럽/아트 갈래 판정 (2026-08-07 신설, 도메니코 지시)
 *
 * 무슨 문제였나 ───────────────────────────────────────────────────────
 * 소셜 다이제스트는 갈래를 `articles.category` 로 갈랐다.
 *   category ∈ {news, celeb} → 셀럽 소식
 *   나머지 전부              → 아트 콜렉션
 *
 * 그런데 DB 에 실재하는 카테고리는 넷뿐이다(45일 실측):
 *   Culture 104 · Fashion 67 · News 43 · Beauty 23   ('celeb' 은 없다)
 *
 * 셀럽 기사가 셋 다에 흩어져 있다. 최근 4일만 봐도:
 *   휴닝카이 페라가모(Fashion) · 정국 샤넬 향수(Beauty) · 스트레이 키즈(Culture)
 *   카리나 컨버스(Fashion) · 에스파 뮤비(Culture) · 안효섭 공항패션(Fashion)
 * 전부 '아트 콜렉션' 으로 나갔다. 반대로 News 안에는 폭염경보·존 갈리아노
 * 회고전처럼 셀럽이 아닌 것이 섞여 있다.
 *
 * 결과는 도메니코가 말한 그대로다 —
 *   "아트 아카이브 모음에 셀럽과 아트가 다 섞여 있고, 셀럽 소식 모음은
 *    오히려 갯수가 부족하다."
 *
 * 그래서 카테고리를 버리고 **내용**으로 가른다 ─────────────────────────
 * 판정 재료는 tags 다. PAP 기사는 태그가 촘촘해서 카테고리보다 훨씬 정확하다.
 *
 * 두 갈래 신호를 쓴다:
 *   DOMAIN — '연예 영역' 을 가리키는 말 (kpop, korean actor, comeback, …)
 *   ACTS   — 그룹·아티스트 고정 명단 (blackpink, aespa, ateez, …)
 *
 * ⚠️ 이 함수는 **false 를 돌려주지 않는다.** true 아니면 null(모름) 이다.
 *    태그에 마커가 없다고 셀럽이 아닌 게 아니기 때문이다. 실측 반례:
 *      '페라가모 플래그십이 영화제 포토콜로 변한 순간'
 *      tags: [ferragamo, nana, kim hee-ae, yoon seung-ah, kim moo-yul, …]
 *    나나·김희애·윤승아·김무열 — 전부 셀럽인데 도메인 마커가 하나도 없다.
 *    사람 이름은 끝이 없어서 명단으로 못 막는다. 그 몫은 AI 2차 판정
 *    (api/cron/celeb-classify.js)이 맡고, 결과는 articles.is_celeb 에 남는다.
 *    여기서 섣불리 false 를 뱉으면 그 2차 판정 기회를 없애 버린다.
 *
 * 실측 성적 (45일 332건):
 *   기존 category 규칙 :  54건
 *   이 마커 규칙       : 121건 (오탐 0 — 수동 확인)
 *   남는 보류          : 211건 (그중 실제 셀럽은 소수, AI 가 처리)
 *
 * 약한 마커는 일부러 뺐다. 'fan event' 는 맨시티 축구 팬 이벤트를,
 * 'performance'·'campaign' 은 아트 퍼포먼스와 브랜드 캠페인을 끌어온다.
 * 재현율보다 정밀도를 택한 자리다 — 놓친 건 AI 가 줍지만, 잘못 넣은 건
 * 두 모음을 동시에 더럽힌다.
 */

'use strict';

/* 연예 영역을 가리키는 말. 사람 이름이 아니라 '분야' 다. */
const DOMAIN = new Set([
  'kpop', 'k-pop', 'kpop fashion', 'k-pop fashion', 'kpop group', 'k-pop group',
  'korean idol', 'idol', 'k-pop idol', 'kpop idol',
  'korean actor', 'korean actors', 'korean actress', 'japanese actor', 'actor', 'actress',
  'celebrity', 'celebrity style', 'celebrity fashion',
  'kdrama', 'k-drama', 'drama', 'ost',
  'girl group', 'boy group', 'comeback', 'debut', 'mini album', 'album release',
  'music video', 'world tour', 'solo tour', 'asia tour', 'concert',
  'fan meeting', 'fanmeeting', 'fandom', 'fan sign',
  'brand ambassador', 'global ambassador', 'house ambassador',
  'airport fashion', 'stage fashion', 'stage outfit', 'front row',
  'solo artist', 'singer', 'rapper', 'red carpet', 'photocall', 'music icon', 'pop music',
]);

/* 그룹·아티스트 고정 명단. 개인 이름은 여기 안 넣는다 — 끝이 없고,
   동명이인(디자이너·작가)과 부딪힌다. 팀 이름은 그런 충돌이 거의 없다. */
const ACTS = new Set([
  'blackpink', 'bts', 'aespa', 'stray kids', 'ateez', 'txt', 'tomorrow x together',
  'riize', 'cortis', 'nct', 'nct wish', 'nct dream', 'seventeen', 'twice', 'ive',
  'newjeans', 'le sserafim', 'itzy', 'enhypen', 'treasure', 'exo', 'red velvet',
  'kard', 'tuide', 'tws', 'katseye', 'nmixx', 'illit', 'babymonster', 'kiss of life',
  'zerobaseone', 'boynextdoor', 'p1harmony', '2ne1', 'bigbang', 'got7', 'monsta x',
  'shinee', 'super junior', 'girls generation', 'mamamoo', 'oh my girl', 'gidle',
  '(g)i-dle', 'the boyz', 'ampers&one', 'xikers', 'zb1', 'hybe', 'yg entertainment',
]);

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** tags 는 jsonb 배열로 오지만, 과거 행에는 문자열·null 도 있다. */
function tagList(tags) {
  if (Array.isArray(tags)) return tags.map(norm).filter(Boolean);
  if (typeof tags === 'string') {
    const s = tags.trim();
    if (s.startsWith('[')) {
      try { return tagList(JSON.parse(s)); } catch (_e) { /* 아래로 */ }
    }
    return s.split(',').map(norm).filter(Boolean);
  }
  return [];
}

/**
 * 마커만 보는 1차 판정.
 * @returns {{celeb: true|null, hits: string[]}}  celeb=null 은 '모름' 이지 '아님' 이 아니다.
 */
function markerVerdict(article) {
  const hits = [];
  for (const t of tagList(article && article.tags)) {
    if (DOMAIN.has(t)) hits.push(t);
    else if (ACTS.has(t)) hits.push(t);
  }
  return { celeb: hits.length ? true : null, hits };
}

/**
 * 최종 판정 — 다이제스트가 부르는 자리.
 *
 * 우선순위가 중요하다:
 *   1. 사람이 손으로 정한 값(celeb_by='manual')   ← 무엇보다 우선
 *   2. 저장된 판정(is_celeb, marker 또는 ai)
 *   3. 마커 즉석 판정                              ← 방금 발행된 기사 구제
 *   4. 모름 → 셀럽 아님으로 취급 (아트 콜렉션)
 *
 * 3번이 없으면, 발행 직후 AI 크론이 돌기 전 기사가 전부 콜렉션으로 샌다.
 * 다이제스트는 '지난 3~4일' 을 보므로 그 창이 그대로 구멍이 된다.
 */
function isCeleb(article) {
  if (!article) return false;
  if (article.celeb_by === 'manual' && article.is_celeb != null) return !!article.is_celeb;
  if (article.is_celeb != null) return !!article.is_celeb;
  return markerVerdict(article).celeb === true;
}

/** AI 2차 판정이 필요한가 — 저장된 값이 없고 마커도 안 걸린 기사. */
function needsAiVerdict(article) {
  if (!article) return false;
  if (article.is_celeb != null) return false;
  return markerVerdict(article).celeb !== true;
}

module.exports = { isCeleb, markerVerdict, needsAiVerdict, tagList, norm, DOMAIN, ACTS };
