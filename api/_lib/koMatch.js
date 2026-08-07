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
function tokenHit(token, art) {
  const tok = squash(token);
  if (!tok) return 0;
  const title = squash(art && art.title);
  if (title && title.indexOf(tok) !== -1) return 1;

  const rt = phon(romanize(token));
  if (rt.length >= 3) {
    for (const tag of (art && art.tags) || []) {
      if (dice(rt, phon(String(tag))) >= TAG_SIM_MIN) return 0.9;
    }
  }
  const d = dice(tok, title);
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
function matchArticle(filename, articles, opts) {
  const o = opts || {};
  const threshold = o.threshold != null ? o.threshold : THRESHOLD;
  const margin = o.margin != null ? o.margin : MARGIN;
  const tokens = fileTokens(filename);

  if (!tokens.length) {
    return { matched: null, score: 0, runnerUp: 0, ranked: [],
      reason: '파일명에서 쓸 만한 낱말을 못 뽑음' };
  }
  const ranked = (articles || [])
    .map((a) => ({ art: a, score: scoreArticle(tokens, a) }))
    .sort((x, y) => y.score - x.score);

  if (!ranked.length) {
    return { matched: null, score: 0, runnerUp: 0, ranked, tokens,
      reason: '비교할 기사가 없음' };
  }
  const best = ranked[0];
  const second = ranked[1] ? ranked[1].score : 0;

  if (best.score < threshold) {
    return { matched: null, score: best.score, runnerUp: second, ranked, tokens,
      reason: `가장 닮은 기사도 ${best.score.toFixed(2)} (기준 ${threshold}) — 닮은 게 없음` };
  }
  if (best.score - second < margin) {
    const tiedTitles = ranked.filter((r) => best.score - r.score < margin)
      .slice(0, 3).map((r) => r.art && r.art.title).join(' / ');
    return { matched: null, score: best.score, runnerUp: second, ranked, tokens,
      reason: `비슷한 기사가 여럿 (${best.score.toFixed(2)} vs ${second.toFixed(2)}) — 애매해서 보류: ${tiedTitles}` };
  }
  return { matched: best.art, score: best.score, runnerUp: second, ranked, tokens,
    reason: `확신 (${best.score.toFixed(2)} vs 2등 ${second.toFixed(2)})` };
}

module.exports = {
  romanize, phon, dice, fileTokens, squash,
  tokenHit, scoreArticle, matchArticle,
  THRESHOLD, MARGIN,
};
