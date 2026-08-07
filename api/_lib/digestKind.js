/**
 * PAP Magazine — 소셜 다이제스트 갈래 판정 (2026-08-07)
 *
 * 기사 하나가 어느 모음에 들어가는지 정한다. 답은 셋이다.
 *
 *   'celeb'       셀럽 소식 모음
 *   'collection'  아트 콜렉션 모음
 *   'none'        **어느 쪽도 아님 — 두 모음 모두에서 뺀다**
 *
 * 'none' 이 왜 필요한가 ───────────────────────────────────────────────
 * 도메니코: "폭염은 아트도 셀럽도 아니야. 애매한건 억지로 포함시키지 말고
 *            그냥 빼줘."
 *
 * 처음엔 셀럽이냐 아니냐 둘로만 갈랐다(is_celeb). 그러면 '서울 전역에 내려진
 * 폭염중대경보' 같은 기사가 자동으로 아트 콜렉션에 실린다 — 셀럽이 아니라는
 * 이유만으로. 두 갈래만 있으면 남는 것을 버릴 자리가 없다.
 *
 * 판정 순서 ─────────────────────────────────────────────────────────
 *   ① 연예 신호가 있으면            → celeb
 *   ② 아트·패션·뷰티 신호가 있으면  → collection
 *   ③ 둘 다 없으면                  → none
 *
 * ①이 ②보다 먼저인 이유: 셀럽 기사에는 패션 태그가 거의 항상 같이 붙는다
 * (휴닝카이 기사에 menswear·fw26). 순서가 바뀌면 셀럽이 전부 콜렉션으로 샌다.
 * 도메니코 결정 "셀럽이면서 패션인 것은 셀럽에만" 이 이 순서 그 자체다.
 *
 * ③이 드문 이유 ─────────────────────────────────────────────────────
 * PAP 기사는 거의 전부 아트·패션·뷰티다. 45일 332건 실측에서 ②를 못 채운
 * 기사는 11건뿐이었고, 그중 10건은 ①에서 이미 셀럽으로 걸러졌다.
 * 남은 'none' 은 **폭염중대경보 한 건.** 정확히 도메니코가 지목한 그 기사다.
 * 규칙이 넓게 훑어 애매한 것을 무더기로 버리는 게 아니라, 정말 해당 없는
 * 것만 뺀다는 뜻이다.
 *
 * 마커의 한계와 AI 2차 ──────────────────────────────────────────────
 * 마커는 '영역' 을 본다. 그래서 태그가 사람 이름뿐인 기사를 못 가른다:
 *
 *   '페라가모 플래그십이 영화제 포토콜로 변한 순간'
 *   tags: [ferragamo, nana, kim hee-ae, yoon seung-ah, kim moo-yul, cara bag]
 *
 * 나나·김희애·윤승아·김무열 전부 셀럽인데 연예 마커가 없다 → 마커는
 * 'collection' 이라 답한다. 이건 틀렸고, 고치는 몫은 AI 2차 판정
 * (api/cron/celeb-classify.js)이다. 그 결과가 articles.digest_kind 에 남고
 * 저장값이 마커보다 우선한다.
 *
 * ⚠️ 마커는 절대 null 을 돌려주지 않는다 — 항상 셋 중 하나를 답한다.
 *    저장된 판정이 없는 갓 발행 기사도 즉시 갈래가 정해져야 하기 때문이다.
 *    (다이제스트 창이 3~4일이라, AI 를 기다리면 그 창이 그대로 구멍이 된다.)
 */

'use strict';

/* ① 연예 영역을 가리키는 말. 사람 이름이 아니라 '분야' 다. */
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

/* 그룹·아티스트 고정 명단. 개인 이름은 안 넣는다 — 끝이 없고 디자이너·작가와
   부딪힌다. 팀 이름은 그 충돌이 거의 없다. */
const ACTS = new Set([
  'blackpink', 'bts', 'aespa', 'stray kids', 'ateez', 'txt', 'tomorrow x together',
  'riize', 'cortis', 'nct', 'nct wish', 'nct dream', 'seventeen', 'twice', 'ive',
  'newjeans', 'le sserafim', 'itzy', 'enhypen', 'treasure', 'exo', 'red velvet',
  'kard', 'tuide', 'tws', 'katseye', 'nmixx', 'illit', 'babymonster', 'kiss of life',
  'zerobaseone', 'boynextdoor', 'p1harmony', '2ne1', 'bigbang', 'got7', 'monsta x',
  'shinee', 'super junior', 'girls generation', 'mamamoo', 'oh my girl', 'gidle',
  '(g)i-dle', 'the boyz', 'ampers&one', 'xikers', 'zb1', 'hybe', 'yg entertainment',
]);

/* ② 아트·패션·뷰티·컬처 신호. 여긴 **부분 일치**다.
   태그가 'sculptural fashion' · 'contemporary art' 처럼 조합어라 전체 일치로는
   목록이 무한정 길어진다. 한국어 태그도 섞여 들어오므로 같이 둔다
   (실측: '슈즈 디자인' · '시스루 펌프스' 만 달린 기사가 있었다). */
const COLLECTION_WORDS = [
  'fashion', 'beauty', 'art', 'design', 'style', 'collection', 'couture', 'runway',
  'atelier', 'brand', 'luxury', 'streetwear', 'menswear', 'womenswear', 'knit', 'textile',
  'tailor', 'makeup', 'nail', 'hair', 'skincare', 'fragrance', 'perfume', 'cosmetic',
  'photograph', 'sculpt', 'paint', 'illustration', 'exhibition', 'gallery', 'museum',
  'installation', 'craft', 'ceramic', 'jewel', 'eyewear', 'footwear', 'sneaker', 'shoe',
  'heel', 'bag', 'denim', 'vintage', 'archive', 'editorial', 'campaign', 'lookbook',
  'model', 'stylist', 'designer', 'creative director', 'pop-up', 'popup', 'store',
  'flagship', 'retail', 'collab', 'culture', 'music', 'film', 'performance', 'dance',
  '패션', '뷰티', '아트', '디자인', '컬렉션', '슈즈', '메이크업', '헤어', '네일',
  '향수', '전시', '스타일', '힐', '가방', '펌프스', '주얼리', '공예',
];

const KINDS = ['celeb', 'collection', 'none'];

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
 * 태그만 보는 1차 판정. 항상 셋 중 하나를 답한다 (null 없음).
 * @returns {{kind:'celeb'|'collection'|'none', hits:string[]}}
 */
function markerKind(article) {
  const tags = tagList(article && article.tags);

  const celebHits = tags.filter((t) => DOMAIN.has(t) || ACTS.has(t));
  if (celebHits.length) return { kind: 'celeb', hits: celebHits };

  const collHits = tags.filter((t) => COLLECTION_WORDS.some((w) => t.includes(w)));
  if (collHits.length) return { kind: 'collection', hits: collHits };

  return { kind: 'none', hits: [] };
}

/**
 * 최종 판정 — 다이제스트가 부르는 자리.
 *
 * 우선순위:
 *   1. 사람이 손으로 정한 값 (kind_by='manual')  ← 무엇보다 우선
 *   2. 저장된 판정 (digest_kind)
 *   3. 마커 즉석 판정                            ← 갓 발행된 기사 구제
 */
function digestKind(article) {
  if (!article) return 'none';
  const stored = norm(article.digest_kind);
  if (stored && KINDS.includes(stored)) return stored;
  return markerKind(article).kind;
}

/** AI 2차 판정 대기열인가 — 저장된 값이 아직 없는 기사. */
function needsAiVerdict(article) {
  if (!article) return false;
  const stored = norm(article && article.digest_kind);
  return !(stored && KINDS.includes(stored));
}

module.exports = {
  digestKind, markerKind, needsAiVerdict, tagList, norm,
  DOMAIN, ACTS, COLLECTION_WORDS, KINDS,
};
