/**
 * GET /api/admin/article-title-backfill — 제목·메타 설명을 검색어에 맞춘다 (관리자 전용)
 *
 * [왜] 2026-09-14, 28일 GSC 실측에서 **순위로는 설명이 안 되는 구멍**이 나왔다.
 *   튜이드               노출 5,057 · 클릭 1 · CTR 0.02% · 순위 6.4
 *   나띠                 노출 8,407 · 클릭 5 · CTR 0.06% · 순위 9.8
 *   jennie summer sonic  노출 4,780 · 클릭 9 · CTR 0.19% · 순위 6.6
 * 6.4위면 보통 CTR 이 3~5% 다. 우리는 0.02% 다. **보여도 안 눌린다.**
 *
 * 본문 보강(article-body-backfill)은 **순위**를 올리는 일이고, 이건 **CTR** 이다.
 * 그리고 훨씬 싸고 빠르다. 구글이 다시 긁으면 바로 반영된다.
 *
 * [무엇이 문제인가] 검색어 "튜이드"(노출 5,057)에 걸리는 우리 제목은
 * "튜이드, 데뷔 타이틀 'SUN KISS' 공개" 다. "튜이드" 를 검색한 사람은
 * **이 그룹이 누구인지** 알고 싶다. 멤버도 소속사도 데뷔일도 제목에 없다.
 *
 * [무엇을 바꾸나 — 중요]
 * 사이트에 보이는 제목(articles.title)은 **건드리지 않는다.**
 * 검색 결과에만 쓰이는 `seo_title` 과 `seo_description` 만 바꾼다.
 * 렌더러는 seo_title 이 있으면 그것을 쓰고 없으면 title 에 브랜드를 붙인다
 * (api/_lib/seoRenderer.js:880). 그래서 이 둘만으로 검색 표시가 바뀐다.
 * 편집 판단 부담이 적고 되돌리기도 쉽다.
 *
 * [근거] 뷰 article_query_match (마이그레이션 159)가 기사마다 "어떤 검색어로
 * 노출되는지" 를 준다. GSC 는 query × page 교차를 우리 표에 주지 않으므로
 * 제목 문자열 매칭으로 이었다. 거칠지만 실측으로 확인했다.
 *
 *   ?enqueue=1&limit=20          후보를 큐에 넣는다 (preview=1 로 먼저 본다)
 *   ?generate_next=1             다음 1건 초안 생성
 *   ?review=1                    검토 화면
 *   ?apply=1&id=<article_id>     반영 (사람이 누른다)
 *   ?reject=1&id=<article_id>    반려
 *   ?revert=1&id=<article_id>    원래 제목·설명으로 복원
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { reportAiFailure } = require('../_lib/aiCreditWatch');
const { HTML_TAG_RE, dropKnownTags } = require('../_lib/stripHtml');

const TABLE = 'article_title_backfill';

/* 구글이 검색 결과에서 자르는 대략적 길이. 넘으면 '…' 로 잘린다. */
const TITLE_MAX = Number(process.env.TITLE_BACKFILL_TITLE_MAX || 60);
/* seo_description 은 backfill-meta-desc 가 155자로 자른다. 같은 기준을 쓴다. */
const DESC_MAX = Number(process.env.TITLE_BACKFILL_DESC_MAX || 155);

function plain(s) {
  return String(s || '').replace(HTML_TAG_RE, dropKnownTags(' ')).replace(/\s+/g, ' ').trim();
}

const TOOL = {
  name: 'emit_title',
  description: '검색어에 맞춘 제목과 메타 설명을 제출한다',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '검색 결과에 쓸 제목. ' + TITLE_MAX + '자 이내.' },
      description: { type: 'string', description: '검색 결과 설명. ' + DESC_MAX + '자 이내.' },
      note: { type: 'string', description: '어떤 검색어를 겨냥해 무엇을 바꿨는지 한 줄' },
    },
    required: ['title', 'description', 'note'],
  },
};

function buildPrompt(art, queries, qImps) {
  const qlist = (queries || []).map((q, i) => '  - "' + q + '" (노출 ' + ((qImps || [])[i] || 0) + ')').join('\n');
  return [
    '너는 PAP 매거진의 한국어 에디터다. 아래 기사는 이미 구글에 색인돼 있고,',
    '노출은 많은데 **클릭이 거의 없다.** 검색 결과에 보이는 제목과 설명을 다시 써라.',
    '',
    '이 기사가 실제로 걸리는 검색어:',
    qlist || '  (없음)',
    '',
    '절대 규칙 (어기면 실패다):',
    '1) **없는 사실을 지어내지 마라.** 근거는 아래 기사 제목·본문에 있는 것뿐이다.',
    '   날짜·수치·인물·소속사를 새로 만들어내는 것은 절대 금지다.',
    '   본문에 없으면 쓰지 마라. 모르면 안 쓰는 게 맞다.',
    '2) 위 검색어로 온 사람이 **"내가 찾던 게 이거다"** 라고 느끼게 하라.',
    '   검색어 자체를 제목 앞쪽에 자연스럽게 넣는다.',
    '3) 제목은 ' + TITLE_MAX + '자 이내. 넘으면 구글이 잘라 버린다.',
    '4) 설명은 ' + DESC_MAX + '자 이내. 제목에 없는 정보를 담아 클릭할 이유를 만든다.',
    '5) 낚시 금지. 기사에 없는 답을 약속하지 마라.',
    '6) 대시(—, –, ㅡ, --) 금지. 이모지 금지. 느낌표 금지.',
    '7) 브랜드명("PAP Magazine")은 붙이지 마라. 렌더러가 알아서 붙인다.',
    '',
    '기사 제목: ' + String(art.title || ''),
    '현재 검색용 제목: ' + (art.seo_title || '(없음 — 기사 제목이 그대로 쓰인다)'),
    '현재 검색용 설명: ' + (art.seo_description || '(없음)'),
    '카테고리: ' + (art.category || '-'),
    '본문:',
    '"""',
    plain(art.content).slice(0, 2500),
    '"""',
    '',
    'emit_title 도구로 제출하라.',
  ].join('\n');
}

async function generateTitle(art, queries, qImps) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY 없음');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.TITLE_BACKFILL_MODEL || 'claude-sonnet-4-5-20250929',
      max_tokens: 1200,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'emit_title' },
      messages: [{ role: 'user', content: buildPrompt(art, queries, qImps) }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    await reportAiFailure(r.status, t, 'article-title-backfill');
    throw new Error('AI ' + r.status + ': ' + t.slice(0, 200));
  }
  const j = await r.json();
  const block = (j.content || []).find(c => c.type === 'tool_use');
  if (!block || !block.input) throw new Error('도구 응답 없음');
  return block.input;
}

/* 초안이 규칙을 지켰는지. 자동 폐기하지 않고 사람에게 보여 준다. */
function checkTitle(art, out) {
  const issues = [];
  const t = String(out.title || '').trim();
  const d = String(out.description || '').trim();
  if (!t) issues.push('제목이 비었다');
  if (t.length > TITLE_MAX) issues.push('제목 ' + TITLE_MAX + '자 초과 (' + t.length + '자)');
  if (d.length > DESC_MAX) issues.push('설명 ' + DESC_MAX + '자 초과 (' + d.length + '자)');
  if (/[—–ㅡ]|--/.test(t + d)) issues.push('대시가 들어 있다');
  if (/[!]/.test(t + d)) issues.push('느낌표가 들어 있다');
  if (/PAP\s*Magazine/i.test(t)) issues.push('제목에 브랜드명이 들어 있다 (렌더러가 붙인다)');
  if (t === String(art.title || '').trim()) issues.push('기사 제목과 똑같다 (바뀐 게 없다)');
  return issues;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const q = req.query || {};

  try {
    /* ── 큐 채우기 ─────────────────────────────────────── */
    if (q.enqueue === '1') {
      const limit   = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
      const minImp  = Math.max(parseInt(q.min_imp, 10) || 4000, 0);
      const maxCtr  = Number(q.max_ctr || 2.0);
      const preview = q.preview === '1';

      const { data: opp, error: oErr } = await supabaseAdmin
        .from('article_seo_opportunity')
        .select('article_id, slug, title, impressions, clicks, ctr, avg_position')
        .gte('impressions', minImp)
        .lte('ctr', maxCtr)
        .order('impressions', { ascending: false })
        .limit(limit * 3);
      if (oErr) throw new Error('article_seo_opportunity: ' + oErr.message);

      const ids = (opp || []).map(o => o.article_id);
      if (!ids.length) return res.status(200).json({ ok: true, 넣음: 0, message: '조건에 맞는 기사가 없습니다.' });

      const { data: matches } = await supabaseAdmin
        .from('article_query_match')
        .select('article_id, queries, query_impressions')
        .in('article_id', ids);
      const byId = {};
      (matches || []).forEach(m => { byId[m.article_id] = m; });

      const { data: seen } = await supabaseAdmin.from(TABLE).select('article_id').in('article_id', ids);
      const has = new Set((seen || []).map(r => r.article_id));

      /* 붙은 검색어를 못 찾은 기사는 넣지 않는다 — 무엇을 겨냥할지 모르면 고칠 수 없다 */
      const picked = (opp || [])
        .filter(o => !has.has(o.article_id) && byId[o.article_id] && (byId[o.article_id].queries || []).length)
        .slice(0, limit);

      if (preview) {
        return res.status(200).json({
          ok: true, preview: true, 후보: picked.length,
          목록: picked.map(o => ({
            노출: Number(o.impressions), 클릭: Number(o.clicks), ctr: o.ctr, 순위: o.avg_position,
            검색어: byId[o.article_id].queries, 제목: o.title,
          })),
        });
      }
      if (!picked.length) return res.status(200).json({ ok: true, 넣음: 0, message: '새 대상이 없습니다.' });

      const { error: iErr } = await supabaseAdmin.from(TABLE).insert(picked.map(o => ({
        article_id: o.article_id,
        impressions: Number(o.impressions) || 0,
        clicks: Number(o.clicks) || 0,
        ctr: o.ctr,
        avg_position: o.avg_position,
        queries: byId[o.article_id].queries,
        status: 'queued',
      })));
      if (iErr) throw new Error('큐 입력 실패: ' + iErr.message);

      return res.status(200).json({
        ok: true, 넣음: picked.length,
        합계노출: picked.reduce((s, o) => s + (Number(o.impressions) || 0), 0),
        목록: picked.map(o => ({ 노출: Number(o.impressions), ctr: o.ctr, 검색어: byId[o.article_id].queries, 제목: o.title })),
      });
    }

    /* ── 초안 생성 ─────────────────────────────────────── */
    if (q.generate_next === '1') {
      const { data: rows } = await supabaseAdmin.from(TABLE)
        .select('article_id, queries, query_impressions')
        .eq('status', 'queued').order('impressions', { ascending: false }).limit(1);
      const row = (rows || [])[0];
      if (!row) return res.status(200).json({ done: true, message: '대기 중인 대상이 없습니다.' });

      const { data: art, error: aErr } = await supabaseAdmin.from('articles')
        .select('id, title, content, category, seo_title, seo_description')
        .eq('id', row.article_id).single();
      if (aErr || !art) throw new Error('기사를 찾지 못함: ' + row.article_id);

      let out;
      try {
        out = await generateTitle(art, row.queries, row.query_impressions);
      } catch (e) {
        await supabaseAdmin.from(TABLE)
          .update({ status: 'rejected', note: '생성 실패: ' + ((e && e.message) || e) })
          .eq('article_id', row.article_id);
        throw e;
      }

      const issues = checkTitle(art, out);
      await supabaseAdmin.from(TABLE).update({
        old_title: art.seo_title || art.title,
        new_title: String(out.title || '').trim(),
        old_desc: art.seo_description || null,
        new_desc: String(out.description || '').trim(),
        note: String(out.note || '') + (issues.length ? ' / ⚠ ' + issues.join(' · ') : ''),
        status: 'draft',
        generated_at: new Date().toISOString(),
      }).eq('article_id', row.article_id);

      return res.status(200).json({
        generated: true, article_id: row.article_id,
        old_title: art.seo_title || art.title, new_title: out.title,
        new_desc: out.description, issues,
      });
    }

    /* ── 반영 / 반려 / 되돌리기 ─────────────────────────── */
    if (q.apply === '1' && q.id) {
      const { data: row } = await supabaseAdmin.from(TABLE)
        .select('*').eq('article_id', String(q.id)).maybeSingle();
      if (!row || !row.new_title) return res.status(404).json({ error: '초안을 찾지 못함' });
      const { error: uErr } = await supabaseAdmin.from('articles')
        .update({ seo_title: row.new_title, seo_description: row.new_desc })
        .eq('id', row.article_id);
      if (uErr) throw new Error('반영 실패: ' + uErr.message);
      await supabaseAdmin.from(TABLE)
        .update({ status: 'applied', applied_at: new Date().toISOString() })
        .eq('article_id', row.article_id);
      return res.status(200).json({ ok: true, applied: row.article_id });
    }

    if (q.reject === '1' && q.id) {
      await supabaseAdmin.from(TABLE).update({ status: 'rejected' }).eq('article_id', String(q.id));
      return res.status(200).json({ ok: true, rejected: String(q.id) });
    }

    if (q.revert === '1' && q.id) {
      const { data: row } = await supabaseAdmin.from(TABLE)
        .select('*').eq('article_id', String(q.id)).maybeSingle();
      if (!row) return res.status(404).json({ error: '기록을 찾지 못함' });
      const { error: uErr } = await supabaseAdmin.from('articles')
        .update({ seo_title: row.old_title, seo_description: row.old_desc })
        .eq('id', row.article_id);
      if (uErr) throw new Error('되돌리기 실패: ' + uErr.message);
      await supabaseAdmin.from(TABLE).update({ status: 'reverted' }).eq('article_id', row.article_id);
      return res.status(200).json({ ok: true, reverted: row.article_id });
    }

    /* ── 검토 화면 ─────────────────────────────────────── */
    if (q.review === '1') {
      const { data: rows } = await supabaseAdmin.from(TABLE)
        .select('*').eq('status', 'draft').order('impressions', { ascending: false }).limit(60);
      const ids = (rows || []).map(r => r.article_id);
      const { data: arts } = ids.length
        ? await supabaseAdmin.from('articles').select('id, title, slug, custom_url').in('id', ids)
        : { data: [] };
      const byId = {}; (arts || []).forEach(a => { byId[a.id] = a; });

      const cards = (rows || []).map(r => {
        const a = byId[r.article_id] || {};
        const warn = /⚠/.test(r.note || '');
        return [
          '<div class="card">',
          '<h2>' + esc(a.title || '(제목 없음)') + '</h2>',
          '<div class="m">노출 ' + (r.impressions || 0).toLocaleString() + ' · 클릭 ' + (r.clicks || 0)
            + ' · CTR ' + (r.ctr || 0) + '% · 순위 ' + (r.avg_position || '-') + '</div>',
          '<div class="q">겨냥한 검색어: ' + esc((r.queries || []).join(' · ')) + '</div>',
          warn ? '<div class="warn">' + esc(r.note) + '</div>' : '<div class="note">' + esc(r.note) + '</div>',
          '<div class="two">',
          '<div><b>지금 검색에 보이는 제목</b><p>' + esc(r.old_title) + '</p>',
          '<b>지금 설명</b><p class="d">' + esc(r.old_desc || '(없음)') + '</p></div>',
          '<div><b>새 제목</b><p class="new">' + esc(r.new_title) + '</p>',
          '<b>새 설명</b><p class="d new">' + esc(r.new_desc) + '</p></div>',
          '</div>',
          '<div class="btns">',
          '<a class="go" href="?apply=1&id=' + esc(r.article_id) + '">이 건만 적용</a>',
          '<a class="no" href="?reject=1&id=' + esc(r.article_id) + '">버리기</a>',
          '<a class="link" href="/article/' + esc(a.custom_url || a.slug || '') + '" target="_blank">기사 보기</a>',
          '</div>',
          '</div>',
        ].join('');
      }).join('');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(
        '<!doctype html><meta charset="utf-8"><title>제목 보강 검토 · PAP</title>'
        + '<style>body{font:15px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;'
        + 'max-width:1060px;margin:24px auto;padding:0 16px;color:#111}'
        + '.card{border:1px solid #e5e5e5;border-radius:12px;padding:20px;margin:18px 0}'
        + 'h2{font-size:19px;margin:0 0 4px}.m{color:#666;font-size:13px}'
        + '.q{background:#eef4ff;padding:8px 12px;border-radius:8px;margin:10px 0;font-size:14px}'
        + '.note{background:#f7f7f7;padding:8px 12px;border-radius:8px;font-size:13px;color:#444}'
        + '.warn{background:#fff4e5;padding:8px 12px;border-radius:8px;font-size:13px;color:#8a4b00}'
        + '.two{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:14px 0}'
        + '@media(max-width:720px){.two{grid-template-columns:1fr}}'
        + 'p{margin:4px 0 12px}.d{color:#555;font-size:14px}.new{font-weight:600}'
        + '.btns a{display:inline-block;padding:8px 16px;border-radius:8px;text-decoration:none;margin-right:8px;font-size:14px}'
        + '.go{background:#111;color:#fff}.no{background:#eee;color:#333}.link{background:#eef;color:#225}'
        + '</style>'
        + '<h1>제목 보강 검토</h1>'
        + '<p>노출은 많은데 클릭이 없는 기사들이다. <b>사이트에 보이는 제목은 그대로</b>다. 검색 결과에만 쓰이는 제목·설명을 바꾼다.</p>'
        + '<p>겨냥한 검색어로 온 사람이 "이거다" 싶은지만 보면 된다. 되돌리기는 <code>?revert=1&id=…</code>.</p>'
        + (cards || '<p>검토할 초안이 없습니다.</p>')
      );
    }

    if (q.queue === '1') {
      const { data } = await supabaseAdmin.from(TABLE)
        .select('article_id, impressions, clicks, ctr, avg_position, queries, old_title, new_title, status, note')
        .order('status', { ascending: true }).order('impressions', { ascending: false }).limit(200);
      return res.status(200).json({ queue: data || [] });
    }

    return res.status(400).json({
      error: '무엇을 할지 정해야 한다',
      사용법: ['?enqueue=1&preview=1', '?enqueue=1&limit=20', '?generate_next=1', '?review=1',
               '?apply=1&id=<article_id>', '?reject=1&id=…', '?revert=1&id=…', '?queue=1'],
    });
  } catch (e) {
    console.error('[article-title-backfill]', e);
    return res.status(500).json({ error: (e && e.message) || 'unknown' });
  }
};
