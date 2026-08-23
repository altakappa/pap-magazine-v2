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

/* 초대형 태그(#KPOP·#패션 같은)는 뺐다 — 가이드의 "초대형 회피, 중형 니치" 지시.
   코어 3개는 항상 이 순서로 맨 앞. #PAPMAGAZINE 이 1번이어야 한다. */
const HASHTAG_CORE = ['PAPMAGAZINE', '팝매거진', '패션뉴스'];
const HASHTAG_POOL_CELEB = [
  '케이팝화보', '셀럽패션', 'KPOPFASHION', '셀럽스타일', 'CELEBSTYLE',
  'KPOPSTYLE', '아이돌패션', '셀럽뉴스', '패션매거진', 'FASHIONNEWS',
  'EDITORIAL', 'FASHIONEDITORIAL', 'SEOULFASHION', '독립매거진', '스타일링',
  '케이팝패션', 'KPOPMAGAZINE', '패션에디토리얼', 'CELEBFASHION', '뮤직뉴스',
];

/* 회차마다 세트를 돌린다(도배 금지). 같은 게시물은 몇 번을 돌려도 같은 결과가
   나와야 하므로 난수를 쓰지 않고 seed 문자열에서 결정적으로 뽑는다. */
function _seedNum(seed) {
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

function buildHashtagBlock(opts) {
  const o = opts || {};
  const want = Math.max(12, Math.min(15, o.count || 14));
  const pool = Array.isArray(o.pool) && o.pool.length ? o.pool.slice() : HASHTAG_POOL_CELEB.slice();
  const start = _seedNum(o.seed) % pool.length;
  const out = HASHTAG_CORE.slice();
  const seen = new Set(out.map((t) => t.toUpperCase()));
  for (let i = 0; i < pool.length && out.length < want; i++) {
    const t = pool[(start + i) % pool.length];
    if (seen.has(t.toUpperCase())) continue;
    seen.add(t.toUpperCase());
    out.push(t);
  }
  return out.map((t) => '#' + t).join('\n');   // 가이드: 줄바꿈 구분
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

/* 브리프에 딸려 나가는 댓글 두 개.
   반환: { comment, reply } — comment 는 질문(없으면 빈 문자열), reply 는 해시태그 블록. */
function buildComments(opts) {
  const o = opts || {};
  return {
    comment: String(o.question || '').trim(),
    reply: buildHashtagBlock({ seed: o.seed, count: o.count, pool: o.pool }),
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

module.exports = {
  htmlToPlain,
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
