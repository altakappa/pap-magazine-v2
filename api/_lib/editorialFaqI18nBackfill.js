/**
 * editorialFaqI18nBackfill.js — 화보 FAQ 언어판 소급 백필 (2026-08-27 신설)
 *
 * 왜: 화보 FAQ(editorials.faq)는 8/27 에 생겼고 번역 배선도 같은 날 붙었다.
 * 다만 그 배선은 **신규·재번역분부터**다 — 이미 번역이 끝난 화보는 doneField
 * (description)가 채워져 있어 본 백필이 통째로 건너뛴다. 그래서 기존 화보의
 * 8개 언어판은 FAQ 블록이 영영 비어 있게 된다.
 *
 * 무엇: 원본 faq 는 있는데 번역행 faq 가 비어 있는 조합만 골라 **FAQ 만** 번역한다.
 * 설명문·제목은 건드리지 않는다 — 이미 번역돼 있고 다시 만들면 품질이 흔들린다.
 *
 * 범위 (도메니코 2026-08-27 판정 "최근분만"):
 *   최근 EDITORIAL_FAQ_I18N_RECENT(기본 300)편. 전량은 비용이 약 8배다.
 *   원본 FAQ 생성이 아직 진행 중이므로 이 크론은 생성 진도를 자연히 따라간다 —
 *   faq 가 생긴 것만 대상이 되기 때문이다.
 *
 * 안전장치:
 *   - 번역행이 이미 있는 것만 UPDATE. 새 행을 만들지 않는다(설명문 빈 행 방지).
 *   - 항목 수가 원본과 다르면 버린다. 반쪽 FAQ 를 저장하지 않는다.
 *   - 실패는 저장하지 않고 다음 회차 재시도. 원본 faq 가 없으면 아무것도 안 한다.
 */

'use strict';

const { supabaseAdmin } = require('./supabase');
const { normalizeFaq, callClaude, LANG_NAMES } = require('./seoTranslateBackfill');

/* ko 는 원본, en 은 faq_en 칼럼(마이그레이션 139 · faqEnBackfill.js)이 담당한다.
   2026-08-28 까지 이 목록에 'en' 이 있었지만 죽은 항목이었다 — 이 백필은
   **기존 번역행 UPDATE 만** 하는데 seo_translations 에 en 행은 0개다.
   매 회차 조회 0건으로 조용히 넘어가느라 죽은 줄도 안 보였다. */
const TARGET_LANGS = ['it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'];

function recentLimit() {
  const n = parseInt(process.env.EDITORIAL_FAQ_I18N_RECENT || '300', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3000) : 300;
}

/** 최근 N편 중 원본 faq 보유 화보 → Map(id, faq[]) */
async function recentWithFaq() {
  const { data, error } = await supabaseAdmin
    .from('editorials')
    .select('id, faq')
    .eq('status', 'published')
    .not('faq', 'is', null)
    .order('published_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(recentLimit());
  if (error) throw error;
  const out = new Map();
  for (const r of (data || [])) {
    const f = normalizeFaq(r.faq);
    if (f) out.set(r.id, f);
  }
  return out;
}

/** 한 언어의 미처리 조합을 batch 만큼 처리. */
async function runOneLang(lang, srcMap, batch, model, timeoutMs) {
  const ids = Array.from(srcMap.keys());
  if (!ids.length) return { processed: 0, remaining: 0, lang };

  /* 번역행이 이미 있고 faq 만 비어 있는 것 — 행 자체가 없으면 본 백필의 몫이다. */
  const { data: rows, error } = await supabaseAdmin
    .from('seo_translations')
    .select('content_id, faq')
    .eq('kind', 'editorial')
    .eq('lang', lang)
    .in('content_id', ids);
  if (error) throw error;

  const pending = (rows || []).filter(r => !normalizeFaq(r.faq)).map(r => r.content_id);
  if (!pending.length) return { processed: 0, remaining: 0, lang };

  const take = pending.slice(0, batch);
  const payload = take.map((id, i) => ({ i, faq: srcMap.get(id) }));

  const prompt =
    'Translate the FAQ blocks of PAP MAGAZINE fashion editorials into ' + LANG_NAMES[lang] + '.\n' +
    'Rules:\n' +
    '- Translate every "q" and "a" into ' + LANG_NAMES[lang] + '. Same length, same order, no new items.\n' +
    '- Keep person names, brand names, agency names and @handles in their original spelling.\n' +
    '- Natural fashion-magazine register, not literal machine translation.\n' +
    '- Return ONLY a JSON array, one object per input: {"i":<index>,"faq":[{"q":"...","a":"..."}]}. No prose, no code fences.\n' +
    'Input JSON:\n' + JSON.stringify(payload);

  /* callClaude 는 문자열이 아니라 {text, stopReason} 객체를 돌려준다.
     2026-08-27~28 사이 이 자리는 String(raw) 였고, 그 값은 언제나
     "[object Object]" 였다 → JSON.parse 실패 → 배열 정규식도 실패 →
     매 회차 조용히 processed:0. cron_runs 에 '화보FAQ 언어판 0 · it:0 fr:0'
     이 24시간 찍히는 동안 Claude 호출만 나가고 저장은 0건이었다.
     (GROWTH-LEDGER 교훈 1 "돌았다 ≠ 했다" 의 네 번째 재발) */
  const raw = await callClaude(prompt, 8000, model, timeoutMs);
  const text = String((raw && raw.text) || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let arr;
  try { arr = JSON.parse(text); }
  catch (_) {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return { processed: 0, remaining: pending.length, lang };
    try { arr = JSON.parse(m[0]); } catch (_) { return { processed: 0, remaining: pending.length, lang }; }
  }
  if (!Array.isArray(arr)) return { processed: 0, remaining: pending.length, lang };

  let processed = 0;
  for (const item of arr) {
    if (!item || typeof item.i !== 'number') continue;
    const id = take[item.i];
    if (!id) continue;
    const trFaq = normalizeFaq(item.faq);
    if (!trFaq || trFaq.length !== (srcMap.get(id) || []).length) continue;
    const { error: upErr } = await supabaseAdmin
      .from('seo_translations')
      .update({ faq: trFaq, updated_at: new Date().toISOString() })
      .eq('kind', 'editorial').eq('lang', lang).eq('content_id', id);
    if (upErr) { console.error('[faq-i18n]', lang, id, upErr.message); continue; }
    processed++;
  }
  return { processed, remaining: Math.max(0, pending.length - processed), lang };
}

/** 한 회차: 언어를 순회하며 예산 안에서 처리. */
async function runEditorialFaqI18nBatch({ batch = 8, timeoutMs = 90000, model } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY 환경변수 미설정.');
    e.statusCode = 503;
    throw e;
  }
  const useModel = model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const srcMap = await recentWithFaq();
  if (!srcMap.size) return { processed: 0, remaining: 0, note: '화보FAQ 언어판 0 · 원본 FAQ 없음' };

  const deadline = Date.now() + timeoutMs;
  let processed = 0;
  let remaining = 0;
  const per = [];
  for (const lang of TARGET_LANGS) {
    if (Date.now() > deadline - 20000) break; // 한 콜 여유가 없으면 접는다
    try {
      const r = await runOneLang(lang, srcMap, batch, useModel,
        Math.max(20000, deadline - Date.now() - 5000));
      processed += r.processed;
      remaining += (r.remaining || 0);
      if (r.processed || r.remaining) per.push(lang + ':' + r.processed);
    } catch (err) {
      console.error('[faq-i18n]', lang, (err && err.message) || err);
      per.push(lang + ':실패');
    }
  }
  return {
    processed, remaining,
    note: '화보FAQ 언어판 ' + processed + ' · 잔여 ' + remaining
      + (per.length ? ' · ' + per.join(' ') : ''),
    scope: srcMap.size,
  };
}

module.exports = { runEditorialFaqI18nBatch, recentWithFaq, recentLimit, TARGET_LANGS };
