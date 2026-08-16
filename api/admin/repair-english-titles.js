/**
 * POST/GET /api/admin/repair-english-titles
 *
 * 영어로 저장된 다국어 제목만 골라 다시 번역한다. 본문은 건드리지 않는다.
 * 배경·안전장치는 api/_lib/titleRepair.js 주석 참조.
 *
 * 쿼리:
 *   ?lang=es|it|fr|de   (기본: 전부)
 *   ?limit=N            한 번에 볼 행 수 (기본 40, 최대 200)
 *   ?batch=N            한 번의 Claude 호출에 묶을 제목 수 (기본 20, 최대 40)
 *   ?apply=1            **이걸 켜야 DB 에 쓴다.** 없으면 dry-run (기본값)
 *
 * 하는 일 / 안 하는 일:
 *   ✅ seo_translations.title 만 UPDATE
 *   ❌ 발행 상태 변경 · 본문 수정 · 삭제 — 하나도 하지 않는다
 *
 * dry-run 이 기본인 이유: 도메니코의 돈이 드는 호출이고, 무엇이 바뀔지
 * 먼저 눈으로 보고 결정할 수 있어야 한다. dry-run 도 번역은 실제로 돌린다
 * (그래야 결과를 보여줄 수 있다) — 쓰기만 안 한다.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { callClaude } = require('../_lib/seoTranslateBackfill');
const {
  REPAIR_LANGS, needsRepair, buildTitlePrompt, parseTitles, rejectReason,
} = require('../_lib/titleRepair');

const PAGE = 1000;

/** 영어 에코 후보를 모은다. 판정은 needsRepair 가 한다(규칙이 두 벌이면 안 된다). */
async function collectCandidates(langs, limit) {
  const out = [];
  for (let from = 0; out.length < limit; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('seo_translations')
      .select('content_id, lang, title')
      .eq('kind', 'article')
      .in('lang', langs)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;

    const ids = [...new Set(data.map(r => r.content_id))];
    const { data: arts } = await supabaseAdmin
      .from('articles').select('id, title, title_en').in('id', ids);
    const byId = new Map((arts || []).map(a => [a.id, a]));

    for (const r of data) {
      const a = byId.get(r.content_id);
      if (!a) continue;
      const row = {
        content_id: r.content_id, lang: r.lang, title: r.title,
        title_en: a.title_en, title_ko: a.title,
      };
      if (needsRepair(row)) out.push(row);
      if (out.length >= limit) break;
    }
    if (data.length < PAGE) break;
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;

  const langQ = String(req.query.lang || '').toLowerCase();
  const langs = REPAIR_LANGS.includes(langQ) ? [langQ] : REPAIR_LANGS;
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 40));
  const batchSize = Math.max(1, Math.min(40, parseInt(req.query.batch, 10) || 20));
  const apply = req.query.apply === '1' || req.query.apply === 'true';
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 미설정' });
  }

  try {
    const rows = await collectCandidates(langs, limit);
    if (!rows.length) {
      return res.status(200).json({
        apply, scanned: 0, repaired: 0, samples: [],
        note: '영어 에코 후보가 없습니다. 이미 다 고쳐졌거나 조건에 맞는 행이 없습니다.',
      });
    }

    // 언어별로 묶는다 — 프롬프트가 언어마다 다르다
    const byLang = new Map();
    for (const r of rows) {
      if (!byLang.has(r.lang)) byLang.set(r.lang, []);
      byLang.get(r.lang).push(r);
    }

    let repaired = 0, rejected = 0, calls = 0;
    const rejectStats = {};
    const samples = [];

    for (const [lang, list] of byLang) {
      for (let i = 0; i < list.length; i += batchSize) {
        const items = list.slice(i, i + batchSize);
        let text = '';
        try {
          calls++;
          const r = await callClaude(buildTitlePrompt(items, lang), 2000, model, 60000);
          text = r.text;
        } catch (e) {
          console.warn('[repair-titles] Claude 실패', lang, (e && e.message) || e);
          continue;
        }
        for (const got of parseTitles(text)) {
          const row = items[got.i];
          if (!row) continue;
          const bad = rejectReason(got.title, row);
          if (bad) {
            rejected++;
            rejectStats[bad] = (rejectStats[bad] || 0) + 1;
            continue;
          }
          const clean = got.title.trim();
          if (apply) {
            const { error } = await supabaseAdmin.from('seo_translations')
              .update({ title: clean, updated_at: new Date().toISOString() })
              .eq('kind', 'article').eq('content_id', row.content_id).eq('lang', lang);
            if (error) { rejected++; rejectStats.db_error = (rejectStats.db_error || 0) + 1; continue; }
          }
          repaired++;
          if (samples.length < 12) samples.push({ lang, before: row.title, after: clean });
        }
      }
    }

    return res.status(200).json({
      apply,
      note: apply
        ? 'DB 에 반영했습니다.'
        : 'dry-run 입니다 — 아무것도 저장하지 않았습니다. 반영하려면 ?apply=1 을 붙이세요.',
      scanned: rows.length,
      repaired,
      rejected,
      reject_reasons: rejectStats,
      claude_calls: calls,
      samples,
    });
  } catch (e) {
    console.error('[repair-english-titles] failed:', e);
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
