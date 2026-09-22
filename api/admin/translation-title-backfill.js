/**
 * GET /api/admin/translation-title-backfill — 언어판 제목 단축 (관리자 전용)
 *
 * [왜] Ahrefs Site Audit(2026-09-15 크롤, 10,031페이지)의 경고 1,623건 가운데
 * 1,338건이 "Title too long" 이고, 열어 보면 전부 /fr /de /es /it /ru 언어판이다.
 * DB 전수 실측(seo_translations, kind='article'):
 *   fr 1,395건 · de 1,352 · es 1,352 · it 1,289 · ru 1,172 이 60자 초과.
 *   최장 133자. 반면 ja 9건 · zh 3건 — 글자가 압축적이라 같은 프롬프트로도 괜찮다.
 *
 * [생성 쪽은 이미 막혀 있다] 2026-08-20 커밋 b23b31b 가 번역 프롬프트에
 * 언어별 상한(TITLE_MAX)을 걸었다. 실측으로 효과가 확인된다:
 *   8/20 이전 생성분 48.7~57.7% 가 60자 초과 → 이후 생성분 1.9~4.6%.
 * 그러니 남은 것은 전부 레거시이고, 필요한 건 프롬프트 수정이 아니라
 * 기존 행을 되쓰는 도구다. 158(본문)·159(한글 제목)와 똑같은 종류의 구멍이었다.
 *
 * [무엇을 바꾸나 — 중요]
 * `seo_translations.title` 만 바꾼다. 한글 원제(articles.title)도,
 * 본문도, 발행 상태도 건드리지 않는다. 원본은 old_title 에 통째로 남긴다.
 *
 * [무엇을 안 하나] 새 사실을 쓰지 않는다. 이 도구는 **번역을 다시 하는 게 아니라
 * 이미 있는 번역 제목에서 곁가지를 덜어내는 일**이다. 한글 원제는 '무엇이
 * 핵심인지' 판단하는 근거로만 쓰고, 원제에 없는 정보는 넣지 않는다.
 *
 * [범위] 노출이 실제로 잡힌 것만 (도메니코 결정 2026-09-15). 뷰
 * translation_title_targets(마이그레이션 161)가 최근 28일 GSC 노출이 있는
 * 60자 초과 행만 준다. 상위 206건이 대상 노출의 68% 를 가져간다.
 *
 *   ?enqueue=1&min_imp=50&limit=40   후보를 큐에 넣는다 (preview=1 로 먼저 본다)
 *   ?generate_next=1[&n=5]           다음 초안 생성
 *   ?review=1                        검토 화면
 *   ?apply=1&id=<content_id>&lang=de 반영 (사람이 누른다)
 *   ?reject=1&id=…&lang=…            반려
 *   ?revert=1&id=…&lang=…            원래 제목으로 복원
 *   ?queue=1                         현황 JSON
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { reportAiFailure } = require('../_lib/aiCreditWatch');
const {
  TITLE_MAX, LANG_NAMES, hasHangul, isEnglishEcho,
} = require('../_lib/seoTranslateBackfill');

const TABLE = 'translation_title_backfill';
const TARGETS_VIEW = 'translation_title_targets';

/* 이 도구가 다루는 언어. ja/zh 는 60자 초과가 각각 9건·3건뿐이라 뺀다 —
   도구를 돌릴 값어치가 없다. en 은 seo_translations 에 행이 없다(title_en 사용). */
const LANGS = ['it', 'fr', 'es', 'de', 'ru'];

/* 157 의 교훈: "남은 것" 판별은 코드가 아니라 DB 가 한다.
   코드에서 거르면 상위가 막혔을 때 조용히 빈 배열이 나오고 도구가 헛돈다. */
function targetQuery(columns, selectOpts) {
  return supabaseAdmin.from(TARGETS_VIEW).select(columns, selectOpts);
}

function maxFor(lang) {
  return Number(TITLE_MAX[lang] || 60);
}

const TOOL = {
  name: 'emit_short_title',
  description: '검색 결과에서 잘리지 않는 길이로 줄인 제목을 제출한다',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '줄인 제목. 상한 글자 수 이내여야 한다.' },
      note: { type: 'string', description: '무엇을 덜어냈는지 한 줄' },
    },
    required: ['title', 'note'],
  },
};

function buildPrompt(row) {
  const lang = row.lang;
  const max = maxFor(lang);
  const name = LANG_NAMES[lang] || lang;
  return [
    'You are a magazine copy editor for PAP MAGAZINE working in ' + name + '.',
    '',
    'The ' + name + ' title below is a faithful translation of a Korean headline,',
    'but it is ' + row.cur_len + ' characters long. Google cuts search-result titles',
    'off at roughly 600 pixels, so everything past about ' + max + ' characters is',
    'invisible to the reader. Rewrite it shorter.',
    '',
    'Korean original headline (context only): ' + String(row.ko_title || ''),
    'Current ' + name + ' title (' + row.cur_len + ' chars): ' + String(row.cur_title || ''),
    '',
    'Hard rules. Breaking any one of them is a failure:',
    '1) The result MUST be at most ' + max + ' characters, including spaces.',
    '2) Write it in ' + name + '. Not English, not Korean. No Hangul anywhere.',
    '3) Invent nothing. Every fact must already be in the two titles above.',
    '   Do not add dates, numbers, people, seasons or collection names that are not there.',
    '4) Keep the brand name or person name, and the single most important fact.',
    '   Drop subordinate clauses, appositions and explanatory tails first.',
    '5) Keep brand names and stylized Latin titles in their original spelling',
    '   (Prada, Comme des Garcons, "CRIMSON").',
    '6) No dashes (em dash, en dash, double hyphen). No emoji. No exclamation marks.',
    '7) Do not append "PAP Magazine" or any site name. The renderer adds it.',
    '8) Never pad a title to reach the limit. Shorter is fine.',
    '',
    'Submit with the emit_short_title tool. Write the note in Korean, one line.',
  ].join('\n');
}

async function generateTitle(row) {
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
      model: process.env.TRANSLATION_TITLE_MODEL || 'claude-sonnet-4-5-20250929',
      max_tokens: 700,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'emit_short_title' },
      messages: [{ role: 'user', content: buildPrompt(row) }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    await reportAiFailure(r.status, t, 'translation-title-backfill');
    throw new Error('AI ' + r.status + ': ' + t.slice(0, 200));
  }
  const j = await r.json();
  const block = (j.content || []).find(c => c.type === 'tool_use');
  if (!block || !block.input) throw new Error('도구 응답 없음');
  return block.input;
}

/* 초안이 규칙을 지켰는지. 자동 폐기하지 않고 사람에게 ⚠ 로 보여 준다 —
   159 에서 배운 방식이다. 기계가 버리면 왜 버렸는지 아무도 모른다. */
function checkTitle(row, out) {
  const issues = [];
  const t = String(out && out.title || '').trim();
  const max = maxFor(row.lang);
  if (!t) issues.push('제목이 비었다');
  if (t.length > max) issues.push(max + '자 초과 (' + t.length + '자)');
  if (hasHangul(t)) issues.push('한글이 남아 있다');
  if (isEnglishEcho(t, row.ko_title, row.lang)) issues.push('영어 원문을 그대로 베꼈다');
  if (/[—–ㅡ]|--/.test(t)) issues.push('대시가 들어 있다');
  if (/!/.test(t)) issues.push('느낌표가 들어 있다');
  if (/PAP\s*Magazine/i.test(t)) issues.push('브랜드명이 들어 있다 (렌더러가 붙인다)');
  if (t === String(row.cur_title || '').trim()) issues.push('원래 제목과 똑같다 (바뀐 게 없다)');
  /* 너무 많이 잘라낸 것도 사고다. 원본의 3분의 1 미만이면 내용이 날아간 것이다. */
  if (t && row.cur_len && t.length < Math.round(row.cur_len / 3)) {
    issues.push('원본의 3분의 1 미만으로 줄었다 (' + row.cur_len + ' → ' + t.length + '자)');
  }
  return issues;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* (content_id, lang) 복합키 — 159 는 article_id 단일키였다.
   같은 기사의 독일어판과 러시아어판은 서로 다른 건이다. */
function keyed(qb, id, lang) {
  return qb.eq('content_id', id).eq('lang', lang);
}

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const q = req.query || {};
  const id = q.id ? String(q.id) : '';
  const lang = q.lang ? String(q.lang) : '';

  try {
    /* ── 큐 채우기 ─────────────────────────────────────── */
    if (q.enqueue === '1') {
      const limit   = Math.min(Math.max(parseInt(q.limit, 10) || 40, 1), 200);
      const minImp  = Math.max(parseInt(q.min_imp, 10) || 50, 0);
      const preview = q.preview === '1';
      const only    = LANGS.includes(String(q.only || '')) ? String(q.only) : '';

      let tq = targetQuery('content_id, lang, slug, ko_title, cur_title, cur_len, impressions, clicks, ctr, avg_position')
        .gte('impressions', minImp)
        .order('impressions', { ascending: false })
        .limit(limit * 3);
      if (only) tq = tq.eq('lang', only);
      const { data: cands, error: tErr } = await tq;
      if (tErr) throw new Error(TARGETS_VIEW + ': ' + tErr.message);
      if (!(cands || []).length) {
        return res.status(200).json({ ok: true, 넣음: 0, message: '조건에 맞는 대상이 없습니다.' });
      }

      /* 이미 장부에 있는 건 제외. 복합키라 문자열로 합쳐 비교한다. */
      const ids = [...new Set(cands.map(c => c.content_id))];
      const { data: seen } = await supabaseAdmin.from(TABLE)
        .select('content_id, lang').in('content_id', ids);
      const has = new Set((seen || []).map(r => r.content_id + '|' + r.lang));

      const picked = cands.filter(c => !has.has(c.content_id + '|' + c.lang)).slice(0, limit);

      if (preview) {
        return res.status(200).json({
          ok: true, preview: true, 후보: picked.length,
          합계노출: picked.reduce((s, c) => s + (Number(c.impressions) || 0), 0),
          목록: picked.map(c => ({
            언어: c.lang, 노출: Number(c.impressions), 클릭: Number(c.clicks),
            ctr: c.ctr, 순위: c.avg_position, 길이: c.cur_len, 제목: c.cur_title,
          })),
        });
      }
      if (!picked.length) return res.status(200).json({ ok: true, 넣음: 0, message: '새 대상이 없습니다.' });

      const { error: iErr } = await supabaseAdmin.from(TABLE).insert(picked.map(c => ({
        content_id: c.content_id,
        lang: c.lang,
        impressions: Number(c.impressions) || 0,
        clicks: Number(c.clicks) || 0,
        ctr: c.ctr,
        avg_position: c.avg_position,
        ko_title: c.ko_title,
        old_title: c.cur_title,
        old_len: c.cur_len,
        status: 'queued',
      })));
      if (iErr) throw new Error('큐 입력 실패: ' + iErr.message);

      return res.status(200).json({
        ok: true, 넣음: picked.length,
        합계노출: picked.reduce((s, c) => s + (Number(c.impressions) || 0), 0),
        언어별: LANGS.reduce((m, L) => {
          const n = picked.filter(c => c.lang === L).length; if (n) m[L] = n; return m;
        }, {}),
      });
    }

    /* ── 초안 생성 ─────────────────────────────────────── */
    if (q.generate_next === '1') {
      const n = Math.min(Math.max(parseInt(q.n, 10) || 1, 1), 10);
      const { data: rows } = await supabaseAdmin.from(TABLE)
        .select('content_id, lang, ko_title, old_title, old_len')
        .eq('status', 'queued').order('impressions', { ascending: false }).limit(n);
      if (!(rows || []).length) {
        return res.status(200).json({ done: true, message: '대기 중인 대상이 없습니다.' });
      }

      const done = [];
      for (const row of rows) {
        const src = {
          lang: row.lang, ko_title: row.ko_title,
          cur_title: row.old_title, cur_len: row.old_len,
        };
        let out;
        try {
          out = await generateTitle(src);
        } catch (e) {
          await keyed(supabaseAdmin.from(TABLE)
            .update({ status: 'rejected', note: '생성 실패: ' + ((e && e.message) || e) }),
            row.content_id, row.lang);
          done.push({ content_id: row.content_id, lang: row.lang, error: String((e && e.message) || e) });
          continue;
        }
        const title = String(out.title || '').trim();
        const issues = checkTitle(src, out);
        await keyed(supabaseAdmin.from(TABLE).update({
          new_title: title,
          new_len: title.length,
          note: String(out.note || '') + (issues.length ? ' / ⚠ ' + issues.join(' · ') : ''),
          status: 'draft',
          generated_at: new Date().toISOString(),
        }), row.content_id, row.lang);
        done.push({
          content_id: row.content_id, lang: row.lang,
          old: row.old_title, old_len: row.old_len,
          new: title, new_len: title.length, issues,
        });
      }
      return res.status(200).json({ generated: done.length, 목록: done });
    }

    /* ── 반영 / 반려 / 되돌리기 ─────────────────────────── */
    if (q.apply === '1' && id && lang) {
      const { data: row } = await keyed(supabaseAdmin.from(TABLE).select('*'), id, lang).maybeSingle();
      if (!row || !row.new_title) return res.status(404).json({ error: '초안을 찾지 못함' });
      const { error: uErr } = await supabaseAdmin.from('seo_translations')
        .update({ title: row.new_title })
        .eq('content_id', id).eq('lang', lang).eq('kind', 'article');
      if (uErr) throw new Error('반영 실패: ' + uErr.message);
      await keyed(supabaseAdmin.from(TABLE)
        .update({ status: 'applied', applied_at: new Date().toISOString() }), id, lang);
      return res.status(200).json({ ok: true, applied: id, lang, new_title: row.new_title });
    }

    if (q.reject === '1' && id && lang) {
      await keyed(supabaseAdmin.from(TABLE).update({ status: 'rejected' }), id, lang);
      return res.status(200).json({ ok: true, rejected: id, lang });
    }

    if (q.revert === '1' && id && lang) {
      const { data: row } = await keyed(supabaseAdmin.from(TABLE).select('*'), id, lang).maybeSingle();
      if (!row) return res.status(404).json({ error: '기록을 찾지 못함' });
      const { error: uErr } = await supabaseAdmin.from('seo_translations')
        .update({ title: row.old_title })
        .eq('content_id', id).eq('lang', lang).eq('kind', 'article');
      if (uErr) throw new Error('되돌리기 실패: ' + uErr.message);
      await keyed(supabaseAdmin.from(TABLE).update({ status: 'reverted' }), id, lang);
      return res.status(200).json({ ok: true, reverted: id, lang });
    }

    /* ── 검토 화면 ─────────────────────────────────────── */
    if (q.review === '1') {
      const { data: rows } = await supabaseAdmin.from(TABLE)
        .select('*').eq('status', 'draft').order('impressions', { ascending: false }).limit(60);
      const ids = [...new Set((rows || []).map(r => r.content_id))];
      const { data: arts } = ids.length
        ? await supabaseAdmin.from('articles').select('id, title, slug, custom_url').in('id', ids)
        : { data: [] };
      const byId = {}; (arts || []).forEach(a => { byId[a.id] = a; });

      const cards = (rows || []).map(r => {
        const a = byId[r.content_id] || {};
        const warn = /⚠/.test(r.note || '');
        const max = maxFor(r.lang);
        const handle = a.custom_url || a.slug || '';
        const kq = '&id=' + encodeURIComponent(r.content_id) + '&lang=' + encodeURIComponent(r.lang);
        return [
          '<div class="card">',
          '<h2><span class="lang">' + esc(r.lang) + '</span> ' + esc(a.title || '(제목 없음)') + '</h2>',
          '<div class="m">노출 ' + (r.impressions || 0).toLocaleString() + ' · 클릭 ' + (r.clicks || 0)
            + ' · CTR ' + (r.ctr || 0) + '% · 순위 ' + (r.avg_position || '-')
            + ' · 상한 ' + max + '자</div>',
          warn ? '<div class="warn">' + esc(r.note) + '</div>' : '<div class="note">' + esc(r.note) + '</div>',
          '<div class="two">',
          '<div><b>지금 (' + (r.old_len || 0) + '자 · 잘린다)</b><p class="old">' + esc(r.old_title) + '</p></div>',
          '<div><b>새 제목 (' + (r.new_len || 0) + '자)</b><p class="new">' + esc(r.new_title) + '</p></div>',
          '</div>',
          '<div class="btns">',
          '<a class="go" href="?apply=1' + kq + '">이 건만 적용</a>',
          '<a class="no" href="?reject=1' + kq + '">버리기</a>',
          '<a class="link" href="/' + esc(r.lang) + '/article/' + esc(handle) + '" target="_blank">언어판 보기</a>',
          '</div>',
          '</div>',
        ].join('');
      }).join('');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(
        '<!doctype html><meta charset="utf-8"><title>언어판 제목 단축 검토 · PAP</title>'
        + '<style>body{font:15px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;'
        + 'max-width:1060px;margin:24px auto;padding:0 16px;color:#111}'
        + '.card{border:1px solid #e5e5e5;border-radius:12px;padding:20px;margin:18px 0}'
        + 'h2{font-size:18px;margin:0 0 4px}.m{color:#666;font-size:13px}'
        + '.lang{background:#111;color:#fff;border-radius:6px;padding:1px 7px;font-size:12px;'
        + 'vertical-align:middle;text-transform:uppercase}'
        + '.note{background:#f7f7f7;padding:8px 12px;border-radius:8px;font-size:13px;color:#444;margin:10px 0}'
        + '.warn{background:#fff4e5;padding:8px 12px;border-radius:8px;font-size:13px;color:#8a4b00;margin:10px 0}'
        + '.two{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:14px 0}'
        + '@media(max-width:720px){.two{grid-template-columns:1fr}}'
        + 'p{margin:4px 0 12px}.old{color:#777}.new{font-weight:600}'
        + '.btns a{display:inline-block;padding:8px 16px;border-radius:8px;text-decoration:none;margin-right:8px;font-size:14px}'
        + '.go{background:#111;color:#fff}.no{background:#eee;color:#333}.link{background:#eef;color:#225}'
        + '</style>'
        + '<h1>언어판 제목 단축 검토</h1>'
        + '<p>구글이 검색 결과에서 잘라 버리는 길이의 번역 제목들이다. '
        + '<b>한글 원제와 본문은 그대로</b>다. 해당 언어판의 제목만 짧게 바꾼다.</p>'
        + '<p>보는 법: 왼쪽이 지금, 오른쪽이 새 제목. 핵심(브랜드·인물·무슨 일)이 살아 있으면 통과다. '
        + '되돌리기는 <code>?revert=1&amp;id=…&amp;lang=…</code>.</p>'
        + (cards || '<p>검토할 초안이 없습니다.</p>')
      );
    }

    /* ── 현황 ──────────────────────────────────────────── */
    if (q.queue === '1') {
      /* 2026-09-22 — 에러를 버리고 remaining || 0 을 돌려줘서, 뷰가 시간 초과
         (PostgREST 8초)로 실패한 날 4,394건이 남았는데 "0" 으로 보였다.
         0 은 "다 끝났다" 로 읽히는 가장 위험한 거짓말이다. 실패면 null 과 이유를 준다. */
      const { count: remaining, error: remErr } = await targetQuery('content_id', { count: 'exact', head: true });
      const { data } = await supabaseAdmin.from(TABLE)
        .select('content_id, lang, impressions, clicks, ctr, old_len, new_len, old_title, new_title, status, note')
        .order('status', { ascending: true }).order('impressions', { ascending: false }).limit(200);
      const by = {};
      (data || []).forEach(r => { by[r.status] = (by[r.status] || 0) + 1; });
      const remainingOut = remErr ? null : (typeof remaining === 'number' ? remaining : null);
      return res.status(200).json({
        남은대상: remainingOut,
        ...(remainingOut === null ? { 남은대상_오류: (remErr && remErr.message) || '개수를 받지 못했다' } : {}),
        상태별: by, queue: data || [],
      });
    }

    return res.status(400).json({
      error: '무엇을 할지 정해야 한다',
      사용법: ['?enqueue=1&preview=1', '?enqueue=1&min_imp=50&limit=40', '?generate_next=1&n=5',
               '?review=1', '?apply=1&id=<content_id>&lang=de', '?reject=1&id=…&lang=…',
               '?revert=1&id=…&lang=…', '?queue=1'],
    });
  } catch (e) {
    console.error('[translation-title-backfill]', e);
    return res.status(500).json({ error: (e && e.message) || 'unknown' });
  }
};

/* 검증용 노출 (tests/translation-title-backfill.test.js) */
module.exports.LANGS = LANGS;
module.exports.maxFor = maxFor;
module.exports.buildPrompt = buildPrompt;
module.exports.checkTitle = checkTitle;
module.exports.targetQuery = targetQuery;
module.exports.TARGETS_VIEW = TARGETS_VIEW;
module.exports.TABLE = TABLE;
