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

/* 원본이 '번역할 만큼 있다' 고 볼 최소 길이. hasSource 와 아래 RPC 인자가
 * 같은 숫자를 써야 한다 — 두 곳에 따로 적으면 한쪽만 바뀐다(이 저장소가 이미
 * 여러 번 겪은 패턴이라 상수로 뽑아 단일 출처를 만든다). */
const MIN_SOURCE = { editorial: 30, article: 80 };

const KINDS = {
  editorial: {
    table: 'editorials',
    columns: 'id, title, title_en, description, description_en, description_it, published_date',
    translateBody: false,
    defaultBatch: 10,
    minSrc: MIN_SOURCE.editorial,
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
      || String(e.description_en || e.description || '').trim().length >= MIN_SOURCE.editorial,
    doneField: 'description',
    /* RPC 큐가 돌려준 행을 이 kind 의 표 스키마 모양으로 되돌린다.
       이렇게 해야 아래 cfg.src / fast-path / upsert 가 경로에 상관없이 같다. */
    fromQueueRow: (r) => ({
      id: r.id, title: r.title, title_en: r.title_en,
      description: r.src, description_en: r.src, description_it: r.extra,
    }),
  },
  article: {
    table: 'articles',
    columns: 'id, title, title_en, content, content_en, published_date',
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
    hasSource: (a) => String(a.content_en || a.content || '').trim().length >= MIN_SOURCE.article,
    doneField: 'body',
    minSrc: MIN_SOURCE.article,
    fromQueueRow: (r) => ({
      id: r.id, title: r.title, title_en: r.title_en,
      content: r.src, content_en: r.src,
    }),
  },
};

/* ─── 2026-08-05 — 큐 선별을 서버로 내린다 (supabase_migrations/100) ───
 *
 * 사건이 아니라 낭비였다. 이 함수는 호출 한 번마다
 *   ① articles(published) 전량 + 본문        → 6.26 MB
 *   ② seo_translations(kind,lang) 전량 + body → 2.33 MB (it 기준)
 * 를 내려받았다. 알고 싶은 건 길이 두 개뿐이었는데(번역이 채워졌나 / 원본이
 * 충분히 기나) 8.5 MB 를 옮겼다. 그것도 언어마다 따로, 크론 한 번에 3~10 회.
 * 그래서 실행 84초에 저장 1~2건, 매 실행 끝이 skip(time-budget) 이었다.
 *
 * 형제 크론 backfill-meta-desc 는 이미 short_desc_editorials RPC 로 같은 일을
 * 하고 실행시간이 0.5초다. 예외였던 쪽을 규칙에 맞춘다.
 *
 * RPC 가 없으면(마이그레이션 미적용·테스트 스텁) 조용히 예전 경로로 돌아간다 —
 * 배포 순서에 매이지 않게 하려는 의도적 설계다. */
const QUEUE_RPC = { editorial: 'seo_translate_queue', article: 'seo_translate_queue_article' };
let rpcUnavailable = false;   // 한 번 없다고 확인되면 매번 왕복하지 않는다

/* ─── 2026-08-05 계측 (2차) ────────────────────────────────────────────
 *
 * 왜 넣나 — 오늘 오전에 "8.5MB 전송이 병목" 이라고 판단해 큐를 RPC 로 내렸다.
 * 전송은 실제로 사라졌는데(RPC mean 72~156ms 실측) **시간당 저장이 61건에서
 * 43건으로 줄었고 평균 실행시간은 69초에서 80초로 늘었다.** 즉 진단이 반만
 * 맞았다. 80초가 *어디에* 쓰이는지 한 번도 재보지 않고 큰 숫자만 보고
 * 원인이라 결론낸 것이 잘못이었다.
 *
 * 이 파일의 주석들이 증언하듯 이 크론은 여러 번 추측으로 튜닝됐다. 그래서
 * 다음 조치는 또 다른 추측이 아니라 계측이다 — 구간별 소요를 note 에 남겨
 * 80초의 내역을 눈으로 본 뒤에 판단한다.
 *
 * 원칙: 계측은 공짜여야 한다. Date.now() 뺄셈과 정수 덧셈뿐이고, 실패해도
 * 본 작업을 막지 않는다(타이밍은 항상 옵셔널 필드로만 나간다). */
function newTiming() {
  return { queueMs: 0, callMs: 0, saveMs: 0, calls: 0, saves: 0 };
}

async function fetchQueueViaRpc(kind, lang, limit, cfg, timing, since, maxSrc) {
  if (rpcUnavailable) return null;
  const t0 = Date.now();
  const minDone = MIN_TRANSLATED[cfg.doneField] || 40;
  const minSrc = cfg.minSrc || 30;
  try {
    /* p_since — 발행 나이 컷 (2026-08-05, 마이그레이션 101). null 이면 제한 없음.
       크론만 값을 넘기고 관리자 수동 경로는 안 넘긴다(에버그린 예외). */
    const qArgs = kind === 'article'
      ? { p_lang: lang, p_limit: limit, p_min_done: minDone, p_min_src: minSrc, p_since: since,
          p_max_src: maxSrc || 0 }
      : { p_kind: kind, p_lang: lang, p_limit: limit, p_min_done: minDone, p_min_src: minSrc,
          p_src_max: EDITORIAL_SRC_MAX };
    const [q, c] = await Promise.all([
      supabaseAdmin.rpc(QUEUE_RPC[kind], qArgs),
      supabaseAdmin.rpc('seo_translate_counts',
        { p_kind: kind, p_lang: lang, p_min_done: minDone, p_min_src: minSrc, p_since: since,
          p_max_src: maxSrc || 0 }),
    ]);
    if (q.error || c.error) throw (q.error || c.error);
    if (timing) timing.queueMs += Date.now() - t0;
    const counts = Array.isArray(c.data) ? (c.data[0] || {}) : (c.data || {});
    return {
      items: (q.data || []).map(cfg.fromQueueRow),
      remaining: Number(counts.remaining) || 0,
      noSource: Number(counts.no_source) || 0,
      tooLong: Number(counts.too_long) || 0,
    };
  } catch (e) {
    if (timing) timing.queueMs += Date.now() - t0;
    const msg = String((e && e.message) || e);
    /* 구조적 부재(함수 없음 42883 · 권한 없음 42501 · 스텁에 rpc 자체가 없음)
       는 다시 시도해도 같은 결과다 → 래치를 걸어 매번 왕복하지 않는다.
       반면 일시적 네트워크 오류까지 영구히 래치하면, 한 번 삐끗한 컨테이너가
       수명이 다할 때까지 8.5MB 경로로 도는 최악이 된다 → 그건 래치하지 않는다. */
    if (/42883|42501|does not exist|not a function|undefined function|permission denied/i.test(msg)
        || (e && (e.code === '42883' || e.code === '42501'))) {
      rpcUnavailable = true;
    }
    console.error('[seoTranslateBackfill] 큐 RPC 사용 불가 → 전량조회 폴백:', msg.slice(0, 120));
    return null;
  }
}

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
/* 2026-08-03 Patch 4 — 잘린 응답에서 '온전한 객체' 만 골라낸다.
 *
 * 왜 필요한가 — Patch 3 배포 후에도 콜의 7.8%(153콜 중 12콜)가
 * 버려졌다. 이번엔 타임아웃이 아니라 응답 '형태' 가 원인이었고, 두 가지가
 * 관찰됐다.
 *   1) 응답이 끝까지 오지 않아 닫는 ']' 가 없다      → '배열을 찾지 못함'
 *   2) 설명문 안에 ']' 가 있어 마지막 ']' 까지 잘라도 JSON 이 깨진다
 *                                                     → '파싱 실패'
 * 어느 쪽이든 지금까지는 **배치 전체(최대 20건)를 통째로 버렸다.**
 * 20건 중 19건이 멀쩡해도 마지막 한 건이 잘리면 19건의 토큰까지 함께 날아간다.
 *
 * 그래서 배열을 통째로 파싱하지 않고 최상위 '{...}' 단위로 훑어 건별로
 * 파싱한다. 문자열 안의 괄호·따옴표는 상태를 추적해 건너뛰고, 끝까지 닫히지
 * 않은 마지막 조각만 버린다. 파서를 관대하게 만드는 게 아니라 '건질 수 있는
 * 만큼만 건진다' 는 뜻이다 — 깨진 JSON 을 추측해서 고치지는 않는다.
 */
function salvageObjects(s, start) {
  const out = [];
  const n = s.length;
  let i = start + 1;
  while (i < n) {
    while (i < n && s[i] !== '{') {
      if (s[i] === ']') return out;      // 배열이 정상적으로 끝났다
      i++;
    }
    if (i >= n) break;
    let depth = 0, inStr = false, esc = false, j = i;
    for (; j < n; j++) {
      const c = s[j];
      if (esc) { esc = false; continue; }
      if (c === '\\') { if (inStr) esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) break;
    }
    // 끝까지 닫히지 않은 조각 = 잘린 지점. 여기서 멈춘다.
    if (j >= n || depth !== 0) break;
    try {
      const o = JSON.parse(s.slice(i, j + 1));
      // title 이 없는 건 저장해도 쓸모가 없다 — 호출자가 어차피 버린다.
      if (o && typeof o === 'object' && o.title) out.push(o);
    } catch (e) { /* 이 한 건만 버린다 */ }
    i = j + 1;
  }
  return out;
}

function parseJsonArray(text) {
  const s = String(text || '');
  const start = s.indexOf('[');
  if (start === -1) {
    throw new Error('번역 응답에서 JSON 배열을 찾지 못함: ' + s.slice(0, 150));
  }
  // 정상 경로: 첫 '[' 부터 마지막 ']' 까지 통째로. 대부분은 여기서 끝난다.
  const end = s.lastIndexOf(']');
  if (end > start) {
    try {
      const v = JSON.parse(s.slice(start, end + 1));
      if (Array.isArray(v)) return v;
    } catch (e) { /* 아래에서 건별 복구를 시도한다 */ }
  }
  const salvaged = salvageObjects(s, start);
  if (salvaged.length) return salvaged;
  throw new Error('번역 응답 JSON 파싱 실패(복구 0건): ' + s.slice(0, 150));
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
/* ─── 2026-08-04 Patch 5 — 한 건의 실패가 언어 전체를 얼리지 못하게 ───
 *
 * 사건: 독일어가 14시간 30분 멈췄다. 원인은 두 겹이었다.
 *   ① 대기줄이 published_date DESC 로 고정 → 실패한 건이 영원히 맨 앞에 남는다.
 *   ② 모델이 제목의 곧은 큰따옴표를 이스케이프 없이 뱉으면 JSON 이 통째로 깨진다.
 *      (같은 행의 it 번역이 곧은 따옴표로 저장돼 있던 것이 증거)
 * 대응: 배치 JSON 이 깨지면 빠진 건만 1건씩, JSON 이 아닌 구분자 포맷으로
 *       다시 받는다(따옴표가 무엇이 들어와도 깨질 수 없는 형식). 그래도 안 되면
 *       그 건만 이번 회차에서 빼고 다음 건으로 넘어간다. */
const MAX_PASSES = 3;

/* ─── 2026-08-04 Patch 6 — Patch 5 가 깨뜨린 시간 예산을 되돌린다 ───
 *
 * 사건: Patch 5 배포 후 이 크론의 평균 실행시간이 94~138초가 됐고, 시간당
 * 27회 중 절반 가까이가 100초를 넘었다. Vercel maxDuration 이 120초라
 * 6시간 동안 22번이 실행 도중 강제종료됐다. 그런데 cron_runs 의 실패는
 * 0건이다 — 잘려 죽은 실행은 자기가 죽었다는 기록조차 남기지 못한다.
 *
 * 원인: 크론의 예산 계산은 "runBackfillBatch 한 번 = Claude 호출 한 번"
 * 이라는 전제 위에 서 있다(그래서 웨이브 진입 조건이 CALL_MS + 여유다).
 * Patch 5 는 그 안에 두 겹을 더 넣었다 — 배치가 깨지면 건별 단건 재시도,
 * 그러고도 실패가 남으면 MAX_PASSES(3) 만큼 전체 반복. 사설 호출 상한이
 * 40초이므로 한 번의 runBackfillBatch 가 40초가 아니라 240초를 쓸 수 있다.
 * Patch 5 자체는 옳았다. 다만 바깥의 예산 약속을 안쪽이 모르고 있었다.
 *
 * 대응: 마감시각(절대 시각)을 인자로 받아, **모든 Claude 호출 앞에서**
 * 남은 시간을 확인한다. 부족하면 지금까지 저장한 만큼 돌려주고 물러난다.
 * 시간이 빠듯하면 호출 타임아웃도 남은 시간에 맞춰 줄인다.
 * 마감을 안 주면(관리자 수동 호출) 예전과 똑같이 동작한다. */

/* 호출 하나가 끝난 뒤 저장·정리에 쓸 여유. */
const CALL_SLACK_MS = 3000;

/** 마감까지 남은 ms. 마감이 없으면 Infinity — 즉 제한 없음. */
function msLeft(deadlineAt) {
  const d = Number(deadlineAt);
  if (!Number.isFinite(d) || d <= 0) return Infinity;
  return d - Date.now();
}

/** 이 호출을 시작해도 되는가 — 타임아웃만큼 쓰고도 여유가 남아야 한다. */
function canCall(deadlineAt, timeoutMs) {
  return msLeft(deadlineAt) >= (Number(timeoutMs) || 0) + CALL_SLACK_MS;
}

/** 실제로 줄 호출 타임아웃 — 마감이 가까우면 그만큼 줄인다. */
function callBudget(deadlineAt, timeoutMs) {
  const left = msLeft(deadlineAt);
  if (!Number.isFinite(left)) return timeoutMs;
  return Math.max(1, Math.min(timeoutMs, left - CALL_SLACK_MS));
}

const T_MARK = '<<<TITLE>>>';
const D_MARK = '<<<DESC>>>';
const B_MARK = '<<<BODY>>>';

/* 개수 상한 + 문자수 예산 중 먼저 걸리는 쪽으로 자른다(최소 1건은 보장 —
   예산보다 긴 글도 혼자서는 처리돼야 한다). */
function pickItems(queue, size, cfg) {
  let items = queue.slice(0, Math.max(1, size));
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
  return items;
}

async function callClaude(prompt, maxTokens, model, timeoutMs) {
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
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!apiRes.ok) {
    const body = await apiRes.text().catch(() => '');
    throw new Error('Claude API 실패 (' + apiRes.status + '): ' + body.slice(0, 200));
  }
  const j = await apiRes.json();
  return {
    text: (j.content && j.content[0] && j.content[0].text) || '',
    stopReason: j.stop_reason,
  };
}

/* 배치 프롬프트 — kind 별로 다르다.
   · 에디토리얼 — 제목+요약(사진 중심, 짧은 카피)
   · 아티클     — 제목+본문. 본문은 HTML 조각이 섞여 있어 "태그는 그대로
                  두고 텍스트만 번역"을 명시해야 마크업이 깨지지 않는다. */
function buildBatchPrompt(items, cfg, lang) {
  const src = items.map((e, i) => Object.assign({ i }, cfg.src(e)));
  return cfg.translateBody
    ? `You are translating fashion-magazine ARTICLES for PAP MAGAZINE into ${LANG_NAMES[lang]}.\n` +
      `Rules:\n` +
      `- Keep proper nouns, brand names, and stylized titles unchanged unless a natural localized form exists.\n` +
      `- Translate the body faithfully into native ${LANG_NAMES[lang]} — magazine register, not literal machine translation.\n` +
      `- The body may contain HTML tags. Keep every tag, attribute and URL EXACTLY as-is; translate only the visible text.\n` +
      `- Do not summarize, omit, or add content. Preserve paragraph structure.\n` +
      `- Return ONLY a JSON array, one object per input, shape: {"i":<index>,"title":"...","body":"..."}. No prose, no code fences.\n` +
      `- Inside JSON strings, escape every double quote as \\". Prefer the target language's own quotation marks in the text.\n` +
      `Input JSON:\n` + JSON.stringify(src)
    : `You are translating fashion-magazine editorial metadata for PAP MAGAZINE into ${LANG_NAMES[lang]}.\n` +
      `Rules:\n` +
      `- Keep proper nouns, brand names, and stylized titles (e.g. "CRIMSON", "Rotten Roots") unchanged unless a natural localized form exists.\n` +
      `- The description must read like native ${LANG_NAMES[lang]} fashion-editorial copy — elegant, concise, no literal machine translation.\n` +
      `- Return ONLY a JSON array, one object per input, shape: {"i":<index>,"title":"...","description":"..."}. No prose, no code fences.\n` +
      `- Inside JSON strings, escape every double quote as \\". Prefer the target language's own quotation marks in the text.\n` +
      `Input JSON:\n` + JSON.stringify(src);
}

/* 구분자 응답 파서 — JSON 이 아니므로 따옴표·역슬래시가 섞여도 깨지지 않는다. */
function parseSentinel(text, wantBody) {
  const s = String(text || '');
  const ti = s.indexOf(T_MARK);
  if (ti === -1) return null;
  const second = wantBody ? B_MARK : D_MARK;
  const si = s.indexOf(second, ti + T_MARK.length);
  const title = s.slice(ti + T_MARK.length, si === -1 ? s.length : si).trim();
  if (!title) return null;
  const rest = si === -1 ? '' : s.slice(si + second.length).trim();
  if (!rest) return null;
  return wantBody ? { title, body: rest } : { title, description: rest };
}

/* 1건 전용 재시도. 배치 JSON 이 깨진 건의 최후 수단이다. */
async function translateOne(item, cfg, lang, model, timeoutMs) {
  const s_ = cfg.src(item) || {};
  const wantBody = !!cfg.translateBody;
  const second = wantBody ? B_MARK : D_MARK;
  const prompt =
    `Translate this fashion-magazine ${wantBody ? 'article' : 'editorial'} for PAP MAGAZINE into ${LANG_NAMES[lang]}.\n` +
    `- Keep proper nouns, brand names and stylized titles unchanged unless a natural localized form exists.\n` +
    (wantBody
      ? `- The body may contain HTML tags. Keep every tag, attribute and URL EXACTLY as-is; translate only the visible text.\n`
      : `- The description must read like native ${LANG_NAMES[lang]} fashion-editorial copy — elegant, concise.\n`) +
    `Output format — PLAIN TEXT, not JSON. Print exactly this, and nothing else:\n` +
    T_MARK + `\n<translated title>\n` + second + `\n<translated ${wantBody ? 'body' : 'description'}>\n` +
    `No code fences, no commentary, no surrounding quotes.\n\n` +
    `TITLE: ` + String(s_.title || '') + `\n` +
    (wantBody ? `BODY:\n` + String(s_.body || '') : `DESCRIPTION:\n` + String(s_.description || ''));
  const { text } = await callClaude(prompt, cfg.maxTokens || 8000, model, timeoutMs);
  return parseSentinel(text, wantBody);
}

async function runBackfillBatch({ lang, kind = 'editorial', batch, timeoutMs = 90000, deadlineAt = 0, sinceDate = null, maxSrcChars = 0 } = {}) {
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

  /* 0) 빠른 경로 — 서버가 골라준 큐 (2026-08-05, 마이그레이션 100)
   *
   * 재시도(MAX_PASSES)가 다음 건으로 넘어갈 수 있도록 배치보다 조금 넉넉히
   * 받는다. it 에디토리얼만 예외 — description_it fast-path 가 한 번에 최대
   * 200건을 저장하던 동작을 유지한다(설명은 1,200자로 잘려 오므로 여전히 작다). */
  const queueLimit = (lang === 'it' && kind === 'editorial')
    ? 200
    : Math.min(20, Math.max(size * 3, size + 2));
  const timing = newTiming();
  const since = sinceDate || null;
  /* ─── 2026-08-05 — 원문 길이 상한 (poison pill 차단) ───────────────
   * zh 잔여 181건이 한 건도 안 줄었다. 큐 맨 앞에 9,052자·12,963자짜리가
   * 박혀 있었고, 중국어는 출력 토큰이 2~3배라 호출 타임아웃 안에 못 끝낸다.
   * 큐가 published_date DESC 고정이라 매 실행 같은 두 건을 다시 시도했고
   * 뒤의 179건은 영원히 차례가 오지 않았다.
   * 성공한 zh 번역 329건의 원문 최대는 2,293자, 6,000자 초과 성공은 0건 —
   * 6,000 은 실측에 근거한 안전선이다. 자르지 않고 '제외'하는 이유는
   * 잘린 본문을 저장하면 문장이 끊긴 페이지가 나가기 때문(아래 upsert 주석).
   * 제외분은 관리자 수동 경로로 처리한다(0 = 상한 없음). */
  const maxSrc = Number(maxSrcChars) > 0 ? Math.floor(Number(maxSrcChars)) : 0;
  const fast = await fetchQueueViaRpc(kind, lang, queueLimit, cfg, timing, since, maxSrc);
  if (fast) {
    return runOnQueue({
      lang, kind, cfg, size, timeoutMs, deadlineAt, timing,
      pending: fast.items, remainingTotal: fast.remaining, skippedNoSource: fast.noSource,
      skippedTooLong: fast.tooLong,
    });
  }
  const tFallback = Date.now();

  /* 1) (폴백) 해당 언어 번역이 '내용까지' 있는 id 집합 (2026-07-30 수정)
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
  /* 나이 컷은 RPC 경로와 폴백 경로가 같아야 한다. 한쪽만 걸면 폴백으로
     떨어진 순간 오래된 기사를 다시 번역하기 시작한다 — 이 파일이 _lib 로
     뽑힌 이유(진입점 둘, 로직 하나)와 같은 종류의 사고다. */
  const inAge = (e) => !since || (e.published_date && String(e.published_date) >= since);
  /* 길이 상한도 RPC 경로와 같아야 한다 — 한쪽만 걸면 폴백으로 떨어진 순간
     다시 거대한 기사에 막힌다. */
  const srcLenOf = (e) => String((cfg.src(e) || {}).body || (cfg.src(e) || {}).description || '').length;
  const notTooLong = (e) => !maxSrc || kind !== 'article' || srcLenOf(e) <= maxSrc;
  const fresh = (eds || []).filter(e => e.title && !doneSet.has(e.id) && inAge(e));
  const withSrc = fresh.filter(e => hasSource(e, lang));
  const pending = withSrc.filter(notTooLong);
  const skippedTooLong = withSrc.length - pending.length;
  const skippedNoSource = fresh.filter(e => !hasSource(e, lang)).length;
  const remainingTotal = pending.length;
  timing.queueMs += Date.now() - tFallback;
  return runOnQueue({ lang, kind, cfg, size, timeoutMs, deadlineAt, timing, pending, remainingTotal, skippedNoSource, skippedTooLong });
}

/* 큐가 정해진 뒤의 공통 처리 — RPC 경로와 폴백 경로가 **같은 코드**를 쓴다.
   (진입점이 둘로 갈리면 한쪽만 고쳐지는 사고가 난다. 이 파일이 _lib 로 뽑힌
    이유와 같은 이유로, 갈림길은 '큐를 어떻게 구했나' 까지만 둔다.) */
async function runOnQueue({ lang, kind, cfg, size, timeoutMs, deadlineAt, timing, pending, remainingTotal, skippedNoSource, skippedTooLong }) {
  timing = timing || newTiming();
  if (!remainingTotal) {
    /* '완료' 와 '원본이 없어 못 함' 을 구분해 보고한다. 이 둘을 뭉뚱그리면
       원본 백필이 밀려서 멈춘 상태를 '완주' 로 착각한다. */
    return {
      lang, kind, processed: 0, remaining: 0, skipped_no_source: skippedNoSource,
      skipped_too_long: skippedTooLong || undefined, timing,
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
      const tFast = Date.now();
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
      timing.saveMs += Date.now() - tFast; timing.saves += fastSaved;
      return {
        lang, processed: fastSaved, remaining: remainingTotal - fastSaved, timing,
        mode: 'fastpath-description_it',
        hint: '기존 description_it 활용분 저장. 반복 호출하면 잔여분은 Claude 번역으로 넘어갑니다.',
      };
    }
  }

  /* 3) 번역 + 저장 — 실패한 한 건이 언어 전체를 얼리지 못한다 (Patch 5)
   *   ① 배치 한 번에 JSON 으로 (기존과 동일 — 정상일 때 동작·비용 변화 없음)
   *   ② 배치에서 빠진 건은 1건씩 구분자 포맷으로 재시도 (따옴표로 안 깨짐)
   *   ③ 그래도 실패한 건은 이번 회차에서 제외하고 다음 건으로 (최대 3패스) */
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const failedIds = new Set();
  const errors = [];
  let processed = 0;
  /* 마감에 걸려 중단했는가. '할 일이 없어서 끝난 것' 과 구분해 보고한다 —
     이걸 뭉뜽그리면 시간에 쫓겨 못 한 것을 완주로 착각한다. */
  let ranOut = false;

  for (let pass = 0; pass < MAX_PASSES && processed < size; pass++) {
    const queue = pending.filter(e => !failedIds.has(e.id));
    const items = pickItems(queue, size - processed, cfg);
    if (!items.length) break;

    /* 배치 호출 한 번 쓸 시간이 없으면 여기서 접는다. */
    if (!canCall(deadlineAt, timeoutMs)) { ranOut = true; break; }

    /* ① 배치 */
    let parsed = [];
    const tBatch = Date.now();
    try {
      const r = await callClaude(buildBatchPrompt(items, cfg, lang), cfg.maxTokens || 8000, model,
        callBudget(deadlineAt, timeoutMs));
      /* 2026-08-03 Patch 4: 잘렸더라도 앞부분의 온전한 건은 살린다. */
      const v = parseJsonArray(r.text);
      if (Array.isArray(v)) parsed = v;
    } catch (e) {
      errors.push({ reason: '배치 실패: ' + String((e && e.message) || e).slice(0, 80) });
    }
    timing.callMs += Date.now() - tBatch; timing.calls++;

    const got = new Map();
    for (const t of parsed) {
      const srcItem = items[t.i];
      if (srcItem && t.title) got.set(srcItem.id, t);
    }

    /* ② 빠진 건만 1건씩 재시도 */
    for (const it of items) {
      if (got.has(it.id)) continue;
      /* 재시도가 마감을 밀고 나가지 않는다. 이건 그 기사의 잘못이 아니므로
         failedIds 에 넣지 않는다 — 다음 실행에서 그대로 다시 시도된다. */
      if (!canCall(deadlineAt, timeoutMs)) { ranOut = true; break; }
      const tOne = Date.now();
      try {
        const one = await translateOne(it, cfg, lang, model, callBudget(deadlineAt, timeoutMs));
        timing.callMs += Date.now() - tOne; timing.calls++;
        if (one && one.title) got.set(it.id, one);
        else {
          failedIds.add(it.id);
          errors.push({ id: it.id, reason: '단건 재시도 파싱 실패' });
        }
      } catch (e) {
        timing.callMs += Date.now() - tOne; timing.calls++;
        failedIds.add(it.id);
        errors.push({ id: it.id, reason: '단건 재시도 실패: ' + String((e && e.message) || e).slice(0, 60) });
      }
    }

    /* ③ 저장 */
    const tSave = Date.now();
    for (const it of items) {
      const t = got.get(it.id);
      if (!t) continue;
      const { error: upErr } = await supabaseAdmin
        .from('seo_translations')
        .upsert({
          kind,
          content_id: it.id,
          lang,
          title: String(t.title).slice(0, 300),
          description: t.description ? String(t.description).slice(0, 2000) : null,
          // 본문은 아티클만. 길이 제한을 두지 않는다 — 잘린 본문을 저장하면
          // 사용자에게 문장이 끊긴 페이지가 나간다.
          body: cfg.translateBody && t.body ? String(t.body) : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'kind,content_id,lang' });
      if (upErr) {
        failedIds.add(it.id);
        errors.push({ id: it.id, reason: upErr.message });
        continue;
      }
      processed++;
      timing.saves++;
    }
    timing.saveMs += Date.now() - tSave;

    /* 마감에 걸렸으면 다음 패스로 넘어가지 않는다 (저장은 위에서 이미 끝났다). */
    if (ranOut) break;
    /* 실패가 없으면 한 패스로 끝낸다 — 정상 상황의 실행량은 기존과 같다. */
    if (!failedIds.size) break;
  }

  return {
    lang,
    kind,
    processed,
    remaining: remainingTotal - processed,
    // 원본(설명)이 없어 손댈 수 없는 건수. 0 이 아니면 '완주' 가 아니다.
    skipped_no_source: skippedNoSource,
    /* 원문이 너무 길어 자동 대상에서 뺀 건수. 0 이 아니면 그만큼은 관리자
       수동 경로로 처리해야 한다 — '잔여'와 뭉뚱그리면 큐가 막힌 상태를
       '아직 할 일이 남았다'로 착각한다(2026-08-05 zh 사고). */
    skipped_too_long: skippedTooLong || undefined,
    // 이번 회차에서 건너뛴 불량 건수. 0 이 아니면 그 id 를 사람이 확인해야 한다.
    skipped_failed: failedIds.size || undefined,
    // 마감에 걸려 중단했다. 잔여가 남아도 '막힌 것' 이 아니라 '시간이 끝난 것'.
    ran_out_of_time: ranOut || undefined,
    // 2026-08-05 계측: 이 조합이 큐조회/AI호출/저장에 각각 몇 ms 를 썼는가.
    timing,
    errors: errors.length ? errors : undefined,
    hint: remainingTotal - processed > 0 ? '같은 URL 을 반복 호출해 잔여분을 처리하세요.' : '전부 번역 완료.',
  };
}

module.exports = { runBackfillBatch, newTiming, normalizeBatch, parseJsonArray, salvageObjects, parseSentinel, pickItems, buildBatchPrompt, msLeft, canCall, callBudget, CALL_SLACK_MS, MAX_PASSES, LANG_NAMES, KINDS };
