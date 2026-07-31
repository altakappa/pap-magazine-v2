/**
 * 레거시 화보 ↔ 인스타그램 게시물 제목 매칭 (2026-07-31 신설).
 *
 * 왜 필요했나:
 *   2019-02 ~ 2023-01 발행 에디토리얼 373편의 cover_image 가 실제 사진이 아니라
 *   `data:image/svg+xml,...` 플레이스홀더다. 갤러리도 전부 같은 상태.
 *   즉 초기 4년치 아카이브가 웹사이트에서 '사진 없는 화보' 로 서비스되고 있다.
 *   서술문이 없는 것보다 이쪽이 먼저 고칠 문제다 — 사진이 없으면 설명도 의미 없다.
 *
 * 왜 URL 이 아니라 제목으로 맞추나:
 *   DB 의 source_instagram_url 이 실제 게시물과 어긋나 있다(실측).
 *     TASTED MY REVENGE  발행 2023-01-22 · CoFQjbJhEwg → 실제 2023-01-31  ✅
 *     YOLANDA            발행 2023-01-07 · CQn80VWg-cC → 2021년경          ✗
 *     ELISA              발행 2022-12-30 · DU10svAk5iI → 2025년 이후        ✗
 *   ('D' 로 시작하는 shortcode 는 2024년 이후 발급분이다.)
 *   그대로 회수하면 엉뚱한 사진이 붙는다. 반면 캡션에는 제목이 그대로 들어 있다:
 *     "'Tasted my Revenge. It's sweet.' exclusive for @pap_magazine"
 *   그래서 제목 매칭이 URL 보다 정확하다. URL 은 매칭 결과로 교정하는 쪽이 맞다.
 *
 * 이 파일은 아무것도 require 하지 않는다 — DB·네트워크 없이 규칙만 검증하기 위해서다
 * (2026-07-30 에 테스트가 supabase 클라이언트를 만들어 CI 를 깨뜨린 교훈).
 */
'use strict';

/* 매칭에 쓸 최소 길이. 너무 짧은 제목은 우연히 겹친다("MUSE" 가 "museum" 에).
 *
 * 문자 종류로 기준을 나눈다 — 한글은 글자당 정보량이 훨씬 크기 때문이다.
 * 라틴 6자("rosett")는 흔한 조각이지만 한글 4자("가을정취")가 우연히 겹칠 확률은
 * 훨씬 낮다. 같은 기준을 쓰면 정상적인 한글 제목이 통째로 걸러진다
 * (테스트에서 '가을의 정취'(정규화 5자)가 실제로 탈락해 발견됐다). */
const MIN_TITLE_LEN = 6;        // 라틴·숫자
const MIN_TITLE_LEN_CJK = 4;    // 한글

/**
 * 비교용 정규화 — 대소문자·따옴표·구두점·공백 차이를 지운다.
 * 캡션은 사람이 손으로 쓴 것이라 「'Tasted my Revenge. It's sweet.'」처럼
 * 제목과 문장부호가 다르다. 문자와 숫자만 남기면 그 차이가 사라진다.
 */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’“”]/g, '')   // 스마트 따옴표
    .replace(/[^a-z0-9가-힣]/g, '');
}

/**
 * 제목이 캡션 안에 들어 있는가.
 * 부분 문자열 비교라 "ROSETTE" 가 "ROSETTES" 캡션에도 걸리지만, 그건 같은
 * 화보일 가능성이 높아 허용한다. 대신 짧은 제목은 아예 판정하지 않는다.
 */
function titleInCaption(title, caption) {
  const t = normalize(title);
  const min = /[가-힣]/.test(t) ? MIN_TITLE_LEN_CJK : MIN_TITLE_LEN;
  if (t.length < min) return false;
  return normalize(caption).includes(t);
}

/**
 * 후보 미디어 목록에서 이 화보에 맞는 것을 고른다.
 *
 * @param {{id:string,title:string}} row       플레이스홀더 화보
 * @param {Array<{id,caption,permalink,timestamp,media_type}>} media  계정 미디어
 * @returns {{status:'matched'|'ambiguous'|'none', media?:object, count:number}}
 *
 * 여러 개가 걸리면 자동으로 고르지 않는다('ambiguous'). 같은 제목의 다른 화보이거나
 * 재게시본일 수 있고, 잘못 붙이면 남의 사진이 남의 화보에 실린다 —
 * 되돌리기 어려운 종류의 오류라 사람이 보게 남긴다.
 */
function matchOne(row, media) {
  const hits = (media || []).filter(m => m && titleInCaption(row.title, m.caption));
  if (!hits.length) return { status: 'none', count: 0 };
  if (hits.length > 1) return { status: 'ambiguous', count: hits.length, media: hits[0] };
  return { status: 'matched', count: 1, media: hits[0] };
}

/** 캡션에서 @핸들을 뽑는다 — 크레딧 복구용(브랜드 허브 연결에 쓰인다). */
function extractHandles(caption) {
  const out = [];
  const re = /@([a-z0-9._]{2,30})/gi;
  let m;
  while ((m = re.exec(String(caption || '')))) {
    const h = m[1].toLowerCase().replace(/\.+$/, '');
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

module.exports = { normalize, titleInCaption, matchOne, extractHandles, MIN_TITLE_LEN, MIN_TITLE_LEN_CJK };
