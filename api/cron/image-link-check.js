/**
 * PAP Magazine — 대표 이미지 링크 점검 크론 (2026-07-22 신설, 도메니코 승인)
 * Route: /api/cron/image-link-check   (vercel.json: 주 1회 월요일 아침 KST)
 *
 * 왜: CREATURES 사고 — 드라이브 원본이 사라져 카드가 빈 배경으로 노출됐지만
 * 아무도 몰랐다(사용자 QA 로 발견). 외부 호스트(드라이브·구 S3) 의존 이미지가
 * 1,900+ 건이라, 깨짐을 사람이 아니라 크론이 먼저 발견해야 한다.
 *
 * 동작: published 에디토리얼의 cover_image·thumbnail 전 URL 을 GET(Range 0-0,
 * 바디 미수신)으로 점검. 동시 20 · 시간 예산 90s. 깨진 건 텔레그램 알림 +
 * image_migration_failures 에 기록(이관 크론이 재시도하지 않도록).
 * 이관 크론이 완주하면 대부분 Supabase URL 이 되어 점검이 사실상 자가 검진이 된다.
 */
'use strict';
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

const CONCURRENCY = 20;
const FETCH_TIMEOUT_MS = 8000;
const TIME_BUDGET_MS = 90000;

async function probe(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // HEAD 는 드라이브 등에서 미지원/불일치가 있어 GET + Range 로 헤더만 받는다.
    const r = await fetch(url, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { Range: 'bytes=0-0' },
    });
    if (!(r.ok || r.status === 206)) return 'HTTP ' + r.status;
    const ct = r.headers.get('content-type') || '';
    // 드라이브는 죽은 파일에 200 + text/html 오류 페이지를 주기도 한다.
    if (/text\/html/i.test(ct)) return 'html-instead-of-image';
    try { ctrl.abort(); } catch (_) {}
    return null; // 정상
  } catch (e) {
    if (e && e.name === 'AbortError') return 'timeout';
    return (e && e.message ? e.message : 'fetch error').slice(0, 80);
  } finally {
    clearTimeout(to);
  }
}

module.exports = withCronGuard('image-link-check', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const started = Date.now();

  // 대표 이미지만 (카드·목록·SNS 미리보기가 읽는 필드). 갤러리 전수는
  // 이관 완주 후 필요 시 확장.
  const { data: rows, error } = await supabaseAdmin
    .from('editorials')
    .select('id, slug, cover_image, thumbnail')
    .eq('status', 'published');
  if (error) throw new Error('select failed: ' + error.message);

  // URL → 사용처 매핑 (중복 URL 은 한 번만 점검)
  const usage = new Map();
  for (const r of rows || []) {
    for (const [field, url] of [['cover', r.cover_image], ['thumb', r.thumbnail]]) {
      if (!url || !/^https?:\/\//.test(url)) continue;
      if (!usage.has(url)) usage.set(url, []);
      usage.get(url).push(r.slug + ':' + field);
    }
  }

  const urls = Array.from(usage.keys());
  const broken = [];
  let checked = 0;
  let cursor = 0;
  let timedOut = false;

  async function worker() {
    while (cursor < urls.length) {
      if (Date.now() - started > TIME_BUDGET_MS) { timedOut = true; return; }
      const url = urls[cursor++];
      const reason = await probe(url);
      checked++;
      if (reason) broken.push({ url, reason, where: usage.get(url) });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (broken.length > 0) {
    // 이관 크론이 죽은 링크를 건너뛰도록 실패 테이블에도 기록
    await supabaseAdmin.from('image_migration_failures')
      .upsert(broken.map(b => ({ url: b.url, reason: 'link-check: ' + b.reason })), { onConflict: 'url' })
      .then(() => {}, e => console.error('[image-link-check] failure log', e && e.message));
  }

  const summary = broken.length === 0
    ? '🖼 주간 이미지 점검 — 대표 이미지 ' + checked + '건 전부 정상' + (timedOut ? ' (예산 내 부분 점검)' : '')
    : '🚨 주간 이미지 점검 — 깨진 대표 이미지 ' + broken.length + '건 / ' + checked + '건 점검' +
      (timedOut ? ' (부분)' : '') + '\n' +
      broken.slice(0, 12).map(b => '· ' + b.where.join(', ') + ' — ' + b.reason).join('\n') +
      (broken.length > 12 ? '\n…외 ' + (broken.length - 12) + '건' : '') +
      '\n관리자에서 해당 에디토리얼 이미지 재등록 필요';
  sendTextToTelegramSafe(summary).catch(() => {});

  console.log('[image-link-check]', { checked, broken: broken.length, timedOut, ms: Date.now() - started });
  return res.status(200).json({ ok: true, checked, broken: broken.length, timedOut });
});
