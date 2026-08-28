/**
 * faqEnBackfill.js — 영문판 FAQ 백필 (2026-08-28 신설)
 *
 * ■ 왜 만들었나
 * /en/ 페이지에는 FAQ 블록도 FAQPage 스키마도 **한 번도 뜬 적이 없었다.**
 * 백필이 밀린 게 아니라 코드 경로가 없었다:
 *
 *   seoRenderer   faqItems = (lang==='ko') ? record.faq : (tr && tr.faq)
 *   핸들러 주석    "ko|en 은 DB 원본 필드, 그 외는 seo_translations"
 *
 * en 은 seo_translations 를 읽지 않는데(en 행 0개 — 실측 de·es·fr·it·ja·ru·zh
 * 뿐) 저 삼항식이 en 을 tr 쪽으로 보냈다. tr 은 언제나 null 이므로 결과는 0.
 * editorialFaqI18nBackfill 의 TARGET_LANGS 에 'en' 이 있었지만 그 백필은 기존
 * 번역행 UPDATE 만 하므로 en 은 영원히 대상 0건이었다.
 *
 * 영어는 버릴 수 없는 표면이다. geo-citation-surface 의 10일 실측에서 인용
 * 언어 분포가 **ko 42 / en 41** 로 거의 동률이었다. 그 절반이 비어 있었다.
 *
 * ■ 무엇을 하나
 * ko 원본 faq 를 영어로 번역해 faq_en 칼럼에 넣는다(마이그레이션 139).
 * 새로 쓰지 않고 번역만 한다 — 원본과 질문이 갈리면 같은 페이지의 ko/en 이
 * 서로 다른 것을 답하게 되고, 그건 교재가 말하는 '일관성' 을 우리 손으로 깨는 것이다.
 *
 * ■ 왜 seo_translations 에 en 행을 만들지 않았나
 * 이 저장소에서 en 은 일관되게 **DB 원본 칼럼 언어**다(title_en·description_en·
 * content_en). en 행을 만들면 그 불변식이 깨지고, 이미 칼럼에 있는 영문 본문과
 * 이중 저장이 된다. 핸들러의 `lang !== 'ko' && lang !== 'en'` 분기도 전부 손봐야 한다.
 *
 * ■ 비용 — 다른 7개 언어와 같은 잣대를 쓰면 안 된다
 * 화보 언어판 소급은 8개 언어라 전량이 비싸서 최근 300편으로 잘랐다.
 * 영어는 **한 언어**다. 기사 2,453 + 화보(생성 진도만큼) 를 한 바퀴 도는 비용이
 * 7개 언어 300편과 비슷한 수준이다. 그래서 기본 상한을 두지 않는다.
 * 필요하면 FAQ_EN_RECENT 로 최근 N편으로 자를 수 있다(0 = 무제한).
 *
 * ■ 지키는 것
 * - 항목 수가 원본과 다르면 버린다. 반쪽 FAQ 를 저장하지 않는다.
 * - 실패는 저장하지 않고 다음 회차 재시도. 원본 faq 가 없으면 아무것도 안 한다.
 * - 잔여 0 이면 Claude 를 호출하지 않는다 — 완주 후 크론을 켜둬도 비용이 0.
 * - 파싱은 seoTranslateBackfill.parseJsonArray 를 쓴다(2026-08-25 에 넷째 칸까지
 *   붙인 jsonRepair 계단). 여기서 정규식을 새로 쓰면 그 수리가 또 복제된다.
 */

'use strict';

const { supabaseAdmin } = require('./supabase');
const {
  normalizeFaq, callClaude, parseJsonArray,
} = require('./seoTranslateBackfill');

/* 대상 표. kind 이름은 크론 note 에 그대로 찍힌다. */
const TARGETS = [
  { table: 'articles', label: '기사' },
  { table: 'editorials', label: '화보' },
];

/** FAQ_EN_RECENT: 최근 N편으로 자르기. 0/미설정이면 무제한. */
function recentLimit() {
  const n = parseInt(process.env.FAQ_EN_RECENT || '0', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20000) : 0;
}

/* FAQ_EN_RECENT 가 켜져 있을 때만 쓰는 컷오프 날짜.
   "최근 N편" 을 SQL 로 표현하려면 N 번째 행의 published_date 가 필요하다.
   무제한(기본)이면 이 질의 자체를 하지 않는다 — 켜지 않은 기능이 매 회차
   DB 를 때리면 안 된다. */
async function cutoffDate(table) {
  const n = recentLimit();
  if (!n) return null;
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('published_date')
    .eq('status', 'published')
    .not('faq', 'is', null)
    .order('published_date', { ascending: false })
    .range(n - 1, n - 1);
  if (error) throw error;
  const row = (data || [])[0];
  // N 편이 안 되면 컷오프가 없다 = 전량이 이미 범위 안이다.
  return (row && row.published_date) || null;
}

function applyScope(q, cutoff) {
  return cutoff ? q.gte('published_date', cutoff) : q;
}

/** 원본 faq 는 있는데 faq_en 이 비어 있는 발행분. 최신순(인용 가능성이 높은 쪽 먼저). */
async function fetchPending(table, batch, cutoff) {
  const { data, error } = await applyScope(
    supabaseAdmin
      .from(table)
      .select('id, faq')
      .eq('status', 'published')
      .not('faq', 'is', null)
      .is('faq_en', null), cutoff)
    .order('published_date', { ascending: false })
    .limit(batch);
  if (error) throw error;

  const out = [];
  for (const r of (data || [])) {
    const f = normalizeFaq(r.faq);
    if (f) out.push({ id: r.id, faq: f });
  }
  return out;
}

/** 남은 건수. 실패해도 백필을 막지 않는다(표시용). */
async function countRemainingSafe(table, cutoff) {
  try {
    const { count, error } = await applyScope(
      supabaseAdmin
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'published')
        .not('faq', 'is', null)
        .is('faq_en', null), cutoff);
    if (error) return null;
    return typeof count === 'number' ? count : null;
  } catch (_) { return null; }
}

function buildPrompt(payload) {
  return [
    'Translate the FAQ blocks of PAP MAGAZINE (a Korean digital fashion magazine)',
    'from Korean into English.',
    'Rules:',
    '- Translate every "q" and "a". Same count, same order, no new items, no dropped items.',
    '- Keep person names, brand names, agency names and @handles in their original spelling.',
    '- Natural fashion-magazine English, not literal machine translation.',
    '- Each answer must stay self-contained and quotable on its own (20-60 words).',
    '- Do not add facts that are not in the Korean source.',
    '- Return ONLY a JSON array, one object per input: {"i":<index>,"faq":[{"q":"...","a":"..."}]}.',
    '  No prose, no code fences.',
    'Input JSON:',
    JSON.stringify(payload),
  ].join('\n');
}

/** 한 표를 batch 만큼 처리. */
async function runOneTable(target, batch, model, timeoutMs) {
  const { table, label } = target;
  const cutoff = await cutoffDate(table);
  const rows = await fetchPending(table, batch, cutoff);
  if (!rows.length) {
    return { table, label, processed: 0, remaining: await countRemainingSafe(table, cutoff) };
  }

  const payload = rows.map((r, i) => ({ i, faq: r.faq }));

  let arr = null;
  try {
    const raw = await callClaude(buildPrompt(payload), 8000, model, timeoutMs);
    /* callClaude 는 {text, stopReason} 객체다. String(raw) 로 받으면
       "[object Object]" 가 되어 조용히 0건이 된다 — 화보 언어판 백필이
       2026-08-27~28 에 정확히 그 상태로 24시간 헛돌았다. */
    arr = parseJsonArray((raw && raw.text) || '');
  } catch (err) {
    console.error('[faq-en]', table, (err && err.message) || err);
    return { table, label, processed: 0, remaining: await countRemainingSafe(table, cutoff), failed: true };
  }
  if (!Array.isArray(arr)) {
    return { table, label, processed: 0, remaining: await countRemainingSafe(table, cutoff), failed: true };
  }

  let processed = 0;
  for (const item of arr) {
    if (!item || typeof item.i !== 'number') continue;
    const row = rows[item.i];
    if (!row) continue;
    const en = normalizeFaq(item.faq);
    /* 반쪽 저장 금지 — 개수가 다르면 원본과 짝이 안 맞는다는 뜻이다. */
    if (!en || en.length !== row.faq.length) continue;
    const { error } = await supabaseAdmin
      .from(table).update({ faq_en: en }).eq('id', row.id);
    if (error) { console.error('[faq-en]', table, row.id, error.message); continue; }
    processed++;
  }

  return { table, label, processed, remaining: await countRemainingSafe(table, cutoff) };
}

/**
 * 한 회차. 표를 순회하며 예산 안에서 처리한다.
 * @returns {{processed:number, remaining:number|null, note:string}}
 */
async function runFaqEnBatch({ batch = 8, timeoutMs = 90000, model } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY 환경변수 미설정.');
    e.statusCode = 503;
    throw e;
  }
  const useModel = model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const deadline = Date.now() + timeoutMs;

  let processed = 0;
  let remaining = 0;
  let remainingKnown = false;
  const per = [];

  for (const target of TARGETS) {
    // 한 콜 여유가 없으면 접는다. 남은 표는 다음 회차가 맡는다.
    if (Date.now() > deadline - 20000) break;
    try {
      const r = await runOneTable(
        target, batch, useModel,
        Math.max(20000, deadline - Date.now() - 5000));
      processed += r.processed;
      if (typeof r.remaining === 'number') { remaining += r.remaining; remainingKnown = true; }
      if (r.processed || r.remaining || r.failed) {
        per.push(r.label + ':' + (r.failed ? '실패' : r.processed));
      }
    } catch (err) {
      console.error('[faq-en]', target.table, (err && err.message) || err);
      per.push(target.label + ':실패');
    }
  }

  return {
    processed,
    remaining: remainingKnown ? remaining : null,
    note: '영문FAQ ' + processed + ' · 잔여 ' + (remainingKnown ? remaining : '?')
      + (per.length ? ' · ' + per.join(' ') : ''),
  };
}

module.exports = { runFaqEnBatch, runOneTable, fetchPending, countRemainingSafe, cutoffDate, recentLimit, buildPrompt, TARGETS };
