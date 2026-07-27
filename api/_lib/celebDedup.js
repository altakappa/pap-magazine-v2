/**
 * PAP Magazine — celeb-watch 중복 판정 로직 (2026-07-21 분리)
 *
 * 왜 분리했나: 도메니코 피드백 "중복된 기사가 너무 많이 온다".
 * 중복 판정이 크론 핸들러 안에 묻혀 있어 테스트가 불가능했다. 순수 함수로
 * 빼서 tests/celeb-dedup.test.js 로 회귀를 막는다.
 *
 * 이 파일의 함수들은 네트워크·DB 를 건드리지 않는다 (순수 함수).
 */

'use strict';

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/* HTML 엔티티 복원 — 숫자 엔티티까지.
   2026-07-21 2차: 이걸 안 하면 `&#038;` `&#160;` `&#8216;` 가 토큰화 단계에서
   038·160·8216 이라는 "단어"가 된다. 실측 celeb_watch_seen 에 그대로 남아 있었고,
   매체마다 인코딩이 달라 실행마다 이 숫자들이 들쭉날쭉 → 매번 "새 요소"로 잡혀
   같은 사건이 6번씩 알림으로 나갔다. 중복 폭주의 1번 원인. */
function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch (_e) { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch (_e) { return ' '; } })
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

/* 구글뉴스·매체 RSS 의 제목 끝 " - 매체명" 꼬리 제거.
   2026-07-21 2차: 이 꼬리 때문에 chosunbiz·starnewskorea·com·네이트 같은
   **매체 이름이 사건의 구성 요소로** 들어갔다. 같은 사건이라도 어느 매체가
   클러스터에 잡히느냐에 따라 core 가 달라져 중복 판정이 새어나갔다.
   중복 폭주의 2번 원인. */
function stripSource(title) {
  return decodeHtml(title)
    .replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set([
  // 영어 기능어
  'the','a','an','of','in','on','at','for','to','and','or','with','his','her','its',
  'new','says','said','after','from','over','into','this','that','be','is','are','was',
  'were','has','have','had','will','k','pop','as','by','but','not','out','up','off','all',
  'more','most','than','then','who','what','when','where','why','how','here','there',
  'it','he','she','they','we','you','their','our','your','one','two','about',
  // 2026-07-21 2차 — 헤드라인 상용어. 사건의 "요소"가 아니라 문장을 채우는 말이라
  // 리워딩마다 들락날락하며 가짜 새 요소를 만든다 (bold·dress·ball·having…).
  'watch','video','photo','photos','pic','pics','image','images','star','stars','show',
  'shows','news','report','reports','update','look','looks','style','styles','wear',
  'wears','wore','dress','dressed','outfit','sneakers','ball','kick','bold','having',
  'shop','release','releases','released','drops','drop','first','best','top','global',
  'official','ahead','link','links','behind','scenes','back','fans','fan','moment',
  'reveal','reveals','revealed','share','shares','shared','post','posts','via','com','www',
  // 한국어 상용어 (2026-07-21 2차)
  '사진','영상','기사','뉴스','공연','무대','모습','현장','네이트','스타일','화보',
  '공개','발표','소식','오늘','어제','관련','이번','지난','최근','대한','통해','위해',
  // 2026-07-27 3차 — 실측(BTS Butter 3번·정국 스포티파이 2번·NCT 티저 2번)에서
  // 같은 사건이 반복된 원인. 조회수·순위·플랫폼·컴백 상용어가 core 에 남아
  // 리워딩마다 '새 요소'를 만든다. 네이버 뉴스 소스 추가로 한↔영 표기 충돌 심화.
  // 조회수·수치 (숫자는 keywords 필터가, 단위·명사는 여기서)
  'billion','million','thousand','views','view','streams','stream','streaming',
  'record','records','milestone','surpasses','surpass','surpassed','becomes','become',
  'hits','hit','enters','enter','entered','tops','topped','reaches','reached',
  // 플랫폼·차트 (사건 식별에 부차적 — 여러 플랫폼 기사가 같은 사건)
  'spotify','billboard','youtube','melon','itunes','circle','hanteo','chart','charts',
  'hot','200','100','album','albums','single','singles','song','songs','track','tracks',
  // 컴백·발매 상용어 (그룹·작품명이 앵커라 이건 노이즈)
  'comeback','teaser','trailer','announce','announces','announced','announcement',
  'drop','drops','dropped','unveil','unveils','unveiled','reveals','revealed',
  'full','length','mini','repackage','prerelease','title','lead',
  // 군입대 (그룹·멤버명이 앵커)
  'enlist','enlists','enlistment','military','service','date','dates','army',
  // 기타 헤드라인 동사·명사
  'sweep','sweeps','spot','spots','meme','sparks','frenzy','higher','resolved','row',
  'tour','concert','performance','stage','win','wins','won','award','awards',
  // 시각물 명사 — 한쪽 기사에만 붙어 가짜 새 요소를 만든다 (NCT 'Logo/Banner Teaser').
  'logo','banner','poster','concept','visual','visuals','clip','preview','still',
  'jacket','tracklist','schedule','spoiler','snippet','edition','version',
  // 한국어 조회수·순위·플랫폼·컴백·군입대 상용어
  '돌파','뷰','스트리밍','스포티파이','빌보드','유튜브','멜론','차트','순위','기록',
  '달성','수록','활동','컴백','티저','예고','앨범','싱글','신곡','발매','공식',
  '입대','군입대','입영','전역','현역','육군','해군','공군','병역','의무','이행','대체복무','군백기','나란히','시작',
  '인기','독보적','최고','입찰','경매','유니폼','수상','정상','석권','올킬',
]);

// 2026-07-21 — 한국어 대응. 기존 `length >= 3` 은 영어 기준이라 한국어 헤드라인의
// 핵심어(정국·결승·무대·수상…)를 거의 전부 버렸고, 그래서 한국어 기사끼리는
// 중복 판정이 사실상 작동하지 않았다. CJK 는 2자부터 의미가 있으므로 분리한다.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/;
function keywords(title) {
  return norm(canonicalize(stripSource(title))).split(' ')
    // 순수 숫자·수치는 사건의 요소가 아니다. 2026-07-27 강화:
    // 연도·엔티티코드(순수숫자) + 조회수·스트리밍 단위(15억·11억·1000만) +
    // 서수(7th·1st) 전부 제거 — 실측 Butter '11억' vs '1.1 billion' 충돌 원인.
    .filter(w => !/^\d+(억|만|천|백|위|th|st|nd|rd)?$/i.test(w))
    .filter(w => (CJK_RE.test(w) ? w.length >= 2 : w.length >= 3) && !STOP.has(w));
}

/* 헤드라인 하나의 지문 — 같은 기사가 실행마다 다시 잡히는 것을 막는다.
   단어 순서·꼬리 매체명·엔티티 인코딩 차이를 흡수하도록 정렬된 키워드 집합으로 만든다.
   (클러스터 core 는 어떤 헤드라인이 함께 묶이느냐에 따라 흔들리지만, 이 키는
    헤드라인 하나만 보므로 흔들리지 않는다 — 중복 방지의 마지막 방어선.) */
function titleKey(title) {
  const ks = [...new Set(keywords(title))].sort();
  return ks.length ? ks.join('-') : norm(stripSource(title)).slice(0, 60);
}

/* 한·영 표기 통일 — BTS 와 방탄소년단이 다른 토큰이면 같은 사건이 갈라진다.
   토큰화 전에 별칭을 하나의 정규 표기로 치환한다. */
const ENTITY_ALIASES = [
  ['bts', /(bts|방탄소년단|방탄)/gi],
  ['blackpink', /(blackpink|블랙핑크)/gi],
  ['newjeans', /(newjeans|뉴진스)/gi],
  ['aespa', /(aespa|에스파)/gi],
  ['straykids', /(stray\s?kids|스트레이\s?키즈)/gi],
  ['seventeen', /(seventeen|세븐틴)/gi],
  ['twice', /(twice|트와이스)/gi],
  // 2026-07-27 한국 소스 보강 — 한국발 기사와 영문 기사가 같은 사건으로 묶이도록.
  ['jungkook', /(jung\s?kook|정국)/gi],
  ['jimin', /(jimin|지민)/gi],
  ['jennie', /(jennie|제니)/gi],
  ['gdragon', /(g[-\s]?dragon|지드래곤|권지용)/gi],
  ['아이유', /\bIU\b|아이유/g],
  ['lesserafim', /(le\s?sserafim|르세라핌)/gi],
  ['ive', /\bIVE\b|아이브/g],
  // 2026-07-27 3차 — 실측 중복(세븐틴 군입대 4번)의 멤버 표기 통일.
  ['dokyeom', /(dokyeom|도겸)/gi],
  ['vernon', /(vernon|버논)/gi],
  ['taehyung', /(taehyung|태형)/gi],
  ['nct', /(nct\s?127|nct127)/gi],
  ['worldcup', /(world\s?cup|월드컵)/gi],
  ['superbowl', /(super\s?bowl|슈퍼볼)/gi],
  ['halftime', /(halftime|하프타임)/gi],
  ['metgala', /(met\s?gala|멧\s?갈라)/gi],
  ['oscars', /(oscars?|아카데미\s?시상식)/gi],
  ['grammys', /(grammys?|그래미)/gi],
  ['cannes', /(cannes|칸\s?영화제)/gi],
  ['chanel', /(chanel|샤넬)/gi],
  ['dior', /(dior|디올)/gi],
  ['gucci', /(gucci|구찌)/gi],
  ['prada', /(prada|프라다)/gi],
  ['louisvuitton', /(louis\s?vuitton|루이\s?비통)/gi],
  ['balenciaga', /(balenciaga|발렌시아가)/gi],
  ['saintlaurent', /(saint\s?laurent|생\s?로랑)/gi],
];
function canonicalize(text) {
  let s = String(text || '');
  for (const [key, re] of ENTITY_ALIASES) s = s.replace(re, ' ' + key + ' ');
  return s;
}

/* 교차 검증 클러스터링 — 키워드 3개 이상 겹치고 소스가 서로 다르면 같은 사건.
   두 개 이상 매체가 다룬 사건만 속보 후보 (단독 낚시 기사 배제). */
function clusterEvents(items) {
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const base = keywords(items[i].title);
    if (base.length < 2) continue;
    const group = [items[i]];
    used.add(i);
    for (let k = i + 1; k < items.length; k++) {
      if (used.has(k)) continue;
      const other = keywords(items[k].title);
      const overlap = base.filter(w => other.includes(w));
      if (overlap.length >= 3) { group.push(items[k]); used.add(k); }
    }
    const sources = new Set(group.map(g => g.source));
    if (sources.size >= 2) {
      // 2026-07-21 — 시그니처를 "첫 헤드라인의 앞 6단어"로 만들면 같은 사건이라도
      // 클러스터의 첫 항목이 바뀔 때마다 시그니처가 달라져 중복 판정이 새어나갔다.
      // 그룹 전체에서 가장 자주 등장한 키워드로 만들어 순서에 흔들리지 않게 한다.
      const kw = clusterKeywords(group);
      const core = clusterCore(group);
      clusters.push({
        signature: core.length ? core.join('-') : kw.slice(0, 5).sort().join('-'),
        kw,
        core,
        headlines: group.map(g => ({ title: g.title, link: g.link, source: g.source })),
        sourceCount: sources.size,
        topic: group[0].topic,
        newestTs: Math.max(...group.map(g => g.ts || 0)),
      });
    }
  }
  return clusters.sort((a, b) => b.sourceCount - a.sourceCount);
}

/* 클러스터 대표 키워드 — 빈도 높은 순, 동률이면 사전순(결정적). */
function clusterKeywords(group) {
  const freq = new Map();
  for (const g of group) {
    for (const w of new Set(keywords(g.title))) freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(e => e[0])
    .slice(0, 12);
}

/* 사건의 "실체" 키워드 — 여러 매체가 공통으로 쓴 단어만 남긴다.
   도메니코 규칙(2026-07-21):
     "단어나 문장만 바꿔가며 BTS가 출연했다는 기사는 중복.
      다만 정호연이 추가되면 정호연이 들어갔으므로 다른 기사."
   즉 사건의 정체성은 **등장 요소(인물·브랜드·이벤트)의 집합**이지 문장 표현이
   아니다. 리워딩으로 생긴 단어는 한 매체에만 나타나고, 진짜 새 인물은 여러
   매체 헤드라인에 동시에 등장한다 — 그 차이로 둘을 가른다. */
function clusterCore(group) {
  const need = group.length >= 3 ? 2 : group.length; // 2건이면 둘 다에, 3건 이상이면 2건 이상에
  const freq = new Map();
  for (const g of group) {
    for (const w of new Set(keywords(g.title))) freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()].filter(e => e[1] >= need).map(e => e[0]).sort();
}

/* 이미 알린 사건과 같은가.
   판정: 새 사건의 실체 키워드가 **기존에 없던 요소를 하나라도 더하면 다른 사건**.
   더하는 게 없고 겹치기만 하면(= 표현만 바꾼 재탕) 중복.

   예) 기존: [bts, halftime, worldcup]
       "BTS 하프타임쇼 무대 오른다"     → core [bts, halftime, worldcup] → 중복 ✅
       "정호연·BTS 하프타임쇼 동반 출연" → core [+정호연]                → 새 사건 ✅ */
function sameEvent(newCore, seenCore, opts) {
  const A = (newCore || []).filter(Boolean);
  const B = new Set((seenCore || []).filter(Boolean));
  if (!A.length || !B.size) return false;

  let inter = 0, novel = 0;
  for (const w of new Set(A)) (B.has(w) ? inter++ : novel++);
  if (!inter) return false;

  // 새 요소가 하나라도 있으면 다른 사건 (인물 추가·사건 전개).
  // 2026-07-27 최종 결정 (도메니코): "A도 B도 아니다 — 문장만 살짝 바뀐 같은
  // 뉴스가 또 오는 것만 막아라." Butter 11억뷰가 10분 간격 재발송된 원인은
  // '11억' vs '1.1 billion' 같은 수치·플랫폼 토큰이 가짜 '새 요소'가 된 것 —
  // 해법은 keywords 단계의 숫자 필터·STOP 강화(위 3차 추가분)이지, 진짜 새
  // 요소(정호연 규칙: 새 인물 추가 = 다른 기사)까지 병합하는 것이 아니다.
  // (novel===1 병합 규칙은 efb80d6 에서 도입됐다가 같은 날 이 결정으로 철회.)
  if (novel > 0) return false;

  // 새 요소가 없다 = 기존 사건의 부분집합 = 표현만 바꾼 재탕.
  // 단, 겹침이 1개뿐이면 우연일 수 있으니(예: 'worldcup' 만 같음) 제외.
  const minOverlap = (opts && opts.minOverlap) || 2;
  return inter >= minOverlap || (inter === 1 && A.length === 1 && B.size === 1);
}

/* 화제성 점수 — 알림을 보낼 가치가 있는가.
   도메니코 결정(2026-07-21): "5분마다 검토해서 화제성이 있는 것만 텔레그램".
   교차 매체 수가 가장 강한 신호이고, 대형 이벤트 키워드·최신성을 가산한다. */
const HOT_RE = /(bts|blackpink|방탄|블랙핑크|월드컵|world\s?cup|super\s?bowl|halftime|met\s?gala|oscar|grammy|cannes|comeback|debut|creative\s+director|artistic\s+director|steps?\s+down|appointed|사망|은퇴|열애|결혼|입대|전역|수상|1위|컴백|데뷔|해체|파경)/i;
function hotScore(c) {
  let s = c.sourceCount * 2;                              // 교차 검증 = 핵심 신호
  if (HOT_RE.test(c.headlines.map(h => h.title).join(' '))) s += 3;
  if (c.newestTs && Date.now() - c.newestTs < 60 * 60 * 1000) s += 2; // 1시간 이내
  if (c.headlines.length >= 4) s += 1;                    // 헤드라인 물량
  return s;
}
const HOT_MIN = 7; // 2개 매체(4) + 최신(2) 만으로는 안 보냄. 3개 매체 또는 대형 키워드 필요.

module.exports = {
  norm, canonicalize, keywords, clusterEvents, clusterKeywords, clusterCore,
  sameEvent, hotScore, HOT_MIN, decodeHtml, stripSource, titleKey, STOP,
};
