'use strict';
/**
 * 공동작업자 지정 → 텔레그램 (도메니코 2026-09-24):
 *   "공동작업자 지정시 반드시 텔레그램으로 인스타그램용 이미지와 크레딧과 함께 나에게 알려줘."
 *
 * 세 덩어리로 보낸다. 싸고 중요한 것부터.
 *   ① 알림 머리말(collaborators.collaboratorAlertText) — 제출·재제출 API 가 그 자리에서 보낸다.
 *   ② 인스타그램 크레딧(collabCreditText) — 복사해서 바로 쓰도록 **별도 메시지**. 역시 API 가 그 자리에서.
 *   ③ 인스타그램용 이미지(sendCollabImages) — 4:5 캔버스 + PAP 로고 합성 PNG, 문서로(바이트 보존).
 *      합성은 장당 수 초라 제출 요청(120초 상한) 안에서 돌리지 않는다. 워커
 *      api/submissions/collab-telegram.js 를 깨운다(dispatchCollabImages, 발행 텔레그램 9/20 사고와 같은 구조).
 *
 * ②③ 은 운영자 대면이라 한국어 고정(.claude/rules/frontend.md 언어 정책).
 */
const { mergeCreditLines } = require('./igCaption');
const { normalizeRole } = require('./creditRoles');

const IG_MAX_IMAGES = 20;   // 인스타그램 캐러셀 상한
const COLLAB_WORKER_URL = () => (process.env.TELEGRAM_COLLAB_WORKER_URL || 'https://www.pap-magazine.com/api/submissions/collab-telegram');
const WAKE_TIMEOUT_MS = 9000;

function _h(s) {
  let h = String(s == null ? '' : s).trim();
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '');
  if (!h) return '';
  return h.charAt(0) === '@' ? h : '@' + h;
}
function _role(r) {
  const s = String(r || '').trim();
  if (!s) return 'Credit';
  return normalizeRole(s) || s;
}

/** 서브미션 description → { creditLines, starring, brandHandles } (review.js 의 캡션 부품과 같은 규칙). */
function collabCreditParts(desc) {
  const d = desc || {};
  const entries = [];
  if (Array.isArray(d.team) && d.team.length) {
    d.team.forEach((m) => {
      if (!m || !m.name) return;
      const handle = _h(m.instagram || '');
      if (!handle) return;
      const roles = Array.isArray(m.role) ? m.role : (m.role ? [m.role] : []);
      entries.push({ roles: roles.length ? roles.map(_role) : ['Credit'], handle });
    });
  }
  const creditLines = mergeCreditLines(entries);
  const starring = [];
  (Array.isArray(d.models) ? d.models : []).forEach((m) => {
    if (!m || !m.name) return;
    const model = _h(m.instagram || '');
    const agency = _h(m.agencyInstagram || '');
    if (model) starring.push(model);
    if (agency) starring.push(agency);
  });
  const seen = new Set();
  const brandHandles = [];
  (Array.isArray(d.looks) ? d.looks : []).forEach((L) => {
    ((L && L.items) || []).forEach((it) => {
      const h = _h((it && it.instagram) || '');
      if (!h) return;
      const k = h.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      brandHandles.push(h);
    });
  });
  return { creditLines, starring, brandHandles };
}

/** ② 인스타그램 크레딧 — 이 메시지 전체를 그대로 복사해 쓸 수 있게 머리말 없이 크레딧만. */
function collabCreditText(sub, desc, collaborators) {
  const title = String((sub && sub.title) || '').trim() || 'Untitled';
  const { creditLines, starring, brandHandles } = collabCreditParts(desc);
  const hs = (collaborators || []).map((c) => _h((c && typeof c === 'object') ? c.handle : c)).filter(Boolean);
  const lines = [];
  lines.push(`'${title}' exclusive for @pap_magazine`);
  lines.push('');
  creditLines.forEach((l) => lines.push(l));
  if (starring.length) lines.push('Starring ' + starring.join(' '));
  if (brandHandles.length) { lines.push(''); lines.push('Fashion by ' + brandHandles.join(' ')); }
  if (hs.length) { lines.push(''); lines.push('Collaborators ' + hs.join(' ')); }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** ③ 인스타그램용 이미지 순서 — 제출자가 고른 커버가 첫 장, 나머지는 제출 순서. 최대 20장. */
function collabImageUrls(sub, desc) {
  const urls = (Array.isArray(sub && sub.file_urls) ? sub.file_urls : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim())).map((u) => u.trim());
  if (!urls.length) return [];
  const ci = Number(desc && desc.coverImageIndex);
  const cover = (Number.isInteger(ci) && ci >= 0 && ci < urls.length) ? urls[ci] : urls[0];
  const out = [cover];
  urls.forEach((u) => { if (u !== cover && out.indexOf(u) === -1) out.push(u); });
  return out.slice(0, IG_MAX_IMAGES);
}

/** ③ 실제 전송 (워커에서만 부른다). 반환 { sent, groups } 또는 { sent:0, skipped }. */
async function sendCollabImages(sub, desc, opts) {
  const tg = require('./telegram');
  if (tg.inTestRun && tg.inTestRun()) return { sent: 0, skipped: 'test_run' };
  const urls = collabImageUrls(sub, desc);
  if (!urls.length) return { sent: 0, skipped: 'no_images' };
  const { resolveInstaOpts, instaCompositeBuffer, getRawLogo } = require('./instaComposite');
  let logo = null;
  try { logo = await getRawLogo(); } catch (e) { console.warn('[collab-tg] 로고 로드 실패 → 로고 없이 프레이밍만:', e && e.message); }
  const made = await tg.mapPool(urls, 3, async (url, i) => {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const raw = Buffer.from(await r.arrayBuffer());
      const o = resolveInstaOpts(null, url);
      if (!logo) o.logoEnabled = false;
      let buf;
      try { buf = await instaCompositeBuffer(raw, logo, o); } catch (e) { console.warn('[collab-tg] 합성 실패 → 원본:', url, e && e.message); buf = raw; }
      return { buffer: buf, name: String(i + 1).padStart(2, '0') + (i === 0 ? '-cover' : '') + '.png', mime: 'image/png' };
    } catch (e) {
      console.warn('[collab-tg] 이미지 스킵:', url, e && e.message);
      return null;
    }
  });
  const files = made.filter(Boolean);
  if (!files.length) return { sent: 0, skipped: 'no_usable_images' };
  const hs = ((desc && desc.collaborators) || []).map((c) => '@' + String((c && c.handle) || c || '').replace(/^@/, '')).filter((h) => h !== '@');
  const kindLabel = (opts && opts.kind === 'resubmit') ? '수정' : '신규';
  const caption = '🤝 공동작업자 지정 (' + kindLabel + ') · 인스타그램용 이미지 ' + files.length + '장\n'
    + "'" + String((sub && sub.title) || '').slice(0, 80) + "'\n"
    + (hs.length ? hs.join(' ') + '\n' : '')
    + 'submission=' + ((sub && sub.id) || '');
  return tg.sendDocumentsToTelegram(files, caption);
}

function _waitUntil() {
  try { const fns = require('@vercel/functions'); return typeof fns.waitUntil === 'function' ? fns.waitUntil : null; }
  catch (_e) { return null; }
}

/**
 * ③ 워커 깨우기 — 제출·재제출 응답을 막지 않는다.
 *   waitUntil 있으면 등록만 하고 즉시 반환 / 없으면 최대 9초 기다림(워커는 계속 돈다).
 *   CRON_SECRET 이 없으면 이미지는 건너뛴다(①② 텍스트는 이미 갔다) — 요청 안에서 합성하면 504 가 난다.
 */
async function dispatchCollabImages(subId, kind) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!subId) return { dispatched: 'skip' };
  if (!secret) { console.warn('[collab-tg] CRON_SECRET 미설정 — 인스타그램용 이미지 전송 생략'); return { dispatched: 'no_secret' }; }
  const url = COLLAB_WORKER_URL() + '?id=' + encodeURIComponent(subId) + (kind === 'resubmit' ? '&kind=resubmit' : '');
  const call = (signal) => fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + secret }, signal });
  const waitUntil = _waitUntil();
  if (waitUntil) {
    waitUntil(call(undefined).then(
      (r) => { if (!r.ok) console.warn('[collab-tg] 워커 응답', r.status); },
      (e) => console.warn('[collab-tg] 워커 깨우기 실패:', (e && e.message) || e),
    ));
    return { dispatched: 'waitUntil' };
  }
  try {
    const r = await call(AbortSignal.timeout(WAKE_TIMEOUT_MS));
    if (!r.ok) throw new Error('worker HTTP ' + r.status);
    return { dispatched: 'await' };
  } catch (e) {
    const name = e && e.name;
    if (name === 'TimeoutError' || name === 'AbortError') return { dispatched: 'await-timeout' };
    console.warn('[collab-tg] 워커 깨우기 실패:', (e && e.message) || e);
    return { dispatched: 'failed' };
  }
}

/** 재제출에서 공동작업자 목록이 바뀌었나 (순서 무시, 대소문자 무시). */
function collaboratorsChanged(prev, next) {
  const norm = (list) => (Array.isArray(list) ? list : [])
    .map((c) => String((c && typeof c === 'object') ? c.handle : c || '').replace(/^@/, '').toLowerCase())
    .filter(Boolean).sort().join(',');
  return norm(prev) !== norm(next);
}

module.exports = {
  IG_MAX_IMAGES,
  collabCreditParts,
  collabCreditText,
  collabImageUrls,
  sendCollabImages,
  dispatchCollabImages,
  collaboratorsChanged,
};
