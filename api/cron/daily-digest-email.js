/**
 * GET /api/cron/daily-digest-email — 매일 아침 인텔리전스 다이제스트 메일 (08:40 KST)
 *
 * 하루치 trend_reports(경쟁사 선점 토픽 + 광고 후보 게시물)를 하나의 메일로
 * 묶어 운영자에게 발송한다. 접속 없이 받은편지함에서 바로 확인.
 *   - competitor : 경쟁사가 터뜨렸고 우리가 안 다룬 선점 토픽 (각도·키워드)
 *   - ad-candidate: 참여 검증된 부스트 후보 게시물 (참여 목표 광고용)
 *
 * 수신자: DIGEST_TO 환경변수 (기본 contact@pap-magazine.com)
 * 수동: 관리자 토큰 GET ?dry=1 (발송 없이 HTML 미리보기 반환)
 */

const { bearerOk } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { withCronGuard } = require('../_lib/cronGuard');
const { requireAdmin } = require('../_lib/auth');
const { sendEmail } = require('../_lib/email');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = withCronGuard('daily-digest-email', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  const dry = !!(req.query && req.query.dry === '1');

  try {
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // KST
    const { data: row } = await supabaseAdmin
      .from('trend_reports').select('items').eq('report_date', today).maybeSingle();
    const items = (row && row.items) || [];

    const comp = items.filter((x) => x.kind === 'competitor');
    const ads = items.filter((x) => x.kind === 'ad-candidate');
    const trends = items.filter((x) => !x.kind || x.kind === 'trend'); // 기존 트렌드 스카우트

    // 아무것도 없으면 발송 스킵 (빈 메일 방지)
    if (!comp.length && !ads.length && !trends.length) {
      return res.status(200).json({ sent: false, reason: '오늘 브리핑 항목 없음', date: today });
    }

    const section = (title, sub, rowsHtml) =>
      '<h2 style="font-size:15px;letter-spacing:.04em;margin:26px 0 4px">' + title + '</h2>' +
      '<p style="font-size:12px;color:#888;margin:0 0 12px">' + sub + '</p>' + rowsHtml;

    const compHtml = comp.length ? section(
      '🎯 경쟁사 선점 토픽', '경쟁사가 터졌는데 우리가 아직 안 다룬 것 — 웹 기사로 선점하세요',
      comp.map((c) => '<div style="border:1px solid #eee;border-radius:10px;padding:14px 16px;margin-bottom:10px">' +
        '<div style="font-weight:700;font-size:14px">' + esc(c.title) + '</div>' +
        (c.angle ? '<div style="font-size:13px;color:#444;margin-top:5px">각도: ' + esc(c.angle) + '</div>' : '') +
        (c.keywords && c.keywords.length ? '<div style="font-size:12px;color:#c0392b;margin-top:5px">키워드: ' + esc(c.keywords.join(', ')) + '</div>' : '') +
        (c.link ? '<a href="' + esc(c.link) + '" style="font-size:12px;color:#2980b9">원본 게시물 →</a>' : '') +
        '</div>').join('')) : '';

    const adHtml = ads.length ? section(
      '📈 광고 후보 게시물', '참여가 검증된 게시물만 — 광고 목표는 \'참여\', 타겟은 CELEB1/ART1/EDITORIAL1 재사용',
      ads.map((a) => '<div style="border:1px solid #eee;border-radius:10px;padding:14px 16px;margin-bottom:10px">' +
        '<div style="font-weight:700;font-size:14px">' + esc(a.title) + ' <span style="font-size:11px;color:#999">(' + esc(a.type) + ')</span></div>' +
        '<div style="font-size:12px;color:#444;margin-top:5px">♥ ' + (a.likes || 0) + ' · 💬 ' + (a.comments || 0) + '</div>' +
        (a.reasons && a.reasons.length ? '<div style="font-size:12px;color:#27ae60;margin-top:4px">' + esc(a.reasons.join(' · ')) + '</div>' : '') +
        (a.link ? '<a href="' + esc(a.link) + '" style="font-size:12px;color:#2980b9">게시물 열기 →</a>' : '') +
        '</div>').join('')) : '';

    const html =
      '<div style="font-family:-apple-system,\'Apple SD Gothic Neo\',sans-serif;max-width:600px;margin:0 auto;color:#111">' +
      '<div style="border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:6px">' +
      '<div style="font-size:11px;letter-spacing:.2em;color:#888">PAP MAGAZINE</div>' +
      '<div style="font-size:20px;font-weight:800">오늘의 인텔리전스 다이제스트</div>' +
      '<div style="font-size:12px;color:#888">' + today + '</div></div>' +
      compHtml + adHtml +
      '<div style="margin-top:24px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:#aaa">' +
      '30분 주기 경쟁사 감시 + 매일 아침 광고 후보 스캔 자동 요약. 문의는 이 메일에 회신.</div></div>';

    const to = process.env.DIGEST_TO || 'contact@pap-magazine.com';
    const subject = '[PAP] 오늘의 선점 브리핑 — 선점 ' + comp.length + ' · 광고후보 ' + ads.length + ' (' + today + ')';

    if (dry) return res.status(200).json({ dry: true, to, subject, itemCounts: { comp: comp.length, ads: ads.length, trends: trends.length }, html });

    const result = await sendEmail(to, { subject, html });
    return res.status(200).json({ date: today, to, itemCounts: { comp: comp.length, ads: ads.length }, email: result });
  } catch (e) {
    console.error('[daily-digest-email] error:', e);
    return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) });
  }
});
