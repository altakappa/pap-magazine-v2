/**
 * PAP Magazine — YouTube Shorts 메타데이터 생성기 (제목 접두사 + 해시태그)
 *
 * 왜 만들었나 (2026-08-04 도메니코 지시):
 *   기존 크론은 제목을 "<기사제목> | PAP MAGAZINE" 으로만 만들고, 해시태그는
 *   #Shorts #PAPMAGAZINE #패션뉴스 #<카테고리> 고정이었다. 그래서 도메니코가
 *   업로드 뒤 유튜브 스튜디오에서 "[ CELEBRITY ]" 같은 접두사와 셀럽 해시태그를
 *   손으로 다시 달고 있었다. 그 수작업 규칙을 코드로 옮긴다.
 *
 * 접두사 목록의 출처: 실제 채널(UCI8hj3SGeyE3x9uwn5lplug) 업로드 제목 실측.
 *   [ CELEBRITY ] [ EVENT ] [ FASHION ] [ BACKSTAGE ] [ PRESENTATION ]
 *   [ Milan Fashion Week ] [ Paris Fashion Week ]
 * 실측에 없던 [ BEAUTY ] / [ CULTURE ] / [ NEWS ] 는 위 규칙에 아무것도 안 걸렸을
 * 때만 쓰는 폴백이다 (도메니코 확인 후 CATEGORY_FALLBACK 에서 바꾸면 된다).
 *
 * 해시태그 출처: articles.tags. IG 임포트가 기사마다 이미 셀럽명·브랜드명·
 * 제품명을 채워둔다(예: ["ahn bo-hyun","royal salute","whisky", ...]).
 * 없던 걸 새로 지어내지 않고 그걸 그대로 쓴다 — AI 호출 0회.
 *
 * 이 파일은 네트워크·DB 를 건드리지 않는다 (순수 함수). tests/youtube-meta.test.js
 */

'use strict';

const SUFFIX = ' | PAP MAGAZINE';
const MAX_TITLE = 100; // YouTube 제목 하드 상한

const PREFIX = {
  CELEBRITY: '[ CELEBRITY ]',
  EVENT: '[ EVENT ]',
  FASHION: '[ FASHION ]',
  BEAUTY: '[ BEAUTY ]',
  CULTURE: '[ CULTURE ]',
  NEWS: '[ NEWS ]',
  PRESENTATION: '[ PRESENTATION ]',
  BACKSTAGE: '[ BACKSTAGE ]',
  MILAN: '[ Milan Fashion Week ]',
  PARIS: '[ Paris Fashion Week ]',
};

/* articles.category 는 'Fashion,Culture' 처럼 쉼표 다중값이 올 수 있다
   (api/_lib/digestBuckets.js 와 같은 전제). 첫 값을 대표로 본다. */
const CATEGORY_FALLBACK = {
  fashion: PREFIX.FASHION,
  beauty: PREFIX.BEAUTY,
  culture: PREFIX.CULTURE,
  news: PREFIX.NEWS,
  celeb: PREFIX.CELEBRITY,
};

/* 자주 다루는 셀럽·그룹. 접두사 판정의 1순위 신호다.
   완전할 필요는 없다 — 여기서 못 잡으면 아래 패턴 휴리스틱이 받는다. */
const CELEB_LEXICON = [
  'BTS', 'RM', '정국', '지민', '뷔', '진', '슈가', '제이홉',
  '블랙핑크', '제니', '지수', '로제', '리사',
  '뉴진스', '아이브', '안유진', '장원영', '리즈', '레이',
  '에스파', '카리나', '윈터', '닝닝', '지젤',
  '르세라핌', '카즈하', '사쿠라', '허윤진', '김채원',
  '트와이스', '나연', '사나', '지효', '모모', '미나', '다현', '쯔위',
  '레드벨벳', '아이린', '슬기', '조이', '웬디', '예리',
  '있지', '류진', '예지', '리아', '채령', '유나',
  '엔믹스', '규진', '설윤', '해원', '릴리', '배이', '지우',
  '아이들', '전소연', '미연', '민니', '우기', '슈화',
  '스트레이 키즈', '스트레이키즈', '방찬', '창빈', '한지성', '필릭스', '현진',
  '세븐틴', '에스쿱스', '민규', '호시', '원우', '준', '디에잇', '버논', '조슈아',
  'NCT', '태용', '마크', '재현', '해찬', '도영', '제노', '재민', '천러',
  '라이즈', '엑소', '카이', '백현', '첸', '수호', '샤이니', '태민', '키', '온유',
  '몬스타엑스', '에이티즈', '최산', '홍중', '우영', '여상',
  '키스오브라이프', '빌리', '이즈나', '알디원', '캣츠아이', '프로미스나인',
  '우주소녀', '다영', 'KARD', '청하', '선미', '비비', '지코', '박재범',
  '자이언티', '코드 쿤스트', '죠지', '태연', '아이유', '보아',
  '데이식스', '영케이', 'young k', '데이브레이크', '악뮤', '이찬혁', '이수현',
  '연준', '수빈', '범규', '휴닝카이', '태현', '투모로우바이투게더',
  '안보현', '김유정', '박서준', '이도현', '차은우', '송혜교', '전지현',
  '한소희', '김고은', '수지', '정호연', '고윤정', '김지원',
  '젠데이아', 'zendaya', 'jennie', 'rose', 'lisa', 'jisoo', 'karina',
];

const BACKSTAGE_RE = /(backstage|백스테이지|비하인드|behind[\s-]?the[\s-]?scenes|메이킹\s?필름|making\s?film)/i;
const EDITORIAL_RE = /(fashion\s?editorial|에디토리얼|editorial)/i;
const RUNWAY_RE = /(패션\s?위크|fashion\s?week|런웨이|runway|컬렉션\s?쇼|\b(?:ss|fw|s\/s|f\/w)\s?\d{2}\b|\b\d{2}(?:ss|fw)\b)/i;
const MILAN_RE = /(밀라노|milan|milano|mfw)/i;
const PARIS_RE = /(파리|paris|pfw)/i;
const PRESENTATION_RE = /(프레젠테이션|presentation|프리젠테이션|컬렉션\s?(?:을\s?)?공개|신규\s?컬렉션|lookbook|룩북)/i;
const EVENT_RE = /(팝업|pop[\s-]?up|플래그십|플래그쉽|flagship|스토어\s?오픈|store\s?opening|오픈\s?기념|런칭|론칭|launch|전시|exhibition|행사|파티|party|기념\s?이벤트|이벤트)/i;
const CELEB_TAG_RE = /(k-?pop|idol|actor|actress|singer|rapper|celebrity|ambassador|girl\s?group|boy\s?group|앰배서더|아이돌|배우|가수|래퍼)/i;
/* "안보현, ..." / "제니, ..." / "Zendaya, ..." — 한국 매체 헤드라인의 셀럽 도입부.
   앞 토막이 짧고 공백이 없어야 한다. "성별을 지운 향, 프라다…" 같은 문장형을
   셀럽으로 오인하지 않게 하는 장치다. */
const LEAD_NAME_RE = /^(?:[가-힣]{2,5}|[A-Za-z][A-Za-z.'-]{1,14})\s?[,·]/;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);

/** 'Fashion,Culture' → 'fashion' */
function primaryCategory(raw) {
  return String(raw || '').split(',')[0].trim().toLowerCase();
}

/** 기사 제목에 이미 붙어 있는 [ ... ] 접두사를 떼어낸다 (재실행 시 중복 방지). */
function stripPrefix(title) {
  return clean(String(title || '').replace(/^\s*\[[^\]]{1,30}\]\s*/, ''));
}

/** 접미사 " | PAP MAGAZINE" / " ㅡ Pap magazine" 을 떼어낸다. */
function stripSuffix(title) {
  return clean(String(title || '').replace(/\s*[|ㅡ—–-]\s*pap\s?magazine\s*$/i, ''));
}

/* 강한 신호 = 이름을 실제로 찾았거나 태그가 사람임을 말한다.
   PRESENTATION 보다 먼저 본다 — 'BTS × 캘빈클라인 … 컬렉션 공개' 처럼
   컬렉션 발표라도 사람이 주인공이면 도메니코는 [ CELEBRITY ] 를 달아왔다. */
function strongCelebSignal(title, tags) {
  const hay = title + ' ' + tags.join(' ');
  if (CELEB_TAG_RE.test(hay)) return true;
  const low = hay.toLowerCase();
  return CELEB_LEXICON.some((n) => (/[가-힣]/.test(n) ? hay.includes(n) : low.includes(n.toLowerCase())));
}

/* 약한 신호 = 헤드라인이 '이름,' 으로 시작하더라 (추정). PRESENTATION 뒤로
   미룬다 — '이자벨마랑, 26FW 컬렉션 공개' 를 셀럽으로 오인하지 않게. */
function hasCelebSignal(title, tags) {
  return strongCelebSignal(title, tags) || LEAD_NAME_RE.test(title);
}

/**
 * 접두사 판정. 먼저 걸리는 규칙이 이긴다 — 순서가 곧 우선순위다.
 * 셀럽을 이벤트보다 먼저 보는 이유: "리즈, 토니모리 팝업스토어 현장"처럼
 * 팝업 기사라도 사람이 주인공이면 도메니코는 [ CELEBRITY ] 를 달아왔다.
 */
function classify(art) {
  const title = stripSuffix(stripPrefix((art && art.title) || ''));
  const tags = arr(art && art.tags);
  const hay = title + ' ' + tags.join(' ');
  const cat = primaryCategory(art && art.category);

  if (BACKSTAGE_RE.test(hay)) return PREFIX.BACKSTAGE;
  if (RUNWAY_RE.test(hay)) {
    if (MILAN_RE.test(hay)) return PREFIX.MILAN;
    if (PARIS_RE.test(hay)) return PREFIX.PARIS;
  }
  if (EDITORIAL_RE.test(hay)) return PREFIX.FASHION;
  if (strongCelebSignal(title, tags)) return PREFIX.CELEBRITY;
  if (PRESENTATION_RE.test(hay)) return PREFIX.PRESENTATION;
  if (hasCelebSignal(title, tags)) return PREFIX.CELEBRITY;
  if (EVENT_RE.test(hay)) return PREFIX.EVENT;
  return CATEGORY_FALLBACK[cat] || PREFIX.NEWS;
}

/** "[ CELEBRITY ] 제목 | PAP MAGAZINE" — 100자 안에서 제목만 줄인다. */
function buildTitle(art) {
  const prefix = classify(art);
  /* < > 는 YouTube 제목 금지 문자. 2026-07-19 "<오디세이>" 기사가
     여기서 걸러지지 않아 업로드가 400 으로 죽었다. */
  const body = stripSuffix(stripPrefix((art && art.title) || '')).replace(/[<>]/g, '');
  const room = MAX_TITLE - prefix.length - 1 - SUFFIX.length;
  const cut = body.length > room ? body.slice(0, Math.max(0, room - 1)).trim() + '…' : body;
  return (prefix + ' ' + cut + SUFFIX).trim();
}

/* 단어 첫 글자만 대문자로 올리면 약어가 뭉개진다 (#Bts #Mv #VipDinner).
   실측 태그에서 실제로 나온 것들만 예외 처리한다. */
const ACRONYM = {
  bts: 'BTS', mv: 'MV', dj: 'DJ', tv: 'TV', vip: 'VIP', ceo: 'CEO', pr: 'PR',
  ai: 'AI', ost: 'OST', mc: 'MC', nyc: 'NYC', la: 'LA', uk: 'UK', usa: 'USA',
  ss: 'SS', fw: 'FW', mfw: 'MFW', pfw: 'PFW', kpop: 'KPop',
  nct: 'NCT', exo: 'EXO', ive: 'IVE', itzy: 'ITZY', kard: 'KARD',
  gidle: 'GIDLE', txt: 'TXT', '3racha': '3RACHA',
};

/** 'red velvet' → '#RedVelvet', '안보현' → '#안보현', 'ahn bo-hyun' → '#AhnBoHyun' */
function toHashtag(raw) {
  const s = clean(raw);
  if (!s) return null;
  const words = s.split(/[\s._/\\-]+/).filter(Boolean);
  const joined = words
    .map((w) => ACRONYM[w.toLowerCase()] || (/^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join('');
  const stripped = joined.replace(/[^\p{L}\p{N}]/gu, '');
  if (stripped.length < 2 || /^\d+$/.test(stripped)) return null;
  return '#' + stripped;
}

/**
 * 해시태그 줄. 고정 앵커 2개 + 기사 태그.
 * 카테고리 해시태그(#NEWS 같은 것)는 더 이상 붙이지 않는다 — 도메니코 지시가
 * "기사에 관련있는 셀럽이나 내용의 단어"였다.
 */
function buildHashtags(art, max) {
  const cap = typeof max === 'number' ? max : 12;
  const out = [];
  const seen = new Set();
  const push = (h) => {
    if (!h) return;
    const k = h.toLowerCase();
    if (seen.has(k) || out.length >= cap) return;
    seen.add(k);
    out.push(h);
  };
  push('#Shorts');
  push('#PAPMAGAZINE');
  arr(art && art.tags).forEach((t) => push(toHashtag(t)));
  return out;
}

/** YouTube API snippet.tags — 브랜드 앵커 + 기사 태그 원문 (15개 상한은 _lib/youtube.js). */
function buildTagList(art, max) {
  const cap = typeof max === 'number' ? max : 15;
  const out = [];
  const seen = new Set();
  const push = (t) => {
    const v = clean(t);
    if (!v) return;
    const k = v.toLowerCase();
    if (seen.has(k) || out.length >= cap) return;
    seen.add(k);
    out.push(v);
  };
  push('PAP MAGAZINE');
  arr(art && art.tags).forEach(push);
  push('Shorts');
  return out;
}

module.exports = {
  PREFIX, CATEGORY_FALLBACK, CELEB_LEXICON, SUFFIX, MAX_TITLE,
  ACRONYM,
  classify, buildTitle, toHashtag, buildHashtags, buildTagList,
  stripPrefix, stripSuffix,
};
