/**
 * PAP Magazine — 스레드 본문 인스타 링크 (2026-10-20 신설, 도메니코 "스레드도 인스타 링크를
 * 댓글 말고 본문에. 트위터 계정을 참고")
 *
 * ■ 왜
 *   2026-08-13 부터 스레드는 "본문엔 링크 없이, 링크는 첫 답글로" 였다. 근거는 남의 통설
 *   ("링크 달린 글은 도달이 눌린다")이었다. 같은 통설을 X 에서 일주일 재 보니 우리 계정에선
 *   틀렸다(2026-10-13 판정, xBodyLinkAb.js): 본문 링크 트윗당 인스타 클릭 7.6 vs 답글 4.3,
 *   조회수도 본문 쪽이 높았다. 14일 실측(10/06~10/20) X 본문 링크 클릭 1,675 vs 스레드 답글
 *   링크 클릭 12 (게시 156건). 스레드 답글 링크는 사실상 아무도 안 누른다.
 *
 * ■ 함께 고친 구멍
 *   스레드 호출부 두 곳(threads-post 크론·sync-instagram)이 source_instagram_url 을 넘기지
 *   않아 인스타 링크가 전부 **프로필**로 갔다(14일 to=profile 12, to=post 0). X 는 게시물로
 *   보내서 클릭이 났다. 이제 원본 게시물로 보낸다.
 *
 * ■ 모양 (X 와 같다)
 *   본문 \n\n CTA 한 줄 \n 인스타 링크(ig-out src=threads_body) [\n\n #PAPMAGAZINE]
 *   답글에는 웹 링크만 남긴다(웹은 2순위 도달점, 끊지 않는다).
 *   500자를 넘으면 본문 쪽을 줄인다 — 링크와 CTA 는 자르지 않는다.
 *
 * ■ 끄기
 *   THREADS_BODY_IG_LINK=off → 예전(본문 깨끗 + 답글에 IG→웹)으로 즉시 복귀.
 *
 * ■ 판정 (일주일 뒤)
 *   ig_outclicks_human src='threads_body' 게시물당 클릭 vs 이전 src='threads'(답글),
 *   threads_posts.views 평균이 크게 깎이지 않았는지.
 */
'use strict';

const { CTA_LINE } = require('./xBodyLinkAb');

const IG_OUT_SRC = 'threads_body';
const MAX = 500;
const TAG = '#PAPMAGAZINE';

function isOn() {
  return String(process.env.THREADS_BODY_IG_LINK || 'all').toLowerCase() !== 'off';
}

/** 기사·화보·영상에 맞는 CTA 한 줄 (X 와 같은 문구) */
function ctaFor(art, media) {
  const url = String((art && art.url) || '');
  if (/\/editorial\//.test(url)) return CTA_LINE.editorial;
  if (media && media.video) return CTA_LINE.video;
  return CTA_LINE.article;
}

/**
 * 본문 + CTA + 인스타 링크 (+ 태그 줄). 500자 안에 맞춘다.
 * @param {string} body   링크 없는 본문 (마지막 줄이 #PAPMAGAZINE 일 수 있다)
 * @param {string} igLink ig-out 경유 URL
 * @param {string} cta    CTA 한 줄
 * @returns {{text:string, trimmed:boolean}}
 */
function composeBody(body, igLink, cta) {
  let main = String(body || '').trim();
  let tag = '';
  const i = main.lastIndexOf('\n\n');
  if (i > 0 && main.slice(i + 2).trim() === TAG) { tag = TAG; main = main.slice(0, i).trim(); }
  const tail = '\n\n' + (cta ? cta + '\n' : '') + igLink + (tag ? '\n\n' + tag : '');
  const room = MAX - tail.length;
  let trimmed = false;
  if (main.length > room) {
    trimmed = true;
    main = main.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, '').trim() + '…';
  }
  return { text: main + tail, trimmed };
}

/** 답글: 웹 링크만 */
function webOnlyReply(webUrl) {
  return '웹에서 전문 보기 → ' + String(webUrl);
}

module.exports = { isOn, ctaFor, composeBody, webOnlyReply, IG_OUT_SRC, MAX };
