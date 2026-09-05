/**
 * PAP Magazine — 크레딧 역할 단일 진실원(SSOT)
 * ═══════════════════════════════════════════════════════════════════
 * 2026-07-21 신설 (QA: 서브미션 ↔ 관리자 크레딧 역할 명칭 불일치)
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────────
 * 관리자 에디토리얼 등록은 'Photographer'/'Stylist' 를 쓰는데, 서브미션
 * 제출 화면은 'Photo'/'Styling' 을 썼다. 그런데 승인 시 서브미션 크레딧을
 * 에디토리얼로 옮기는 review.js 의 _normalizeRoleLabel() 은 snake_case 를
 * Title Case 로 바꾸는 일만 했고 — 두 체계를 잇는 매핑이 아예 없었다.
 * 그 결과 제출자가 고른 'Photo' 가 그대로 에디토리얼에 꽂혔다.
 *
 * 실측(2026-07-21): 에디토리얼 크레딧 1,211건 중 549건(45%)이 비표준,
 * 고유 역할 139종 중 표준은 23종뿐. 같은 역할이 이렇게 갈라져 있었다:
 *   Photographer(64) / Photo(22) / Photography(5)
 *   Stylist(64) / Styling(24)
 *   Stylist assist(22) / Styling Asst.(14) / Styling Assist(6)
 *   Make Up(72) / Makeup(11) / MUAH(13) / Makeup & Hair(5)
 *
 * 더 중요한 건 이게 처음이 아니라는 점이다. 서브미션 화면 라벨은 과거에
 * 한 번 'Art Dir.' → 'Art Director' 로 바뀐 적이 있는데(DB에 옛 값이
 * 66건 남아 있다) 그때도 매핑 계층을 안 만들어서 같은 문제가 재발했다.
 * 그래서 라벨만 고치지 않고 이 파일을 만든다 — 세 번째를 막기 위해.
 *
 * ── 쓰는 곳 ────────────────────────────────────────────────────────
 *   · api/submissions/[id]/review.js — 승인 시 서브미션→에디토리얼 변환
 *   · frontend/pap-admin.js          — 관리자 역할 드롭다운(브라우저라
 *     require 불가 → 목록을 복제하되 tests/credit-roles.test.js 가 두
 *     파일을 대조해 어긋나면 실패시킨다. 사람이 아니라 테스트가 막는다)
 *   · frontend/submission.html       — 제출 화면 역할 라벨
 *
 * ── 범위 밖 ────────────────────────────────────────────────────────
 * 'Fashion by'(201건) · 'Beauty by'(27건) 는 사람 크레딧이 아니라
 * 브랜드 크레딧이다. api/_lib/brandExtract.js 가 이 값을 읽어 인스타
 * 캡션의 "Fashion by @brand" 줄과 /go/ 제휴 링크를 만든다. 역할 목록에
 * 합치면 캡션과 링크가 깨지므로 여기서 다루지 않는다.
 */

// 표준 역할 목록. 관리자 드롭다운의 순서이자 유일한 기준값.
// 'Make Up & Hair' 는 2026-07-21 추가 — 현장에서 한 사람이 둘 다 맡는
// 경우가 많아(MUAH/HMUA) 도메니코 결정으로 단일 역할로 유지한다.
const CANONICAL_ROLES = [
  'Photographer', 'Photographer assist',
  'Stylist', 'Stylist assist',
  'Make Up', 'Make Up assist',
  'Hair', 'Hair assist',
  'Make Up & Hair',
  'Set Design', 'Set Design assist',
  'Producer', 'Production assist',
  'Creative Director', 'Art Director', 'Casting Director',
  'Model', 'Starring', 'Talent Agency',
  'Video Director', 'Video assist', 'DOP / Cinematographer',
  'Editor', 'Colorist', 'Retouching',
  'Sound', 'Music', 'VFX',
  'Location', 'Special Thanks',
];

// 별칭 → 표준값. 키는 _key() 로 정규화된 형태(소문자·기호제거)라
// 'Styling Asst.' 'styling asst' 'STYLING ASST.' 가 모두 같은 키가 된다.
//
// 원칙: 뜻이 명확한 것만 매핑한다. 'Assistant' 'Assist' 'Designer'
// 'Studio' 'BTS' 'Nails' 처럼 무엇의 보조인지/무슨 디자이너인지 알 수
// 없는 값은 건드리지 않고 자유입력 역할로 남긴다 — 추측해서 바꾸면
// 크레딧을 잘못 붙이게 되고, 그건 창작자에게 실례다.
const ALIASES = {
  // 포토
  'photo': 'Photographer',
  'photography': 'Photographer',
  'photographer': 'Photographer',
  'photo assist': 'Photographer assist',
  'photo asst': 'Photographer assist',
  'photo assistant': 'Photographer assist',
  'photographer assist': 'Photographer assist',
  'photography assist': 'Photographer assist',

  // 스타일링
  'styling': 'Stylist',
  'stylist': 'Stylist',
  'fashion stylist': 'Stylist',
  'styling assist': 'Stylist assist',
  'styling asst': 'Stylist assist',
  'styling assistant': 'Stylist assist',
  'stylist assist': 'Stylist assist',
  'stylist assistant': 'Stylist assist',

  // 메이크업 / 헤어
  'makeup': 'Make Up',
  'make up': 'Make Up',
  'mua': 'Make Up',
  'makeup assist': 'Make Up assist',
  'make up assist': 'Make Up assist',
  'hair': 'Hair',
  'hair stylist': 'Hair',
  'hair assist': 'Hair assist',
  // MUAH 계열 — 한 사람이 메이크업+헤어를 겸한 경우
  'muah': 'Make Up & Hair',
  'hmua': 'Make Up & Hair',
  'makeup hair': 'Make Up & Hair',
  'make up hair': 'Make Up & Hair',
  'makeup and hair': 'Make Up & Hair',
  'hair makeup': 'Make Up & Hair',

  // 세트
  'set design': 'Set Design',
  'set designer': 'Set Design',
  'set design assist': 'Set Design assist',
  'set assist': 'Set Design assist',
  'set assistance': 'Set Design assist',

  // 프로덕션
  'production': 'Producer',
  'producer': 'Producer',
  'production assist': 'Production assist',
  'producer assist': 'Production assist',

  // 디렉션
  'art dir': 'Art Director',
  'art director': 'Art Director',
  'art direction': 'Art Director',
  'creative dir': 'Creative Director',
  'creative director': 'Creative Director',
  'creative direction': 'Creative Director',
  'casting': 'Casting Director',
  'casting director': 'Casting Director',

  // 후반
  'retouch': 'Retouching',
  'retoucher': 'Retouching',
  'retouching': 'Retouching',

  // 기타
  'agency': 'Talent Agency',
  'talent agency': 'Talent Agency',
  'dop': 'DOP / Cinematographer',
  'cinematographer': 'DOP / Cinematographer',
  'video dir': 'Video Director',
  'video director': 'Video Director',

  // ── 브라우저 자동번역 역번역 (2026-09-05) ─────────────────────────
  // Modern Teddy 서브미션(2026-09-04)에서 제출자가 Chrome 자동번역을 켠 채
  // 폼을 썼고, 폼이 라벨의 textContent 를 그대로 읽어 '摄影师' 같은 번역문이
  // DB 까지 들어와 사이트에 노출됐다. 프론트(data-role)가 1차 방어지만
  // API 를 직접 치거나 옛 캐시 페이지에서 오면 뚫리므로 서버도 되돌린다.
  // 표는 폼의 8개 고정 라벨 + 자주 쓰는 역할을 중/한/일로 번역기가 내는
  // 대표 표기만 담는다. 확신 없는 건 넣지 않는다(잘못 붙이면 창작자에게 실례).
  // 중국어(간체/번체)
  '摄影师': 'Photographer', '攝影師': 'Photographer', '摄影': 'Photographer', '攝影': 'Photographer',
  '摄影助理': 'Photographer assist', '攝影助理': 'Photographer assist',
  '造型师': 'Stylist', '造型師': 'Stylist', '造型': 'Stylist',
  '造型助理': 'Stylist assist', '造型师助理': 'Stylist assist', '造型師助理': 'Stylist assist',
  '化妆': 'Make Up', '化妝': 'Make Up', '化妆师': 'Make Up', '化妝師': 'Make Up',
  '发型': 'Hair', '髮型': 'Hair', '发型师': 'Hair', '髮型師': 'Hair',
  '化妆和发型': 'Make Up & Hair', '化妝和髮型': 'Make Up & Hair', '化妆与发型': 'Make Up & Hair', '妆发': 'Make Up & Hair', '妝髮': 'Make Up & Hair',
  '布景设计': 'Set Design', '佈景設計': 'Set Design', '场景设计': 'Set Design', '場景設計': 'Set Design',
  '修图': 'Retouching', '修圖': 'Retouching', '修饰': 'Retouching', '润饰': 'Retouching',
  '制片人': 'Producer', '製片人': 'Producer', '制片': 'Producer', '製片': 'Producer', '制作人': 'Producer', '製作人': 'Producer',
  '艺术总监': 'Art Director', '藝術總監': 'Art Director', '美术指导': 'Art Director', '美術指導': 'Art Director',
  '创意总监': 'Creative Director', '創意總監': 'Creative Director',
  '选角导演': 'Casting Director', '選角導演': 'Casting Director',
  '模特': 'Model', '模特儿': 'Model', '模特兒': 'Model',
  '主演': 'Starring',
  '经纪公司': 'Talent Agency', '經紀公司': 'Talent Agency',
  // 한국어
  '포토그래퍼': 'Photographer', '사진작가': 'Photographer', '사진': 'Photographer',
  '스타일리스트': 'Stylist', '스타일링': 'Stylist',
  '메이크업': 'Make Up', '헤어': 'Hair', '메이크업 헤어': 'Make Up & Hair', '메이크업 및 헤어': 'Make Up & Hair',
  '세트 디자인': 'Set Design', '리터칭': 'Retouching', '보정': 'Retouching',
  '프로듀서': 'Producer', '아트 디렉터': 'Art Director', '크리에이티브 디렉터': 'Creative Director',
  '모델': 'Model', '주연': 'Starring',
  // 일본어
  'フォトグラファー': 'Photographer', '写真家': 'Photographer', '撮影': 'Photographer',
  'スタイリスト': 'Stylist', 'メイク': 'Make Up', 'ヘア': 'Hair', 'メイク ヘア': 'Make Up & Hair', 'ヘアメイク': 'Make Up & Hair',
  'レタッチ': 'Retouching', 'プロデューサー': 'Producer', 'アートディレクター': 'Art Director',
};

// 비교용 키: 소문자 + 마침표/앰퍼샌드/슬래시 제거 + 공백 1칸으로 압축.
// 'Styling Asst.' → 'styling asst', 'Makeup & Hair' → 'makeup hair'
function _key(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[.&/,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 표준값 자체도 키로 찾을 수 있게 미리 인덱싱 (대소문자·표기 흔들림 흡수)
const _canonByKey = {};
CANONICAL_ROLES.forEach((r) => { _canonByKey[_key(r)] = r; });

/**
 * 임의의 역할 문자열을 표준값으로 정규화한다.
 * 매핑이 없으면 원본을 최대한 살려서 돌려준다(자유입력 역할 보존).
 *
 * @param {string} raw
 * @returns {string} 표준값 또는 정리된 원본. 빈 입력이면 '' (호출부가 판단)
 */
function normalizeRole(raw) {
  const str = String(raw || '').trim();
  if (!str) return '';

  const k = _key(str);
  if (_canonByKey[k]) return _canonByKey[k];   // 이미 표준값
  if (ALIASES[k]) return ALIASES[k];           // 알려진 별칭

  // snake_case 레거시 키('photo_assist')는 Title Case 후 재시도
  if (/^[a-z0-9_]+$/.test(str)) {
    const humanized = str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const hk = _key(humanized);
    if (_canonByKey[hk]) return _canonByKey[hk];
    if (ALIASES[hk]) return ALIASES[hk];
    return humanized;
  }

  // 모르는 값 — 원본 유지(관리자 UI의 자유입력 역할로 살아남는다)
  return str;
}

/** 표준 목록에 있는 값인가 */
function isCanonical(raw) {
  return CANONICAL_ROLES.indexOf(String(raw || '')) !== -1;
}

module.exports = { CANONICAL_ROLES, ALIASES, normalizeRole, isCanonical };
