/**
 * 한국어 파일명 ↔ 기사 매칭 (2026-08-07)
 *
 * 배경: 에디터가 구글 드라이브 '유튜브' 폴더에 올리는 영상 파일명은 자유 형식이다.
 *   "베이델리 규진" · "공항패션 규진" · "페라가모 나나 김무열 윤승아 김희애"
 * 파일명에 기사 슬러그도 인스타 코드도 없다. 도메니코가 "제목 유사도 자동 매칭"을
 * 선택했으므로 제목·태그로 추정한다.
 *
 * ⚠️ 이 함수가 틀리면 **엉뚱한 영상이 공개 유튜브에 올라간다.** 되돌릴 수는 있지만
 * 이미 사람들이 본 뒤다. 그래서 설계 원칙은 하나다 —
 *
 *      **확신할 때만 붙이고, 애매하면 거부한다.**
 *
 * 거부는 실패가 아니다. 거부하면 사람이 처리하면 된다. 잘못 붙이면 사고다.
 * 구체적으로 두 개의 문을 통과해야 한다:
 *   ① 점수가 THRESHOLD 이상   (닮았나)
 *   ② 1등과 2등의 차가 MARGIN 이상 (혼자만 닮았나)
 * ②가 핵심이다. 실측에서 "베이델리 규진"은 두 기사에 똑같이 들어맞았다
 *   · "규진의 공항 패션, 베이델리로 완성한 꾸안꾸 스타일링"
 *   · "엔믹스 규진, 베이델리 제주 애월 플래그십 오픈 현장 공개"
 * 둘 다 1.0 이라 ②에서 걸려 거부된다. 이게 이 파일이 존재하는 이유다.
 *
 * 태그는 영문 로마자다(nana · kim moo-yul · yoon seung-ah). 그래서 한글 토큰을
 * 로마자로 옮겨 태그와도 대조한다. 표기가 흔들리므로(gim/kim · u/oo · eo/o)
 * 음운 정규화 후 유사도로 본다.
 */

'use strict';

// ── 한글 → 로마자 (국어의 로마자 표기법 간략판) ──────────────
const CHO = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const JUNG = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const JONG = ['','k','k','k','n','n','n','t','l','l','l','l','l','l','l','l','m','p','p','t','t','ng','t','t','k','t','p','t'];

function romanize(s) {
  let out = '';
  for (const ch of String(s || '')) {
    const c = ch.codePointAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) {
      const n = c - 0xac00;
      out += CHO[Math.floor(n / 588)] + JUNG[Math.floor((n % 588) / 28)] + JONG[n % 28];
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * 음운 정규화 — 같은 이름의 서로 다른 표기를 한 모양으로 모은다.
 * 실측 대응: 김무열↔kim moo-yul · 윤승아↔yoon seung-ah · 김희애↔kim hee-ae
 */
function phon(s) {
  let x = String(s || '').toLowerCase();
  x = x.replace(/[^a-z]/g, '');          // 하이픈·공백 제거
  x = x.replace(/oo/g, 'u').replace(/ee/g, 'i').replace(/aa/g, 'a');
  // 순서 중요 — 아래 두 줄은 eo/eu 축약보다 먼저다.
  x = x.replace(/ui/g, 'i');             // 희=hui 는 실제로 [히] 로 소리난다 (김희애↔kim hee-ae)
  x = x.replace(/yeo/g, 'yu');           // 열=yeol 을 관용 표기 yul 에 맞춘다 (김무열↔kim moo-yul)
  x = x.replace(/eo/g, 'o').replace(/eu/g, 'u');
  x = x.replace(/k/g, 'g').replace(/p/g, 'b').replace(/t/g, 'd');  // 격음/평음 통합
  x = x.replace(/ch/g, 'j');
  x = x.replace(/(.)\1+/g, '$1');        // 중복 자모 압축
  return x;
}

/** 문자 바이그램 Dice 계수 (0~1). 짧은 문자열은 완전일치만 인정. */
function dice(a, b) {
  const s = String(a || ''), t = String(b || '');
  if (!s || !t) return 0;
  if (s === t) return 1;
  if (s.length < 2 || t.length < 2) return 0;
  const grams = (v) => {
    const m = new Map();
    for (let i = 0; i < v.length - 1; i++) {
      const g = v.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const A = grams(s), B = grams(t);
  let hit = 0, total = 0;
  for (const [g, n] of A) { total += n; hit += Math.min(n, B.get(g) || 0); }
  for (const n of B.values()) total += n;
  return total ? (2 * hit) / total : 0;
}

/** 파일명 → 토큰. 확장자·날짜숫자·잡기호를 버린다. */
function fileTokens(name) {
  let s = String(name || '').replace(/\.[a-z0-9]{2,4}$/i, '');
  s = s.replace(/[_\-.,()[\]{}]+/g, ' ');
  return s.split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !/^\d+$/.test(t))     // "0807" 같은 날짜 조각
    .filter((t) => t.length >= 2);
}

/** 공백·기호를 없앤 비교용 문자열 ("공항 패션" 과 "공항패션" 을 같게 본다) */
function squash(s) {
  return String(s || '').toLowerCase().replace(/[\s .,·!?~'"’“”\-_/()[\]]+/g, '');
}

const TAG_SIM_MIN = 0.78;   // 로마자 태그를 '같은 이름'으로 인정할 하한
const PARTIAL_MIN = 0.60;   // 제목 부분유사를 점수로 인정할 하한

/**
 * 파일명 토큰 하나가 기사에 얼마나 걸리는지 (0~1).
 *   1.0  제목에 그대로 들어 있음
 *   0.9  로마자 변환이 태그와 사실상 같음
 *   0~1  제목과의 부분 유사도 (PARTIAL_MIN 미만은 0)
 */
/* 낱말 경계 (2026-09-02) ─────────────────────────────────────────────
   squash 는 공백까지 지운다. '디올 뷰티' 와 '디올뷰티' 를 맞추려면 그래야 한다.
   그런데 공백을 지우고 나면 제목이 한 덩어리가 되어 **낱말 중간에서도 걸린다.**

   실측으로 잡은 사고:
     토큰 '유가'  vs  기사 '공유가 보여준 브라운 NEVO의 어른 남자 제스처'  → 1.0

   '유가' 는 카스쿨 페스티벌에 나온 아티스트인데 배우 공유 기사에 만점으로 붙었다.
   지금은 다른 토큰이 점수를 눌러 문턱을 못 넘고 있을 뿐이다. 가중치를 손대는
   순간 이게 1등이 된다 — 실제로 낱말 가중치(1/df) 실험에서
   '카스쿨 유가.mp4' 가 저 기사에 0.80 으로 붙었다. **엉뚱한 영상이 공개
   유튜브에 올라가는** 바로 그 사고다.

   한글은 교착어다. 조사·어미는 낱말 **뒤에** 붙는다 (설윤+이, 한소희+가, 뷰티+가).
   앞에 붙는 일은 없다. 그러므로 토큰은 한글 덩어리의 **시작**에서 걸려야 한다.
   squash 된 자리를 원문 자리로 되짚어 그 앞 글자를 본다.

   실측 검증 (최근 21일 기사 213편, 과거 성공 매칭 8건):
     기존 성공 8/8 유지 · 새로 붙는 것 0건 · '유가' 가짜 일치 1.0 → 0
   동작을 바꾸지 않고 지뢰만 제거한다. */
const DROP_CHARS = /[\s .,·!?~'"’“”\-_/()[\]]+/;

/** squash 하면서 각 글자의 원문 자리를 같이 들고 온다. */
function squashMap(s) {
  const raw = String(s || '').toLowerCase();
  let out = '';
  const idx = [];
  for (let i = 0; i < raw.length; i++) {
    if (DROP_CHARS.test(raw[i])) continue;
    out += raw[i];
    idx.push(i);
  }
  return { raw, out, idx };
}

function isHangulChar(c) { return /[가-힣]/.test(c || ''); }

/** 토큰이 한글 덩어리의 시작에서 걸렸는가. 한 자리라도 시작이면 참. */
function hitAtWordStart(tok, m) {
  let i = m.out.indexOf(tok);
  while (i !== -1) {
    const origin = m.idx[i];
    const prev = origin > 0 ? m.raw[origin - 1] : '';
    if (!isHangulChar(prev)) return true;
    i = m.out.indexOf(tok, i + 1);
  }
  return false;
}

function tokenHit(token, art) {
  const tok = squash(token);
  if (!tok) return 0;
  const m = squashMap(art && art.title);
  if (m.out && hitAtWordStart(tok, m)) return 1;

  const rt = phon(romanize(token));
  if (rt.length >= 3) {
    for (const tag of (art && art.tags) || []) {
      if (dice(rt, phon(String(tag))) >= TAG_SIM_MIN) return 0.9;
    }
  }
  const d = dice(tok, m.out);
  return d >= PARTIAL_MIN ? d : 0;
}

function scoreArticle(tokens, art) {
  if (!tokens.length) return 0;
  let sum = 0;
  for (const t of tokens) sum += tokenHit(t, art);
  return sum / tokens.length;
}

const THRESHOLD = 0.60;   // 이만큼은 닮아야 후보
const MARGIN = 0.20;      // 2등과 이만큼 벌어져야 확신

/**
 * 파일명으로 기사 하나를 고른다. 확신 없으면 고르지 않는다.
 * @param {string} filename
 * @param {Array} articles [{id,title,tags,...}]
 * @param {object} [opts] {threshold, margin}
 * @returns {{matched:object|null, score:number, runnerUp:number, reason:string, ranked:Array}}
 */
/* 판별력 없는 낱말은 분모에서 뺀다 (2026-09-02) ─────────────────────────
   실측 — 드라이브 '유튜브' 폴더가 매 실행 '매칭 실패 15건' 을 뱉고 있었다.
   최근 21일 기사 206편으로 재현한 결과:

     0902_산드로 설윤 댓글 DM.mp4  → 0.50 (기준 0.60) 거부
       토큰 4개 중 '댓글'·'DM' 이 **어느 기사에도** 안 걸린다. 영상 내용을
       적은 작업용 낱말이지 기사를 가리키는 말이 아니다. 그런데 점수를
       전체 토큰 수로 나누니 이 둘이 점수를 절반으로 깎았다.
       '산드로 설윤' 만이면 1.00 이었다.

     0902_휠라 한소희.mp4          → 0.50 거부
       한소희 1.00, 휠라 0.00. 외래어 브랜드는 한글 표기가 원음의 음차라
       로마자 규칙이 안 맞는다:
         휠라  → hwilra vs fila  → dice 0.250
         오트리 → oduri  vs audry → dice 0.000   (아예 0)
       태그 사전을 손으로 채우는 방식은 브랜드가 늘 때마다 같은 사고가 난다.

   두 건의 공통점: **어느 기사에도 안 걸리는 토큰이 분모에 남아 있다.**
   그런 토큰은 기사를 가려낼 힘이 0 이다. 분모에서 빼는 것이 옳다.

   ■ 이게 왜 안전한가
   판별력 0 인 토큰을 빼도 '어느 기사가 더 닮았나' 의 순위는 바뀌지 않는다.
   임계값(0.60)과 마진(0.20) 두 문은 **그대로 둔다** — 그건 엉뚱한 영상이
   공개 유튜브에 올라가는 걸 막는 장치다. 이 변경은 문턱을 낮추는 게 아니라
   점수를 왜곡하던 잡음을 없애는 것이다.

   ■ 그래도 남는 위험과 그 상한
   살아남은 토큰이 너무 적으면 파일명이 사실상 기사와 무관하다는 뜻이다.
   그래서 **절반 미만이 살아남으면 거부한다.** 위 두 건은 각각 2/4, 1/2 로
   절반을 채운다.

   ■ 고치지 않는 것
   0901_오트리 창빈.mp4 은 1.00 대 1.00 으로 마진에서 거부됐다. 같은 사건으로
   기사가 2편 나갔기 때문이다("창빈의 시그니처가 오트리 위에 올라탔다" /
   "스트레이 키즈 창빈, 오트리와 협업 런칭 파티 호스트로 나서다").
   **이건 설계대로 옳은 거부다.** 어느 기사에 붙일지는 사람이 정해야 한다. */

/** 이 토큰이 후보 기사 중 하나라도 건드리나. 아니면 판별력이 0 이다. */
function tokenIsLive(token, articles) {
  for (const a of articles || []) { if (tokenHit(token, a) > 0) return true; }
  return false;
}

function matchArticle(filename, articles, opts) {
  const o = opts || {};
  const threshold = o.threshold != null ? o.threshold : THRESHOLD;
  const margin = o.margin != null ? o.margin : MARGIN;
  const tokens = fileTokens(filename);

  if (!tokens.length) {
    return { matched: null, score: 0, runnerUp: 0, ranked: [],
      reason: '파일명에서 쓸 만한 낱말을 못 뽑음' };
  }

  const arts = articles || [];
  const live = tokens.filter((t) => tokenIsLive(t, arts));
  const dead = tokens.filter((t) => !live.includes(t));

  if (!live.length) {
    return { matched: null, score: 0, runnerUp: 0, ranked: [], tokens, live, dead,
      reason: '파일명 낱말이 어느 기사에도 안 걸림 (' + tokens.join('·') + ')' };
  }
  /* 절반도 안 남으면 파일명이 기사와 사실상 무관하다. 남은 몇 개로 억지로
     붙이면 그게 바로 '엉뚱한 영상이 올라가는' 사고다. */
  if (live.length * 2 < tokens.length) {
    return { matched: null, score: 0, runnerUp: 0, ranked: [], tokens, live, dead,
      reason: '낱말 ' + tokens.length + '개 중 ' + live.length + '개만 기사에 걸림 — 관련 없어 보임 (버림: ' + dead.join('·') + ')' };
  }

  const ranked = arts
    .map((a) => ({ art: a, score: scoreArticle(live, a) }))
    .sort((x, y) => y.score - x.score);

  if (!ranked.length) {
    return { matched: null, score: 0, runnerUp: 0, ranked, tokens, live, dead,
      reason: '비교할 기사가 없음' };
  }
  const best = ranked[0];
  const second = ranked[1] ? ranked[1].score : 0;

  if (best.score < threshold) {
    return { matched: null, score: best.score, runnerUp: second, ranked, tokens, live, dead,
      reason: `가장 닮은 기사도 ${best.score.toFixed(2)} (기준 ${threshold}) — 닮은 게 없음` };
  }
  if (best.score - second < margin) {
    const tiedTitles = ranked.filter((r) => best.score - r.score < margin)
      .slice(0, 3).map((r) => r.art && r.art.title).join(' / ');
    return { matched: null, score: best.score, runnerUp: second, ranked, tokens, live, dead,
      reason: `같은 사건 기사가 여럿 (${best.score.toFixed(2)} vs ${second.toFixed(2)}) — 사람이 골라야 한다: ${tiedTitles}` };
  }
  return { matched: best.art, score: best.score, runnerUp: second, ranked, tokens, live, dead,
    reason: `확신 (${best.score.toFixed(2)} vs 2등 ${second.toFixed(2)})` };
}

/* 매칭 실패 목록을 **사유별로 묶어** 한 줄로 (2026-09-02)

   종전 로그는 이름만 나열했다. 그래서 14건이 전부 같은 '실패' 로 보였는데
   실제로는 성격이 셋이다:

     사람이 골라야  기사가 여럿이라 기계가 못 정한다 → 사람이 정해 줘야 한다
     기사 없음      붙일 기사가 아예 없다             → 기다리거나 목록에서 빼면 된다
     닮은 게 없음   문턱 미달                         → 파일명이나 기사 제목 문제

   무엇을 해야 하는지가 셋 다 다른데 한 덩어리로 보이면 아무도 손대지 않는다.
   실제로 0821_몬스타엑스 가 12일째 매 10분마다 이름만 찍히고 있었다. */
function groupUnmatched(unmatched) {
  const list = Array.isArray(unmatched) ? unmatched : [];
  const buckets = new Map();
  for (const u of list) {
    const r = String((u && u.reason) || '');
    let kind = '기타';
    if (/사람이 골라야/.test(r)) kind = '사람이 골라야';
    else if (/안 걸림|관련 없어 보임/.test(r)) kind = '기사 없음';
    else if (/닮은 게 없음/.test(r)) kind = '닮은 기사 없음';
    if (!buckets.has(kind)) buckets.set(kind, []);
    buckets.get(kind).push((u && u.name) || '?');
  }
  const parts = [];
  for (const [kind, names] of buckets) {
    /* 묶음당 40개까지. 앞 커밋(2026-09-02)이 "3건만 찍어서 나머지를 알 수 없었다" 는
       실측으로 40개 상한을 세웠다. 묶는다고 그 기준을 낮추면 같은 문제가 돌아온다.
       진짜 상한은 호출부의 1500자다. */
    const shown = names.slice(0, 40);
    parts.push('[' + kind + ' ' + names.length + '] ' + shown.join(' · ')
      + (names.length > shown.length ? ' 외 ' + (names.length - shown.length) + '건' : ''));
  }
  return parts.join(' ');
}

module.exports = {
  groupUnmatched,
  romanize, phon, dice, fileTokens, squash,
  tokenHit, tokenIsLive, scoreArticle, matchArticle, hitAtWordStart, squashMap,
  THRESHOLD, MARGIN,
};
