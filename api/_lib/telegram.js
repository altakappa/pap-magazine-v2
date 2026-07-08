/**
 * PAP Magazine — 텔레그램 자동 전송 라이브러리
 *
 * 새 에디토리얼이 발행(draft→published)되는 순간, 그 에디토리얼의
 * 인스타그램용(5:4 · 아래 로고) 이미지들 = 저장된 cover_image + gallery[] URL을
 * 텔레그램 채팅으로 자동 전송한다. 저장 URL을 그대로 Telegram API에 넘기므로
 * 별도 업로드/로고 합성 없이 원본 그대로 전달된다.
 *
 * 의존 env (Vercel):
 *   TELEGRAM_BOT_TOKEN — @BotFather 로 만든 봇 토큰 (예: 123456:ABC-...)
 *   TELEGRAM_CHAT_ID   — 이미지를 받을 채팅 ID (봇과의 1:1 채팅, 그룹, 또는 채널)
 *
 * 두 값 중 하나라도 없으면 조용히 skip → 기능 미설정 상태에서도 발행이 막히지 않음.
 *
 * 소비자:
 *   api/editorials/[id].js (PUT) — becomingPublished 전환 시 fire-and-forget 호출
 */

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID   = () => process.env.TELEGRAM_CHAT_ID || '';
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

async function tg(method, payload) {
  const url = 'https://api.telegram.org/bot' + BOT_TOKEN() + '/' + method;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let j = {};
  try { j = await r.json(); } catch (_) {}
  if (!j || j.ok !== true) {
    throw new Error('Telegram ' + method + ' failed: ' + ((j && j.description) || ('HTTP ' + r.status)));
  }
  return j;
}

// Telegram 미디어 그룹 = 최대 10장/묶음. 10장씩 잘라서 보낸다.
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function buildCaption(ed) {
  const title = (ed && ed.title) ? String(ed.title).trim() : 'New Editorial';
  const dateStr = (ed && (ed.published_date || ed.date))
    ? String(ed.published_date || ed.date).slice(0, 10) : '';
  const link = SITE + '/?ed=' + encodeURIComponent(title);
  return '📸 PAP · 새 에디토리얼\n' + title + (dateStr ? ('\n' + dateStr) : '') + '\n' + link;
}

/**
 * 발행된 에디토리얼의 이미지들을 텔레그램으로 전송.
 * 호출부는 fire-and-forget 로 쓰되, 여기서도 내부 에러는 잡아 상위로 던지지 않는
 * 안전 버전(sendEditorialToTelegramSafe)을 함께 제공한다.
 * @returns {Promise<{sent:number, groups?:number, skipped?:string}>}
 */
async function sendEditorialToTelegram(ed) {
  if (!isConfigured()) return { sent: 0, skipped: 'not_configured' };
  const urls = collectImageUrls(ed);
  if (!urls.length) return { sent: 0, skipped: 'no_images' };

  const caption = buildCaption(ed);
  const groups = chunk(urls, 10);
  let sent = 0;

  for (let gi = 0; gi < groups.length; gi++) {
    const batch = groups[gi];
    if (batch.length === 1) {
      // 단일 이미지는 sendPhoto 가 더 안정적 (첫 그룹이면 캡션 포함).
      await tg('sendPhoto', {
        chat_id: CHAT_ID(),
        photo: batch[0],
        caption: gi === 0 ? caption : undefined,
      });
    } else {
      // 미디어 그룹: 캡션은 첫 그룹의 첫 사진에만 붙는다.
      const media = batch.map((u, idx) => {
        const item = { type: 'photo', media: u };
        if (gi === 0 && idx === 0) item.caption = caption;
        return item;
      });
      await tg('sendMediaGroup', { chat_id: CHAT_ID(), media });
    }
    sent += batch.length;
  }
  return { sent, groups: groups.length };
}

// 발행 응답을 절대 막지 않는 안전 래퍼 — 에러를 콘솔에만 남기고 삼킨다.
async function sendEditorialToTelegramSafe(ed) {
  try {
    const r = await sendEditorialToTelegram(ed);
    if (r && r.sent > 0) {
      console.log('[telegram] 에디토리얼 전송 완료:', (ed && ed.title) || ed && ed.id, '이미지', r.sent + '장');
    } else if (r && r.skipped) {
      console.log('[telegram] skip:', r.skipped, '-', (ed && ed.title) || (ed && ed.id));
    }
    return r;
  } catch (e) {
    console.warn('[telegram] 전송 실패 (발행에는 영향 없음):', e && e.message);
    return { sent: 0, error: String(e && e.message || e) };
  }
}

module.exports = {
  sendEditorialToTelegram,
  sendEditorialToTelegramSafe,
  collectImageUrls,
  isConfigured,
};
