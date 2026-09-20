/**
 * PAP Magazine — 텔레그램 자동 전송 라이브러리
 *
 * 새 에디토리얼이 발행(draft→published)되는 순간, 그 에디토리얼의 이미지를 텔레그램 채팅으로 자동 전송한다.
 * 2026-09-14 부터 내용물은 관리자 "전체 ZIP 다운로드" 와 같다: 매거진 커버(cover_image 그대로) +
 * 갤러리 인스타 합성본(insta_logo_settings 로 4:5 프레이밍 + PAP 로고, api/_lib/instaComposite.js).
 * 전부 문서(document)로 보내 텔레그램 재압축 없이 바이트가 보존된다.
 * (종전: brandImage.js 로 원본 크기에 trim 로고 14% 를 얹어 사진으로 전송 — ZIP 과 달랐다.)
 *
 * 의존 env (Vercel):
 *   TELEGRAM_BOT_TOKEN — @BotFather 봇 토큰
 *   TELEGRAM_CHAT_ID   — 이미지를 받을 채팅 ID
 *   TELEGRAM_BRAND_LOGO(선택) — 'off' 로 두면 로고 합성 없이 원본 URL 전송
 *   TELEGRAM_LOGO_URL(선택)   — 로고 이미지 URL 오버라이드
 *
 * 두 필수 env 중 하나라도 없으면 조용히 skip → 발행이 막히지 않음.
 *
 * 소비자: api/editorials/telegram-send.js (전용 워커, 300초) ← api/editorials/[id].js (PUT) 가 발행 순간 깨운다.
 *   2026-09-20: 종전엔 PUT 안에서 직접 돌렸다. 16장 합성이 120초 상한을 넘겨 504 + 캡션 유실. 워커로 분리.
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
async function prepareImageBuffers(urls, opts) {
  const brand = BRAND_ON();
  // 커버(첫 장)는 로고를 얹지 않는다 — 2026-07-28 도메니코 지시.
  // 커버 이미지는 이미 매거진 표지 디자인(PAP 로고·타이틀)이 들어간 완성본이라
  // 하단 로고를 또 합성하면 표지 디자인을 가린다. 갤러리 컷에만 로고를 얹는다.
  const skipFirst = !!(opts && opts.skipBrandOnFirst);
  let logo = null;
  if (brand) {
    try { logo = await getTrimmedLogo(); }
    catch (e) { console.warn('[telegram] 로고 로드 실패 → 원본 전송으로 전환:', e && e.message); }
  }
  const buffers = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const noBrand = skipFirst && i === 0;
    try {
      const raw = await fetchImageBuffer(url);
      if (brand && logo && !noBrand) {
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

/* ── 파일(문서) 묶음 전송 (2026-09-14) ──
   사진(photo)으로 보내면 텔레그램이 다시 압축해 긴 변 1280px 로 줄인다 — 1080×1350 인스타 합성본이
   1024×1280 이 되어 그대로 올릴 수 없다. 문서(document)로 보내면 바이트가 그대로 간다(ZIP 과 동일).
   미디어 그룹은 문서끼리만 묶을 수 있다(10개까지). 캡션은 첫 묶음의 첫 항목에만. */
async function sendDocumentsToTelegram(files, caption, chatId) {
  const token = BOT_TOKEN();
  const chat = String(chatId || CHAT_ID() || '');
  if (!token || !chat) throw new Error('텔레그램 토큰/채팅 미설정');
  const list = (files || []).filter((f) => f && f.buffer && f.buffer.length);
  if (!list.length) throw new Error('보낼 파일이 없습니다');
  const groups = chunk(list, 10);
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const cap = gi === 0 ? caption : '';
    const form = new FormData();
    form.append('chat_id', chat);
    if (g.length === 1) {
      if (cap) form.append('caption', cap);
      form.append('document', new Blob([g[0].buffer], { type: g[0].mime || 'image/png' }), g[0].name || 'file.png');
      const r = await fetch('https://api.telegram.org/bot' + token + '/sendDocument', { method: 'POST', body: form });
      const j = await r.json().catch(() => ({}));
      if (!j || j.ok !== true) throw new Error('sendDocument: ' + ((j && j.description) || ('HTTP ' + r.status)));
      continue;
    }
    const media = g.map((f, i) => {
      const key = 'file' + i;
      form.append(key, new Blob([f.buffer], { type: f.mime || 'image/png' }), f.name || (key + '.png'));
      const m = { type: 'document', media: 'attach://' + key };
      if (i === 0 && cap) m.caption = cap;
      return m;
    });
    form.append('media', JSON.stringify(media));
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMediaGroup', { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    if (!j || j.ok !== true) throw new Error('sendMediaGroup(document): ' + ((j && j.description) || ('HTTP ' + r.status)));
  }
  return { sent: list.length, groups: groups.length };
}

function extFromUrl(u) {
  const m = String(u || '').split('?')[0].match(/\.(png|jpe?g|webp|gif)$/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}
function mimeFromExt(ext) {
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
}
function fileBase(title) {
  return String(title || 'cover').toLowerCase().replace(/[^a-z0-9가-힯 ]+/g, '').replace(/\s+/g, '-') || 'cover';
}

/**
 * 발행 에디토리얼 → 텔레그램. 관리자 "전체 ZIP 다운로드" 와 같은 내용물(2026-09-14 도메니코):
 *   ① 매거진 커버(cover_image 바이트 그대로 — 저장 시 합성된 표지 디자인, 로고 안 얹음) '<제목>-cover.<ext>'
 *   ② 갤러리 전부를 insta_logo_settings 로 인스타 합성(4:5 캔버스 + PAP 로고) 한 PNG '01.png' …
 *   ③ 인스타그램 캡션(instagram_caption) 원문을 별도 텍스트 메시지로 (있을 때만)
 * 이미지는 전부 문서(document)로 보내 바이트가 보존된다. ZIP 처럼 갤러리는 커버 원본 컷도 빼지 않는다.
 * TELEGRAM_BRAND_LOGO=off 면 로고만 안 얹고 프레이밍은 그대로.
 * @returns {Promise<{sent:number, groups?:number, skipped?:string}>}
 */
async function sendEditorialToTelegram(ed) {
  if (!isConfigured()) return { sent: 0, skipped: 'not_configured' };
  const { resolveInstaOpts, instaCompositeBuffer, getRawLogo } = require('./instaComposite');
  const files = [];
  const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());

  // ① 커버 — 바이트 그대로 (이미 표지 디자인이 들어간 완성본; 2026-07-28 "커버엔 로고 안 얹는다")
  const coverUrl = ed && isHttp(ed.cover_image) ? ed.cover_image.trim() : '';
  if (coverUrl) {
    try {
      const ext = extFromUrl(coverUrl);
      files.push({ buffer: await fetchImageBuffer(coverUrl), name: fileBase(ed.title) + '-cover.' + ext, mime: mimeFromExt(ext) });
    } catch (e) { console.warn('[telegram] 커버 스킵:', coverUrl, e && e.message); }
  }

  // ③→① 인스타그램 캡션 (2026-09-14 도메니코 "텔레그램으로 보낼 때 인스타그램 캡션도 같이") — **별도 텍스트 메시지**로
  //    캡션 원문만 보낸다. 미디어 캡션은 1,024자 제한이라 긴 캡션이 잘리고, 머리말을 붙이면 복사할 때 같이 딸려온다.
  //    2026-09-20 사고: 종전엔 파일 묶음 **뒤에** 보냈다. 16장 합성·업로드가 함수 상한(120초)을 넘기면서 캡션 차례가
  //    오지 않았다(도메니코 "크레딧이 오지 않음"). 가장 싸고 가장 중요한 것을 맨 먼저 보낸다 — 1초짜리 텍스트가
  //    100초짜리 이미지 뒤에서 기다릴 이유가 없다. 캡션이 비어 있으면 안 보낸다. 실패해도 이미지 전송은 계속.
  const igCaption = (ed && typeof ed.instagram_caption === 'string') ? ed.instagram_caption.trim() : '';
  let captionSent = false;
  if (igCaption) {
    const c = await sendTextToChatSafe(CHAT_ID(), igCaption);
    captionSent = !!(c && c.ok);
  }

  // ② 갤러리 — ZIP 과 같은 인스타 합성. 다운로드·합성을 3장씩 겹쳐 돌린다(순서는 보존).
  //    직렬로 16장이면 다운로드 대기가 그대로 쌓인다. sharp 는 자체 스레드를 쓰므로 3 이상은 이득이 작다.
  const gallery = (ed && Array.isArray(ed.gallery)) ? ed.gallery.filter(isHttp).map((u) => u.trim()) : [];
  let logo = null;
  if (BRAND_ON() && gallery.length) {
    try { logo = await getRawLogo(); }
    catch (e) { console.warn('[telegram] 로고 로드 실패 → 로고 없이 프레이밍만:', e && e.message); }
  }
  const t0 = Date.now();
  const made = await mapPool(gallery, 3, async (url, i) => {
    try {
      const raw = await fetchImageBuffer(url);
      const opts = resolveInstaOpts(ed.insta_logo_settings, url);
      if (!logo) opts.logoEnabled = false;
      let buf;
      try { buf = await instaCompositeBuffer(raw, logo, opts); }
      catch (e) { console.warn('[telegram] 합성 실패 → 원본 사용:', url, e && e.message); buf = raw; }
      return { buffer: buf, name: String(i + 1).padStart(2, '0') + '.png', mime: 'image/png' };
    } catch (e) {
      console.warn('[telegram] 이미지 스킵:', url, e && e.message);
      return null;
    }
  });
  made.forEach((f) => { if (f) files.push(f); });
  console.log('[telegram] 합성 완료:', files.length + '파일', (Date.now() - t0) + 'ms');
  if (!files.length) return { sent: 0, captionSent, skipped: (coverUrl || gallery.length) ? 'no_usable_images' : 'no_images' };

  const r = await sendDocumentsToTelegram(files, buildCaption(ed));
  r.captionSent = captionSent;
  console.log('[telegram] 업로드 완료:', r.sent + '파일', r.groups + '묶음', (Date.now() - t0) + 'ms');
  return r;
}

/* 순서를 보존하는 병렬 map. 동시에 limit 개까지만 돈다. fn 이 던지면 그 자리는 undefined 가 아니라 예외가 난다 —
   호출부가 fn 안에서 잡는다(위 갤러리 루프처럼). */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit || 1, items.length || 1));
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: n }, worker));
  return out;
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


// ── 운영 텍스트 알림 (서브미션 반려 피드백 알림 등) ──
// 실패해도 호출부(리뷰 저장 등)를 절대 막지 않는다.
async function sendTextToTelegramSafe(text) {
  try {
    if (!isConfigured() || !text) return { ok: false, skipped: 'not_configured_or_empty' };
    const r = await fetch('https://api.telegram.org/bot' + BOT_TOKEN() + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID(), text: String(text).slice(0, 4000), disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j || j.ok !== true) throw new Error((j && j.description) || ('HTTP ' + r.status));
    return { ok: true };
  } catch (e) {
    console.warn('[telegram] 텍스트 전송 실패 (호출부에는 영향 없음):', e && e.message);
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ── 개인방 텍스트 알림 (2026-07-23, 도메니코 지시) ──
// 크론 실패 같은 운영자 개인 대상 알림용. TELEGRAM_PERSONAL_CHAT_ID 가
// 설정돼 있어야 하며(그룹 CHAT_ID 로 폴백하지 않는다 — "그룹방 말고
// 개인방" 지시), 미설정이면 skipped 를 반환해 호출부가 이메일 등으로
// 폴백할 수 있게 한다.
async function sendTextToTelegramPersonalSafe(text) {
  try {
    const personal = process.env.TELEGRAM_PERSONAL_CHAT_ID || '';
    if (!BOT_TOKEN() || !personal || !text) return { ok: false, skipped: 'no_personal_chat_id' };
    const r = await fetch('https://api.telegram.org/bot' + BOT_TOKEN() + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: personal, text: String(text).slice(0, 4000), disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j || j.ok !== true) throw new Error((j && j.description) || ('HTTP ' + r.status));
    return { ok: true };
  } catch (e) {
    console.warn('[telegram] 개인방 전송 실패:', e && e.message);
    return { ok: false, error: String((e && e.message) || e) };
  }
}


/* ── 임의 채팅으로 사진 여러 장 보내기 (2026-08-23, 셀럽 속보 브리프) ──
   sendGroup 은 TELEGRAM_CHAT_ID 로 고정돼 있다. 브리프는 **링크를 보낸 채팅**
   으로 돌려줘야 해서 chat 을 인자로 받는다.
   텔레그램 미디어 그룹 상한은 10장 — 넘으면 나눠 보내고, 캡션은 첫 묶음에만 단다. */
async function sendPhotosToTelegram(buffers, caption, chatId) {
  const token = BOT_TOKEN();
  const chat = String(chatId || CHAT_ID() || '');
  if (!token || !chat) throw new Error('텔레그램 토큰/채팅 미설정');
  const list = (buffers || []).filter(Boolean);
  if (!list.length) throw new Error('보낼 이미지가 없습니다');

  const groups = chunk(list, 10);
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const cap = gi === 0 ? caption : '';
    const form = new FormData();
    form.append('chat_id', chat);
    if (g.length === 1) {
      if (cap) form.append('caption', cap);
      form.append('photo', new Blob([g[0]], { type: 'image/jpeg' }), 'photo.jpg');
      const r = await fetch('https://api.telegram.org/bot' + token + '/sendPhoto', { method: 'POST', body: form });
      const j = await r.json().catch(() => ({}));
      if (!j || j.ok !== true) throw new Error('sendPhoto: ' + ((j && j.description) || ('HTTP ' + r.status)));
      continue;
    }
    const media = g.map((buf, i) => {
      const name = 'file' + i;
      form.append(name, new Blob([buf], { type: 'image/jpeg' }), name + '.jpg');
      const m = { type: 'photo', media: 'attach://' + name };
      if (i === 0 && cap) m.caption = cap;
      return m;
    });
    form.append('media', JSON.stringify(media));
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMediaGroup', { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    if (!j || j.ok !== true) throw new Error('sendMediaGroup: ' + ((j && j.description) || ('HTTP ' + r.status)));
  }
  return { sent: list.length, groups: groups.length };
}

/* 임의 채팅으로 텍스트. 실패해도 호출부를 막지 않는다. */
async function sendTextToChatSafe(chatId, text) {
  try {
    const chat = String(chatId || CHAT_ID() || '');
    if (!BOT_TOKEN() || !chat || !text) return { ok: false, skipped: 'not_configured_or_empty' };
    const r = await fetch('https://api.telegram.org/bot' + BOT_TOKEN() + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: String(text).slice(0, 4000), disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j || j.ok !== true) throw new Error((j && j.description) || ('HTTP ' + r.status));
    return { ok: true };
  } catch (e) {
    console.warn('[telegram] 채팅 전송 실패:', e && e.message);
    return { ok: false, error: String((e && e.message) || e) };
  }
}


/* ── 사진·영상 섞어 보내기 (2026-08-23, 셀럽 속보 릴스 대응) ──
   items: [{ kind:'photo'|'video', buffer, thumb? }]  — thumb 는 영상 미리보기 커버(JPEG)
   텔레그램 미디어 그룹은 사진과 영상을 **한 묶음에 섞을 수 있다**(10개까지).
   캡션은 첫 묶음의 첫 항목에만 단다. */
async function sendMediaToTelegram(items, caption, chatId) {
  const token = BOT_TOKEN();
  const chat = String(chatId || CHAT_ID() || '');
  if (!token || !chat) throw new Error('텔레그램 토큰/채팅 미설정');
  const list = (items || []).filter((x) => x && x.buffer && x.buffer.length);
  if (!list.length) throw new Error('보낼 미디어가 없습니다');

  const groups = chunk(list, 10);
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const cap = gi === 0 ? caption : '';
    const form = new FormData();
    form.append('chat_id', chat);

    if (g.length === 1) {
      const one = g[0];
      const isVid = one.kind === 'video';
      if (cap) form.append('caption', cap);
      form.append(isVid ? 'video' : 'photo',
        new Blob([one.buffer], { type: isVid ? 'video/mp4' : 'image/jpeg' }),
        isVid ? 'clip.mp4' : 'photo.jpg');
      /* 영상 미리보기에 PAP 디자인 커버를 얹는다 (2026-08-23 도메니코:
         "영상 위에 섬네일을 올려주면 돼"). 텔레그램은 thumbnail 을 JPEG 로만
         받고 320px 이하를 권장한다 — 호출부가 줄여서 넘긴다. */
      if (isVid && one.thumb && one.thumb.length) {
        form.append('thumbnail', new Blob([one.thumb], { type: 'image/jpeg' }), 'cover.jpg');
      }
      const r = await fetch('https://api.telegram.org/bot' + token + (isVid ? '/sendVideo' : '/sendPhoto'),
        { method: 'POST', body: form });
      const j = await r.json().catch(() => ({}));
      if (!j || j.ok !== true) throw new Error((isVid ? 'sendVideo: ' : 'sendPhoto: ') + ((j && j.description) || ('HTTP ' + r.status)));
      continue;
    }

    const media = g.map((it, i) => {
      const isVid = it.kind === 'video';
      const name = 'file' + i;
      form.append(name, new Blob([it.buffer], { type: isVid ? 'video/mp4' : 'image/jpeg' }),
        name + (isVid ? '.mp4' : '.jpg'));
      const m = { type: isVid ? 'video' : 'photo', media: 'attach://' + name };
      if (isVid && it.thumb && it.thumb.length) {
        const tn = 'thumb' + i;
        form.append(tn, new Blob([it.thumb], { type: 'image/jpeg' }), tn + '.jpg');
        m.thumbnail = 'attach://' + tn;
      }
      if (i === 0 && cap) m.caption = cap;
      return m;
    });
    form.append('media', JSON.stringify(media));
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMediaGroup', { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    if (!j || j.ok !== true) throw new Error('sendMediaGroup: ' + ((j && j.description) || ('HTTP ' + r.status)));
  }
  return { sent: list.length, groups: groups.length };
}

module.exports = {
  sendEditorialToTelegram,
  sendDocumentsToTelegram,
  sendPhotosToTelegram,
  sendMediaToTelegram,
  sendTextToChatSafe,
  sendEditorialToTelegramSafe,
  collectImageUrls,
  isConfigured,
  sendTextToTelegramSafe,
  sendTextToTelegramPersonalSafe,
  mapPool,
};
