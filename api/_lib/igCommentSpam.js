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

  // 4) 전각 구두점 도배 (。‥:::)
  const cjkPunct = (s.match(/[　-〿！-／：-＠]/g) || []).length;
  if (cjkPunct >= 3) sig.push({ k: 'cjk_punct_spam', n: cjkPunct, w: 25 });

  // 5) 검색어 유도 문구 (정규화 후 판정)
  const q = squash(s);
  if (/(검색해봐|찾기해봐|글로검색|쳐봐|검색해보|구글에)/.test(q)) sig.push({ k: 'search_bait', w: 30 });

  // 6) 도메인 흔적
  if (/(19x|\.zone|\.club|\.top|\.xyz|tme|wame)/i.test(q)) sig.push({ k: 'domain_bait', w: 45 });

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
  const all = [...structuralSignals(raw), ...keywordHits(raw)];
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
const AUTO_MIN_SCORE = 150;
const AUTO_MIN_OWN_SIGNALS = 2;

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
  if (score < minScore) return { auto: false, why: `${score}점 < 자동 기준 ${minScore}점` };
  if (own.length < minOwn) {
    return { auto: false, why: `자기 신호 ${own.length}개 < ${minOwn}개 (살포 가산만으로는 자동 처리하지 않는다)` };
  }
  return { auto: true, why: `${score}점 · 자기 신호 ${own.length}개` };
}

module.exports = { normalize, squash, structuralSignals, keywordHits, score, fingerprint,
  autoHidable, ownSignals, AUTO_MIN_SCORE, AUTO_MIN_OWN_SIGNALS, BAIT };
