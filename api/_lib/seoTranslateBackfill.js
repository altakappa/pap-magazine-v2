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

/* 2026-07-21 — 도메니코 결정으로 선택기의 9개 언어를 전부 지원한다.
   (ko/en 은 원본 컬럼을 쓰므로 여기 없다) */
const LANG_NAMES = {
  it: 'Italian', fr: 'French', es: 'Spanish', ja: 'Japanese',
  zh: 'Simplified Chinese', ru: 'Russian', de: 'German',
};

/* 콘텐츠 종류별 설정. 진입점(관리자·크론)이 kind 를 넘긴다.
   ─────────────────────────────────────────────────────────────────
   에디토리얼은 사진 중심이라 제목+요약만 번역한다(설명 평균 15자).
   아티클은 본문이 곧 콘텐츠라 body 까지 번역한다 — 대량 기계번역
   본문은 구글 스팸 정책 리스크가 있으나, 도메니코가 리스크를 인지하고
   진행을 선택했다(2026-07-21). 완료 후 서치콘솔로 색인·노출 추이를 본다.

   batch 가 종류마다 다른 이유: 아티클 본문이 평균 1,228자라
   에디토리얼과 같은 10개씩 묶으면 응답이 max_tokens 안에서 잘린다
   (ja 배치20 에서 이미 겪은 문제 — 아래 max_tokens 주석 참고). */
/* 번역이 '있다' 고 인정하는 최소 길이 (2026-07-30 신설).
 *
 * 왜 필요했나 — 실측:
 *   ja 2,450행 중 실제 내용이 있는 건 105건뿐이었다(4%). 나머지는 빈 껍데기인데
 *   시스템은 "번역 완료" 로 셌다. it 305 · es 315 · fr 442 도 같은 상태.
 *   원인은 선별이 '행이 존재하는가' 만 봤기 때문이다(doneSet.has(id)).
 *   원본 설명이 없던 시절에 빈 값으로 저장된 행이 영구히 제외됐다.
 *   오늘 하루 세 번 만난 '가짜 완주' 와 같은 패턴이다. */
const MIN_TRANSLATED = { description: 40, body: 100 };

/* 에디토리얼 원본 설명을 모델에 보낼 때의 상한 (2026-08-03 신설).
 *
 * 왜 필요했나 — 라이브 실측(2026-08-03 00:24~01:03 KST, 20 runs):
 *   es 15콜 중 13콜 / de 8콜 중 5콜 / ja 12콜 중 4콜이
 *   "The operation was aborted due to timeout" 으로 실패했다. 그런데 실패한
 *   세 언어의 큐 선두(published_date DESC 기준 미번역 1건)는 전부 같은 행이었다 —
 *   'On Now Interview Series #12' (879bec00-4ec2-44d2-81bd-fb6945506216),
 *   description 7,387자. 반대로 큐 선두가 847~1,018자였던 fr·zh·ru 는
 *   26콜 중 실패 2콜이었다. 무작위 API 불안정이 아니라 한 행이 세 언어를
 *   영구히 막고 있었다(poison pill).
 *
 * 배치 반감 재시도(a32eef4)로도 못 푼다 — 배치가 1이 되어도 그 1건이 바로
 * 이 행이기 때문이다. 그래서 매 실행마다 40s + 48s 를 태우고 끝났고,
 * 그게 duration 91s / 실행당 3언어 현상의 원인이다.
 *
 * 저장 시 description 은 어차피 2,000자로 잘린다(아래 upsert). 그보다 긴
 * 입력을 보내는 것은 전액 낭비다. 발행 에디토리얼 2,163건 중 1,200자 초과는
 * 325건, 2,000자 초과는 3건뿐이라 메타 설명 품질에는 영향이 없다. */
const EDITORIAL_SRC_MAX = 1200;

const KINDS = {
  editorial: {
    table: 'editorials',
    columns: 'id, title, title_en, description, description_en, description_it',
    translateBody: false,
    defaultBatch: 10,
    /* 2026-08-03: 0(무제한)이었다. 위 EDITORIAL_SRC_MAX 주석 참고 —
       긴 설명 여러 건이 한 배치에 몰리면 한 콜이 타임아웃을 넘긴다.
       예산을 넘기는 건은 자연히 혼자 처리된다(최소 1건 보장). */
    charBudget: 3000,
    maxTokens: 8000,
    order: 'published_date',
    src: (e) => ({
      title: e.title,
      title_en: e.title_en || null,
      description: String(e.description_en || e.description || '').slice(0, EDITORIAL_SRC_MAX),
    }),
    /* 번역할 원본이 실제로 있는가. 없으면 호출해봐야 빈 값만 저장되고
       그 행이 다시 '완료' 로 잡혀 영구 제외된다 — 그게 지금 상태다.
       단 lang=it 은 예외다: description_it(마이그레이션 039 로 들어온 기존
       이탈리아어 설명)이 있으면 번역 없이 그대로 쓰는 fast-path 가 있다.
       lang 을 안 보면 그 경로까지 막힌다 — 테스트가 실제로 이걸 잡았다. */
    hasSource: (e, lang) =>
      (lang === 'it' && String(e.description_it || '').trim().length > 0)
      || String(e.description_en || e.description || '').trim().length >= 30,
    doneField: 'description',
  },
  article: {
    table: 'articles',
    columns: 'id, title, title_en, content, content_en',
    translateBody: true,
    defaultBatch: 5,
    /* 파일럿(2026-07-21)에서 발견 — 개수만으로 묶으면 안 된다.
       486건 중 465건(95.7%)이 2,000자 이하인데 최대 12,963자짜리가 있다.
       고정 batch 로 묶으면 긴 글이 걸린 배치에서 응답이 max_tokens 안에서
       잘려 통째로 실패한다(ja 배치20 에서 겪은 것과 같은 계열).
       → 개수 상한과 함께 "본문 문자수 예산"으로도 자른다. 긴 글은 자연히
         혼자 처리된다. 예산은 일본어/중국어 확장을 감안해 보수적으로 잡았다. */
    charBudget: 6000,
    maxTokens: 16000,
    order: 'published_date',
    src: (a) => ({
      title: a.title,
      title_en: a.title_en || null,
      body: a.content_en || a.content || '',
    }),
    hasSource: (a) => String(a.content_en || a.content || '').trim().length >= 80,
    doneField: 'body',
  },
};

/**
 * 응답 텍스트에서 JSON 배열만 꺼낸다 (2026-07-31 신설).
 *
 * 왜 필요했나 — 라이브 실측:
 *   es/edi:0 ERR 번역 응답 JSON 파싱 실패: ```json\n[{"i":0,"title":"The Mod…
 *   de/edi:0 ERR 번역 응답 JSON 파싱 실패: ```json\n[{"i":0,"title":"Form Do…
 *   같은 실행에서 fr·ja 는 통과했다. 프롬프트로 "코드 펜스 쓰지 마라"고
 *   지시해도 모델은 가끔 붙인다 — 그때마다 **배치 전체가 버려진다.**
 *   "번역은 다 됐는데 저장은 0건" 이라는, 오늘 하루 반복해서 만난 그 패턴이다.
 *
 * 그래서 앞뒤 장식(코드 펜스·서두 설명문·후미 문구)을 무시하고 첫 '[' 부터
 * 마지막 ']' 까지만 취한다. 정규식으로 특정 형태를 좇으면 다음에 또 다른
 * 형태가 나온다 — 형태를 열거하지 말고 '배열의 경계' 라는 사실만 쓴다.
 */
function parseJsonArray(text) {
  const s = String(text || '');
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end <= start) {
    throw new Error('번역 응답에서 JSON 배열을 찾지 못함: ' + s.slice(0, 150));
  }
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    throw new Error('번역 응답 JSON 파싱 실패: ' + s.slice(0, 150));
  }
}

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
async function runBackfillBatch({ lang, kind = 'editorial', batch, timeoutMs = 90000 } = {}) {
  if (!LANG_NAMES[lang]) {
    const e = new Error('lang 은 ' + Object.keys(LANG_NAMES).join('|') + ' 중 하나여야 합니다.');
    e.statusCode = 400;
    throw e;
  }
  const cfg = KINDS[kind];
  if (!cfg) {
    const e = new Error('kind 는 ' + Object.keys(KINDS).join('|') + ' 중 하나여야 합니다.');
    e.statusCode = 400;
    throw e;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY 환경변수 미설정.');
    e.statusCode = 503;
    throw e;
  }
  const size = normalizeBatch(batch, cfg.defaultBatch);

  /* 1) 해당 언어 번역이 '내용까지' 있는 id 집합 (2026-07-30 수정)
   *
   * 전에는 행의 존재만 봤다(select('content_id')). 그래서 원본 설명이 없던
   * 시절에 빈 값으로 저장된 행이 영원히 '완료' 로 잡혔다 — ja 는 2,450행 중
   * 105건(4%)만 실제 내용이 있었는데도 잔여 0 으로 보고됐다.
   * 이제 실제 텍스트 길이로 판정한다. 빈 껍데기는 자동으로 재시도 대상이 된다
   * (upsert 라 새 행이 아니라 그 행이 채워진다). */
  const doneCol = cfg.doneField || 'description';
  const { data: done, error: doneErr } = await supabaseAdmin
    .from('seo_translations')
    .select('content_id, ' + doneCol)
    .eq('kind', kind)
    .eq('lang', lang)
    .limit(10000);
  if (doneErr) throw doneErr;
  const minLen = MIN_TRANSLATED[doneCol] || 40;
  const doneSet = new Set(
    (done || [])
      .filter(r => String(r[doneCol] || '').trim().length >= minLen)
      .map(r => r.content_id)
  );

  /* 2) 번역 대상: 발행 에디토리얼 중 미번역분 (최신 우선)
     description_it: 039 마이그레이션으로 이미 존재하는 이탈리아어 설명 —
     lang=it 이고 이 값이 있으면 Claude 호출 없이 그대로 저장 (fast-path). */
  const { data: eds, error: edErr } = await supabaseAdmin
    .from(cfg.table)
    .select(cfg.columns)
    .eq('status', 'published')
    .order(cfg.order, { ascending: false })
    .limit(5000);
  if (edErr) throw edErr;

  /* 원본이 없는 행은 대상에서 뺀다 (2026-07-30 신설).
   * 이게 없으면 번역할 게 없는 행에 빈 값을 저장하고, 그 행이 다시 '완료' 로
   * 잡혀 영구 제외된다 — 지금 ja 2,345건이 정확히 그렇게 만들어졌다.
   * 원본(서술문 백필)이 채워지는 대로 자연히 대상에 들어온다. */
  const hasSource = cfg.hasSource || (() => true);
  const pending = (eds || []).filter(e => e.title && !doneSet.has(e.id) && hasSource(e, lang));
  const skippedNoSource = (eds || []).filter(e => e.title && !doneSet.has(e.id) && !hasSource(e, lang)).length;
  const remainingTotal = pending.length;
  if (!remainingTotal) {
    /* '완료' 와 '원본이 없어 못 함' 을 구분해 보고한다. 이 둘을 뭉뚱그리면
       원본 백필이 밀려서 멈춘 상태를 '완주' 로 착각한다. */
    return {
      lang, kind, processed: 0, remaining: 0, skipped_no_source: skippedNoSource,
      message: skippedNoSource
        ? `번역 가능한 잔여 0 — 다만 원본(설명) 없는 ${skippedNoSource}건은 대기 중입니다.`
        : '전부 번역 완료.',
    };
  }

  /* 2b) fast-path — lang=it 이고 description_it 보유분은 API 호출 없이 일괄 저장 */
  if (lang === 'it' && kind === 'editorial') {
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

  /* 개수 상한 + 문자수 예산 중 먼저 걸리는 쪽으로 자른다(최소 1건은 보장 —
     예산보다 긴 글도 혼자서는 처리돼야 한다). */
  let items = pending.slice(0, size);
  if (cfg.charBudget > 0) {
    const picked = [];
    let used = 0;
    for (const it of items) {
      /* 2026-08-03: body 만 봤다. 에디토리얼 src 는 body 가 없고
         description 이라 예산이 항상 0으로 계산돼 무력화됐다. */
      const s_ = cfg.src(it) || {};
      const len = String(s_.body || s_.description || '').length;
      if (picked.length && used + len > cfg.charBudget) break;
      picked.push(it);
      used += len;
    }
    items = picked;
  }

  /* 3) Claude 번역 — 배치 전체를 한 번에 JSON 으로 */
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const src = items.map((e, i) => Object.assign({ i }, cfg.src(e)));
  /* 프롬프트는 kind 별로 다르다.
     · 에디토리얼 — 제목+요약(사진 중심, 짧은 카피)
     · 아티클     — 제목+본문. 본문은 HTML 조각이 섞여 있어 "태그는 그대로
                    두고 텍스트만 번역"을 명시해야 마크업이 깨지지 않는다. */
  const prompt = cfg.translateBody
    ? `You are translating fashion-magazine ARTICLES for PAP MAGAZINE into ${LANG_NAMES[lang]}.\n` +
      `Rules:\n` +
      `- Keep proper nouns, brand names, and stylized titles unchanged unless a natural localized form exists.\n` +
      `- Translate the body faithfully into native ${LANG_NAMES[lang]} — magazine register, not literal machine translation.\n` +
      `- The body may contain HTML tags. Keep every tag, attribute and URL EXACTLY as-is; translate only the visible text.\n` +
      `- Do not summarize, omit, or add content. Preserve paragraph structure.\n` +
      `- Return ONLY a JSON array, one object per input, shape: {"i":<index>,"title":"...","body":"..."}. No prose, no code fences.\n` +
      `Input JSON:\n` + JSON.stringify(src)
    : `You are translating fashion-magazine editorial metadata for PAP MAGAZINE into ${LANG_NAMES[lang]}.\n` +
      `Rules:\n` +
      `- Keep proper nouns, brand names, and stylized titles (e.g. "CRIMSON", "Rotten Roots") unchanged unless a natural localized form exists.\n` +
      `- The description must read like native ${LANG_NAMES[lang]} fashion-editorial copy — elegant, concise, no literal machine translation.\n` +
      `- Return ONLY a JSON array, one object per input, shape: {"i":<index>,"title":"...","description":"..."}. No prose, no code fences.\n` +
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
      max_tokens: cfg.maxTokens || 8000,
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

  /* 응답이 잘린 건지 포맷이 다른 건지를 구분한다 — 원인이 다르면 대응이 다르다.
     잘렸다면 배치를 줄여야 하고, 포맷 문제라면 파싱을 관대하게 하면 된다. */
  if (j.stop_reason === 'max_tokens') {
    throw new Error('번역 응답이 max_tokens 에서 잘림 (배치 ' + items.length + '건) — 배치를 줄여야 한다.');
  }

  const parsed = parseJsonArray(text);
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
        kind,
        content_id: srcItem.id,
        lang,
        title: String(t.title).slice(0, 300),
        description: t.description ? String(t.description).slice(0, 2000) : null,
        // 본문은 아티클만. 길이 제한을 두지 않는다 — 잘린 본문을 저장하면
        // 사용자에게 문장이 끊긴 페이지가 나간다.
        body: cfg.translateBody && t.body ? String(t.body) : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'kind,content_id,lang' });
    if (upErr) { errors.push({ i: t.i, reason: upErr.message }); continue; }
    processed++;
  }

  return {
    lang,
    kind,
    processed,
    remaining: remainingTotal - processed,
    // 원본(설명)이 없어 손댈 수 없는 건수. 0 이 아니면 '완주' 가 아니다.
    skipped_no_source: skippedNoSource,
    errors: errors.length ? errors : undefined,
    hint: remainingTotal - processed > 0 ? '같은 URL 을 반복 호출해 잔여분을 처리하세요.' : '전부 번역 완료.',
  };
}

module.exports = { runBackfillBatch, normalizeBatch, parseJsonArray, LANG_NAMES, KINDS };
