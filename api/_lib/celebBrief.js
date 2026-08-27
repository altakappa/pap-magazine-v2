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

/* 게시 명령 (2026-08-23).
   도메니코: "게시 기능을 만들어줘." → 텔레그램에 "올려" 라고 치면 게시한다.

   ⚠️ 절대 규칙("발행은 내가 직접")을 지키려면 **오해의 여지가 없어야** 한다.
   그래서 아주 좁게 본다:
     · 메시지에 인스타 링크가 있으면 명령이 아니다 (새 브리프 요청이다)
     · 문장 전체가 명령어여야 한다. "올려도 될까?" 같은 문장은 명령이 아니다
     · 부정형("올리지 마")은 걸러낸다
   애매하면 명령이 아닌 쪽으로 판정한다 — 잘못 올리는 것이 안 올리는 것보다 훨씬 나쁘다. */
const _PUBLISH_WORDS = [
  '올려', '올려줘', '올려주세요', '올려라',
  '게시', '게시해', '게시해줘', '게시하자',
  '업로드', '업로드해', '업로드해줘',
  'publish', 'post', 'go',
];
const _WEB_PUBLISH_WORDS = [
  '웹만', '웹 올려', '웹올려', '웹에 올려', '웹에올려',
  '웹게시', '웹 게시', '웹사이트 올려', '웹사이트에 올려', 'web',
];

function parsePublishCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (_POST_RE.test(raw)) { _POST_RE.lastIndex = 0; return false; }   // 링크가 있으면 새 요청
  _POST_RE.lastIndex = 0;
  if (/(마|말|않|안 |아니|취소|하지)/.test(raw)) return false;          // 부정·취소
  const norm = raw.toLowerCase().replace(/[\s.!~]+$/g, '').replace(/^[\s]+/, '');
  /* 2026-08-23 — 자동 감시로 브리프가 한꺼번에 여러 건 올 수 있게 되면서
     "올려"만으로는 어떤 걸 올릴지 모호해졌다. "올려 12" / "올려 #12" 로
     번호를 지정할 수 있다. 반환: false | { num: null|번호 } */
  const m = /^(.+?)\s*#?(\d{1,8})$/.exec(norm);
  const word = m ? m[1].trim() : norm;
  const num = m ? parseInt(m[2], 10) : null;
  if (_PUBLISH_WORDS.includes(word)) return { num, web: false };
  /* "웹만"/"웹 올려" — 인스타 인사이트에 부담 없이 웹사이트에만 기사를 낸다
     (도메니코 2026-08-23: "웹사이트는 인사이트 걱정 없이 방대하게 올려도 되거든").
     AI 인용 경쟁의 병목이 웹 기사 물량이라 이 경로가 전략의 본체다. */
  if (_WEB_PUBLISH_WORDS.includes(word)) return { num, web: true };
  return false;
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
    publishCommand: parsePublishCommand(text),
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
/* 인스타그램 캐러셀 상한이 20장이다. 10 으로 잘라 두면 원본 장수가 그보다
   많은 게시물에서 뒤 슬라이드가 통째로 버려진다 — 실측(브리프 36번)에서
   10장으로 잘린 사례가 확인됐다. 커버가 1장을 먹으므로 실제 원본은 19장까지.
   텔레그램은 한 묶음에 10장까지라 telegram.sendMediaToTelegram 이 알아서
   두 번에 나눠 보낸다(chunk(list, 10)) — 여기서 신경 쓸 게 없다.
   도메니코 2026-08-26: "이미지를 최대한으로 뽑아줘". */
const MAX_SLIDES = 20;

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
/* minLines: 한 줄에 다 들어가도 굳이 두 줄로 쪼갠다.
   도메니코 2026-08-23: "섬네일 타이틀은 이전처럼 두 줄로."
   왜 — 조판이 2줄 전제다. 국문 baseline 아래 EN_LEAD 만큼 내려 영문을 그리는데,
   국문이 1줄로 떨어지면 국문과 영문 사이에 빈 줄 하나가 뜬다(레이아웃이 깨진다). */
function wrapHeadline(text, maxWidth, measure, maxLines, minLines) {
  const limit = maxLines || 2;
  const floor = Math.min(minLines || 1, limit);
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
  // 쪼갤 단어가 하나뿐이면 두 줄로 만들 방법이 없다 — 억지로 자르지 않는다.
  if (words.length === 1) return measure(raw) <= maxWidth ? [raw] : null;
  const oneLine = measure(raw) <= maxWidth;
  if (oneLine && floor < 2) return [raw];
  if (limit < 2) return oneLine ? [raw] : null;

  // 단어 경계 후보 전부를 2줄로 놓고 본다.
  const cand = [];
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (measure(a) <= maxWidth && measure(b) <= maxWidth) cand.push({ a, b, i });
  }
  // 한 줄엔 들어가는데 고른 2줄 후보가 없다면(예: 한 단어가 너무 길다) 한 줄로 둔다.
  if (!cand.length) return oneLine ? [raw] : null;

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

/* 기사 본문(HTML) → 인스타에 그대로 붙여넣을 수 있는 평문.

   왜 필요한가 (2026-08-23): body_ko 는 **웹사이트용 포맷**이다 —
   단락을 <br><br> 로 나누고 <b>·<i> 같은 인라인 태그를 쓴다
   (instagramImport 프롬프트가 그렇게 지시한다). 그대로 캡션에 넣으면
   도메니코 화면에 <br><br> 가 글자로 보이고, 인스타에 복사해 붙일 수 없다.
   캡션은 "받아서 바로 붙여넣는 것" 이 목적이므로 평문으로 바꾼다. */
function htmlToPlain(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')      // 단락 사이는 빈 줄 하나까지만
    .trim();
}

/* 게시물 캡션에서 @핸들을 뽑는다 (멘션 줄 만들기용). */
function extractMentions(text, limit) {
  const out = [];
  const seen = new Set();
  const re = /@([A-Za-z0-9._]{2,30})/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const h = m[1].replace(/[._]+$/, '').toLowerCase();
    if (h.length < 2 || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
    if (out.length >= (limit || 5)) break;
  }
  return out;
}

/* PAP 인스타그램 캡션 — 실제 발행본 형식 그대로.
 *
 * ── 실측 (2026-08-23) ──────────────────────────────────────
 * 도메니코: 셀럽기사에서 참고해라 / 항상 영문도 있다.
 * 그래서 News 카테고리만 다시 쟀다 (2026-06 이후 92건).
 *   영문 병기                        92/92 = 100%   ← 예외 없다
 *   2번째 줄이 @계정 멘션             91/92 =  99%
 *   크레딧 이모지                     89/92 =  97%  (사진 45 · 영상 44, 거의 반반)
 *   FOR MORE ARTICLES | @pap_magazine   52/92 =  57%
 *   URL 포함                          0/92 =   0%
 *   평균 958자 · 첫 줄 21자
 *
 * ⚠️ 해시태그는 **어디에도 넣지 않는다.**
 *    실측상 셀럽기사 22% 가 후킹 문장 안에 태그를 녹여 쓰긴 한다
 *    ('무대 위의 #태용 은 언제나 강하다'). 하지만 도메니코가 2026-08-23 에
 *    직접 물렸다: "해시태그 후킹 문장 안에 녹이는 거는 더 이상하지 않아."
 *    실측이 곧 정답은 아니다 — 발행자가 아니라고 하면 아닌 것이다.
 *    기사 생성기가 후킹에 태그를 달아 보내면 여기서 벗겨낸다.
 *
 * ⚠️ 광고·협찬 표기(#광고 · #제작지원)는 다루지 않는다.
 *    도메니코 2026-08-23: 협찬은 너에게 맡기지 않는다.
 *
 * 구조:
 *   [후킹 한 줄]                 ← 기사 제목이 아니라 더 짧고 구어체 (19~23자)
 *   @계정 @계정
 *   (빈 줄)
 *   국문 본문
 *   (빈 줄)
 *   FOR MORE ARTICLES | @pap_magazine
 *   (빈 줄)
 *   영문 본문
 *   (빈 줄)
 *   📸 @계정   (영상이면 🎥)
 *
 * ⚠️ 처음에 내가 임의로 만든 형식(해시태그 나열 + '출처 @x · URL')은
 *    실제와 전혀 달랐다. 해시태그는 2%, URL 은 0건이다.
 *    인스타 캡션에 링크를 넣어도 클릭되지 않으니 애초에 안 쓴다.
 */
/* 후킹에서 해시태그를 벗긴다.
   '#' 만 지우면 '무대 위의 태용 은 언제나' 처럼 조사 앞 공백이 남는다
   (원문이 태그가 조사를 먹지 않게 일부러 띄워 놓기 때문). 그래서 '#낱말'
   바로 뒤에 오는 '공백 + 조사' 는 공백까지 함께 붙여 준다. */
const _JOSA = '은|는|이|가|을|를|의|과|와|도|만|에|에서|에게|으로|로|부터|까지|이나|나|이라|라';
const _HASH_JOSA = new RegExp('#([0-9A-Za-z가-힣_]+)\\s+(' + _JOSA + ')(?=\\s|[,.!?)\\]]|$)', 'g');

function stripHashtags(text) {
  return String(text || '')
    .replace(_HASH_JOSA, '$1$2')
    .replace(/#(?=[0-9A-Za-z가-힣_])/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/* 캡션용 본문 줄이기 (2026-08-23).
   도메니코: "너무 캡션이 길다. 기사내용은 절반으로 줄여달라."

   웹사이트 본문은 600~800자로 쓰인다(papVoice LENGTH_ARTICLE). 인스타 캡션은
   국문+영문이 함께 들어가서 두 배가 되고, 실측 셀럽기사 평균이 958자인데
   우리 캡션은 그걸 훌쩍 넘겼다.

   문장 중간에서 자르지 않는다 — **단락 단위**로 앞에서부터 담다가 목표 길이를
   넘으면 멈춘다. 앞 단락이 리드(누가·언제·무엇을)라 앞을 남기는 게 맞다.
   최소 한 단락은 남긴다. 국문·영문은 **같은 단락 수**로 맞춘다 — 실제 캡션이
   국·영문 단락 수를 맞춰 쓴다(papVoice 프롬프트도 그렇게 지시한다). */
function halveBody(text, opts) {
  const ratio = (opts && opts.ratio) || 0.5;
  const t = htmlToPlain(text);
  if (!t) return { text: '', paras: 0 };
  const paras = t.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  if (paras.length <= 1) return { text: paras.join(''), paras: paras.length };
  const target = t.length * ratio;
  /* 목표를 넘자마자 멈추면 한 단락을 통째로 더 담아 과하게 길어진다
     (100자 4단락 · 목표 203 → 3단락 304자). 목표에 **가장 가까운** 단락 수를
     고른다. 최소 한 단락은 남긴다. */
  let acc = 0;
  let best = 1;
  let bestGap = Infinity;
  for (let i = 0; i < paras.length; i++) {
    acc += paras[i].length;
    const gap = Math.abs(acc - target);
    if (gap < bestGap) { bestGap = gap; best = i + 1; }
  }
  const keep = paras.slice(0, best);
  return { text: keep.join('\n\n'), paras: keep.length };
}

/* 단락 수를 n 개로 맞춘다 (국문에서 정한 수에 영문을 맞출 때). */
function takeParagraphs(text, n) {
  const t = htmlToPlain(text);
  if (!t || !n) return t || '';
  return t.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).slice(0, n).join('\n\n');
}

/* ── 댓글 / 대댓글 (2026-08-23) ────────────────────────────────
 * 도메니코: "댓글과 대댓글 해시태그를 학습해달라" → 댓글=질문 / 대댓글=해시태그.
 *
 * 볼트 근거:
 *   50_Brand/톤앤매너.md
 *     "해시태그는 자체 에디토리얼 캡션에만 붙인다. 뉴스·큐레이션·셀럽 기사
 *      캡션에는 넣지 않는다 (실게시물 50개 검증)."  → 캡션은 깨끗하게 둔다.
 *   50_Brand/PAP-브랜드-가이드.md
 *     해시태그 블록 — 대문자·줄바꿈 구분, 12~15개, #PAPMAGAZINE 을 항상 1번.
 *     초대형 태그 회피, 중형 니치 위주, 세트는 로테이션(도배 금지).
 *   40_Community/한국인-댓글-작전-2026-07-29.md
 *     "댓글창 첫 댓글을 우리가 단다 — 질문 한 줄을 고정 댓글로.
 *      캡션을 건드리지 않고 대화를 여는 가장 싼 방법."
 *
 * 질문은 새로 지어내지 않는다. §1 말투 규칙상 본문 마지막 문장이 이미
 * 독자 호명이다("당신은 ~인가?"). 그 문장을 본문에서 **떼어내** 댓글로 옮긴다.
 * 새로 지으면 톤이 갈리고, 그대로 두면 캡션과 댓글이 겹친다.
 * 물음표로 끝나지 않으면 옮기지 않는다 — 억지로 질문을 만들지 않는다.
 */

/* 해시태그 — 5개, 기사 내용에서 뽑는다 (2026-08-23 도메니코 지시).
   "대댓글 해시태그는 5개면 충분하고 기사에 관련된 내용으로 해줘."

   이전에는 셀럽 공용 풀에서 12~15개를 돌려 썼다. 브랜드 가이드의 숫자였지만
   그건 **에디토리얼** 기준이고, 셀럽 속보에는 기사와 무관한 태그가 섞였다.
   이제 기사 생성기가 뽑은 tags(제목·본문에서 나온 키워드)를 쓴다.

   #PAPMAGAZINE 은 1번 자리에 고정한다 — 브랜드 가이드의 유일한 고정 규칙이고
   계정을 찾아오는 통로다. 나머지 4개가 기사 몫이다.
   기사 태그가 하나도 없을 때만 셀럽 공용 풀로 채운다(빈 대댓글보다 낫다). */
const HASHTAG_CORE = ['PAPMAGAZINE'];
const HASHTAG_POOL_CELEB = [
  '케이팝화보', '셀럽패션', 'KPOPFASHION', '셀럽스타일', '패션뉴스',
];
const HASHTAG_COUNT = 5;

/* 태그 한 개를 인스타 표기로 정리한다.
   영문은 대문자(브랜드 가이드), 한글은 그대로. 공백·특수문자는 뺀다
   (해시태그는 공백에서 끊기므로 'fallen angel' → 'FALLENANGEL'). */
function normalizeTag(t) {
  const raw = String(t || '').replace(/^#+/, '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/[^0-9A-Za-z가-힣_]+/g, '');
  if (!cleaned) return '';
  return /[가-힣]/.test(cleaned) ? cleaned : cleaned.toUpperCase();
}

function buildHashtagBlock(opts) {
  const o = opts || {};
  const want = Math.max(1, o.count || HASHTAG_COUNT);
  const out = [];
  const seen = new Set();
  const push = (t) => {
    const n = normalizeTag(t);
    if (!n || seen.has(n.toUpperCase()) || out.length >= want) return;
    seen.add(n.toUpperCase());
    out.push(n);
  };
  HASHTAG_CORE.forEach(push);
  /* 도메니코 2026-08-23: "대댓글 해시태그는 인물이나 브랜드에 포커스."
     주체를 중요한 순서로, 각각 영문 → 한글 병기로 넣는다
     (인스타는 #JISOO 와 #지수 의 검색 결과가 완전히 다르다).
     예: #PAPMAGAZINE #JISOO #지수 #BLACKPINK #블랙핑크 */
  (Array.isArray(o.entities) ? o.entities : []).forEach((e) => {
    if (!e) return;
    push(e.en);
    push(e.ko);
  });
  // 주체를 하나도 못 뽑은 기사에서만 예전 방식으로 메운다 — 빈 대댓글보다는 낫다.
  if (out.length <= HASHTAG_CORE.length) {
    (Array.isArray(o.tags) ? o.tags : []).forEach(push);
    HASHTAG_POOL_CELEB.forEach(push);
  }
  return out.map((t) => '#' + t).join(' ');
}

/* 본문 마지막 문장이 독자 호명 질문이면 떼어낸다.
   반환: { body, question } — question 이 없으면 본문은 그대로다. */
function splitClosingQuestion(bodyKo) {
  const text = htmlToPlain(bodyKo);
  if (!text) return { body: '', question: '' };
  const paras = text.split(/\n{2,}/);
  const last = paras[paras.length - 1];
  const sentences = last.split(/(?<=[.!?])\s+/).filter(Boolean);
  const tail = sentences[sentences.length - 1] || '';
  if (!/\?\s*$/.test(tail)) return { body: text, question: '' };
  sentences.pop();
  paras[paras.length - 1] = sentences.join(' ').trim();
  const body = paras.filter((p) => p.trim()).join('\n\n');
  return { body, question: tail.trim() };
}

/* 댓글은 존댓말로 (2026-08-23 도메니코 지시).

   기사 본문은 §1 규칙대로 평서체 반말(~다)이고 마지막 문장도 '~인가?' 로 끝난다.
   그 문장을 그대로 댓글로 옮기면 독자에게 반말로 말을 거는 셈이 된다.
   브랜드 가이드의 댓글 트리거 예시도 존댓말이다
   ("이 룩, 저장할 이유가 하나라도 있었나요? 댓글로.").

   질문을 새로 짓지 않고 **어미만** 바꾼다 — 새로 지으면 기사와 톤이 갈린다.
   실측(2026-08-03 이후 News 60건 마지막 문장)에서 나온 어미는 세 갈래뿐이었다.
     ~는가  → ~나요    (있는가·하는가·동의하는가·됐는가·통했는가)
     ~가    → ~가요    (싶은가·궁금한가·언제인가·것인가·예정인가)
     ~까    → ~까요    (일까·될까·있을까)
   어느 것도 안 걸리면 손대지 않는다. 억지로 바꾸면 문장이 깨진다. */
function toPolite(question) {
  const raw = String(question || '').trim();
  if (!raw) return '';
  const body = raw.replace(/[.?!\s]+$/, '');
  if (!body) return '';
  if (/(요|니다|니까|세요|나요|까요|가요|지요)$/.test(body)) return body + '?';   // 이미 존댓말
  let out = body;
  if (/는가$/.test(body)) out = body.replace(/는가$/, '나요');
  else if (/까$/.test(body)) out = body + '요';
  else if (/가$/.test(body)) out = body + '요';
  else if (/지$/.test(body)) out = body + '요';
  else return raw;                                    // 모르는 어미는 건드리지 않는다
  return out + '?';
}

/* 브리프에 딸려 나가는 댓글 두 개.
   반환: { comment, reply } — comment 는 질문(없으면 빈 문자열), reply 는 해시태그 블록. */
function buildComments(opts) {
  const o = opts || {};
  /* 기사 마지막이 질문으로 끝나는 비율은 실측 67% 뿐이다. 나머지는 question 이 비고,
     그러면 댓글이 안 달려 **대댓글 해시태그까지 통째로 사라진다**(브리프 9·10번).
     그래서 모델이 따로 만들어 준 fallbackQuestion 을 받는다. */
  const q = String(o.question || '').trim() || String(o.fallbackQuestion || '').trim();
  return {
    comment: toPolite(q),
    reply: buildHashtagBlock({ entities: o.entities, tags: o.tags, count: o.count }),
  };
}

const FOR_MORE = 'FOR MORE ARTICLES | @pap_magazine';

function buildBriefCaption(brief) {
  const b = brief || {};
  const hook = stripHashtags(htmlToPlain(b.hook || b.title));
  const ko = htmlToPlain(b.bodyKo || b.body);
  const en = htmlToPlain(b.bodyEn);   // 실측 100% — 비면 호출부가 사람에게 알린다
  const mentions = (Array.isArray(b.mentions) ? b.mentions : [])
    .map((h) => String(h || '').replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  const uniq = [];
  const seen = new Set();
  for (const h of mentions) { if (!seen.has(h)) { seen.add(h); uniq.push(h); } }

  const lines = [];
  if (hook) lines.push(hook);
  if (uniq.length) lines.push(uniq.map((h) => '@' + h).join(' '));

  const parts = [];
  if (lines.length) parts.push(lines.join('\n'));
  if (ko) parts.push(ko);
  parts.push(FOR_MORE);
  if (en) parts.push(en);

  const credit = uniq.length
    ? (b.creditKind === 'video' ? '🎥 ' : '📸 ') + uniq.map((h) => '@' + h).join(' ')
    : '';
  if (credit) parts.push(credit);

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

/* 커버 판형 (2026-08-26) ────────────────────────────────────────────────
   종전 규칙: `items[0].type === 'video' ? 'reels' : 'feed'`.
   **영상이면 무조건 9:16 이라고 찍었다.** 그런데 영상 크기를 읽는 코드
   (mp4Mute.mp4Dimensions)는 이 판단보다 뒤에서 돌고 있었다. 잴 수 있는데
   안 재고 찍은 것이다.

   실측(celeb_brief_queue.result.video_sizes):
     브리프 41·40·34·32·28 (라이즈·에스파)  720x1280 = 0.5625 (9:16)  판정 맞음
     브리프 25 (프라다)                      720x900  = 0.8    (4:5)   **판정 틀림**

   4:5 영상 게시물에 9:16 커버를 씌우면 인스타 캐러셀이 첫 장 기준으로 비율을
   맞추면서 뒤 영상이 눌리거나 잘린다. 도메니코 2026-08-26: "위아래 납짝해지지
   않게 … 지금은 너무 비율이 엉망이야."

   경계값 0.62 는 9:16(0.5625)과 4:5(0.8) 사이다. 세로 영상이 조금 어긋나도
   (0.56~0.62) 릴스로 보내고, 4:5 계열(0.75~0.8)은 피드로 보낸다.
   **못 쟀으면 종전 동작(reels)을 유지한다** — 새 규칙이 못 재는 경우까지
   바꿔 버리면 고장 범위가 넓어진다. */
const REELS_MAX_RATIO = 0.62;

/**
 * 커버 판형을 정한다.
 * @param {{type:string}[]} items      슬라이드 목록 (0번이 커버 대상)
 * @param {{width:number,height:number,ratio:number}|null} firstDim
 *        items[0] 이 영상일 때 **실측한** 크기. 못 쟀으면 null.
 * @returns {'feed'|'reels'}
 */
function pickVariant(items, firstDim) {
  const first = (items || [])[0];
  if (!first || first.type !== 'video') return 'feed';
  const ratio = firstDim && Number(firstDim.ratio);
  if (!ratio || !isFinite(ratio) || ratio <= 0) return 'reels';   // 못 쟀으면 종전대로
  return ratio <= REELS_MAX_RATIO ? 'reels' : 'feed';
}

/* 셀럽 게이트 (2026-08-26) ──────────────────────────────────────────────
   도메니코: "모두 셀럽이 포함된 기사여야만해. 그냥 디올 기사같은건 필요없어."

   실측(브리프 42건): 디올 단독 9건. 4시간 안에 같은 테일러링 캠페인으로
   3건이 나갔다 — "디올이 말하는 테일러링의 정밀함" / "디올 테일러링 스터디" /
   "디올 테일러링의 여유로운 럭셔리". 전부 인물이 없다.

   **계정을 지우지 않는다.** 같은 프라다 계정에서 "해리 스타일스, 멕시코시티
   무대에서 입은 프라다"(브리프 42)가 나왔다. 거르는 기준은 계정이 아니라
   기사에 사람이 있느냐다.

   fail-open 이 핵심이다. 모델이 kind 를 안 주거나 파싱이 깨졌을 때
   "person 이 없다"로 읽으면 **브리프가 전부 사라진다.** 오늘 아침 자기
   리퍼러 건에서 겪은 것과 같은 모양의 사고다. 그래서 판단할 근거 자체가
   없으면 통과시키고 이유를 적는다. */

/**
 * 이 기사에 사람(인물·그룹)이 등장하는가.
 * @param {{ko?:string,en?:string,kind?:string}[]} entities
 * @returns {{pass:boolean, reason:string|null}} reason 은 통과/차단 사유 메모
 */
function celebGate(entities) {
  const list = Array.isArray(entities) ? entities.filter(Boolean) : [];
  if (!list.length) return { pass: true, reason: 'entities 없음 — 판단 불가라 통과' };
  const withKind = list.filter((e) => typeof e.kind === 'string' && e.kind);
  if (!withKind.length) return { pass: true, reason: 'kind 표기 없음 — 판단 불가라 통과' };
  if (withKind.some((e) => e.kind === 'person' || e.kind === 'group')) {
    return { pass: true, reason: null };
  }
  const names = list.map((e) => e.ko || e.en).filter(Boolean).slice(0, 3).join('·');
  return { pass: false, reason: '인물 없음 — 브랜드만 등장' + (names ? ' (' + names + ')' : '') };
}

/* 주제 게이트 (2026-08-26, 2차 수정) ────────────────────────────────────
   도메니코 1차: "제발 셀럽소식만. 셀럽이 매거진에 실린소식은 안알려줘도돼.
                  챌린지도 알려줄필요없어."
   도메니코 정정: "브랜드 캠페인이 차단이 아니라 **셀럽이 포함되지 않은**
                  브랜드 캠페인이 없어도 된다는거야."

   처음엔 brand_campaign 을 통째로 막았다. 틀렸다. 샤넬 캠페인에 제니가 나오면
   그건 우리가 원하는 기사다. 걸러야 하는 건 **사람이 없는** 캠페인이다.
   그리고 그건 이미 celebGate 가 하는 일이다.

   그래서 규칙을 단순하게 다시 세운다.
     · 무조건 막는 것은 도메니코가 이름을 댄 둘뿐 — magazine_feature, challenge.
       (이 둘은 셀럽이 나와도 소식이 아니다: 남의 매거진 발행, 이벤트 참여 안내)
     · 나머지는 전부 **사람이 있느냐**로만 판단한다.
       brand_campaign · other · 모르는 값 · 값 없음 → celebGate 에 맡긴다.

   규칙이 하나 줄었고, 판단 기준이 한 곳(celebGate)으로 모였다.
   fail-open 도 자동으로 지켜진다 — 모르는 주제는 애초에 막지 않는다. */
const TOPIC_BLOCK = new Set(['magazine_feature', 'challenge']);
const TOPIC_LABEL = {
  magazine_feature: '남의 매거진에 실린 소식',
  challenge: '챌린지·이벤트',
};

/**
 * 이 브리프를 보낼 것인가.
 *   ① 도메니코가 이름 댄 주제(매거진 화보·챌린지)면 막는다.
 *   ② 그 외에는 인물(person·group)이 있어야 통과한다.
 * @param {{entities?:any[], brief_topic?:string}} gen 기사 생성 결과
 * @returns {{pass:boolean, reason:string|null}}
 */
function briefGate(gen) {
  const g = gen || {};
  const topic = typeof g.brief_topic === 'string'
    ? g.brief_topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    : '';
  if (topic && TOPIC_BLOCK.has(topic)) {
    return { pass: false, reason: TOPIC_LABEL[topic] + ' (' + topic + ')' };
  }
  return celebGate(g.entities);
}

module.exports = {
  briefGate,
  TOPIC_BLOCK,
  pickVariant,
  celebGate,
  REELS_MAX_RATIO,
  htmlToPlain,
  toPolite,
  normalizeTag,
  HASHTAG_COUNT,
  parsePublishCommand,
  halveBody,
  takeParagraphs,
  buildHashtagBlock,
  splitClosingQuestion,
  buildComments,
  HASHTAG_CORE,
  HASHTAG_POOL_CELEB,
  stripHashtags,
  extractMentions,
  FOR_MORE,
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
