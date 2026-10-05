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

function isOn(now) {
  if (String(process.env.X_BODY_LINK_AB || '').toLowerCase() !== 'on') return false;
  const until = process.env.X_BODY_LINK_AB_UNTIL;
  if (until) {
    const t = Date.parse(until);
    if (Number.isFinite(t) && (now || Date.now()) >= t) return false;
  }
  return true;
}

/** @returns {'body'|'reply'|null} null = 실험 꺼짐 */
function variantFor(articleId, now) {
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

module.exports = { isOn, variantFor, bodyWithIgLink, IG_OUT_SRC };
