/**
 * AI 검색·챗봇 계측 화면 (2026-08-19 신설)
 * Route: /api/admin/ai-traffic?days=30        (HTML)
 *        /api/admin/ai-traffic?days=30&json=1 (원본)
 *
 * ■ 왜 만들었나
 * 시밀러웹 영업 메일이 무신사·지그재그의 "AI 챗봇 유입 7배"를 보여 줬다.
 * 그건 패널 추정치다. 우리 사이트 유입은 우리 서버가 원본을 갖고 있다.
 * 추정치를 사기 전에 원본을 읽는 화면이 이거다.
 *
 * ■ 두 표를 나란히 놓되 절대 더하지 않는다
 *   유입  사람이 AI 답변의 링크를 눌러 우리에게 온 것 (social_inclicks)
 *   크롤  AI 회사 봇이 우리 글을 읽어 간 것          (ai_crawl_daily)
 * 크롤은 유입의 선행 지표지 유입이 아니다. 합계를 내면 둘 다 의미를 잃는다.
 *
 * ■ 과거 표기 통합은 읽을 때 한다
 * 8/17 이전 행은 src 가 'chatgpt_com'·'openai' 로 저장돼 있다. UPDATE 로
 * 과거를 고치지 않고 normalizeSrc 로 읽을 때 합친다. 원본을 안 건드리는
 * 쪽이 되돌릴 수 있어서다.
 */

const { requireAdmin } = require('../_lib/auth');
const { supabaseAdmin } = require('../_lib/supabase');
const { normalizeSrc } = require('../_lib/socialInclick');
const { REFERRAL_HOSTS, CRAWLERS } = require('../_lib/aiTraffic');

/* AI 플랫폼 이름 집합 — lib 에서 뽑는다. 목록을 두 벌 적으면 한쪽만 낡는다. */
const AI_NAMES = new Set(
  REFERRAL_HOSTS.map((r) => r[1]).concat(CRAWLERS.map((c) => c[1]))
);

const KIND_LABEL = { live: '지금 답변 중', index: '검색 색인', train: '학습 수집' };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function daysAgoIso(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const q = req.query || {};
  const days = Math.max(1, Math.min(365, Number(q.days || 30)));
  const since = daysAgoIso(days - 1);

  try {
    /* ── 유입 (사람) ─────────────────────────────────────────── */
    const { data: inRows, error: inErr } = await supabaseAdmin
      .from('social_inclicks')
      .select('src, path, page, referrer_host, clicked_at')
      .gte('clicked_at', since + 'T00:00:00Z')
      .limit(50000);
    if (inErr) throw new Error('social_inclicks: ' + inErr.message);

    const byPlatform = new Map();   // 플랫폼 → 유입 수
    const byPath = new Map();       // 경로 → {hits, platforms:Set}
    let aiTotal = 0;
    let allTotal = 0;
    const rawNames = new Map();     // 통합 전 원본 표기 (갈라짐 확인용)

    (inRows || []).forEach((r) => {
      allTotal++;
      const norm = normalizeSrc(r.src || '');
      if (!AI_NAMES.has(norm)) return;
      aiTotal++;
      byPlatform.set(norm, (byPlatform.get(norm) || 0) + 1);
      rawNames.set(r.src, (rawNames.get(r.src) || 0) + 1);
      const p = r.path || '/';
      const cur = byPath.get(p) || { hits: 0, platforms: new Set() };
      cur.hits++; cur.platforms.add(norm);
      byPath.set(p, cur);
    });

    /* ── 크롤 (봇) ───────────────────────────────────────────── */
    const { data: crawlRows, error: crErr } = await supabaseAdmin
      .from('ai_crawl_daily')
      .select('day, platform, kind, path, hits')
      .gte('day', since)
      .limit(50000);
    if (crErr) throw new Error('ai_crawl_daily: ' + crErr.message);

    const crawlByPk = new Map();    // '플랫폼|목적' → hits
    const crawlByPath = new Map();  // 경로 → hits
    let crawlTotal = 0;
    (crawlRows || []).forEach((r) => {
      const h = Number(r.hits || 0);
      crawlTotal += h;
      const k = r.platform + '|' + r.kind;
      crawlByPk.set(k, (crawlByPk.get(k) || 0) + h);
      crawlByPath.set(r.path, (crawlByPath.get(r.path) || 0) + h);
    });

    const sortDesc = (m) => Array.from(m.entries()).sort((a, b) => {
      const av = typeof a[1] === 'object' ? a[1].hits : a[1];
      const bv = typeof b[1] === 'object' ? b[1].hits : b[1];
      return bv - av;
    });

    const payload = {
      window: { days: days, since: since },
      referral: {
        ai_hits: aiTotal,
        all_inclicks: allTotal,
        by_platform: sortDesc(byPlatform).map(([k, v]) => ({ platform: k, hits: v })),
        top_paths: sortDesc(byPath).slice(0, 25).map(([k, v]) => ({
          path: k, hits: v.hits, platforms: Array.from(v.platforms).join(', '),
        })),
        raw_src_names: sortDesc(rawNames).map(([k, v]) => ({ src: k, hits: v })),
      },
      crawl: {
        total_hits: crawlTotal,
        by_platform_kind: sortDesc(crawlByPk).map(([k, v]) => ({
          platform: k.split('|')[0], kind: k.split('|')[1], hits: v,
        })),
        top_paths: sortDesc(crawlByPath).slice(0, 25).map(([k, v]) => ({ path: k, hits: v })),
      },
    };

    if (q.json) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(payload);
    }

    /* ── HTML ────────────────────────────────────────────────── */
    const row = (cells) => '<tr>' + cells.map((c, i) =>
      '<td' + (i === 0 ? '' : ' class="n"') + '>' + c + '</td>').join('') + '</tr>';

    const platRows = payload.referral.by_platform.map((r) =>
      row([esc(r.platform), r.hits])).join('') || row(['(없음)', 0]);

    const crawlRowsHtml = payload.crawl.by_platform_kind.map((r) =>
      row([esc(r.platform) + ' <span class="k">' + esc(KIND_LABEL[r.kind] || r.kind) + '</span>', r.hits]))
      .join('') || row(['(없음 — 아직 배포 전이거나 봇이 안 왔다)', 0]);

    const inPathRows = payload.referral.top_paths.map((r) =>
      row(['<a href="' + esc(r.path) + '" target="_blank">' + esc(r.path) + '</a> <span class="k">' + esc(r.platforms) + '</span>', r.hits])).join('')
      || row(['(없음)', 0]);

    const crPathRows = payload.crawl.top_paths.map((r) =>
      row(['<a href="' + esc(r.path) + '" target="_blank">' + esc(r.path) + '</a>', r.hits])).join('')
      || row(['(없음)', 0]);

    const rawWarn = payload.referral.raw_src_names.length > 1
      ? '<p class="warn">저장된 원본 표기 ' + payload.referral.raw_src_names.length
        + '종: ' + esc(payload.referral.raw_src_names.map((r) => r.src + '(' + r.hits + ')').join(', '))
        + ' — 위 표는 이걸 하나로 합쳐서 센 값이다.</p>'
      : '';

    const html = '<!doctype html><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>AI 유입 계측</title><style>'
      + 'body{font:14px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;'
      + 'max-width:940px;margin:32px auto;padding:0 18px;color:#111}'
      + 'h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:34px 0 10px;'
      + 'padding-bottom:6px;border-bottom:1px solid #e5e5e5}'
      + 'table{width:100%;border-collapse:collapse;font-size:13px}'
      + 'td{padding:7px 6px;border-bottom:1px solid #f0f0f0;word-break:break-all}'
      + 'td.n{text-align:right;white-space:nowrap;width:90px;font-variant-numeric:tabular-nums}'
      + '.k{color:#999;font-size:11px}.sub{color:#666;font-size:12px;margin:0 0 18px}'
      + '.warn{background:#fff8e1;border-left:3px solid #f0b400;padding:8px 12px;font-size:12px}'
      + '.note{background:#f6f6f6;padding:12px 14px;font-size:12px;color:#444;line-height:1.75}'
      + 'a{color:#0645ad}</style>'
      + '<h1>AI 검색·챗봇 계측</h1>'
      + '<p class="sub">최근 ' + days + '일 (' + since + ' ~) · 유입 <b>' + aiTotal + '</b>건 / 전체 유입 기록 ' + allTotal + '건 · 크롤 <b>' + crawlTotal + '</b>회</p>'
      + '<h2>① 사람이 AI 답변을 눌러 들어온 수 (유입)</h2>'
      + '<table>' + platRows + '</table>' + rawWarn
      + '<h2>② AI 봇이 우리 글을 읽어 간 수 (크롤)</h2>'
      + '<table>' + crawlRowsHtml + '</table>'
      + '<h2>③ AI 에서 사람이 가장 많이 들어온 글</h2>'
      + '<table>' + inPathRows + '</table>'
      + '<h2>④ AI 가 가장 많이 읽어 간 글</h2>'
      + '<table>' + crPathRows + '</table>'
      + '<h2>이 숫자를 읽는 법</h2>'
      + '<div class="note">'
      + '<b>①과 ②를 더하지 마라.</b> ①은 사람, ②는 봇이다. ②는 ①의 선행 지표일 뿐이다.<br>'
      + '<b>「지금 답변 중」이 중요하다.</b> ChatGPT-User 같은 봇은 사람이 방금 질문해서 우리 글을 여는 중이라는 뜻이다. 「학습 수집」은 내년 이야기다.<br>'
      + '<b>이 값은 하한선이다.</b> 상세 페이지는 CDN 이 5분 캐시하므로 같은 글의 짧은 시간 내 반복 방문은 세어지지 않는다. 절대치가 아니라 추세로 읽는다.<br>'
      + '<b>못 재는 구멍.</b> 리퍼러를 아예 안 보내는 AI 앱의 유입은 「직접 방문」으로 섞여 영영 못 가른다.'
      + '</div>';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
