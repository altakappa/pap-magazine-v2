/**
 * PAP Magazine — 셀럽·속보 감시 크론 (2026-07-17 신설)
 * Route: /api/cron/celeb-watch  (vercel.json: 15분마다)
 *
 * 왜: 새벽에 터지는 대형 이벤트(예: 월드컵 결승 하프타임쇼)를 팀이 자느라
 * 놓친다. 기존 sync-instagram 은 "IG 에 이미 올라간 것"만 기사화하므로,
 * IG 게시조차 못 하는 새벽엔 아무것도 나가지 않는다.
 *
 * 무엇: 셀럽·시상식·패션 속보 소스를 15분마다 폴링해
 *   ① 여러 매체가 동시에 다루는 사건 = 속보로 판정 (교차 검증 — 오보·낚시 방지)
 *   ② Claude 가 PAP 톤 기사 + AEO FAQ 3개 생성
 *   ③ articles 에 status='draft' 로 저장 (CLAUDE.md 규칙)
 *   ④ 도메니코에게 즉시 메일 — 일어나서 어드민에서 발행 1클릭
 *
 * 발행 정책(도메니코 결정 2026-07-17): draft + 알림.
 * 자동 발행하지 않는다 — 오보 리스크보다 "즉시 발행 가능한 완성 초안"이 목표.
 *
 * 저작권: 타 매체 이미지를 복제하지 않는다. 기사 본문은 사실 요약 + PAP 시각이며,
 * 이미지는 어드민에서 사람이 붙인다 (초안엔 출처 링크만).
 *
 * 멱등성: 같은 사건(정규화 제목 시그니처)으로 이미 draft/published 가 있으면 생성 안 함.
 * 수동 트리거: 관리자 토큰.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { sendEmail } = require('../_lib/email');

const SITE = 'https://www.pap-magazine.com';

/* 감시 소스 — 도메니코 선택 3개 영역 (K-pop 셀럽 / 시상식 레드카펫 / 패션 브랜드).
   구글 뉴스 RSS 쿼리는 키워드 기반이라 이벤트성 속보를 빠르게 잡는다. */
const FEEDS = [
  // K-pop · 셀럽
  { source: 'Soompi', url: 'https://www.soompi.com/feed', topic: 'kpop' },
  { source: 'Allkpop', url: 'https://www.allkpop.com/rss', topic: 'kpop' },
  { source: 'Billboard', url: 'https://www.billboard.com/feed/', topic: 'kpop' },
  { source: 'GoogleNews-KPOP', topic: 'kpop',
    url: 'https://news.google.com/rss/search?q=(BTS+OR+blackpink+OR+%22K-pop%22)+when:1d&hl=en-US&gl=US&ceid=US:en' },
  // 시상식 · 레드카펫
  { source: 'GoogleNews-RedCarpet', topic: 'redcarpet',
    url: 'https://news.google.com/rss/search?q=(%22red+carpet%22+OR+MetGala+OR+Oscars+OR+Grammys+OR+Cannes)+fashion+when:1d&hl=en-US&gl=US&ceid=US:en' },
  // 패션 브랜드 속보 (디렉터 선임·사임 등)
  { source: 'WWD', url: 'https://wwd.com/feed/', topic: 'fashion' },
  { source: 'Hypebeast', url: 'https://hypebeast.com/feed', topic: 'fashion' },
  { source: 'GoogleNews-Fashion', topic: 'fashion',
    url: 'https://news.google.com/rss/search?q=(%22creative+director%22+OR+%22artistic+director%22)+(appointed+OR+named+OR+steps+down)+fashion+when:1d&hl=en-US&gl=US&ceid=US:en' },
];

// 의존성 없는 최소 RSS 파서 (trend-scout 과 동일 방식)
function parseRss(xml, source, topic) {
  const items = [];
  const chunks = String(xml).split(/<item[\s>]/).slice(1, 21);
  for (const c of chunks) {
    const t = c.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const l = c.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
    const d = c.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const title = t && t[1] ? t[1].replace(/<[^>]+>/g, '').trim() : '';
    const link = l && l[1] ? l[1].trim() : '';
    if (!title || !link) continue;
    const ts = d && d[1] ? Date.parse(d[1]) : NaN;
    items.push({ title, link, source, topic, ts: isNaN(ts) ? null : ts });
  }
  return items;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const STOP = new Set(['the','a','an','of','in','on','at','for','to','and','or','with','his','her','its','new','says','after','from','over','into','this','that','be','is','are','was','were','has','have','will','k','pop']);
function keywords(title) {
  return norm(title).split(' ').filter(w => w.length >= 3 && !STOP.has(w));
}

/* 교차 검증 클러스터링 — 키워드 3개 이상 겹치고 소스가 서로 다르면 같은 사건.
   두 개 이상 매체가 다룬 사건만 속보 후보 (단독 낚시 기사 배제). */
function clusterEvents(items) {
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const base = keywords(items[i].title);
    if (base.length < 2) continue;
    const group = [items[i]];
    used.add(i);
    for (let k = i + 1; k < items.length; k++) {
      if (used.has(k)) continue;
      const other = keywords(items[k].title);
      const overlap = base.filter(w => other.includes(w));
      if (overlap.length >= 3) { group.push(items[k]); used.add(k); }
    }
    const sources = new Set(group.map(g => g.source));
    if (sources.size >= 2) {
      clusters.push({
        signature: base.slice(0, 6).sort().join('-'),
        headlines: group.map(g => ({ title: g.title, link: g.link, source: g.source })),
        sourceCount: sources.size,
        topic: group[0].topic,
        newestTs: Math.max(...group.map(g => g.ts || 0)),
      });
    }
  }
  return clusters.sort((a, b) => b.sourceCount - a.sourceCount);
}

module.exports = withCronGuard('celeb-watch', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY 미설정' });

  const dry = !!(req.query && req.query.dry === '1');
  const MAX_PER_RUN = Math.max(1, Math.min(3, parseInt((req.query && req.query.max) || '2', 10) || 2));

  try {
    /* 1) 수집 — 실패 피드는 건너뜀 */
    const results = await Promise.allSettled(FEEDS.map(async (f) => {
      const r = await fetch(f.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PAPCelebWatch/1.0)' },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(f.source + ' ' + r.status);
      return parseRss(await r.text(), f.source, f.topic);
    }));
    let items = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
    if (!items.length) return res.status(200).json({ ok: true, note: '수집 0건' });

    /* 2) 최근 6시간 이내 항목만 (속보성). pubDate 없으면 통과. */
    const CUTOFF = Date.now() - 6 * 3600 * 1000;
    items = items.filter(i => !i.ts || i.ts >= CUTOFF);

    /* 3) 교차 검증 클러스터링 */
    let clusters = clusterEvents(items);
    if (!clusters.length) return res.status(200).json({ ok: true, note: '교차 확인된 속보 없음', scanned: items.length });

    /* 4) 이미 다룬 사건 제외 — 최근 기사 120건 제목과 키워드 대조 */
    const { data: recent } = await supabaseAdmin.from('articles')
      .select('title, created_at').order('created_at', { ascending: false }).limit(120);
    const recentKw = (recent || []).map(a => keywords(a.title));
    clusters = clusters.filter(c => {
      const ck = keywords(c.headlines[0].title);
      return !recentKw.some(rk => ck.filter(w => rk.includes(w)).length >= 3);
    });
    if (!clusters.length) return res.status(200).json({ ok: true, note: '신규 속보 없음 (이미 다룸)' });

    const picked = clusters.slice(0, MAX_PER_RUN);
    if (dry) {
      return res.status(200).json({ ok: true, dry: true, scanned: items.length,
        clusters: picked.map(c => ({ sources: c.sourceCount, topic: c.topic, headlines: c.headlines.map(h => h.source + ': ' + h.title) })) });
    }

    /* 5) 기사 생성 (Claude) → draft 저장 */
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
    const created = [];
    for (const c of picked) {
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model, max_tokens: 3000,
            system: [
              'PAP MAGAZINE(서울·밀라노 기반, 아트를 중심으로 한 패션·뷰티·컬쳐 매거진)의 셀럽·컬쳐 속보 에디터.',
              '여러 매체 헤드라인을 받아 PAP 독자용 한국어 속보 기사를 쓴다.',
              '규칙:',
              '- 헤드라인들이 공통으로 말하는 사실만 쓴다. 추측·미확인 정보 금지. 확인 안 된 건 "~로 알려졌다" 대신 아예 쓰지 않는다.',
              '- 패션·스타일·비주얼 관점을 반드시 포함 (PAP 정체성). 무대의상·스타일링·연출 등.',
              '- 존댓말, 3~4단락, 단락 구분은 <br><br>.',
              '- 첫 문장은 사건의 핵심을 직접 말한다 (AEO: 답변 먼저).',
              'JSON 객체만 출력:',
              '{"title_ko":"30자 이내 제목","title_en":"English title","body_ko":"<br><br> 구분 본문","body_en":"English body",',
              '"category":"News","tags":["소문자 태그 5~8개"],"slug":"english-slug",',
              '"faq":[{"q":"독자가 검색할 자연어 질문","a":"20~60단어 자기완결 답변"}]}',
              'faq 는 3개. JSON 외 텍스트 금지.',
            ].join('\n'),
            messages: [{ role: 'user', content: JSON.stringify({ headlines: c.headlines, topic: c.topic }) }],
          }),
          signal: AbortSignal.timeout(90000),
        });
        if (!resp.ok) throw new Error('Claude ' + resp.status);
        const j = await resp.json();
        const block = Array.isArray(j.content) ? j.content.find(b => b && typeof b.text === 'string') : null;
        const raw = block ? block.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim() : '';
        let g;
        try { g = JSON.parse(raw); } catch (_) {
          const m = raw.match(/\{[\s\S]*\}/); g = m ? JSON.parse(m[0]) : null;
        }
        if (!g || !g.title_ko || !g.body_ko) throw new Error('생성 결과 파싱 실패');

        const sourceLinks = c.headlines.slice(0, 4)
          .map(h => `<a href="${h.link}" target="_blank" rel="noopener nofollow">${h.source}</a>`).join(' · ');
        const body = String(g.body_ko) +
          '<br><br><span style="font-size:12px;opacity:.6">출처: ' + sourceLinks + '</span>';

        const { data: ins, error: insErr } = await supabaseAdmin.from('articles').insert({
          title: String(g.title_ko).slice(0, 200),
          title_en: g.title_en ? String(g.title_en).slice(0, 200) : null,
          content: body,
          content_en: g.body_en || null,
          category: 'News',
          tags: Array.isArray(g.tags) ? g.tags.map(t => String(t).toLowerCase().replace(/^#+/, '').trim()).filter(Boolean).slice(0, 10) : [],
          slug: g.slug ? String(g.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') : null,
          faq: (Array.isArray(g.faq) && g.faq.length)
            ? g.faq.filter(f => f && f.q && f.a).map(f => ({ q: String(f.q).slice(0, 200), a: String(f.a).slice(0, 600) })).slice(0, 5)
            : null,
          status: 'draft', // CLAUDE.md: DB INSERT 는 draft 만. 발행 판단은 도메니코.
        }).select('id, title, slug').single();
        if (insErr) throw insErr;

        created.push({ id: ins.id, title: ins.title, slug: ins.slug, sources: c.sourceCount,
          headlines: c.headlines.map(h => h.source + ': ' + h.title) });
      } catch (e) {
        console.error('[celeb-watch] 생성 실패:', (e && e.message) || e);
      }
    }

    /* 6) 알림 메일 — 도메니코가 일어나서 바로 발행하도록 */
    if (created.length) {
      const to = process.env.DIGEST_TO || 'contact@pap-magazine.com';
      const rows = created.map(a => `
        <div style="border:1px solid #ddd;padding:16px;margin-bottom:12px">
          <div style="font-size:11px;color:#888;letter-spacing:.1em">속보 · ${a.sources}개 매체 교차 확인</div>
          <div style="font-size:18px;font-weight:700;margin:6px 0">${a.title}</div>
          <div style="font-size:12px;color:#666;line-height:1.7">${a.headlines.join('<br>')}</div>
          <a href="${SITE}/admin/news" style="display:inline-block;margin-top:12px;background:#000;color:#fff;padding:10px 20px;text-decoration:none;font-size:12px;font-weight:700">어드민에서 검토·발행 →</a>
        </div>`).join('');
      try {
        await sendEmail({
          to,
          subject: `[PAP 속보] 초안 ${created.length}건 생성 — ${created[0].title}`,
          html: `<div style="font-family:-apple-system,sans-serif;max-width:600px">
            <h2 style="font-size:16px">셀럽·속보 감시가 초안을 만들었습니다</h2>
            <p style="font-size:13px;color:#555">여러 매체가 동시에 다룬 사건입니다. 검토 후 발행하세요 — 발행 시 X 자동 게시 + 검색엔진 즉시 핑이 함께 나갑니다.</p>
            ${rows}
            <p style="font-size:11px;color:#999">PAP celeb-watch · 15분마다 감시 · 이미지는 어드민에서 직접 첨부</p>
          </div>`,
        });
      } catch (e) { console.warn('[celeb-watch] 메일 실패:', (e && e.message) || e); }
    }

    return res.status(200).json({ ok: true, scanned: items.length, clusters: clusters.length, created: created.length,
      titles: created.map(c => c.title) });
  } catch (err) {
    console.error('[celeb-watch] error:', err);
    throw err;
  }
});
