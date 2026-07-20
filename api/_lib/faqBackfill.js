/**
 * PAP Magazine — 기사 FAQ 백필 공용 로직 (2026-07-21 신설)
 *
 * 왜: 2026-07-21 SEO/GEO 감사에서 발행 기사 484건 중 FAQ 가 붙은 건 24건(5%)뿐이었다.
 * FAQ 생성은 2026-07-16(커밋 68f2f04)에 인스타 수입 파이프라인에 넣었으므로
 * 그 이후 기사만 갖고 있다. AEO/GEO 교육자료의 핵심 주장이 "FAQ 구조가 AI
 * 답변의 약 60%를 차지한다"였는데, 정작 그 장치를 5%에만 달아둔 셈이다.
 *
 * 무엇: 이미 발행된 기사 중 faq 가 비어 있는 것을 골라 본문에서 FAQ 3개를
 * 생성해 articles.faq 에 채운다. 본문을 새로 쓰지 않는다 — 기존 사실만 쓴다.
 *
 * 설계는 seoTranslateBackfill.js 와 같은 규약을 따른다:
 *   - 진입점은 둘(관리자 수동 / 크론), 로직은 하나
 *   - 이미 채워진 행은 건너뜀 (재실행 안전)
 *   - 실패 항목은 저장하지 않고 errors 로 보고 → 다음 호출에서 재시도
 *   - 배치 1~20 (Claude 1콜 max_tokens 안전선)
 *
 * 왜 FAQ 만 채우고 본문은 안 건드리나: 본문 대량 재생성은 스케일드 콘텐츠
 * 남용 정책 리스크가 있다. FAQ 는 기존 본문에서 답이 나오는 질문만 만든다.
 *
 * 필요 환경변수: ANTHROPIC_API_KEY
 */

'use strict';

const { supabaseAdmin } = require('./supabase');

/** 배치 크기 정규화 — 1~20. */
function normalizeBatch(v, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(20, n));
}

/** HTML 본문 → 평문 (프롬프트 토큰 절약 + 태그 노이즈 제거). */
function toPlain(html, max) {
  const s = String(html == null ? '' : html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const limit = max || 1200;
  return s.length > limit ? s.slice(0, limit) : s;
}

/**
 * Claude 응답 → 기사 id별 FAQ 배열.
 * 방어적으로 파싱한다 — 형식이 어긋난 항목은 통째로 버린다(빈 FAQ 를 저장하면
 * 구조화 데이터가 깨져 오히려 감점이다).
 */
function parseFaqResponse(raw, validIds) {
  const text = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let arr;
  try {
    arr = JSON.parse(text);
  } catch (_) {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return {};
    try { arr = JSON.parse(m[0]); } catch (_) { return {}; }
  }
  if (!Array.isArray(arr)) return {};

  const idSet = new Set((validIds || []).map(String));
  const out = {};
  for (const item of arr) {
    if (!item || !item.id || !Array.isArray(item.faq)) continue;
    const id = String(item.id);
    if (idSet.size && !idSet.has(id)) continue; // 없는 id 를 만들어내면 버린다
    const faq = item.faq
      .filter(f => f && typeof f.q === 'string' && typeof f.a === 'string')
      .map(f => ({ q: f.q.trim().slice(0, 200), a: f.a.trim().slice(0, 600) }))
      .filter(f => f.q && f.a)
      .slice(0, 5);
    if (faq.length) out[id] = faq;
  }
  return out;
}

/** FAQ 가 비어 있는 발행 기사 조회. */
async function fetchPending(size) {
  const { data, error } = await supabaseAdmin
    .from('articles')
    .select('id, title, title_en, content')
    .eq('status', 'published')
    .is('faq', null)
    .order('published_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(size);
  if (error) throw error;
  return (data || []).filter(a => a.title && toPlain(a.content).length >= 80);
}

/** 남은 건수 (진행률 보고용). */
async function countRemainingSafe() {
  try {
    const { count } = await supabaseAdmin
      .from('articles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .is('faq', null);
    return typeof count === 'number' ? count : null;
  } catch (_) { return null; }
}

/**
 * 1배치 처리.
 * @returns {Promise<{processed, remaining, errors?, note?}>}
 * @throws  {Error} err.statusCode 가 있으면 호출자가 그 코드를 쓴다.
 */
async function runFaqBackfillBatch({ batch = 10, timeoutMs = 90000 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY 환경변수 미설정.');
    e.statusCode = 503;
    throw e;
  }
  const size = normalizeBatch(batch, 10);
  const rows = await fetchPending(size);
  if (!rows.length) {
    return { processed: 0, remaining: await countRemainingSafe(), note: '대상 없음 — 완주' };
  }

  const payload = rows.map(a => ({
    id: a.id,
    title: a.title,
    body: toPlain(a.content),
  }));

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: [
        'PAP MAGAZINE(서울·밀라노 기반, 아트를 중심으로 한 패션·뷰티·컬쳐 매거진)의 기사에',
        'AEO(답변 엔진 최적화)용 FAQ 를 붙인다.',
        '규칙:',
        '- 질문은 독자가 검색창에 실제로 칠 법한 자연어. 기사 제목의 반복 금지.',
        '- 답변은 20~60단어, 그 자체로 완결된 문장 (앞뒤 문맥 없이도 인용 가능해야 한다).',
        '- **본문에 있는 사실만** 쓴다. 본문에 없는 내용을 추측해 채우지 않는다.',
        '- 본문으로 답할 수 있는 질문이 3개가 안 되면 있는 만큼만 (억지로 채우지 말 것).',
        '- 한국어로 쓴다. 브랜드·인명은 통용 표기.',
        '입력은 [{id, title, body}] 배열.',
        '출력은 JSON 배열만: [{"id":"입력과 동일한 id","faq":[{"q":"...","a":"..."}]}]',
        'JSON 외 텍스트 금지.',
      ].join('\n'),
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    const e = new Error('Claude API ' + resp.status);
    e.statusCode = resp.status === 429 ? 429 : 502;
    throw e;
  }

  const j = await resp.json();
  const block = Array.isArray(j.content) ? j.content.find(b => b && typeof b.text === 'string') : null;
  const byId = parseFaqResponse(block && block.text, rows.map(r => r.id));

  const errors = [];
  let processed = 0;
  for (const row of rows) {
    const faq = byId[String(row.id)];
    if (!faq) { errors.push({ id: row.id, reason: '생성 결과 없음' }); continue; }
    const { error } = await supabaseAdmin.from('articles').update({ faq }).eq('id', row.id);
    if (error) { errors.push({ id: row.id, reason: error.message }); continue; }
    processed++;
  }

  const out = { processed, remaining: await countRemainingSafe() };
  if (errors.length) out.errors = errors;
  return out;
}

module.exports = {
  runFaqBackfillBatch, normalizeBatch, toPlain, parseFaqResponse,
};
