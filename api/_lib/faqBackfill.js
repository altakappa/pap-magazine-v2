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

const { HTML_TAG_RE, dropKnownTags } = require('./stripHtml');
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
    .replace(HTML_TAG_RE, dropKnownTags(' '))
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

/* 본문이 이보다 짧으면 FAQ 를 만들 근거가 없다 — 사진 한 장짜리 게시물이다. */
const MIN_BODY_CHARS = 80;
/* 짧은 기사가 앞줄에 몰려 있어도 뚫고 나가되, 무한정 긁지는 않는다. */
const MAX_SCAN_PAGES = 3;

/** 한 페이지에 훑을 행 수 — 배치의 8배(최소 60, 최대 200). */
function scanSpan(size) {
  const n = parseInt(size, 10) || 10;
  return Math.min(200, Math.max(n * 8, 60));
}

/**
 * 훑어온 행에서 작업 가능한 것만 골라 size 만큼 자른다 — 순수 함수.
 *
 * **순서가 이 함수의 전부다.** 예전에는 SQL LIMIT 을 먼저 걸고 그 결과를
 * 이 조건으로 걸렀다. 그래서 앞쪽 N건이 전부 짧은 기사이면 매 실행이 빈손으로
 * 돌아오면서도 ok=true 를 남겼다 — 2026-08-04 실측: 잔여 260건 중 상위 12건이
 * 모두 본문 62~78자(스트릿 스타일·백스테이지 사진)라 뒤의 234건이 통째로
 * 막혀 있었다. '자른 뒤에 거른다'를 '거른 뒤에 자른다'로 뒤집는다.
 */
function selectWorkable(rows, size) {
  const limit = Math.max(1, parseInt(size, 10) || 10);
  const out = [];
  let tooShort = 0;
  for (const a of (rows || [])) {
    if (!a || !a.title || toPlain(a.content).length < MIN_BODY_CHARS) { tooShort++; continue; }
    if (out.length < limit) out.push(a);
  }
  return { rows: out, tooShort };
}

/**
 * FAQ 가 비어 있는 발행 기사 조회.
 * 한 페이지가 전부 짧은 기사여도 다음 페이지까지 훑어 벽을 넘는다.
 *
 * @returns {Promise<{rows:Array, scanned:number, tooShort:number, exhausted:boolean}>}
 *          exhausted=true 면 마지막 페이지까지 봤다는 뜻 — 남은 건 전부 짧은 기사다.
 */
async function fetchPending(size) {
  const span = scanSpan(size);
  const want = Math.max(1, parseInt(size, 10) || 10);
  const seen = new Set();
  const pool = [];
  let scanned = 0;
  let exhausted = false;

  for (let page = 0; page < MAX_SCAN_PAGES; page++) {
    const from = page * span;
    const { data, error } = await supabaseAdmin
      .from('articles')
      .select('id, title, title_en, content')
      .eq('status', 'published')
      .is('faq', null)
      .order('published_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, from + span - 1);
    if (error) throw error;

    const page_rows = data || [];
    scanned += page_rows.length;
    for (const a of page_rows) {
      const key = String(a && a.id);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(a);
    }

    const picked = selectWorkable(pool, want);
    if (picked.rows.length >= want) {
      return { rows: picked.rows, scanned, tooShort: picked.tooShort, exhausted: false };
    }
    if (page_rows.length < span) { exhausted = true; break; } // 마지막 페이지였다
  }

  const picked = selectWorkable(pool, want);
  return { rows: picked.rows, scanned, tooShort: picked.tooShort, exhausted };
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
  const scan = await fetchPending(size);
  const rows = scan.rows;
  if (!rows.length) {
    /* 요약 한 줄이 곧 생산량 기록이다 — pipeline-watch 의 faqHealth 가 이 문장을
       읽어 '돌았는데 아무것도 안 만든' 상태를 잡는다. 세 문장을 구분하는 이유:
       완주 / 실질 완주 / 앞이 막힘 은 볼 곳이 완전히 다르다. */
    const remaining = await countRemainingSafe();
    const rem = remaining == null ? '?' : remaining;
    let note;
    if (remaining === 0) {
      note = 'FAQ 0 · 완주';
    } else if (scan.exhausted) {
      note = 'FAQ 0 · 완주 (잔여 ' + rem + '건은 본문 ' + MIN_BODY_CHARS + '자 미만)';
    } else {
      note = 'FAQ 0 · 대상 없음 — 앞 ' + scan.scanned + '건이 전부 본문 '
        + MIN_BODY_CHARS + '자 미만 (잔여 ' + rem + ')';
    }
    return {
      processed: 0, remaining, note,
      scanned: scan.scanned, tooShort: scan.tooShort, exhausted: scan.exhausted,
    };
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

  const remaining = await countRemainingSafe();
  const out = {
    processed, remaining, scanned: scan.scanned, tooShort: scan.tooShort,
    note: 'FAQ ' + processed + '/' + rows.length + ' · 잔여 '
      + (remaining == null ? '?' : remaining)
      + (errors.length ? ' · 실패 ' + errors.length : ''),
  };
  if (errors.length) out.errors = errors;
  return out;
}

module.exports = {
  runFaqBackfillBatch, normalizeBatch, toPlain, parseFaqResponse,
  selectWorkable, scanSpan, MIN_BODY_CHARS,
};
