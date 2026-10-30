/**
 * PAP Magazine — 셀럽 속보를 '아이돌 소식'으로 좁히는 관문 (2026-10-30 신설)
 *
 * 도메니코 2026-10-30: "텔레그램 셀럽속보 채팅방으로 전송되는 기사들을 아이돌 한정기사로 추려줘."
 *
 * 실측 (10/23~10/30, celeb_watch_seen alerted 243건): 대부분 아이돌이지만 섞여 들어오는 것들
 *   · 배우·가수 전속계약(송혜교·공명·윤하·스윙스), 트로트(임영웅·송가인·이찬원)
 *   · '아이돌 출신'·'걸그룹 졸업생'·'아이돌 닮은'·'출판계 아이돌'·'배드민턴 아이돌'
 *   · 영어 'BTS' = behind the scenes (인도 영화 기사: Kalki·Lagaan·Raashii Khanna)
 *   · AI·로봇·버추얼 아이돌, 할리우드 가십(제니퍼 로렌스)
 * 기존 isOnTarget 은 '10~20대 문화'(화보·앰버서더·틱톡·런웨이)까지 들였다 → 넓다.
 *
 * 판정 = ① 아이돌 이름(그룹·멤버)이 있거나 ② 아이돌 단어가 있으면서 제외 문맥이 없다.
 * 이름이 가장 믿을 만하다. 단어만 있는 경우는 '출신·졸업생·닮은·차트' 같은 문맥을 걸러낸다.
 *
 * 짧은 한글 이름(지수·리사·제니·정국·있지 등)은 일반 단어 속에 숨어 있다
 * ('코스피 지수', '제니퍼', '있지만', '프랜차이즈'). 그래서 앞뒤가 한글이 아닐 때만,
 * 또는 뒤에 조사(가·의·와·부터 …)만 붙었을 때만 이름으로 인정한다.
 *
 * 끄기: Vercel 환경변수 CELEB_WATCH_SCOPE=all → 예전(isOnTarget)대로.
 */
'use strict';

// ① 아이돌 그룹·멤버 (한글)
const NAMES_KO = [
  // 보이그룹
  '방탄소년단','세븐틴','스트레이키즈','스트레이 키즈','스키즈','엔시티','투모로우바이투게더','투바투',
  '엔하이픈','제로베이스원','제베원','라이즈','보이넥스트도어','에이티즈','더보이즈','몬스타엑스','갓세븐',
  '샤이니','슈퍼주니어','엑소','빅뱅','동방신기','트레저','크래비티','웨이션브이','엔플라잉','비투비',
  '인피니트','에이비식스','골든차일드','피원하모니','앤팀','투어스','코르티스','알파드라이브원','위고식스',
  '82메이저','코이키즈','플레이브','정한X조슈아','정한·조슈아','강다니엘','김재환','지창민','최강창민','텐',
  // 걸그룹
  '블랙핑크','뉴진스','아이브','에스파','르세라핌','트와이스','아일릿','베이비몬스터','키스오브라이프',
  '레드벨벳','여자아이들','마마무','오마이걸','엔믹스','케플러','스테이씨','우주소녀','있지',
  '에이핑크','프로미스나인','이즈나','하츠투하츠','키키','미야오','리센느','트리플에스','캣츠아이',
  '소녀시대','에프엑스','투애니원','2NE1','티아라','핑클','베스티','브레이브걸스','브브걸','EXID',
  '키빗업','A2O LITE','A2O 라이트','시크릿넘버','퀸즈아이','하이키','QWER',
  // 솔로·멤버
  '지드래곤','아이유','장원영','안유진','카리나','윈터','닝닝','태연','제니','로제','리사','지수',
  '정국','지민','슈가','제이홉','태민','백현','수호','창빈','미연','설윤','해린','하니','민지',
  '다니엘','혜인','원희','이로하','카즈하','사쿠라','허윤진','김채원','홍은채','나연','정연',
  '쯔위','사나','지효','채령','유나','리아','예지','류진','웬디','슬기','아이린','윤아',
  '효민','이채연','전소미','청하','권은비','최예나','츄','태용','도영','재현','해찬',
  '승관','디노','우지','조슈아','정한','민규','원우','호시','버논','에스쿱스','방찬','현진','필릭스',
  '아이엔','최산','윤호','홍중','민기','우영','종호','여상','차은우','문빈','뷔',
];
// 3글자여도 일반 단어 속에 잘 숨는 이름 → 경계 규칙 적용
const RISKY_KO = new Set(['라이즈','트레저','투어스','아이브','티아라','베스티','하이키','다니엘','사쿠라','세븐틴']);
const KO_SUBSTR = NAMES_KO.filter(n => n.length >= 3 && !RISKY_KO.has(n));
const KO_BOUNDED = NAMES_KO.filter(n => n.length < 3 || RISKY_KO.has(n));
// 이름 뒤에 붙어도 되는 조사
const PARTICLE = '(?:은|는|이|가|을|를|의|와|과|도|에|에서|에게|로|으로|랑|이랑|까지|부터|처럼|표|님|씨)';

// 영문 이름 (단어 경계 강제). 'bts' 는 아래 별도 규칙 — behind the scenes 오탐 때문.
const NAMES_EN = [
  'blackpink','newjeans','aespa','ive','le\\s?sserafim','seventeen','stray\\s?kids','skz','twice',
  'nct(?:\\s?127|\\s?dream|\\s?wish)?','txt','tomorrow\\s?x\\s?together','babymonster','zerobaseone',
  'enhypen','illit','itzy','riize','ateez','boynextdoor','the\\s?boyz','monsta\\s?x','got7','shinee',
  'super\\s?junior','exo','big\\s?bang','bigbang','red\\s?velvet','i-dle','mamamoo',
  'nmixx','kep1er','stayc','kiss\\s?of\\s?life','fromis_9','izna','hearts2hearts','katseye','plave',
  'a2o\\s?lite','rescene','tws','cortis','g-?dragon','jennie','jisoo','lisa','ros[eé]','jungkook',
  'jimin','j-hope','suga','karina','wonyoung','yujin','iu','taeyeon','jihyo','nayeon',
  'tzuyu','s\\.?coups','hoshi','mingyu','bang\\s?chan','felix','hyunjin','kazuha','hanni','qwer','exid','2ne1',
];

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const NAMES_RE = new RegExp(
  '(' + KO_SUBSTR.map(esc).join('|') + ')' +
  '|(?<![가-힣])(' + KO_BOUNDED.map(esc).join('|') + ')(?=$|[^가-힣]|' + PARTICLE + '(?![가-힣]))' +
  '|\\b(' + NAMES_EN.join('|') + ')\\b' +
  '|\\(g\\)i-dle',
  'i'
);

// ② 아이돌 단어 — 이름이 없을 때만 본다.
const WORDS_RE = /아이돌|걸그룹|보이그룹|연습생|데뷔조|k-?pop\s?idol|\bidol\b|girl\s?group|boy\s?group/i;

// 이름이 있어도 버리는 문맥: 진짜 아이돌이 아닌데 아이돌 이름을 빌려 쓴 기사
const ALWAYS_EXCLUDE_RE = new RegExp([
  '닮은꼴', '출판계 아이돌', '배드민턴 아이돌', '야구 아이돌', '골프 아이돌', '피겨 아이돌',
  '로봇 아이돌', '버추얼 아이돌', 'AI 걸그룹', 'AI 아이돌', '가상 아이돌',
].join('|'), 'i');

// 단어만으로 걸렸을 때 추가로 버리는 문맥: 출신·졸업생·닮은·비유·차트 이름·AI/로봇·과거 회상
const WORD_ONLY_EXCLUDE_RE = new RegExp([
  '출신', '졸업생', '닮은', '닮았', '아이돌픽', '아이돌\\s?차트', '아차랭킹',
  '트로트', '로봇', '인공지능', '\\bAI\\b', '버추얼', '데뷔 직전 무산', '유행 시술',
  '과거 소환', '걸그룹 꿈', '이었지',
].join('|'), 'i');

// 트로트 가수 — 이 사람이 주인공이면 아이돌 이름이 비교 대상으로 나와도 버린다
const TROT_RE = /임영웅|송가인|이찬원|안성훈|김희재|진해성|장민호|영탁|박서진|정동원/;
// 트로트 가수와 함께 나와도 '아이돌 기사'로 보는 큰 그룹
const BIG_IDOL_RE = /방탄소년단|\bBTS\b|블랙핑크|아이브|세븐틴|에이티즈|리센느|르세라핌|스트레이|스키즈/i;

/** 영어 'BTS' 가 방탄소년단인가 — 한글이 있거나 케이팝 맥락 단어가 같이 있어야 한다 */
function btsIsBand(t) {
  if (!/\bBTS\b/i.test(t)) return false;
  if (/[가-힣]/.test(t)) return true;
  return /jungkook|jimin|suga|j-hope|\bRM\b|\bjin\b|\bV\b|army|arirang|k-?pop|hybe|big\s?hit|tour|concert|album|billboard|spotify|grammy|bangtan|ateez|supergroup/i.test(t);
}

/**
 * 아이돌 소식인가 (제목 기준).
 * @param {string} title
 * @returns {boolean}
 */
function isIdolNews(title) {
  const t = String(title || '');
  if (!t) return false;
  if (ALWAYS_EXCLUDE_RE.test(t)) return false;
  const named = NAMES_RE.test(t) || btsIsBand(t) || /방탄/.test(t);
  if (named) {
    // 트로트 가수가 주인공이고 아이돌은 비교 대상일 뿐인 기사: '임영웅 291주 1위 - 아이돌차트'
    if (TROT_RE.test(t) && !BIG_IDOL_RE.test(t)) return false;
    return true;
  }
  if (WORDS_RE.test(t) && !WORD_ONLY_EXCLUDE_RE.test(t) && !TROT_RE.test(t)) return true;
  return false;
}

function scope() { return String(process.env.CELEB_WATCH_SCOPE || 'idol').toLowerCase(); }
function idolOnly() { return scope() !== 'all'; }

module.exports = { isIdolNews, idolOnly, btsIsBand, NAMES_RE, WORDS_RE, WORD_ONLY_EXCLUDE_RE, ALWAYS_EXCLUDE_RE };
