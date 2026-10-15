/**
 * PAP Magazine — X 본문 링크 A/B (2026-10-05 신설, 도메니코 "일주일만 인스타링크로 시험")
 *
 * 질문: 인스타 링크를 **본문**에 넣으면(도달이 눌린다는 통설) 답글에 넣을 때보다
 * 인스타로 넘어오는 사람이 늘어나는가, 줄어드는가.
 *
 * 실측 배경: 지효 루부탱 트윗 2,972 뷰 · 349 좋아요 · 147 RT 에 답글 링크 클릭 8명.
 * "답글은 안 읽힌다"는 우리 숫자고, "본문 링크는 도달이 눌린다"는 남의 통설이다.
 * 둘을 같은 주에 나란히 재야 답이 난다.
 *
 * 설계
 *   · X_BODY_LINK_AB=on 이고 X_BODY_LINK_AB_UNTIL(ISO 날짜) 전이면 실험 중.
 *   · 갈래는 기사 id 의 마지막 16진수 자리 홀짝 — 같은 기사는 늘 같은 갈래(결정적).
 *       짝수 → 'body'  : 본문에 인스타 링크(ig-out src=x_body) + #PAPMAGAZINE. 답글엔 웹 링크만.
 *       홀수 → 'reply' : 지금 그대로(본문 깨끗 + 안내 줄, 답글에 IG→웹).
 *   · x_posts.kind 에 'ab_body' / 'ab_reply' 를 남긴다 — 판정 SQL 이 kind 로 묶는다.
 *   · 클릭은 ig_outclicks_human.src ('x_body' vs 'x'), 도달은 x_posts.views(x-metrics 크론).
 *
 * 판정(일주일 뒤): 갈래별 평균 views, 갈래별 인스타 클릭/트윗, 클릭/뷰.
 *   body 의 클릭/트윗이 reply 보다 높고 views 가 크게 안 깎이면 본문 링크로 전환.
 *   views 가 반토막이면 통설이 맞는 것 — 답글로 복귀. 실험 비용은 본문 링크 트윗당 $0.20.
 */
'use strict';

const IG_OUT_SRC = 'x_body';

/* 2026-10-13 판정(일주일 · 트윗 63건): 본문 링크 38건 vs 답글 링크 25건
     인스타 고유 클릭 287 vs 107 (트윗당 7.6 vs 4.3) · 조회수 평균(1,000뷰↑ 제외) 135 vs 79 · 중앙값 46 vs 36.
     통설("본문 링크는 도달이 눌린다")은 우리 계정에서 틀렸다. 도메니코 "본문 상시로 가자".
     → X_BODY_LINK_AB=all : 미디어 있는 기사 트윗 전부 본문 링크(kind 'body'). 홀짝 갈래 없음.
       'on'(+UNTIL) 은 실험용 50/50 으로 남겨 둔다. */
function mode() { return String(process.env.X_BODY_LINK_AB || '').toLowerCase(); }
function isAll() { return mode() === 'all'; }

function isOn(now) {
  if (isAll()) return true;
  if (mode() !== 'on') return false;
  const until = process.env.X_BODY_LINK_AB_UNTIL;
  if (until) {
    const t = Date.parse(until);
    if (Number.isFinite(t) && (now || Date.now()) >= t) return false;
  }
  return true;
}

/** @returns {'body'|'reply'|null} null = 실험 꺼짐 */
function variantFor(articleId, now) {
  if (isAll()) return 'body';
  if (!isOn(now)) return null;
  const s = String(articleId || '').replace(/[^0-9a-f]/gi, '');
  if (!s) return 'reply';
  const last = parseInt(s[s.length - 1], 16);
  return (last % 2 === 0) ? 'body' : 'reply';
}

/**
 * 본문 갈래 트윗 텍스트: 본문 + 인스타 링크 + 태그 줄. 안내 줄은 넣지 않는다(링크가 있다).
 * 가중 280 판정은 URL 을 23 으로 센다(X 의 t.co 규칙).
 * @param {string} body   '본문\n\n#PAPMAGAZINE' 꼴 (buildThreadsParityTweet.body)
 * @param {string} igLink ig-out 경유 URL
 * @param {{weightedLen:Function, URL_PLACEHOLDER:string}} x  xPost 의 측정기 (순환 require 회피)
 * @returns {string|null} 280 을 넘으면 null (호출부는 reply 갈래로 떨어진다)
 */
function bodyWithIgLink(body, igLink, x) {
  const s = String(body || '');
  const i = s.lastIndexOf('\n\n');
  const main = i > 0 ? s.slice(0, i) : s;
  const tagLine = i > 0 ? s.slice(i + 2) : '#PAPMAGAZINE';
  const full = main + '\n\n' + igLink + '\n\n' + tagLine;
  const measured = main + '\n\n' + x.URL_PLACEHOLDER + '\n\n' + tagLine;
  return x.weightedLen(measured) <= 280 ? full : null;
}

/** x_posts.kind — 상시 모드는 'body', 실험 모드는 'ab_body'/'ab_reply' (판정 SQL 이 kind 로 묶는다) */
function kindFor(variant, hasBody) {
  if (!variant) return 'article';
  if (isAll()) return hasBody ? 'body' : 'article';
  return hasBody ? 'ab_body' : 'ab_reply';
}

/* ───────────────────────────────────────────────────────────────────────────
 * 2026-10-15 — CTA 한 줄 A/B (도메니코 "링크만 vs 링크를 알리는 한 줄").
 *
 * 질문: 본문의 인스타 링크 바로 위에 "무엇이 있는지" 한 줄을 적으면 클릭이 느는가.
 * 지금은 링크가 말없이 혼자 서 있다(본문 링크 43건 · 트윗당 고유 클릭 8.1).
 * 비교 자료가 없어 일주일 반반으로 잰다. 문구는 도메니코가 정했다:
 *     일반 기사  '자세한 내용은 아래 링크에서↓'
 *     영상 기사  '풀 영상은 아래 링크에서 ↓'
 *     에디토리얼 '전체 화보는 아래 링크에서 ↓'   (골든아워 부스트 트윗, goldenBoost.boostTextX)
 *
 * 설계
 *   · X_BODY_CTA_AB=on 이고 X_BODY_CTA_AB_UNTIL 전이면 실험 중. 'all' 이면 전부 CTA.
 *   · 갈래는 id 마지막 자리 홀짝 — 홀수 'cta' / 짝수 'bare'(지금 그대로). 결정적.
 *   · CTA 는 링크 **바로 윗줄**에 붙는다: 본문 \n\n CTA \n 링크 \n\n 태그.
 *     280 가중자를 넘으면 CTA 를 떼고 링크만(트윗을 잃지 않는다) — kind 도 bare 로 남는다.
 *   · 계측: x_posts.kind 'body' / 'body_cta' · ig_outclicks_human.src 'x_body' / 'x_body_cta'.
 *     부스트(에디토리얼)는 kind 'boost' / 'boost_cta' · src 'boost_x' / 'boost_x_cta'.
 *
 * 판정(일주일 뒤): 갈래별 트윗당 고유 클릭, 클릭/뷰. CTA 가 높으면 all 로 전환.
 * ─────────────────────────────────────────────────────────────────────────── */
const CTA_LINE = Object.freeze({
  article: '자세한 내용은 아래 링크에서↓',
  video: '풀 영상은 아래 링크에서 ↓',
  editorial: '전체 화보는 아래 링크에서 ↓',
});
const IG_OUT_SRC_CTA = 'x_body_cta';

function ctaMode() { return String(process.env.X_BODY_CTA_AB || '').toLowerCase(); }
function ctaIsOn(now) {
  if (ctaMode() === 'all') return true;
  if (ctaMode() !== 'on') return false;
  const until = process.env.X_BODY_CTA_AB_UNTIL;
  if (until) {
    const t = Date.parse(until);
    if (Number.isFinite(t) && (now || Date.now()) >= t) return false;
  }
  return true;
}
function lastIsOdd(id) {
  const s = String(id || '').replace(/[^0-9a-f]/gi, '');
  if (!s) return false;
  return parseInt(s[s.length - 1], 16) % 2 === 1;
}
/** @returns {'cta'|'bare'|null} null = 실험 꺼짐(지금 그대로) */
function ctaVariantFor(id, now) {
  if (ctaMode() === 'all') return 'cta';
  if (!ctaIsOn(now)) return null;
  return lastIsOdd(id) ? 'cta' : 'bare';
}
/** 기사 트윗의 CTA 문구 — 미디어 종류로 고른다 */
function ctaLineFor(mediaKind) { return mediaKind === 'video' ? CTA_LINE.video : CTA_LINE.article; }

/**
 * CTA 갈래 트윗 텍스트: 본문 + CTA + 링크 + 태그 줄.
 * @returns {{text:string, cta:boolean}|null}  CTA 가 안 들어가면 cta:false 로 링크만, 그것도 넘치면 null
 */
function bodyWithIgLinkCta(body, igLink, ctaLine, x) {
  const s = String(body || '');
  const i = s.lastIndexOf('\n\n');
  const main = i > 0 ? s.slice(0, i) : s;
  const tagLine = i > 0 ? s.slice(i + 2) : '#PAPMAGAZINE';
  const line = String(ctaLine || '').trim();
  if (line) {
    const full = main + '\n\n' + line + '\n' + igLink + '\n\n' + tagLine;
    const measured = main + '\n\n' + line + '\n' + x.URL_PLACEHOLDER + '\n\n' + tagLine;
    if (x.weightedLen(measured) <= 280) return { text: full, cta: true };
  }
  const bare = bodyWithIgLink(body, igLink, x);
  return bare ? { text: bare, cta: false } : null;
}

/** 기사 트윗 kind 에 CTA 표시를 덧붙인다 — 본문 링크가 실제로 들어갔을 때만 */
function kindWithCta(kind, cta) {
  if (!cta) return kind;
  return (kind === 'body' || kind === 'ab_body') ? kind + '_cta' : kind;
}

module.exports = { isOn, isAll, variantFor, bodyWithIgLink, kindFor, IG_OUT_SRC,
  CTA_LINE, IG_OUT_SRC_CTA, ctaIsOn, ctaVariantFor, ctaLineFor, bodyWithIgLinkCta, kindWithCta };
