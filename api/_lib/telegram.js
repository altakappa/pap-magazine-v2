/**
 * PAP Magazine — 텔레그램 자동 전송 라이브러리
 *
 * 새 에디토리얼이 발행(draft→published)되는 순간, 그 에디토리얼의 이미지
 * (cover_image + gallery[])에 흰색 "PAP" 워드마크를 하단 중앙에 합성한 뒤
 * (= 인스타그램 게시 버전과 동일한 룩) 텔레그램 채팅으로 자동 전송한다.
 *
 * DB 에 저장된 원본은 로고가 없는 깨끗한 이미지이므로, 전송 직전 서버가
 * sharp 로 로고를 얹는다(api/_lib/brandImage.js). 합성 후 바이트를 텔레그램에
 * multipart 로 업로드한다.
 *
 * 의존 env (Vercel):
 *   TELEGRAM_BOT_TOKEN — @BotFather 봇 토큰
 *   TELEGRAM_CHAT_ID   — 이미지를 받을 채팅 ID
 *   TELEGRAM_BRAND_LOGO(선택) — 'off' 로 두면 로고 합성 없이 원본 URL 전송
 *   TELEGRAM_LOGO_URL(선택)   — 로고 이미지 URL 오버라이드
 *
 * 두 필수 env 중 하나라도 없으면 조용히 skip → 발행이 막히지 않음.
 *
 * 소비자: api/editorials/[id].js (PUT) — becomingPublished 전환 시 await 호출
 */

const { brandImageBuffer, getTrimmedLogo } = require('./brandImage');

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID   = () => process.env.TELEGRAM_CHAT_ID || '';
const BRAND_ON  = () => String(process.env.TELEGRAM_BRAND_LOGO || 'on').toLowerCase() !== 'off';
const SITE      = 'https://www.pap-magazine.com';

function isConfigured() { return !!(BOT_TOKEN() && CHAT_ID()); }

// cover_image + gallery[] 에서 유효한 http(s) 이미지 URL만 추린다.
// 순서: cover 먼저, 그다음 gallery. 중복 URL 제거.
function collectImageUrls(ed) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    if (!u || typeof u !== 'string') return;
    const s = u.trim();
    if (!/^https?:\/\//i.test(s)) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  push(ed && ed.cover_image);
  const g = ed && ed.gallery;
  if (Array.isArray(g)) g.forEach(push);
  return out;
}

function buildCaption(ed) {
  const title = (ed && ed.title) ? String(ed.title).trim() : 'New Editorial';
  const dateStr = (ed && (ed.published_date || ed.date))
    ? String(ed.published_date || ed.date).slice(0, 10) : '';
  const link = SITE + '/?ed=' + encodeURIComponent(title);
  return '📸 PAP · 새 에디토리얼\n' + title + (dateStr ? ('\n' + dateStr) : '') + '\n' + link;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// URL → 이미지 바이트 다운로드
async function fetchImageBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('image fetch failed: HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// 이미지 URL 목록 → (로고 합성된) JPEG 버퍼 목록.
// 개별 이미지가 실패하면 그 이미지만 건너뛴다(전체는 계속).
async function prepareImageBuffers(urls) {
  const brand = BRAND_ON();
  let logo = null;
  if (brand) {
    try { logo = await getTrimmedLogo(); }
    catch (e) { console.warn('[telegram] 로고 로드 실패 → 원본 전송으로 전환:', e && e.message); }
  }
  const buffers = [];
  for (const url of urls) {
    try {
      const raw = await fetchImageBuffer(url);
      if (brand && logo) {
        try { buffers.push(await brandImageBuffer(raw, logo)); }
        catch (e) { console.warn('[telegram] 합성 실패 → 원본 사용:', url, e && e.message); buffers.push(raw); }
      } else {
        buffers.push(raw);
      }
    } catch (e) {
      console.warn('[telegram] 이미지 스킵:', url, e && e.message);
    }
  }
  return buffers;
}

// multipart 로 한 묶음(최대 10장) 전송. 첫 묶음의 첫 장에만 캡션.
async function sendGroup(buffers, caption) {
  const token = BOT_TOKEN();
  if (buffers.length === 1) {
    const form = new FormData();
    form.append('chat_id', CHAT_ID());
    if (caption) form.append('caption', caption);
    form.append('photo', new Blob([buffers[0]], { type: 'image/jpeg' }), 'photo.jpg');
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendPhoto', { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    if (!j || j.ok !== true) throw new Error('sendPhoto: ' + ((j && j.description) || ('HTTP ' + r.status)));
    return;
  }
  const form = new FormData();
  form.append('chat_id', CHAT_ID());
  const media = buffers.map((buf, i) => {
    const name = 'file' + i;
    form.append(name, new Blob([buf], { type: 'image/jpeg' }), name + '.jpg');
    const m = { type: 'photo', media: 'attach://' + name };
    if (i === 0 && caption) m.caption = caption;
    return m;
  });
  form.append('media', JSON.stringify(media));
  const r = await fetch('https://api.telegram.org/bot' + token + '/sendMediaGroup', { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  if (!j || j.ok !== true) throw new Error('sendMediaGroup: ' + ((j && j.description) || ('HTTP ' + r.status)));
}

/**
 * 발행된 에디토리얼 이미지들을 (로고 합성 후) 텔레그램으로 전송.
 * @returns {Promise<{sent:number, groups?:number, skipped?:string}>}
 */
async function sendEditorialToTelegram(ed) {
  if (!isConfigured()) return { sent: 0, skipped: 'not_configured' };
  const urls = collectImageUrls(ed);
  if (!urls.length) return { sent: 0, skipped: 'no_images' };

  const buffers = await prepareImageBuffers(urls);
  if (!buffers.length) return { sent: 0, skipped: 'no_usable_images' };

  const caption = buildCaption(ed);
  const groups = chunk(buffers, 10);
  let sent = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    await sendGroup(groups[gi], gi === 0 ? caption : '');
    sent += groups[gi].length;
  }
  return { sent, groups: groups.length };
}

// 발행 응답을 절대 막지 않는 안전 래퍼 — 에러를 콘솔에만 남기고 삼킨다.
async function sendEditorialToTelegramSafe(ed) {
  try {
    const r = await sendEditorialToTelegram(ed);
    if (r && r.sent > 0) {
      console.log('[telegram] 에디토리얼 전송 완료:', (ed && ed.title) || (ed && ed.id), '이미지', r.sent + '장');
    } else if (r && r.skipped) {
      console.log('[telegram] skip:', r.skipped, '-', (ed && ed.title) || (ed && ed.id));
    }
    return r;
  } catch (e) {
    console.warn('[telegram] 전송 실패 (발행에는 영향 없음):', e && e.message);
    return { sent: 0, error: String((e && e.message) || e) };
  }
}

module.exports = {
  sendEditorialToTelegram,
  sendEditorialToTelegramSafe,
  collectImageUrls,
  isConfigured,
};
