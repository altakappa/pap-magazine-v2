'use strict';
/**
 * IG 스팸 댓글 정규화 + 구조 신호 탐지
 * 2026-08-19 실제 표본(성인사이트 유인) 기반.
 * 스패머는 키워드 필터를 피하려고 글자를 망가뜨린다. 우리는 되돌린 뒤에 본다.
 */

// 한글(음절·자모), ASCII 영숫자만 남긴다. 나머지(그리스 ι, 。, 【】, |, :, / 등)는 소음.
const KEEP = /[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9\s]/;

function normalize(raw) {
  let s = String(raw || '').normalize('NFKC');   // ⑤→5, ｇ→g, 全角→半角
  s = s.replace(/[​-‍﻿]/g, '');   // 제로폭 문자
  s = Array.from(s).filter((c) => KEEP.test(c)).join('');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** 띄어쓰기까지 없앤 형태 — "해 봐" 와 "해봐" 를 같게 만든다 */
function squash(raw) {
  return normalize(raw).replace(/\s+/g, '').toLowerCase();
}

/* ── 구조 신호 ──────────────────────────────────────────
 * 이름(송하리·밀탱크녀)은 매주 바뀐다. 하지만 '망가뜨리는 방식'은 안 바뀐다.
 * 그래서 이름이 아니라 방식을 본다. */
function structuralSignals(raw) {
  const s = String(raw || '');
  const sig = [];

  // 1) 한글 사이에 낀 이물질 문자 (그리스 ι, 키릴, 라틴 소문자 등)
  const infiltrated = (s.match(/[가-힣][ɐ-ʯͰ-ϿЀ-ӿǀ-Ǐıι|·ˑ○◇◆△▽↘↗→←~＋⁺_+]+[가-힣]/g) || []).length;
  if (infiltrated >= 2) sig.push({ k: 'homoglyph_infiltration', n: infiltrated, w: 40 });

  // 2) 한 글자씩 띄어쓰기 (해 봐 남 자 만 들 어 와)
  const singles = (s.match(/(?:^|\s)[가-힣](?=\s)/g) || []).length;
  if (singles >= 4) sig.push({ k: 'char_spacing', n: singles, w: 35 });

  // 3) 원문자·전각 숫자 (⑤②⑨⑦)
  const enclosed = (s.match(/[①-⓿０-９]/g) || []).length;
  if (enclosed >= 2) sig.push({ k: 'enclosed_digits', n: enclosed, w: 30 });

  /* 3b) 한 자리 숫자를 구두점으로 끊어 놓은 것 (5,,4,,7,,2 / 3ː6ː9ː2)
   *     ⑤,,②,,⑨,,⑦ 와 같은 수법인데 원문자를 안 쓴 판이다.
   *     2026-08-21: 스패머가 원문자를 일반 숫자로 바꾸자 30점이 통째로 빠졌다.
   *     원문자가 이미 잡혔으면 더하지 않는다 — 같은 수법을 두 번 세지 않는다.
   *     날짜(2026.08.21)·금액(5,000)은 여러 자리 묶음이라 걸리지 않는다. */
  if (enclosed < 2 && /[0-9](?:[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ]{1,3}[0-9]){2,}/.test(s)) {
    sig.push({ k: 'spaced_digits', w: 30 });
  }

  // 4) 전각 구두점 도배 (。‥:::)
  const cjkPunct = (s.match(/[　-〿！-／：-＠]/g) || []).length;
  if (cjkPunct >= 3) sig.push({ k: 'cjk_punct_spam', n: cjkPunct, w: 25 });

  // 5) 검색어 유도 문구 (정규화 후 판정)
  const q = squash(s);
  if (/(검색해봐|찾기해봐|글로검색|쳐봐|검색해보|구글에)/.test(q)) sig.push({ k: 'search_bait', w: 30 });

  /* 6) 도메인 흔적
   *    2026-09-06: 여기 있던 규칙은 squash(점·공백이 다 사라진 문자열)에 대고
   *    'tme' 를 찾고 있었다. 그래서 "contact me" 가 "contactme" 가 되면서
   *    영어 정상 댓글이 45점을 받았다. ('hit me up' 도 같다.)
   *    같은 이유로 '.zone/.club/.top/.xyz' 는 점이 이미 사라져 한 번도 걸린 적이 없다.
   *    죽은 규칙 넷과 오탐 규칙 둘이었다. 점을 살린 문자열에 대고 다시 본다. */
  const dom = String(s).normalize('NFKC').toLowerCase().replace(/[。｡·・]/g, '.').replace(/\s+/g, '');
  const domSp = String(s).normalize('NFKC').toLowerCase().replace(/[。｡]/g, '.');
  if (/19x/.test(dom)
      || /\b(t|wa)\s*\.\s*me\b/.test(domSp)
      || /[a-z0-9-]{2,}\.(zone|club|top|xyz)(?![a-z])/.test(domSp)) {
    sig.push({ k: 'domain_bait', w: 45 });
  }

  // 7) 검색엔진 이름을 구분자로 찢어놓은 경우
  //    G....__O__O__G__L__E / G⁺O⁺O⁺G⁺L⁺E / GιOιOιGιLιE / Ｇ○ogle / 구ι글
  //    원문에는 사이에 뭔가 끼어 있고, 정규화하면 google/naver 가 드러난다.
  const hadSep = /[가-힣A-Za-z][^가-힣A-Za-z0-9\s]{1,8}[가-힣A-Za-z]/.test(s);
  if (hadSep && /(google|goog|naver|구글|네이버)/i.test(q) && !/(google|naver|구글|네이버)/i.test(s)) {
    sig.push({ k: 'search_engine_obfuscated', w: 50 });
  }

  return sig;
}

/* 미끼 이름 — 주간 갱신 대상. 정규화된 문자열에 대해 매칭한다. */
const BAIT = [
  '송하리', '밀탱크녀', '라방사건', '19x',
  '노출사고', '유출본', '19금영상',
  '지컵', '쮸소창', '쥬소쳐', '방송사고', 'vip전용',
  '어린애들은검색하지마라', '이중생활', '인플루언서vip',
];
/* 단독으로 쓰면 오탐나는 말들 — 반드시 조합으로만 */
const COMBO = [
  ['원본', ['컵', '녀', '유출', '영상']],
  ['영상', ['유출', '원본', '19']],
];

function keywordHits(raw) {
  const q = squash(raw);
  const hits = [];
  for (const b of BAIT) if (q.includes(b.toLowerCase())) hits.push({ k: 'bait:' + b, w: 45 });
  for (const [word, needs] of COMBO) {
    if (q.includes(word) && needs.some((n) => q.includes(n))) hits.push({ k: 'combo:' + word, w: 35 });
  }
  return hits;
}

function score(raw) {
  const all = [...structuralSignals(raw), ...keywordHits(raw), ...englishSignals(raw)];
  const total = all.reduce((a, x) => a + x.w, 0);
  return { total, signals: all.map((x) => x.k), normalized: normalize(raw), squashed: squash(raw) };
}

/**
 * 지문 — 같은 문구를 여러 계정이 뿌리는 것을 잡기 위한 키.
 * 스패머는 계정만 바꾸고 본문은 돌려쓴다. 정규화하면 같은 값이 나온다.
 *
 * ⚠️ 2026-08-19 실전에서 잡은 함정: 이모지만 있는 댓글('😢😢😢😢')은
 * 정규화하면 빈 문자열이 된다. 그러면 서로 무관한 이모지 댓글 20건이
 * 전부 같은 지문으로 묶여 '20계정 살포'로 오인된다. 실제로 그렇게 나왔다.
 * 글자가 남지 않는 댓글은 지문을 만들지 않는다(null). 묶을 근거가 없다.
 */
/* 우리 계정 핸들. 이것만 남는 댓글은 '우리를 태그한 것'이지 살포가 아니다. */
const OWN_HANDLES = /^(pap_?magazine|pap_?celeb|pap_?beauty|pap_?fashion|pap_?trends|pap_?object|pepperit_?mag|papkorea)$/;

function fingerprint(raw) {
  const q = squash(raw).replace(/[0-9]/g, '#');   // 숫자 자리(⑤④⑦②)는 바뀌므로 뭉갠다
  if (q.length < 6) return null;                  // 너무 짧으면 우연히 겹친다 — 묶지 않는다
  if (OWN_HANDLES.test(q)) return null;           // 우리 핸들 멘션만 남은 것 (2026-08-19 오탐)
  let h = 5381;
  for (let i = 0; i < q.length; i++) h = ((h * 33) ^ q.charCodeAt(i)) >>> 0;
  return h.toString(36) + ':' + q.length;
}


/* ── 영문 스팸 (마약 판매 유인) ──────────────────────────────
 * 2026-09-06. 도메니코가 인스타 댓글 캡처를 보냈다. 6개 계정이 같은 게시물에
 * 마약 판매 텔레그램 계정을 뿌리고 있었다.
 *
 * 그 6건을 위 판정기에 그대로 넣어 봤다. 전부 0점이었다. 살포 판정도 안 걸렸다
 * (문구를 조금씩 바꿔서 같은 지문 최대 묶음이 2건, 기준은 3건).
 * 이유는 명확하다. 위의 신호는 전부 한글·CJK 구두점·한국어 미끼어가 있어야 켜진다.
 * 2026-08-19 한국어 성인 스팸 표본 하나만 보고 만든 자였다.
 *
 * 그동안 크론은 12일 내내 '스팸 0건'이라고 정상 보고했다.
 * 0은 깨끗하다는 뜻이 아니라 이 자로는 못 잰다는 뜻이었다.
 *
 * 여기서 세는 것은 낱말이 아니라 '파는 구조'다.
 *   ① 플랫폼 밖 연락처로 빼낸다 (텔레그램·왓츠앱·위커)
 *   ② 그 낱말을 쪼갠다 (tele gram) — 한글 char_spacing 의 영어판
 *   ③ 마약 낱말 + 판매 신호가 함께 나온다 (둘 중 하나만으로는 안 센다)
 *   ④ 목적지 계정은 안 바뀐다 — 문구는 바꿔도 연락처는 못 바꾼다
 * ④는 여기서 신호로 만들지 않는다. 살포(burst)와 완전히 같은 성격이라
 * 크론의 살포 계산에 키 하나를 더하는 쪽이 맞다. 규칙을 두 벌로 만들지 않는다.
 */

/** 낱말 경계를 살린 라틴 형태 — 짧은 낱말(lsd·dmt)을 안전하게 본다 */
function latinWords(raw) {
  return String(raw || '').normalize('NFKC').replace(/[​-‍﻿]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
/** 라틴 문자만 붙인 형태 — "tele gram" 과 "telegram" 을 같게 만든다 */
function latinSquash(raw) {
  return latinWords(raw).replace(/ /g, '');
}

const MESSENGER = 'telegram|telegam|telgram|tellegram|whatsapp|whatapp|watsapp|wickr';
const MESSENGER_SQ = new RegExp('(' + MESSENGER + ')');
const MESSENGER_W = new RegExp('\\b(' + MESSENGER + ')\\b');

/* 마약 낱말. 이것만으로는 절대 판정하지 않는다 — 화보 댓글에도 나올 수 있다. */
const DRUG_RE = /\b(psychedelic|psychedelics|psilocybin|mushroom|mushrooms|shroom|shrooms|lsd|dmt|mdma|ketamine|ayahuasca|mescaline|microdose|microdosing|molly|adderall|xanax|percocet|oxycodone|cannabis|marijuana|weed|edibles|carts)\b/;
/* 파는 자리에서만 나오는 말 */
const SALE_RE = /\b(available|order|orders|ordering|shipping|ship|discreet|discreetly|delivery|deliver|plug|dm|dms|hmu|inbox|contact|buy|purchase|stock|vendor|supply|supplier|legit|worldwide|prices|priced)\b/;
/* 밖으로 불러내는 말 */
const SOLICIT_RE = /\b(dm|dms|message|text|contact|write)\s+(me|him|her|us)\b|\bhit\s+me\s+up\b|\bhmu\b|\breach\s+out\b/;

function englishSignals(raw) {
  const sig = [];
  const w = latinWords(raw);
  const sq = latinSquash(raw);
  if (!w) return sig;

  // 1) 플랫폼 밖 연락처 유도
  const messenger = MESSENGER_SQ.test(sq);
  if (messenger) sig.push({ k: 'offplatform_contact', w: 60 });

  // 2) 그 낱말을 쪼개 놓았다 (tele gram / t.e.l.e.g.r.a.m / w h a t s a p p)
  //    한글 쪽 search_engine_obfuscated 와 같은 수법, 같은 판정 방식이다.
  if (messenger && !MESSENGER_W.test(w)) sig.push({ k: 'contact_word_split', w: 90 });

  // 3) 마약 낱말 + 판매 신호. 반드시 둘 다 있어야 한다.
  if (DRUG_RE.test(w) && SALE_RE.test(w)) sig.push({ k: 'drug_sale', w: 90 });

  // 4) 밖으로 불러내는 문구
  if (SOLICIT_RE.test(w)) sig.push({ k: 'dm_solicit', w: 30 });

  return sig;
}

/**
 * 목적지 계정. 연락처 유도 신호가 있는 댓글에서만 뽑는다.
 * 그냥 아무 @멘션이나 세면 '@pap_magazine 🤍' 4건이 살포로 묶인다 (6c37aa7 오탐).
 * 평범한 영어 낱말은 목적지가 아니다 — 밑줄이나 숫자가 있는 것만 본다.
 */
function contactHandle(raw) {
  const sq = latinSquash(raw);
  if (!MESSENGER_SQ.test(sq)) return null;
  const toks = String(raw || '').normalize('NFKC').toLowerCase().match(/[a-z][a-z0-9._]{3,29}/g) || [];
  for (const tok of toks) {
    const clean = tok.replace(/[._]+$/, '');
    if (clean.length < 5) continue;
    if (!/[._0-9]/.test(clean)) continue;
    const bare = clean.replace(/[._]/g, '');
    if (OWN_HANDLES.test(bare)) continue;
    if (MESSENGER_SQ.test(bare)) continue;
    return clean;
  }
  return null;
}


/* ── 자동 숨김 판정 ────────────────────────────────────────────
 * 2026-08-20. 도메니코: "내가 뭔가를 하지 않아도 자동으로 숨길 수 없어?"
 *
 * 어제는 '자동 숨김은 안 된다'고 했다. 오탐을 두 번 냈기 때문이다.
 * 하룻밤 실전 데이터 107건으로 다시 보니 그 판단은 반만 맞았다.
 *
 *   오탐 1차 (이모지 20건)   60점 · 자기 신호 0개 (살포 가산만)
 *   오탐 2차 (멘션 4건)      60점 · 자기 신호 0개 (살포 가산만)
 *   진짜 스팸 107건         110~460점 · 신호 3~9개
 *
 * 겹치는 구간이 없다. 문제는 '자동이냐 아니냐'가 아니라 '선을 어디에
 * 긋느냐'였다. 두 오탐 모두 '자기 신호 0개 + 살포 가산' 이라는 같은 모양이라,
 * 그 모양을 배제하는 것이 임계값보다 중요하다.
 *
 * 그래서 두 조건을 동시에 요구한다.
 *   ① 점수가 자동 임계값 이상 (기본 150 — 오탐 60점의 2.5배)
 *   ② 살포 가산을 뺀 '자기 신호'가 2개 이상
 *
 * ②가 핵심이다. 남들이 똑같이 썼다는 사실만으로는 영원히 자동 숨김이 안 된다.
 */
/* 살포 가산 — 같은 글이 여러 계정에서 동시에 올라온 것.
 * 수집할 때와 숨기기 직전 재판정할 때가 같은 값을 써야 한다.
 * (2026-08-21: 수집 점수엔 들어가고 재판정 점수엔 안 들어가서
 *  200점짜리 스팸이 '140점'으로 재판정돼 영원히 보류됐다) */
const BURST_BONUS = 60;
const BURST_MIN_COUNT = 3;

const AUTO_MIN_SCORE = 150;
const AUTO_MIN_OWN_SIGNALS = 2;

/* ── 단독으로도 확정인 신호 ─────────────────────────────────
 * 2026-09-06 도메니코 지시: "tele 나 gram 이 들어가면 다 스팸 처리해서 숨겨줘".
 *
 * 글자 그대로 부분문자열로 찾을 수는 없다. 'instagram' 안에 'gram' 이 있다.
 * program·diagram·monogram·grammy 도 마찬가지고, 'tele' 는 television·
 * telephone·telefono(밀라노 쪽 이탈리아어 댓글) 안에 있다. 그대로 켜면
 * 인스타 댓글에서 제일 흔한 낱말이 통째로 숨겨진다.
 *
 * 그래서 낱말 단위로 본다. 'telegram' 이 보이면(쪼개 놨든 아니든) 확정으로 친다.
 * 'instagram' 안에는 'telegram' 이 없으므로 안전하다.
 * 'on the gram'(인스타를 가리키는 영어 속어)도 telegram 이 아니므로 안 걸린다.
 *
 * 이 신호가 있으면 점수와 신호 개수를 보지 않고 숨긴다.
 * 정상 독자가 우리 화보 밑에 텔레그램·왓츠앱·위커를 적을 이유가 사실상 없다.
 * 대가는 분명하다: "Are you on telegram?" 같은 진짜 댓글도 숨겨진다.
 * 도메니코가 그 대가를 알고 고른 것이다. 되돌리려면 이 집합을 비우면 된다.
 */
const DECISIVE = new Set(['offplatform_contact', 'contact_word_split']);

/** 살포(burst)를 뺀, 그 댓글이 스스로 낸 신호 */
function ownSignals(signals) {
  return (signals || []).filter((s) => !String(s).startsWith('burst:'));
}

/**
 * 자동으로 숨겨도 되는가.
 * @returns {{auto:boolean, why:string}}
 */
function autoHidable(score, signals, opts) {
  const minScore = Number((opts && opts.minScore) || AUTO_MIN_SCORE);
  const minOwn = Number((opts && opts.minOwnSignals) || AUTO_MIN_OWN_SIGNALS);
  const own = ownSignals(signals);
  const decisive = own.filter((x) => DECISIVE.has(String(x)));
  if (decisive.length) return { auto: true, why: `단독 확정 신호 ${decisive.join('+')} (${score}점)` };
  if (score < minScore) return { auto: false, why: `${score}점 < 자동 기준 ${minScore}점` };
  if (own.length < minOwn) {
    return { auto: false, why: `자기 신호 ${own.length}개 < ${minOwn}개 (살포 가산만으로는 자동 처리하지 않는다)` };
  }
  return { auto: true, why: `${score}점 · 자기 신호 ${own.length}개` };
}

module.exports = { BURST_BONUS, BURST_MIN_COUNT, normalize, squash, structuralSignals, keywordHits, score, fingerprint,
  autoHidable, ownSignals, AUTO_MIN_SCORE, AUTO_MIN_OWN_SIGNALS, BAIT,
  latinWords, latinSquash, englishSignals, contactHandle, DECISIVE };
