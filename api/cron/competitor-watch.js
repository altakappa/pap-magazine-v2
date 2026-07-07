/**
 * GET /api/cron/competitor-watch — 경쟁사 선점 브리핑 (매일 07:50 KST)
 *
 * 경쟁 매거진 5곳(@eyesmag @fastpapermag @dailyfashion_news @hipkr_
 * @newsourcemag)의 지난 24시간 게시물을 공개 API로 스캔 → 반응이 뜨는
 * 토픽 중 PAP이 아직 다루지 않은 것을 Claude 가 골라 "오늘 선점할 기사"
 * 브리핑을 생성 → trend_reports 에 저장 (관리자 대시보드/주간 브리핑에서
 * 소비). 목표: 경쟁사가 인스타에서 터뜨린 토픽의 *검색 지면*을 우리가
 * 웹 기사로 먼저 차지한다 (경쟁 5곳 모두 웹 SEO 부재 — 무주공산).
 *
 * 수동: 관리자 토큰 GET ?dry=1 (저장 없이 브리핑만 반환)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { discoverAccount } = require('../_lib/igDiscovery');

const COMPETITORS = ['eyesmag', 'fastpapermag', 'dailyfashion_news', 'hipkr_', 'newsourcemag'];

module.exports = async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  const dry = !!(req.query && req.query.dry === '1');

  try {
    // 1) 경쟁 5곳 최근 게시물 (24~36시간 창)
    const cutoff = Date.now() - 36 * 3600000;
    const hot = [];
    for (const u of COMPETITORS) {
      try {
        const acc = await discoverAccount(u, 25);
        if (acc.error) continue;
        (acc.media || []).forEach((m) => {
          if (!m.ts || new Date(m.ts).getTime() < cutoff) return;
          const score = (m.likes || 0) + (m.comments || 0) * 3;
          hot.push({ source: u, followers: acc.followers, score, likes: m.likes, comments: m.comments, permalink: m.permalink, caption: m.caption_head });
        });
      } catch (_) {}
    }
    if (!hot.length) return res.status(200).json({ message: '24시간 내 경쟁사 게시물 없음.', items: [] });
    // 팔로워 규모 보정 점수로 상위 20개
    hot.forEach((h) => { h.norm = h.followers ? +(h.score / h.followers * 1000).toFixed(2) : 0; });
    hot.sort((a, b) => b.norm - a.norm);
    const top = hot.slice(0, 20);

    // 2) 우리 최근 기사 제목 (커버리지 갭 판단용)
    const { data: ours } = await supabaseAdmin
      .from('articles').select('title')
      .eq('status', 'published')
      .order('published_date', { ascending: false }).limit(60);
    const ourTitles = (ours || []).map((a) => a.title);

    // 3) Claude 브리핑 생성
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY 누락' });
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
    const prompt = [
      '너는 PAP MAGAZINE(아트 기반 패션·뷰티·컬쳐 매거진)의 편집장 보좌 AI다.',
      '아래는 경쟁 인스타 매거진들의 지난 24시간 인기 게시물(팔로워 보정 점수순)과, 우리가 최근 발행한 기사 제목들이다.',
      '경쟁사가 다루는 토픽 중 (a) 반응이 검증됐고 (b) 우리가 아직 다루지 않았으며 (c) PAP의 패션·뷰티·아트·컬쳐 정체성에 맞는 것을 3~6개 골라라.',
      '각 토픽에 PAP만의 차별화 각도(단순 속보 재탕 금지)와 검색 선점용 한국어 키워드를 제시하라.',
      '',
      '경쟁사 인기 게시물:',
      JSON.stringify(top.map((t) => ({ src: t.source, norm: t.norm, likes: t.likes, cmt: t.comments, cap: t.caption.slice(0, 120) }))),
      '',
      '우리 최근 기사 제목:',
      JSON.stringify(ourTitles),
      '',
      '다음 JSON 배열로만 응답하라:',
      '[{"title":"토픽 요약","angle":"PAP 각도 제안 (1-2문장)","keywords":["검색 키워드",...],"source":"경쟁사 계정","link":"해당 게시물 permalink","score":팔로워보정점수,"reason":"선정 이유 한 줄"}]',
    ].join('\n');

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(90000),
    });
    if (!apiRes.ok) {
      const t = await apiRes.text().catch(() => '');
      throw new Error('Claude API ' + apiRes.status + ': ' + t.slice(0, 150));
    }
    const j = await apiRes.json();
    const text = (j.content && j.content[0] && j.content[0].text) || '';
    const m = text.match(/\[[\s\S]*\]/);
    const items = m ? JSON.parse(m[0]) : [];
    // permalink 이 없거나 잘못 온 경우 top 목록에서 보정
    items.forEach((it) => {
      if (!it.link) {
        const hit = top.find((t) => t.source === it.source);
        if (hit) it.link = hit.permalink;
      }
      it.kind = 'competitor'; // trend-scout 아이템과 구분자
    });

    // 4) trend_reports 에 병합 저장 (같은 날짜 행이 있으면 items 에 append)
    let saved = false;
    if (!dry && items.length) {
      const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // KST
      const { data: existing } = await supabaseAdmin
        .from('trend_reports').select('id, items').eq('report_date', today).maybeSingle();
      if (existing) {
        const merged = (existing.items || []).filter((x) => x.kind !== 'competitor').concat(items);
        const { error } = await supabaseAdmin.from('trend_reports')
          .update({ items: merged, model }).eq('id', existing.id);
        saved = !error;
      } else {
        const { error } = await supabaseAdmin.from('trend_reports')
          .insert({ report_date: today, items, model });
        saved = !error;
      }
    }

    return res.status(200).json({ scanned: hot.length, briefing: items, saved, dry });
  } catch (e) {
    console.error('[competitor-watch] error:', e);
    return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) });
  }
};
