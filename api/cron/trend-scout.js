/**
 * PAP Magazine — 트렌드 스카우트 크론 (guide/AUTOMATION_PROMPTS_ADVANCED.md 14)
 * Route: /api/cron/trend-scout  (vercel.json: 화·금 06:00 KST = 월·목 21:00 UTC)
 *
 * 루프 A(콘텐츠 플라이휠)의 시작점:
 *   1. 패션 매체 RSS 4곳에서 최신 헤드라인 수집 (의존성 없이 regex 파싱)
 *   2. 이미 다룬 주제 제거 — 최근 trend_reports 항목 + articles 제목과 대조
 *   3. Claude 가 PAP 적합도(0~10)·기사 각도·근거를 채점, 상위만 채택
 *   4. trend_reports 저장 → 적합도 8+ 은 어드민에서 기사화 후보로 사용
 *      (pap-article 스킬/자동 기사 파이프라인에 소스 공급)
 *
 * 수동 트리거: 관리자 토큰 POST 허용.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
// 2026-08-07 — 가드 추가. 그전까지 이 크론은 cron_runs 에 아무 기록도
// 남기지 않아 '도는지 안 도는지 알 수 없는' 상태였다(7일 로그 0건).
// 실패해도 아무도 몰랐다는 뜻이다.
const { withCronGuard } = require('../_lib/cronGuard');

const FEEDS = [
  { source: 'Vogue', url: 'https://www.vogue.com/feed/rss' },
  { source: 'Hypebeast', url: 'https://hypebeast.com/feed' },
  { source: 'Dazed', url: 'https://www.dazeddigital.com/rss' },
  { source: 'WWD', url: 'https://wwd.com/feed/' },
];

// 의존성 없는 최소 RSS 파서 — <item><title>/<link> 만 추출
function parseRss(xml, source) {
  const items = [];
  const chunks = String(xml).split(/<item[\s>]/).slice(1, 16); // 피드당 최대 15개
  for (const c of chunks) {
    const t = c.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const l = c.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
    const title = t && t[1] ? t[1].replace(/<[^>]+>/g, '').trim() : '';
    const link = l && l[1] ? l[1].trim() : '';
    if (title && link) items.push({ title, link, source });
  }
  return items;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/* ─── 시간 예산 (2026-08-10 신설) ─────────────────────────────────────
 *
 * weekly-news 와 같은 사고. 2026-07-06 등록 이후 **34일간 성공 0회**이고
 * cron_runs 기록도 0건이라 아무에게도 안 보였다(함수가 상한에서 통째로
 * 잘리면 기록을 남길 코드까지 같이 죽는다).
 *
 * 산수:  RSS 15초 + Claude 채점 100초 = 115초 + DB 쓰기  >  상한 120초
 * Claude 호출 타임아웃 100초가 상한 120초에 너무 붙어 있었다 — 피드가
 * 조금만 늦어도 넘는다.
 *
 * ① vercel.json 에서 이 경로만 maxDuration 300 (Pro 허용)
 * ② 예산을 둬서, 모자라면 죽는 대신 이유를 남기고 끝낸다 */
const BUDGET_MS = Number(process.env.TREND_SCOUT_BUDGET_MS || 260000);
const SLACK_MS = 20000;

module.exports = withCronGuard('trend-scout', async function handler(req, res) {
  const started = Date.now();
  const msLeft = () => BUDGET_MS - (Date.now() - started);
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY 미설정' });

  try {
    // 1) 수집 (실패한 피드는 건너뜀 — 부분 성공 허용)
    const results = await Promise.allSettled(FEEDS.map(async (f) => {
      const r = await fetch(f.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PAPTrendScout/1.0)' },
        signal: AbortSignal.timeout(Math.max(5000, Math.min(15000, msLeft() - SLACK_MS))),
      });
      if (!r.ok) throw new Error(f.source + ' ' + r.status);
      return parseRss(await r.text(), f.source);
    }));
    let items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    if (!items.length) return res.status(502).json({ error: '모든 피드 수집 실패' });

    // 2) 중복 제거 — 최근 4회차 스카우트 + 최근 기사 60건 제목과 대조
    const [{ data: prevReports }, { data: recentArticles }] = await Promise.all([
      supabaseAdmin.from('trend_reports').select('items').order('report_date', { ascending: false }).limit(4),
      supabaseAdmin.from('articles').select('title').order('created_at', { ascending: false }).limit(60),
    ]);
    const seen = new Set();
    (prevReports || []).forEach((r) => (Array.isArray(r.items) ? r.items : []).forEach((i) => seen.add(norm(i.title))));
    (recentArticles || []).forEach((a) => seen.add(norm(a.title)));
    items = items.filter((i) => {
      const n = norm(i.title);
      if (!n || seen.has(n)) return false;
      seen.add(n); // 피드 간 중복도 제거
      return true;
    }).slice(0, 40);
    if (!items.length) return res.status(200).json({ ok: true, note: '신규 항목 없음' });

    // 3) Claude 채점 — 남은 예산 안에서만
    const claudeMs = Math.min(100000, msLeft() - SLACK_MS);
    if (claudeMs < 20000) {
      return res.status(200).json({
        ok: true, skipped: 'budget',
        note: '시간 부족으로 채점 생략 (남은 ' + Math.round(msLeft() / 1000) + '초) — 다음 실행이 재시도',
      });
    }
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 3500,
        system: [
          'PAP 매거진(아트 기반 패션·뷰티·컬쳐, 한국 중심 글로벌 독자, IG 38만)의 트렌드 에디터.',
          '헤드라인 목록을 받아 PAP 기사화 적합도를 채점한다.',
          '기준: 우리 독자(패션·아트 감도 높은 한국 20~30대) 관심도, 비주얼 스토리 가능성, 시의성. 단순 커머스·기업 실적 뉴스는 낮게.',
          'JSON 배열만 출력: [{"title":"원문 제목","link":"원문 링크","source":"출처","score":0-10,"angle":"PAP 기사 각도 한 문장(한국어)","reason":"근거 한 줄(한국어)"}]',
          'score 6 미만은 배열에서 제외. 최대 12개. JSON 외 다른 텍스트 금지.',
        ].join('\n'),
        messages: [{ role: 'user', content: JSON.stringify(items) }],
      }),
      signal: AbortSignal.timeout(claudeMs),
    });
    if (!resp.ok) throw new Error('Claude ' + resp.status);
    const j = await resp.json();
    const block = Array.isArray(j.content) ? j.content.find((b) => b && typeof b.text === 'string') : null;
    let scored = [];
    try {
      const m = block ? block.text.match(/\[[\s\S]*\]/) : null;
      scored = m ? JSON.parse(m[0]) : [];
    } catch (_) { scored = []; }
    scored = (Array.isArray(scored) ? scored : [])
      .filter((x) => x && x.title && typeof x.score === 'number')
      .sort((a, b) => b.score - a.score).slice(0, 12);

    // 4) 저장 (KST 날짜당 1건 upsert)
    const kstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const { error } = await supabaseAdmin.from('trend_reports')
      .upsert({ report_date: kstDate, items: scored, model }, { onConflict: 'report_date' });
    if (error) throw error;

    return res.status(200).json({
      ok: true, report_date: kstDate,
      collected: items.length, scored: scored.length,
      top: scored.slice(0, 3).map((x) => x.title),
    });
  } catch (err) {
    console.error('[trend-scout] error:', err);
    return res.status(500).json({ error: 'trend scout failed', detail: String(err && err.message || err).slice(0, 150) });
  }
});
