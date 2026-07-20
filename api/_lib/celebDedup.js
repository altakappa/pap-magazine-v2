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
const STOP = new Set(['the','a','an','of','in','on','at','for','to','and','or','with','his','her','its','new','says','after','from','over','into','this','that','be','is','are','was','were','has','have','will','k','pop']);
// 2026-07-21 — 한국어 대응. 기존 `length >= 3` 은 영어 기준이라 한국어 헤드라인의
// 핵심어(정국·결승·무대·수상…)를 거의 전부 버렸고, 그래서 한국어 기사끼리는
// 중복 판정이 사실상 작동하지 않았다. CJK 는 2자부터 의미가 있으므로 분리한다.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/;
function keywords(title) {
  return norm(canonicalize(title)).split(' ')
    .filter(w => (CJK_RE.test(w) ? w.length >= 2 : w.length >= 3) && !STOP.has(w));
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
  if (novel > 0) return false;

  // 새 요소가 없다 = 기존 사건의 부분집합 = 표현만 바꾼 재탕.
  // 단, 겹침이 1개뿐이면 우연일 수 있으니(예: 'worldcup' 만 같음) 제외.
  const minOverlap = (opts && opts.minOverlap) || 2;
  return inter >= minOverlap || (inter === 1 && A.length === 1 && B.size === 1);
}

/* 화제성 점수 — 알림을 보낼 가치가 있는가.
   도메니코 결정(2026-07-21): "5분마다 검토해서 화제성이 있는 것만 텔레그램".
   교차 매체 수가 가장 강한 신호이고, 대형 이벤트 키워드·최신성을 가산한다. */
const HOT_RE = /(bts|blackpink|방탄|블랙핑크|월드컵|world\s?cup|super\s?bowl|halftime|met\s?gala|oscar|grammy|cannes|comeback|debut|creative\s+director|artistic\s+director|steps?\s+down|appointed|사망|은퇴|열애|결혼|입대|전역|수상|1위)/i;
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
  sameEvent, hotScore, HOT_MIN,
};
