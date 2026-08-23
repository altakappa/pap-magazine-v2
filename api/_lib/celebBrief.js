/**
 * PAP Magazine — 셀럽 속보 브리프 공용 로직 (2026-08-23 신설)
 *
 * 도메니코 지시(2026-08-23):
 *   "내가 인스타에서 링크를 텔레그램으로 주면, 너가 기사 이미지와 캡션을
 *    만들어서 다시 텔레그램으로 나한테 전달해주면 된다."
 *   "여러 장일 경우 썸네일은 디자인으로 구성, 나머지는 아무 디자인도 입히지 않은 이미지."
 *   "때에 따라 비슷한 링크를 몇 개 보낼 수도 있다. 그럼 그 이미지들로 나열하면 된다."
 *
 * 이 파일은 **네트워크·DB 를 건드리지 않는 순수 함수만** 둔다.
 * 크론 핸들러 안에 로직이 묻히면 테스트가 불가능해진다는 교훈은
 * _lib/celebDedup.js 머리말에 이미 기록돼 있다. 같은 실수를 반복하지 않는다.
 *
 * 소비자:
 *   • api/telegram/webhook.js  — 텔레그램 수신 → 큐 적재
 *   • api/cron/celeb-brief.js  — 큐 처리 → 기사·이미지 생성 → 텔레그램 회신
 */

'use strict';

/* 인스타 게시물 URL 을 텍스트에서 전부 뽑는다.
   지원 형태:
     https://www.instagram.com/p/<code>/
     https://instagram.com/reel/<code>/?igsh=...
     https://www.instagram.com/<username>/p/<code>/
   ?igsh= 같은 추적 파라미터는 permalink 매칭에 방해가 되므로 여기서 버린다. */
const _POST_RE = /https?:\/\/(?:www\.)?instagram\.com\/(?:([A-Za-z0-9._]+)\/)?(p|reel|tv)\/([A-Za-z0-9_-]+)/gi;

function extractPostLinks(text) {
  const out = [];
  const seen = new Set();
  const s = String(text || '');
  let m;
  _POST_RE.lastIndex = 0;
  while ((m = _POST_RE.exec(s)) !== null) {
    const username = m[1] && m[1].toLowerCase() !== 'p' ? m[1] : null;
    const kind = m[2].toLowerCase();
    const shortcode = m[3];
    if (seen.has(shortcode)) continue;
    seen.add(shortcode);
    out.push({
      username,
      shortcode,
      kind,
      permalink: 'https://www.instagram.com/' + kind + '/' + shortcode + '/',
    });
  }
  return out;
}

/* 메시지 안에서 계정 핸들(@handle)을 찾는다.
   URL 이 https://instagram.com/p/<code> 형태면 계정명이 안 들어 있다.
   business_discovery 는 username 이 있어야 조회되므로 이때는 도메니코가
   보낸 텍스트의 @핸들을 쓴다. 없으면 되물어야 한다(webhook 이 안내 회신). */
function extractHandle(text) {
  const s = String(text || '');
  // URL 안의 @ 는 제외하기 위해 링크를 먼저 지운다.
  const stripped = s.replace(/https?:\/\/\S+/g, ' ');
  const m = stripped.match(/@([A-Za-z0-9._]{2,30})/);
  return m ? m[1] : null;
}

/* 텔레그램 update → 처리 대상 목록.
   반환: { chatId, messageId, text, links: [...], handle }  또는 null(무시할 업데이트) */
function parseUpdate(update) {
  const msg = (update && (update.message || update.channel_post || update.edited_message)) || null;
  if (!msg) return null;
  const chatId = msg.chat && msg.chat.id;
  if (chatId == null) return null;
  const text = String(msg.text || msg.caption || '');
  const links = extractPostLinks(text);
  return {
    chatId: String(chatId),
    messageId: msg.message_id == null ? null : Number(msg.message_id),
    fromId: msg.from && msg.from.id != null ? String(msg.from.id) : null,
    text,
    links,
    handle: extractHandle(text),
  };
}

/* business_discovery 응답의 media 한 건 → 슬라이드 목록.
   반환: [{ type:'image'|'video', url, thumb }]
     · image → url 이 사진
     · video → url 이 mp4, thumb 이 커버 프레임(디자인을 얹을 대상)

   ── 영상을 왜 넣게 됐나 (2026-08-23) ────────────────────────
   처음엔 영상을 통째로 뺐다. "이미지로 나열" 지시를 좁게 읽었고,
   영상 썸네일을 사진인 척 섞으면 화질이 다른 컷이 낀다고 봤다.
   그런데 첫 실전 테스트(@jennierubyjane)가 릴스였고 그대로 실패했다.
   도메니코: "영상은 불가능해?" — 셀럽 속보는 릴스가 절반이다.
   그래서 영상은 **영상 그대로** 보내고, 디자인은 커버 프레임에만 얹는다.
   도메니코 규칙("썸네일은 디자인, 나머지는 원본")은 그대로 지켜진다. */
const MAX_SLIDES = 10;

function collectMediaItems(media, opts) {
  const max = (opts && opts.max) || MAX_SLIDES;
  const out = [];
  const seen = new Set();
  const push = (m) => {
    if (!m) return;
    const type = String(m.media_type || '').toUpperCase() === 'VIDEO' ? 'video' : 'image';
    const url = m.media_url;
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    const thumb = (typeof m.thumbnail_url === 'string' && /^https?:\/\//i.test(m.thumbnail_url))
      ? m.thumbnail_url : null;
    if (out.length < max) out.push({ type, url, thumb: type === 'video' ? thumb : url });
  };
  const kids = media && media.children && Array.isArray(media.children.data)
    ? media.children.data : null;
  if (kids && kids.length) kids.forEach(push);
  else push(media);
  return out;
}

/* 링크 여러 개 → 슬라이드 한 줄로 나열.
   도메니코: "비슷한 링크를 몇 개 보낼 수도 있어. 그럼 그 이미지들로 나열하면 돼."
   입력 순서 = 보낸 순서. 인스타 캐러셀 상한 10장에서 자른다. */
function mergeMediaItems(perPost, opts) {
  const max = (opts && opts.max) || MAX_SLIDES;
  const out = [];
  const seen = new Set();
  for (const items of perPost || []) {
    for (const it of items || []) {
      if (!it || seen.has(it.url)) continue;
      seen.add(it.url);
      out.push(it);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/* 디자인을 얹을 커버 이미지 URL.
   첫 슬라이드가 영상이면 커버 프레임(thumb)을 쓴다. 그것도 없으면
   뒤쪽 슬라이드에서 사진을 찾는다. 하나도 없으면 null (호출부가 사람에게 알린다). */
function pickCoverUrl(items) {
  for (const it of items || []) {
    if (it && it.thumb) return it.thumb;
  }
  return null;
}

/* 사진 URL 만 (기존 호출부 호환 · 테스트용) */
function collectMediaUrls(media, opts) {
  return collectMediaItems(media, opts).filter((i) => i.type === 'image').map((i) => i.url);
}
function mergeMediaUrls(perPost, opts) {
  const max = (opts && opts.max) || MAX_SLIDES;
  const out = [];
  const seen = new Set();
  for (const urls of perPost || []) {
    for (const u of urls || []) {
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/* 썸네일에 얹을 제목 줄바꿈.
   (일반1) 썸네일 규격은 국문·영문 각각 **최대 2줄**이다(볼트 §4-7).
   measure(text) 는 픽셀 폭을 재는 함수 — 렌더러가 실제 폰트로 주입한다.

   ── 어디서 끊나 (2026-08-23 실측으로 정한 순서) ──────────────
   템플릿 원본은 "이번 주, / 파리에서 주목해야 할 것들" 로 **쉼표 뒤**에서 끊는다.
   그냥 폭이 찰 때까지 채우면 "이번 주, 파리에서 주목해야 할 / 것들" 이 되고,
   PSD 합성본과 비교했을 때 제목 띠의 평균오차가 21.6/255 까지 벌어졌다.
   그래서 이 순서로 고른다.
     ① 사람이 넣은 줄바꿈(\n)이 있으면 그대로 존중한다 — 사람이 이긴다
     ② 쉼표(, ，·、) 뒤에서 끊어 2줄이 되면 그걸 쓴다 — 템플릿과 같은 방식
     ③ 두 줄 폭이 가장 고르게 되는 지점 — 한쪽만 길면 디자인이 무너진다
   어느 것도 2줄에 못 담으면 **자르지 않고 null** 을 준다. 폰트를 줄이는 대신
   제목을 줄이라는 뜻이고, 그 판단은 사람이 한다. */
function wrapHeadline(text, maxWidth, measure, maxLines) {
  const limit = maxLines || 2;
  const raw = String(text || '').trim();
  if (!raw) return [];

  const fits = (lines) =>
    lines.length > 0 && lines.length <= limit && lines.every((l) => l && measure(l) <= maxWidth);

  // ① 사람이 넣은 줄바꿈
  if (raw.includes('\n')) {
    const manual = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    return fits(manual) ? manual : null;
  }

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length === 1) return measure(raw) <= maxWidth ? [raw] : null;
  if (measure(raw) <= maxWidth) return [raw];
  if (limit < 2) return null;

  // 단어 경계 후보 전부를 2줄로 놓고 본다.
  const cand = [];
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (measure(a) <= maxWidth && measure(b) <= maxWidth) cand.push({ a, b, i });
  }
  if (!cand.length) return null;

  const mostBalanced = (list) => {
    let best = list[0];
    let bestGap = Math.abs(measure(best.a) - measure(best.b));
    for (const c of list.slice(1)) {
      const gap = Math.abs(measure(c.a) - measure(c.b));
      if (gap < bestGap) { best = c; bestGap = gap; }
    }
    return [best.a, best.b];
  };

  // ② 쉼표 뒤. 쉼표가 여럿이면 두 줄이 가장 고른 쪽을 고른다.
  //    (실측: 영문 부제는 쉼표가 두 개인데 템플릿 원본이 뒤쪽 쉼표에서 끊었다)
  const commas = cand.filter((c) => /[,，、]$/.test(c.a));
  if (commas.length) return mostBalanced(commas);

  // ③ 쉼표가 없으면 두 줄 폭 차이가 가장 작은 지점
  return mostBalanced(cand);
}

/* 텔레그램으로 돌려줄 캡션.
   인스타에 그대로 붙여넣을 수 있는 형태여야 한다 — 그래서 안내 문구는 맨 아래로,
   기사 본문이 맨 위로 온다. 텔레그램 캡션 상한 1024자를 넘기면 본문을 자르지 않고
   별도 텍스트 메시지로 보낸다(호출부 판단). */
function buildBriefCaption(brief) {
  const b = brief || {};
  const parts = [];
  if (b.title) parts.push(String(b.title).trim());
  if (b.body) parts.push(String(b.body).trim());
  const tags = Array.isArray(b.tags) ? b.tags.filter(Boolean) : [];
  if (tags.length) parts.push(tags.map((t) => (String(t).startsWith('#') ? t : '#' + t)).join(' '));
  const src = [];
  if (b.sourceHandle) src.push('출처 @' + String(b.sourceHandle).replace(/^@/, ''));
  if (b.permalink) src.push(b.permalink);
  if (src.length) parts.push(src.join(' · '));
  return parts.join('\n\n');
}

const TELEGRAM_CAPTION_MAX = 1024;

function splitCaptionForTelegram(caption) {
  const s = String(caption || '');
  if (s.length <= TELEGRAM_CAPTION_MAX) return { caption: s, overflow: '' };
  // 캡션은 제목 한 줄만 남기고, 전문은 뒤이어 텍스트 메시지로 보낸다.
  const firstLine = s.split('\n')[0].slice(0, TELEGRAM_CAPTION_MAX);
  return { caption: firstLine, overflow: s };
}

module.exports = {
  collectMediaItems,
  mergeMediaItems,
  pickCoverUrl,
  extractPostLinks,
  extractHandle,
  parseUpdate,
  collectMediaUrls,
  mergeMediaUrls,
  wrapHeadline,
  buildBriefCaption,
  splitCaptionForTelegram,
  MAX_SLIDES,
  TELEGRAM_CAPTION_MAX,
};
