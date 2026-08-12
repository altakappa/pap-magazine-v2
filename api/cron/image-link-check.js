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
/* 신원을 밝힌다. 익명 요청은 Wix 등에서 핫링크 차단(403)에 걸린다 —
   브라우저인 척하지는 않는다. 우리 이미지를 우리가 점검하는 것뿐이다. */
const UA = 'PAPMagazineImageCheck/1.0 (+https://www.pap-magazine.com)';

/* 이 검사기가 스스로 만들어내던 거짓 timeout (2026-08-09 실측)
 *
 * 「깨진 대표 이미지 19건」 경보의 6건이 **우리 Supabase 파일**이었다.
 * storage.objects 로 확인하니 6건 전부 존재하고 크기는 0.1~1.1MB — 느릴 이유가 없다.
 *
 * 원인: 아래 두 return 경로(HTTP 오류 · html 판정)가 **응답 본문을 소비하지도
 * 취소하지도 않고 빠져나갔다.** undici 는 본문이 소비되기 전까지 연결을 풀에
 * 반납하지 않는다. 동시 20 으로 4,600개를 훑는데 Wix 403 · 드라이브 500 이
 * 쌓일수록 연결이 고갈되고, 뒤에 줄 선 요청이 대기하다 8초를 넘긴다.
 * 그래서 **가장 빠른 자사 파일이 timeout 으로 찍혔다.**
 *
 * 고침: finally 에서 무조건 본문을 취소한다. 성공·실패 경로 구분 없이. */
async function probe(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let r = null;
  try {
    // HEAD 는 드라이브 등에서 미지원/불일치가 있어 GET + Range 로 헤더만 받는다.
    r = await fetch(url, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { Range: 'bytes=0-0', 'User-Agent': UA },
    });
    if (!(r.ok || r.status === 206)) return 'HTTP ' + r.status;
    const ct = r.headers.get('content-type') || '';
    // 드라이브는 죽은 파일에 200 + text/html 오류 페이지를 주기도 한다.
    if (/text\/html/i.test(ct)) return 'html-instead-of-image';
    return null; // 정상
  } catch (e) {
    if (e && e.name === 'AbortError') return 'timeout';
    return (e && e.message ? e.message : 'fetch error').slice(0, 80);
  } finally {
    /* ★ 핵심 — 본문을 반드시 버린다. 이걸 빠뜨린 것이 위 사고의 원인이다. */
    if (r && r.body) { try { await r.body.cancel(); } catch (_) {} }
    clearTimeout(to);
  }
}

/* timeout 은 '깨졌다'의 증거가 아니다 — 이쪽 사정일 수도 있다.
   확정 실패(404 · html)만 실패로 세고, 나머지는 '보류'로 따로 보고한다.
   실측: timeout 24건이 전부 자사 파일이었다. */
function isDefiniteFailure(reason) {
  return reason === 'html-instead-of-image'
    || reason === 'HTTP 404'
    || reason === 'HTTP 410';
}

function hostOf(url) {
  try { return new URL(url).host; } catch (_) { return '(알 수 없음)'; }
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

  /* ★ 확정 실패만 기록한다 (2026-08-09).
   * 이 표에 오른 URL 은 이관 크론이 **영구히 건너뛴다.** 그런데 여태 timeout 까지
   * 싸잡아 넣어서, 멀쩡한 자사 파일 24건이 '실패'로 등재돼 있었다(실측).
   * 판정이 모호한 것을 영구 명단에 올리면 되돌릴 사람이 없다. */
  const definite = broken.filter(b => isDefiniteFailure(b.reason));
  if (definite.length > 0) {
    await supabaseAdmin.from('image_migration_failures')
      .upsert(definite.map(b => ({ url: b.url, reason: 'link-check: ' + b.reason })), { onConflict: 'url' })
      .then(() => {}, e => console.error('[image-link-check] failure log', e && e.message));
  }

  /* 알림 문안 (2026-08-09 개편)
   * 옛 문안은 전부 '깨짐'으로 묶고 "관리자에서 재등록 필요"라고 지시했다.
   * 둘 다 틀렸다 — timeout 은 깨진 게 아니었고, 403 의 해법은 재등록이 아니라
   * 이관이다. 원인별로 나누고 각각 맞는 행동을 적는다. */
  const suspect = broken.filter(b => !isDefiniteFailure(b.reason));
  const byHost = new Map();
  for (const b of broken) {
    const h = hostOf(b.url);
    if (!byHost.has(h)) byHost.set(h, { n: 0, reasons: new Set() });
    byHost.get(h).n++; byHost.get(h).reasons.add(b.reason);
  }
  const hostLines = Array.from(byHost.entries())
    .sort((a, b) => b[1].n - a[1].n)
    .map(([h, v]) => '· ' + h + ' — ' + v.n + '건 (' + Array.from(v.reasons).join(', ') + ')');

  const summary = broken.length === 0
    ? '🖼 주간 이미지 점검 — 대표 이미지 ' + checked + '건 전부 정상' + (timedOut ? ' (예산 내 부분 점검)' : '')
    : (definite.length > 0 ? '🚨' : '⚠️') + ' 주간 이미지 점검 — 확정 ' + definite.length +
      '건 · 판정보류 ' + suspect.length + '건 / ' + checked + '건 점검' + (timedOut ? ' (부분)' : '') + '\n' +
      hostLines.join('\n') + '\n' +
      (definite.length > 0
        ? '\n확정 ' + definite.length + '건 (파일이 실제로 없음 — 관리자에서 재등록):\n' +
          definite.slice(0, 8).map(b => '· ' + b.where.join(', ') + ' — ' + b.reason).join('\n') +
          (definite.length > 8 ? '\n…외 ' + (definite.length - 8) + '건' : '') + '\n'
        : '') +
      '\n※ timeout·403 은 깨짐 확정이 아니다. 403 은 외부 호스트의 핫링크 차단이고,' +
      ' 해법은 재등록이 아니라 Supabase 이관(migrate-external-images)이다.';
  await sendTextToTelegramSafe(summary).catch(() => {});

  console.log('[image-link-check]', { checked, broken: broken.length, timedOut, ms: Date.now() - started });
  return res.status(200).json({ ok: true, checked, broken: broken.length, timedOut });
});
