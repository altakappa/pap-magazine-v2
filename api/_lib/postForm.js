/**
 * PAP Magazine — 게시물 "형태" 판정 (2026-09-08 신설)
 *
 * 형태는 넷이다. digest_kind(누구 이야기냐)와 **다른 축**이다 — 어떤 모양이냐.
 *
 *   'visual'    이미지가 주인공. 작가·크리에이터·재료·기법이 주어인 발견형.
 *   'namenews'  이름이 주인공. 셀럽·브랜드 소식, 발탁·컴백·근황.
 *   'onsite'    현장. 행사·팝업·전시·포토콜 취재기.
 *   'none'      셋 다 아님.
 *
 * (화보 'editorial' 은 여기서 안 만든다 — editorials 매칭이면 뷰가 자동으로 붙인다.
 *  AI 에 물을 이유가 없는 것을 묻지 않는다.)
 *
 * 왜 필요한가 ────────────────────────────────────────────────────────
 * 45_Business/2026-09-06-IG팔로워-증가-급락-진단.md:
 *   "같은 '기사' 라도 팔로우 전환이 20배 갈린다.
 *    귀여운 얼굴로 유통되는 치명적 진실 1.85 ↔ 제니 롤라팔루자 0.05(도달 25만)
 *    공통점: 왼쪽은 이미지가 주인공, 오른쪽은 셀럽 이름이 주인공.
 *    ...지금 비율은 실측 필요."
 * 그 '실측 필요' 를 셀 수 있게 만드는 열이다.
 *
 * 왜 마커(태그 규칙)가 없는가 ────────────────────────────────────────
 * digestKind.js 는 태그 마커가 1차를 본다. 여기서는 **일부러 안 만들었다.**
 * 2026-09-08 실측 — 컬렉션 게시물의 태그를 도달 2만+ 여부로 갈라 봤다:
 *   sculpture 5건 중 4건 히트(80%) · latex fashion 4건 중 2건(50%)
 *   vs fashion art 6건 중 0건 · digital art 6건 중 0건 · runway 4건 중 0건
 * 표본이 태그당 4~21건이고 적중률이 0~80% 로 흩어진다. 이 신호로 규칙을 만들면
 * **틀린 라벨이 조용히 쌓인다.** 틀린 계측기는 없는 계측기보다 나쁘다
 * (작업-프로토콜 §G-2 "표본과 탐지 범위").
 *
 * 마커 없이도 되는 이유: post_form 은 아무것도 막지 않는다. 다이제스트는 이 값을
 * 안 읽는다. digest_kind 는 발행 즉시 답이 필요해서(다이제스트 창 3~4일) 마커가
 * 필요했지만, 여기는 계측 전용이라 몇 분 늦어도 된다.
 *
 * 사람 우선 ──────────────────────────────────────────────────────────
 * post_form_by='manual' 은 크론이 절대 안 덮는다. digest_kind 와 같은 규칙이다.
 */

'use strict';

const { tagList, norm } = require('./digestKind');
const { parseJsonArray } = require('./jsonRepair');

/** AI 가 답할 수 있는 값. 'editorial' 은 포함하지 않는다 — 뷰가 정한다. */
const FORMS = ['visual', 'namenews', 'onsite', 'none'];

/** 뷰가 붙이는 값까지 포함한 전체 목록 (표·리포트가 쓰는 순서). */
const ALL_FORMS = ['editorial', 'visual', 'namenews', 'onsite', 'none'];

const SYSTEM = [
  '너는 PAP 매거진(아트 기반 패션·뷰티·컬처 매거진)의 인스타그램 게시물 형태 분류기다.',
  '"무엇에 관한 글이냐"가 아니라 **"게시물이 어떤 모양이냐"**를 판정한다.',
  '',
  '"visual" — 이미지 자체가 주인공. 한 장만 봐도 "저게 뭐야"가 나오는 글.',
  '  · 작가·디자이너·크리에이터의 작업물 소개, 재료·기법·공정이 주어',
  '  · 기괴·전복·착시·변형처럼 설명 없이도 눈에 걸리는 것',
  '  · 예: "머리카락으로 조각하는 작가" · "할머니집 식탁보 무늬가 라텍스 수트가 되었다"',
  '        "종이에 얼굴을 파묻으면 자화상이 나온다" · "이 로고, 먹어도 됩니다"',
  '',
  '"namenews" — 사람 이름 또는 브랜드 이름이 주인공인 소식.',
  '  · 앰배서더 발탁, 컴백, 신곡·신작, 근황, 열애·결별, 시상식 수상',
  '  · 신제품 출시·리뉴얼 같은 브랜드 발표',
  '  · 예: "돌체앤가바나의 새로운 얼굴, TXT 수빈" · "제니 롤라팔루자 무대"',
  '',
  '"onsite" — 특정 장소·행사에 가서 본 것을 전하는 글.',
  '  · 팝업·전시 현장, 패션위크 백스테이지, 포토콜, 런웨이 리포트, 스토어 오픈',
  '  · 그 자리에 있어야 알 수 있는 정보가 중심이면 onsite 다',
  '  · 예: "프리즈 서울 2026 현장" · "입생로랑 뷰티가 성수에 연 아지트"',
  '        "잠실 잔디밭에 런웨이가 깔렸다"',
  '',
  '"none" — 위 셋 어디에도 안 맞는 것 (날씨·사회 일반 뉴스 등).',
  '  · **none 은 마지막 수단이다. 조금이라도 걸리면 셋 중 하나를 골라라.**',
  '',
  '헷갈릴 때의 순서 ─────────────────────────────',
  '1. 특정 행사·장소 현장 리포트인가? → onsite',
  '2. 아니면, 작업물·재료·기법이 주어인가? → visual',
  '3. 아니면, 사람/브랜드 이름이 주어인가? → namenews',
  '',
  '주의: 셀럽이 나와도 그 사람의 "작업물·변신 자체"가 주인공이면 visual 이다',
  '(예: "타일러 몸에 옷을 붙인 디자이너" → 주어는 디자이너의 기법 → visual).',
  '반대로 전시장에 셀럽이 왔다는 글은 onsite 다.',
  '',
  '출력은 JSON 배열 하나만. 설명·코드펜스 금지.',
  '형식: [{"i":0,"form":"visual"},{"i":1,"form":"namenews"}]',
  'i 는 입력에 붙은 번호 그대로. form 은 visual|namenews|onsite|none 넷 중 하나. 빠뜨리지 말 것.',
].join('\n');

/** 제목·카테고리·태그·캡션 첫 줄만 보낸다 — 본문은 토큰만 먹고 판정을 안 바꾼다. */
function buildUserPrompt(rows) {
  return (rows || []).map((r, i) => {
    const tags = tagList(r && r.tags).slice(0, 12).join(', ');
    const cap = String((r && r.instagram_caption) || '').split('\n')
      .map((s) => s.trim()).filter(Boolean).slice(0, 2).join(' / ');
    return [
      'i=' + i,
      '제목: ' + String((r && r.title) || '').slice(0, 120),
      '카테고리: ' + String((r && r.category) || ''),
      '태그: ' + (tags || '(없음)'),
      '캡션머리: ' + (cap ? cap.slice(0, 160) : '(없음)'),
    ].join('\n');
  }).join('\n---\n');
}

/* 파싱은 정본(jsonRepair.parseJsonArray)에 맡긴다 — 코드펜스·서두 설명·따옴표
   깨짐을 이미 다 겪은 자리다. 손으로 자르면 그 수리 로직을 놓친다
   (tests/ai-json-repair-shared.test.js 가 이걸 규칙으로 막는다).
   여기서는 못 읽으면 null 을 돌려준다 — 부르는 쪽이 "이 배치는 통째로 버린다" 로
   처리하기 때문에 예외를 위로 던질 이유가 없다. */
function parseFormVerdicts(text) {
  let arr;
  try {
    arr = parseJsonArray(text, '형태 판정').value;
  } catch (_e) {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  return arr.filter((o) => o && Number.isInteger(o.i) && FORMS.includes(o.form));
}

/** 판정이 아직 없는가. 사람이 정한 값(manual)은 이미 있는 값이므로 false. */
function needsFormVerdict(article) {
  if (!article) return false;
  const v = norm(article.post_form);
  return !(v && FORMS.includes(v));
}

module.exports = { FORMS, ALL_FORMS, SYSTEM, buildUserPrompt, parseFormVerdicts, needsFormVerdict };
