/**
 * PAP Magazine — 다국어 SEO 번역 백필 공용 로직
 *
 * 무엇: 발행 에디토리얼의 제목+설명을 Claude API 로 번역해 seo_translations(080)
 * 에 저장하는 "1배치" 단위 처리기. /it /fr /es /ja SSR 페이지의 데이터 소스
 * (ja는 2026-07-21 추가 — 서치콘솔 확인 결과 전용 페이지 없이도 노출이 it/fr/es
 * 보다 커 최우선 후보였음, PAP-Vault/45_Business/2026-07-21-다국어SEO-2단계-성과검토.md).
 *
 * 왜 _lib 로 뽑았나 (2026-07-21):
 *   관리자 수동 엔드포인트(api/admin/backfill-translations.js)와
 *   자동 크론(api/cron/backfill-translations.js)이 **완전히 같은 로직**을 써야 한다.
 *   복붙하면 한쪽만 고쳐지는 사고가 난다 — 진입점은 둘, 로직은 하나.
 *
 * 왜 제목+설명만: 에디토리얼은 사진 중심 — 제목·리드 번역만으로 해당 언어
 * 사용자에게 온전한 페이지가 되고, 본문 전체 기계번역 대량 생성(스팸 정책
 * 리스크)을 피한다.
 *
 * 안전장치:
 *   - 이미 번역된 (kind,content_id,lang) 은 건너뜀 (재실행 안전, upsert 기반)
 *   - Claude 호출 1회에 배치 전체를 JSON 으로
 *   - 번역 실패 항목은 저장하지 않고 errors 로 보고 (다음 호출에서 재시도)
 *
 * 필요 환경변수: ANTHROPIC_API_KEY
 */

const { supabaseAdmin } = require('./supabase');

const LANG_NAMES = { it: 'Italian', fr: 'French', es: 'Spanish', ja: 'Japanese' };

/** 배치 크기 정규화 — 1~20. Claude 1콜 max_tokens(4000) 안에 안전하게 들어가는 상한. */
function normalizeBatch(v, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(20, n));
}

/**
 * 한 언어에 대해 1배치를 처리한다.
 *
 * @param {object}  opts
 * @param {string}  opts.lang        'it' | 'fr' | 'es' | 'ja'
 * @param {number} [opts.batch=10]   1~20
 * @param {number} [opts.timeoutMs]  Claude fetch 타임아웃 (기본 90초).
 *                                   크론은 함수 예산(120초)을 3언어가 나눠 쓰므로 짧게 준다.
 * @returns {Promise<{lang,processed,remaining,mode?,errors?,hint?}>}
 * @throws  {Error}  설정 누락·API 실패·DB 오류 — 호출자가 상태코드로 변환한다.
 *                   err.statusCode 가 있으면 그 코드를 쓴다.
 */
async function runBackfillBatch({ lang, batch = 10, timeoutMs = 90000 } = {}) {
  if (!LANG_NAMES[lang]) {
    const e = new Error('lang 은 it|fr|es|ja 중 하나여야 합니다.');
    e.statusCode = 400;
    throw e;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY 환경변수 미설정.');
    e.statusCode = 503;
    throw e;
  }
  const size = normalizeBatch(batch, 10);

  /* 1) 해당 언어 번역이 이미 있는 에디토리얼 id 집합 */
  const { data: done, error: doneErr } = await supabaseAdmin
    .from('seo_translations')
    .select('content_id')
    .eq('kind', 'editorial')
    .eq('lang', lang)
    .limit(10000);
  if (doneErr) throw doneErr;
  const doneSet = new Set((done || []).map(r => r.content_id));

  /* 2) 번역 대상: 발행 에디토리얼 중 미번역분 (최신 우선)
     description_it: 039 마이그레이션으로 이미 존재하는 이탈리아어 설명 —
     lang=it 이고 이 값이 있으면 Claude 호출 없이 그대로 저장 (fast-path). */
  const { data: eds, error: edErr } = await supabaseAdmin
    .from('editorials')
    .select('id, title, title_en, description, description_en, description_it')
    .eq('status', 'published')
    .order('published_date', { ascending: false })
    .limit(5000);
  if (edErr) throw edErr;

  const pending = (eds || []).filter(e => e.title && !doneSet.has(e.id));
  const remainingTotal = pending.length;
  if (!remainingTotal) {
    return { lang, processed: 0, remaining: 0, message: '전부 번역 완료.' };
  }

  /* 2b) fast-path — lang=it 이고 description_it 보유분은 API 호출 없이 일괄 저장 */
  if (lang === 'it') {
    const ready = pending.filter(e => e.description_it && String(e.description_it).trim());
    if (ready.length) {
      let fastSaved = 0;
      for (const e of ready.slice(0, 200)) {
        const { error: upErr } = await supabaseAdmin
          .from('seo_translations')
          .upsert({
            kind: 'editorial', content_id: e.id, lang: 'it',
            title: e.title_en || e.title, // 제목은 스타일라이즈드 원제 유지
            description: String(e.description_it).slice(0, 2000),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'kind,content_id,lang' });
        if (!upErr) fastSaved++;
      }
      return {
        lang, processed: fastSaved, remaining: remainingTotal - fastSaved,
        mode: 'fastpath-description_it',
        hint: '기존 description_it 활용분 저장. 반복 호출하면 잔여분은 Claude 번역으로 넘어갑니다.',
      };
    }
  }

  const items = pending.slice(0, size);

  /* 3) Claude 번역 — 배치 전체를 한 번에 JSON 으로 */
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const src = items.map((e, i) => ({
    i,
    title: e.title,
    title_en: e.title_en || null,
    description: e.description_en || e.description || '',
  }));
  const prompt =
    `You are translating fashion-magazine editorial metadata for PAP MAGAZINE into ${LANG_NAMES[lang]}.\n` +
    `Rules:\n` +
    `- Keep proper nouns, brand names, and stylized titles (e.g. "CRIMSON", "Rotten Roots") unchanged unless a natural ${LANG_NAMES[lang]} rendering exists; when in doubt, keep the original title and translate only the description.\n` +
    `- The description must read like native ${LANG_NAMES[lang]} fashion-editorial copy — elegant, concise, no literal word-by-word translation.\n` +
    `- Return ONLY a JSON array, one object per input, shape: {"i":<index>,"title":"...","description":"..."}. No prose, no code fences.\n\n` +
    `Input JSON:\n` + JSON.stringify(src);

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      // 2026-07-21: 4000 이었으나 batch=20 + ja(멀티바이트, 토큰 소모 큼)
      // 조합에서 응답이 중간에 잘려 JSON 파싱 실패가 재현됨(운영 관찰,
      // batch<=10 은 재현 안 됨). it/fr/es 는 영향 없이 여유만 늘어남.
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!apiRes.ok) {
    const body = await apiRes.text().catch(() => '');
    throw new Error('Claude API 실패 (' + apiRes.status + '): ' + body.slice(0, 200));
  }
  const j = await apiRes.json();
  const text = (j.content && j.content[0] && j.content[0].text) || '';
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^```json?\s*/i, '').replace(/```\s*$/, ''));
  } catch (e) {
    throw new Error('번역 응답 JSON 파싱 실패: ' + text.slice(0, 150));
  }
  if (!Array.isArray(parsed)) throw new Error('번역 응답이 배열이 아님.');

  /* 4) 저장 */
  let processed = 0;
  const errors = [];
  for (const t of parsed) {
    const srcItem = items[t.i];
    if (!srcItem || !t.title) { errors.push({ i: t.i, reason: 'missing item or title' }); continue; }
    const { error: upErr } = await supabaseAdmin
      .from('seo_translations')
      .upsert({
        kind: 'editorial',
        content_id: srcItem.id,
        lang,
        title: String(t.title).slice(0, 300),
        description: t.description ? String(t.description).slice(0, 2000) : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'kind,content_id,lang' });
    if (upErr) { errors.push({ i: t.i, reason: upErr.message }); continue; }
    processed++;
  }

  return {
    lang,
    processed,
    remaining: remainingTotal - processed,
    errors: errors.length ? errors : undefined,
    hint: remainingTotal - processed > 0 ? '같은 URL 을 반복 호출해 잔여분을 처리하세요.' : '전부 번역 완료.',
  };
}

module.exports = { runBackfillBatch, normalizeBatch, LANG_NAMES };
