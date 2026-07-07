/**
 * GET /api/cron/competitor-watch — 경쟁사 실시간 선점 시스템 (30분 주기)
 *
 * 경쟁 매거진 5곳(@eyesmag @fastpapermag @dailyfashion_news @hipkr_
 * @newsourcemag)의 최근 게시물을 30분마다 공개 API로 스캔한다.
 *
 * 파이프라인 (전부 자동):
 *   1) 지난 24시간 게시물 중 반응 상위(팔로워 보정)를 추출
 *   2) 이미 브리핑된 게시물(최근 3일 trend_reports)은 제외 — 새 토픽이
 *      없으면 AI 호출 없이 종료 (비용·레이트리밋 절약)
 *   3) 새 토픽만 Claude 로 분류: PAP 정체성에 맞고 우리가 안 다룬 것 →
 *      선점 브리핑 아이템 생성, 오늘자 trend_reports 에 병합
 *   4) 재선점 핑: 토픽 키워드가 우리 기존 기사와 매칭되면 해당 기사
 *      URL 을 IndexNow 로 즉시 재제출 → 검색엔진 신선도 신호로 순위
 *      방어·선점 (경쟁 5곳은 웹 SEO 부재 — 검색 지면은 우리 것)
 *
 * 완전 자동 "기사 발행"은 의도적으로 하지 않는다: 경쟁사 이미지 사용
 * 불가·오보·중복콘텐츠 리스크. 발행 판단은 브리핑을 본 운영자가 한다.
 *
 * 수동: 관리자 토큰 GET ?dry=1 (저장·핑 없이 결과만)
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { discoverAccount } = require('../_lib/igDiscovery');
const { submitIndexNow, SITE } = require('../_lib/pingSearch');

const COMPETITORS = ['eyesmag', 'fastpapermag', 'dailyfashion_news', 'hipkr_', 'newsourcemag'];

// 한국어/영어 토큰화 — 제목·키워드 매칭용 (2글자 이상)
function tokens(s) {
  return String(s || '').toLowerCase().match(/[a-z0-9가-힣]{2,}/g) || [];
}

module.exports = async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  const dry = !!(req.query && req.query.dry === '1');

  try {
    // 1) 경쟁 5곳 최근 게시물 (24시간 창)
    const cutoff = Date.now() - 24 * 3600000;
    const hot = [];
    for (const u of COMPETITORS) {
      try {
        const acc = await discoverAccount(u, 15);
        if (acc.error) continue;
        (acc.media || []).forEach((m) => {
          if (!m.ts || new Date(m.ts).getTime() < cutoff) return;
          const score = (m.likes || 0) + (m.comments || 0) * 3;
          hot.push({ source: u, followers: acc.followers, score, likes: m.likes, comments: m.comments, permalink: m.permalink, caption: m.caption_head });
        });
      } catch (_) {}
    }
    if (!hot.length) return res.status(200).json({ message: '24시간 내 경쟁사 게시물 없음.', new_items: 0 });
    hot.forEach((h) => { h.norm = h.followers ? +(h.score / h.followers * 1000).toFixed(2) : 0; });
    hot.sort((a, b) => b.norm - a.norm);

    // 2) 중복 제거 — 최근 3일 브리핑에 이미 등재된 permalink 는 스킵
    const since = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const { data: recentReports } = await supabaseAdmin
      .from('trend_reports').select('items').gte('report_date', since);
    const seen = new Set();
    (recentReports || []).forEach((r) => (r.items || []).forEach((it) => { if (it.link) seen.add(it.link); if (it.src_link) seen.add(it.src_link); }));
    const fresh = hot.filter((h) => !seen.has(h.permalink)).slice(0, 12);

    // 우리 최근 기사 (갭 판단 + 재선점 핑 대상)
    const { data: ours } = await supabaseAdmin
      .from('articles').select('title, custom_url, slug, id, tags')
      .eq('status', 'published')
      .order('published_date', { ascending: false }).limit(80);
    const ourArts = ours || [];

    let items = [];
    if (fresh.length && process.env.ANTHROPIC_API_KEY) {
      // 3) 새 토픽만 Claude 분류
      const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
      const prompt = [
        '너는 PAP MAGAZINE(아트 기반 패션·뷰티·컬쳐 매거진)의 편집장 보좌 AI다.',
        '아래는 경쟁 인스타 매거진들의 최근 24시간 신규 인기 게시물과, 우리 최근 기사 제목들이다.',
        '경쟁사 토픽 중 (a) 반응이 검증됐고 (b) 우리가 아직 다루지 않았으며 (c) PAP 정체성(패션·뷰티·아트·컬쳐)에 맞는 것을 0~5개 골라라. 맞는 것이 없으면 빈 배열.',
        '각 토픽에 PAP만의 차별화 각도와 검색 선점용 한국어 키워드를 제시하라.',
        '',
        '경쟁사 신규 인기 게시물:',
        JSON.stringify(fresh.map((t) => ({ src: t.source, norm: t.norm, likes: t.likes, cmt: t.comments, link: t.permalink, cap: t.caption.slice(0, 120) }))),
        '',
        '우리 최근 기사 제목:',
        JSON.stringify(ourArts.map((a) => a.title)),
        '',
        '다음 JSON 배열로만 응답하라 (없으면 []):',
        '[{"title":"토픽 요약","angle":"PAP 각도 (1-2문장)","keywords":["키워드",...],"source":"계정","link":"게시물 permalink","score":팔로워보정점수,"reason":"선정 이유 한 줄"}]',
      ].join('\n');

      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: 1800, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(90000),
      });
      if (apiRes.ok) {
        const j = await apiRes.json();
        const text = (j.content && j.content[0] && j.content[0].text) || '';
        const m = text.match(/\[[\s\S]*\]/);
        items = m ? JSON.parse(m[0]) : [];
        items.forEach((it) => { it.kind = 'competitor'; it.detected_at = new Date().toISOString(); });
      }
    }

    // 4) 재선점 핑 — 핫토픽(신규 + 기존 브리핑 무관)과 매칭되는 우리 기사 재제출.
    //    hot 상위 토큰 vs 기사 제목·태그 토큰 겹침 2개 이상이면 매칭.
    const pinged = [];
    if (!dry) {
      const hotTokens = hot.slice(0, 15).map((h) => ({ h, tk: new Set(tokens(h.caption)) }));
      const already = new Set();
      for (const a of ourArts) {
        const artTk = tokens(a.title).concat((a.tags || []).flatMap((t) => tokens(t)));
        for (const { tk } of hotTokens) {
          const overlap = artTk.filter((t) => tk.has(t));
          if (overlap.length >= 2) {
            const handle = a.custom_url || a.slug || a.id;
            const url = SITE + '/article/' + encodeURIComponent(handle);
            if (!already.has(url)) { already.add(url); pinged.push({ url, matched: overlap.slice(0, 4) }); }
            break;
          }
        }
        if (pinged.length >= 5) break; // 실행당 최대 5건 (핑 스팸 방지)
      }
      if (pinged.length) {
        try { await submitIndexNow(pinged.map((p) => p.url)); } catch (_) {}
      }
    }

    // 5) 브리핑 저장 (오늘자 trend_reports 에 병합 append)
    let saved = false;
    if (!dry && items.length) {
      const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // KST
      const { data: existing } = await supabaseAdmin
        .from('trend_reports').select('id, items').eq('report_date', today).maybeSingle();
      if (existing) {
        const { error } = await supabaseAdmin.from('trend_reports')
          .update({ items: (existing.items || []).concat(items) }).eq('id', existing.id);
        saved = !error;
      } else {
        const { error } = await supabaseAdmin.from('trend_reports')
          .insert({ report_date: today, items, model: 'competitor-watch' });
        saved = !error;
      }
    }

    return res.status(200).json({
      scanned: hot.length, fresh: fresh.length, new_items: items.length,
      briefing: items, repinged: pinged, saved, dry,
    });
  } catch (e) {
    console.error('[competitor-watch] error:', e);
    return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) });
  }
};
