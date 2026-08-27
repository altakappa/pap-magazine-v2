/**
 * PAP Magazine — 화보(editorials) FAQ 백필 공용 로직 (2026-08-27 신설)
 *
 * 왜: 확장전략 55 의 Ⅰ-3 잔여 + Ⅰ-12 케이스스터디 통합 (도메니코 확정 2026-08-27).
 * 기사 FAQ 는 99% 커버(2,435/2,461)인데 화보는 faq 컬럼 자체가 없었다 —
 * 발행 화보 2,303편 중 설명문 보유 2,291편이 FAQ 0 상태. "이 화보는 누가
 * 찍었나 / 콘셉트가 뭔가 / 어떤 브랜드가 나오나" 류 레퍼런스 질의(시나리오 B군)를
 * 전부 흘리고 있었다.
 *
 * 무엇: faq 가 비어 있는 발행 화보에서 설명문·크레딧·브랜드·이슈 사실만으로
 * FAQ 2~4개를 생성해 editorials.faq 에 채운다. 설명문을 새로 쓰지 않는다.
 *
 * 규약은 faqBackfill.js(기사)와 동일:
 *   - 진입점(크론/관리자)과 로직 분리, 이미 채워진 행 건너뜀, 실패는 재시도
 *   - parseFaqResponse·toPlain·normalizeBatch 는 기사 쪽 모듈을 재사용
 *
 * 언어: ko 만 생성한다. 언어판 FAQ 는 8/17 절충(신규 번역분부터)과 같은 별도
 * 결정 사안 — seoTranslateBackfill.attachFaqs 가 articles 하드코딩이므로
 * 화보 확장 시 그쪽도 함께 손대야 한다 (볼트 기록).
 *
 * 필요 환경변수: ANTHROPIC_API_KEY
 */

'use strict';

const { supabaseAdmin } = require('./supabase');
const { normalizeBatch, parseFaqResponse, toPlain } = require('./faqBackfill');

/* 설명문이 이보다 짧으면 FAQ 근거가 부족하다 — 크레딧만으론 질문 1개짜리다. */
const MIN_DESC_CHARS = 60;
const MAX_SCAN_PAGES = 3;

/** credits jsonb → "Photographer: A · Starring: B, C" 요약 (프롬프트 재료). */
function creditLine(credits) {
  if (!Array.isArray(credits)) return '';
  const byRole = new Map();
  for (const c of credits) {
    if (!c || !c.name) continue;
    const roles = Array.isArray(c.roles) && c.roles.length ? c.roles : ['Credit'];
    for (const r of roles) {
      const role = String(r || '').trim();
      if (!role) continue;
      const key = role.toLowerCase();
      if (!byRole.has(key)) byRole.set(key, { role, names: [] });
      const slot = byRole.get(key);
      if (!slot.names.includes(c.name)) slot.names.push(c.name);
    }
  }
  const parts = [];
  for (const { role, names } of byRole.values()) {
    parts.push(role + ': ' + names.slice(0, 6).join(', '));
  }
  return parts.join(' · ').slice(0, 500);
}

/** fashion jsonb → "Brands: X, Y" (없으면 빈 문자열). */
function brandLine(fashion) {
  const brands = fashion && Array.isArray(fashion.brands) ? fashion.brands : [];
  const names = brands.map(b => b && b.name).filter(Boolean).slice(0, 8);
  return names.length ? 'Brands: ' + names.join(', ') : '';
}

/** 작업 가능한 행만 골라 size 만큼 — 기사 쪽 selectWorkable 과 같은 "거른 뒤 자르기". */
function selectWorkable(rows, size) {
  const limit = Math.max(1, parseInt(size, 10) || 10);
  const out = [];
  let tooThin = 0;
  for (const e of (rows || [])) {
    const desc = toPlain((e && (e.description || e.description_en)) || '', 2000);
    if (!e || !e.title || desc.length < MIN_DESC_CHARS) { tooThin++; continue; }
    if (out.length < limit) out.push(e);
  }
  return { rows: out, tooThin };
}

function scanSpan(size) {
  const n = parseInt(size, 10) || 10;
  return Math.min(200, Math.max(n * 8, 60));
}

/** faq 가 비어 있는 발행 화보 조회 — 최신 발행분부터. */
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
      .from('editorials')
      .select('id, title, title_en, description, description_en, credits, fashion, tags, issue, published_date')
      .eq('status', 'published')
      .is('faq', null)
      .order('published_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, from + span - 1);
    if (error) throw error;

    const rows = data || [];
    scanned += rows.length;
    for (const e of rows) {
      const key = String(e && e.id);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(e);
    }

    const picked = selectWorkable(pool, want);
    if (picked.rows.length >= want) {
      return { rows: picked.rows, scanned, tooThin: picked.tooThin, exhausted: false };
    }
    if (rows.length < span) { exhausted = true; break; }
  }

  const picked = selectWorkable(pool, want);
  return { rows: picked.rows, scanned, tooThin: picked.tooThin, exhausted };
}

async function countRemainingSafe() {
  try {
    const { count } = await supabaseAdmin
      .from('editorials')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .is('faq', null);
    return typeof count === 'number' ? count : null;
  } catch (_) { return null; }
}

/**
 * 1배치 처리 — 반환/예외 규약은 기사 쪽 runFaqBackfillBatch 와 동일.
 */
async function runEditorialFaqBackfillBatch({ batch = 10, timeoutMs = 90000 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY 환경변수 미설정.');
    e.statusCode = 503;
    throw e;
  }
  /* 2026-08-27 라이브 실측: 배치 10 × max_tokens 4000 에서 10건 전부 '생성 결과
     없음' — 응답이 토큰 상한에서 잘려 JSON 이 통째로 깨진 패턴. 화보 FAQ 는
     기사보다 항목당 출력이 길다(질문 2~4 + 크레딧 인용). 배치를 6으로 줄이고
     상한을 8000 으로 올린다. */
  const size = Math.min(normalizeBatch(batch, 6), 6);
  const scan = await fetchPending(size);
  const rows = scan.rows;
  if (!rows.length) {
    const remaining = await countRemainingSafe();
    const rem = remaining == null ? '?' : remaining;
    let note;
    if (remaining === 0) note = '화보FAQ 0 · 완주';
    else if (scan.exhausted) note = '화보FAQ 0 · 완주 (잔여 ' + rem + '건은 설명문 ' + MIN_DESC_CHARS + '자 미만)';
    else note = '화보FAQ 0 · 대상 없음 — 앞 ' + scan.scanned + '건이 전부 설명문 ' + MIN_DESC_CHARS + '자 미만 (잔여 ' + rem + ')';
    return { processed: 0, remaining, note, scanned: scan.scanned, tooThin: scan.tooThin, exhausted: scan.exhausted };
  }

  const payload = rows.map(e => ({
    id: e.id,
    title: e.title,
    title_en: e.title_en || undefined,
    statement: toPlain(e.description || e.description_en || '', 1500),
    credits: creditLine(e.credits) || undefined,
    brands: brandLine(e.fashion) || undefined,
    tags: Array.isArray(e.tags) && e.tags.length ? e.tags.slice(0, 8) : undefined,
    issue: e.issue || undefined,
    year: e.published_date ? String(e.published_date).slice(0, 4) : undefined,
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
      max_tokens: 8000,
      system: [
        'PAP MAGAZINE(서울·밀라노 기반, 아트를 중심으로 한 패션·뷰티·컬쳐 매거진)의',
        '오리지널 화보(에디토리얼)에 AEO(답변 엔진 최적화)용 FAQ 를 붙인다.',
        '규칙:',
        '- 질문은 크리에이티브·독자가 실제로 검색할 법한 자연어 — 누가 촬영/스타일링했나,',
        '  콘셉트·스테이트먼트는 무엇인가, 어떤 브랜드 의상이 등장하나, 어떻게 만들어졌나.',
        '- 답변은 20~60단어, 그 자체로 완결된 문장 (앞뒤 문맥 없이 인용 가능해야 한다).',
        '- **입력에 있는 사실만** 쓴다. 없는 인명·브랜드·기법을 추측해 채우지 않는다.',
        '- 입력으로 답할 수 있는 질문이 2개가 안 되면 있는 만큼만 (억지로 채우지 말 것).',
        '- 질문에 화보 제목을 그대로 반복하지 않는다. 한국어로 쓴다. 인명·브랜드는 원어 표기 유지.',
        '입력은 [{id, title, statement, credits, brands, tags, issue, year}] 배열.',
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
  /* 전멸 파싱 실패는 원인 없이 '생성 결과 없음 ×N' 으로만 남아 며칠을 잡아먹는다 —
     stop_reason 과 응답 머리를 로그로 남겨 다음 사람이 한 번에 보게 한다. */
  if (!Object.keys(byId).length) {
    console.error('[editorial-faq] parse empty · stop_reason=' + (j.stop_reason || '?')
      + ' · head=' + String(block && block.text || '').slice(0, 200));
  }

  const errors = [];
  let processed = 0;
  for (const row of rows) {
    const faq = byId[String(row.id)];
    if (!faq) { errors.push({ id: row.id, reason: '생성 결과 없음' }); continue; }
    const { error } = await supabaseAdmin.from('editorials').update({ faq }).eq('id', row.id);
    if (error) { console.error('[editorial-faq] update failed:', row.id, error.message); errors.push({ id: row.id, reason: error.message }); continue; }
    processed++;
  }

  const remaining = await countRemainingSafe();
  const out = {
    processed, remaining, scanned: scan.scanned, tooThin: scan.tooThin,
    note: '화보FAQ ' + processed + '/' + rows.length + ' · 잔여 '
      + (remaining == null ? '?' : remaining)
      + (errors.length ? ' · 실패 ' + errors.length : ''),
  };
  if (errors.length) out.errors = errors;
  return out;
}

module.exports = {
  runEditorialFaqBackfillBatch, creditLine, brandLine, selectWorkable,
  MIN_DESC_CHARS,
};
