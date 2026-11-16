/**
 * GET /api/cron/mediakit-link-watch — 미디어킷 링크가 살아 있는지 매일 본다
 *
 * ■ 왜 (같은 사고가 세 번째다)
 * 미디어킷은 구글 드라이브 파일을 링크로 걸어 둔다. 드라이브는 파일을 **교체하면
 * ID 가 바뀐다** — 도메니코가 새 키트를 올리고 옛 파일을 휴지통에 넣으면, 사이트는
 * 휴지통 파일을 계속 가리킨다.
 *   · 2026-07-29 — KO·EN 둘 다 휴지통. "파일이 소유자의 휴지통에 있습니다".
 *   · 2026-11-16 — 또 KO·EN 둘 다 휴지통(8/24·7/29 파일). 3개월 가까이 그 상태.
 * 소유자는 로그인 상태에서 휴지통 파일도 열리니 "옛 키트가 뜬다" 로만 보인다.
 * 광고주에게는 오류 화면이 뜬다. 이건 광고 퍼널에서 사람이 돈을 쓸지 판단하는
 * 지점이고, 조용히 죽으면 아무도 모른 채 몇 달이 지난다. 실제로 그랬다.
 *
 * 7/29 에는 "링크가 또 바뀌면 두 곳을 함께 고칠 것" 이라는 주석을 남겼다. 주석은
 * 재발을 막지 못했다. 사람 주의력으로 막을 일이 아니라서 점검으로 바꾼다.
 *
 * ■ 무엇을 보나
 * 설정(site_settings.business_page)의 KO·EN 링크와 코드 폴백(api/mediakit.js
 * DEFAULT_LINKS), 그리고 공개 정적 PDF(/media-kit/*.pdf) 를 전부 열어 본다.
 * 드라이브는 휴지통·삭제·권한 변경을 전부 "그 파일을 볼 수 없다" 로 돌려주므로,
 * 로그인 없이 받아지는지만 보면 광고주가 보는 것과 같은 판정이 된다.
 *
 * 판정 (로그인 없이 GET)
 *   · HTTP 200 + PDF/뷰어 응답 → 살아 있다
 *   · 404·403·410 → 죽었다 (휴지통·삭제·권한)
 *   · 200 인데 본문에 휴지통/권한 안내 문구 → 죽었다
 *     (드라이브 뷰어는 오류도 200 으로 돌려주므로 상태 코드만 보면 못 잡는다)
 *   · 네트워크 실패·타임아웃 → 판정 보류. 한 번의 실패로 경보를 울리지 않는다.
 *
 * ■ 조용히 끝나지 않는다
 * 죽은 링크가 하나라도 있으면 텔레그램. 전부 멀쩡하면 cronNote 에만 적고 알리지
 * 않는다(매일 오는 '정상' 알림은 곧 안 읽게 되고, 그러면 진짜 고장도 묻힌다).
 *
 * 돈·삭제를 건드리지 않으므로 CRON_SECRET 없이도 돌지만, 외부 호출이 있어
 * 레이트리밋 대신 예약 호출만 허용한다.
 */
'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { withCronGuard } = require('../_lib/cronGuard');
const { safeEqual } = require('../_lib/secretCompare');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
const FETCH_TIMEOUT_MS = 12000;

/* 드라이브 뷰어가 오류를 200 으로 돌려줄 때 본문에 나오는 문구들.
   한국어·영어 둘 다 — 서버 로케일에 따라 달라진다. */
const DEAD_MARKERS = [
  '소유자의 휴지통',
  'in the owner',               // "is in the owner's trash"
  'moved to the trash',
  '파일을 찾을 수 없',
  'File not found',
  'Sorry, unable to open the file',
  '권한이 필요',
  'Request access',
  'You need access',
];

function isDriveLink(u) {
  try { return /(^|\.)drive\.google\.com$/.test(new URL(u).hostname); } catch (_) { return false; }
}

/** 로그인 없이 열어 본다. { ok, reason, status } — ok=null 은 판정 보류. */
async function probe(url) {
  if (!url) return { ok: false, reason: 'empty', status: 0 };
  let ctrl, timer;
  try {
    ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    const status = r.status;
    if (status === 404 || status === 403 || status === 410) {
      return { ok: false, reason: 'http_' + status, status };
    }
    if (status >= 500) return { ok: null, reason: 'http_' + status, status };   // 저쪽 장애 — 보류
    if (status !== 200) return { ok: null, reason: 'http_' + status, status };
    /* 드라이브 뷰어는 오류도 200 + HTML 로 준다. PDF 바이트면 그대로 통과. */
    const ct = String(r.headers.get('content-type') || '');
    if (/application\/pdf/i.test(ct)) return { ok: true, reason: 'pdf', status };
    const head = (await r.text()).slice(0, 60000);
    const hit = DEAD_MARKERS.find((m) => head.indexOf(m) !== -1);
    if (hit) return { ok: false, reason: 'marker:' + hit.slice(0, 24), status };
    return { ok: true, reason: 'html', status };
  } catch (e) {
    return { ok: null, reason: 'fetch_failed:' + String((e && e.message) || e).slice(0, 60), status: 0 };
  } finally { if (timer) clearTimeout(timer); }
}

function bearerOk(auth, secret) {
  const got = String(auth || '').replace(/^Bearer\s+/i, '').trim();
  return !!(secret && got && safeEqual(got, String(secret)));
}

module.exports = withCronGuard('mediakit-link-watch', async function handler(req, res) {
  if (handleCors(req, res)) return;
  res.locals = res.locals || {};   // ★ 공책을 먼저 만든다 (2026-08-13 사고, cron-contract)
  function note(msg) { res.locals = res.locals || {}; res.locals.cronNote = msg; return msg; }

  if (!bearerOk(req.headers && req.headers.authorization, process.env.CRON_SECRET)) {
    note('예약 호출 아님 — 거부');
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const targets = [];

  /* ① 관리자 설정 — 실제로 쓰이는 값 */
  try {
    const { data } = await supabaseAdmin.from('site_settings')
      .select('value').eq('key', 'business_page').maybeSingle();
    const v = (data && data.value) || {};
    const val = typeof v === 'string' ? JSON.parse(v) : v;
    targets.push({ what: '설정 KO', url: val.mediakit_link_ko || '' });
    targets.push({ what: '설정 EN', url: val.mediakit_link_en || '' });
  } catch (e) {
    targets.push({ what: '설정', url: '', err: String((e && e.message) || e).slice(0, 80) });
  }

  /* ② 코드 폴백 — 설정 조회가 실패하면 이쪽이 쓰인다. 같이 썩는다. */
  try {
    const mk = require('../mediakit.js');
    const fb = (mk && mk.DEFAULT_LINKS) || null;
    if (fb) {
      targets.push({ what: '폴백 KO', url: fb.ko || '' });
      targets.push({ what: '폴백 EN', url: fb.en || '' });
    }
  } catch (_) { /* 폴백을 못 읽는 건 이 점검의 실패가 아니다 */ }

  /* ③ 공개 정적 PDF — AI 검색이 읽는 파일 */
  targets.push({ what: '공개 PDF KO', url: SITE + '/media-kit/PAP-Magazine-Media-Kit-2026-KO.pdf' });

  const seen = new Set();
  const results = [];
  for (const t of targets) {
    if (!t.url) { results.push(Object.assign({ ok: false, reason: 'empty' }, t)); continue; }
    if (seen.has(t.url)) continue;          // 설정과 폴백이 같으면 한 번만 본다
    seen.add(t.url);
    const r = await probe(t.url);
    results.push(Object.assign({}, t, r, { drive: isDriveLink(t.url) }));
  }

  const dead = results.filter((r) => r.ok === false);
  const unknown = results.filter((r) => r.ok === null);
  const live = results.filter((r) => r.ok === true);

  if (dead.length) {
    const lines = dead.map((d) => '· ' + d.what + ' — ' + d.reason + '\n  ' + String(d.url).slice(0, 120));
    await sendTextToTelegramSafe(
      '🚨 미디어킷 링크가 죽었다 (' + dead.length + '건)\n'
      + lines.join('\n')
      + '\n\n드라이브는 파일을 교체하면 ID 가 바뀐다. 새 파일 링크로 바꿔야 할 곳:\n'
      + '· 어드민 → 비즈니스 페이지 (미디어킷 링크 KO·EN)\n'
      + '· api/mediakit.js DEFAULT_LINKS (폴백)\n'
      + '광고주가 누르는 경로다 — 소유자 본인은 로그인 상태라 휴지통 파일도 그냥 열려서 멀쩡해 보인다.'
    );
  }

  note((dead.length ? '죽음 ' + dead.length + '건: ' + dead.map((d) => d.what).join(',') + ' · ' : '')
    + '정상 ' + live.length + '건'
    + (unknown.length ? ' · 보류 ' + unknown.length + '건(' + unknown.map((u) => u.what).join(',') + ')' : ''));

  return res.status(200).json({
    checked: results.length,
    dead: dead.map((d) => ({ what: d.what, reason: d.reason, url: d.url })),
    unknown: unknown.map((u) => ({ what: u.what, reason: u.reason })),
    live: live.map((l) => l.what),
    note: res.locals.cronNote,
  });
});

module.exports.probe = probe;
module.exports.DEAD_MARKERS = DEAD_MARKERS;
