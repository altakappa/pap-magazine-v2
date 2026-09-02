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
const { normalizeFaq, callClaude } = require('./seoTranslateBackfill');
/* JSON 파싱은 jsonRepair 의 **네 칸짜리** 계단을 쓴다.
   seoTranslateBackfill 에도 같은 이름의 parseJsonArray 가 있지만 그건 세 칸이고
   (넷째 칸 '덩어리 고르기' 가 없다), 그 파일 주석이 "번역 배치 전용 계약이
   얽혀 있어 건드리지 않는다" 고 못박아 둔 별개 함수다. 파서가 세 벌인 셈인데,
   내가 처음에 통일한 대상이 하필 세 칸짜리였다.
   로컬 재현: '```json [...] ``` 뒤에 대괄호 섞인 산문' 과 '배열 두 개' 가
   세 칸에서는 [형태불명] 으로 죽고 네 칸에서는 살아난다. */
const { parseJsonArray, parseJsonLines } = require('./jsonRepair');

/* 대상 표. label 은 크론 note 에 그대로 찍힌다.
   batch 를 표마다 다르게 두는 이유 (2026-08-28 라이브 실측):
   기사 FAQ 는 최대 5항목, 화보는 3항목이다. 같은 8건 배치로 돌렸더니
   화보는 8/8 성공하고 기사는 응답이 max_tokens 에서 잘려 전멸했다
   ('[faq-en] articles 번역 응답 JSON 파싱 실패[형태불명]' + 잘린 JSON).
   화보 FAQ 도 2026-08-27 에 같은 사고를 겪었다(fd95059: 10x4000 → 6x8000).
   출력 길이는 건수가 아니라 **항목 수 x 건수**로 정해진다. */
/* 2026-09-02 상향 (4·8 → 12·20). 위 주석의 "batch 8 은 max_tokens 에서 잘려
   전멸했다" 는 진단이 **오늘 뒤집혔다.** 같은 실패를 런타임 로그로 다시 재니
   stop_reason 이 전부 end_turn 이었고 길이도 상한의 절반이었다 — 잘린 게 아니라
   모델이 바깥 배열의 ] 를 빼먹은 것이었다. 즉 배치를 4 로 줄인 조치는 틀린
   원인에 대한 처방이었고, 그 처방이 처리량 상한으로 1주일째 남아 있었다.
   게다가 이제는 JSONL 이라 정말 잘려도 완성된 줄은 다 살아남는다.

   실측 응답 길이 — 기사 batch=4 → 3,285자, 화보 batch=8 → 5,922자.
   건당 약 820자·740자다. 12건·20건이면 약 9,800자·14,800자 ≈ 2,500·3,700 토큰,
   아래 MAX_TOKENS(16,000)의 4분의 1 이하다. */
/* 화보 20 → 12 (2026-09-02, 배포 후 실측). 상한을 푼 첫 회차:

     15:03  영문FAQ 12 · 잔여 4135 · 1회전 · 기사:12 화보:실패   duration 95,178ms

   기사 12 는 그대로 성공했다(종전 8). 화보 20 은 콜이 안 끝나 통째로 실패했고,
   그 콜이 예산을 다 먹어 2회전도 못 돌았다 — 결과는 12건으로 종전(16~31)보다 나쁘다.
   화보 FAQ 는 항목이 3개뿐이라 가볍다고 봤는데, 실제로는 20건이 55초를 넘겼다.
   기사와 같은 12 로 맞춘다. */
const TARGETS = [
  { table: 'articles', label: '기사', batch: 12 },
  { table: 'editorials', label: '화보', batch: 12 },
];

/* 한 배치가 쓸 수 있는 출력 토큰.
   종전 주석은 "여기를 올리는 것보다 batch 를 줄이는 쪽이 안전하다 — 잘린 응답은
   전멸" 이었다. 두 전제가 다 바뀌었다: (a) 실측에서 잘린 적이 없었고(stop_reason
   전부 end_turn), (b) JSONL 이라 잘려도 전멸하지 않는다.
   토큰은 **쓴 만큼** 과금된다. 상한을 올려도 짧은 응답의 비용은 그대로다.
   상한이 낮은 것만이 배치 크기를 묶고 있었다. */
const MAX_TOKENS = 16000;

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
    /* JSONL 로 바꾼다 (2026-09-02). 종전 계약은 "배열 하나로 달라" 였는데
       실측에서 모델이 **바깥 배열의 닫는 ] 를 빼먹었다** (stop_reason=end_turn,
       길이는 상한의 절반 — 잘린 게 아니다). 자세한 근거는 jsonRepair.parseJsonLines
       머리말에 적었다.
       줄 단위면 닫을 바깥 괄호가 없어 놓칠 것이 없고, 한 줄이 깨져도 그 한 건만
       잃는다. 종전에는 8건 중 하나만 어긋나도 전멸이었다. */
    '- Output one JSON object per line (JSONL). Do NOT wrap them in an array.',
    '- Each line: {"i":<index>,"faq":[{"q":"...","a":"..."}]}',
    '- Exactly one line per input item, in the same order. No prose, no code fences,',
    '  no blank lines, no trailing commas.',
    'Input JSON:',
    JSON.stringify(payload),
  ].join('\n');
}

/** 한 표를 batch 만큼 처리. */
async function runOneTable(target, batch, model, timeoutMs) {
  const { table, label } = target;
  /* 표별 크기는 **표가 정한다.** 호출부의 batch 는 표에 값이 없을 때 쓰는 기본값일 뿐이다.

     2026-09-02 실측에서 이 한 줄이 처리량을 40%로 묶고 있었다.
     크론이 batch:8 을 넘기는데 Math.min(8, 12) = 8 이 되어, 오늘 올린 기사 12·화보 20
     설정이 **한 번도 적용된 적이 없다.** 노트가 그걸 그대로 말하고 있었는데
     (`2회전 · 기사:8 화보:16` = 회당 8·8) 내가 못 읽었다.

     min 을 쓴 원래 의도는 "호출부가 큰 값을 줘도 잘린 응답으로 전멸하지 않게" 였다.
     표 값을 그대로 쓰면 그 의도는 더 확실히 지켜진다 — 호출부가 무엇을 주든
     표가 정한 크기를 넘지 않는다. */
  const useBatch = Math.max(1, target.batch || batch);
  const cutoff = await cutoffDate(table);
  const rows = await fetchPending(table, useBatch, cutoff);
  if (!rows.length) {
    return { table, label, processed: 0, remaining: await countRemainingSafe(table, cutoff) };
  }

  const payload = rows.map((r, i) => ({ i, faq: r.faq }));

  let arr = null;
  let stopReason = null;
  let rawText = '';
  let repaired = 'none';   // 계단 몇 칸째로 살렸나 — note 에 남긴다
  try {
    const raw = await callClaude(buildPrompt(payload), MAX_TOKENS, model, timeoutMs);
    /* callClaude 는 {text, stopReason} 객체다. String(raw) 로 받으면
       "[object Object]" 가 되어 조용히 0건이 된다 — 화보 언어판 백필이
       2026-08-27~28 에 정확히 그 상태로 24시간 헛돌았다. */
    stopReason = raw && raw.stopReason;
    rawText = (raw && raw.text) || '';
    /* 줄 단위로 먼저 읽는다. 이 파서는 대괄호를 세지 않으므로 모델이 옛 계약대로
       배열을 보내와도 그대로 읽힌다 — 계약을 바꾸는 동안 한쪽이 죽지 않는다.
       못 읽으면 종전 배열 파서로 한 번 더 간다(양쪽 실패해야 실패다). */
    try {
      const lines = parseJsonLines(rawText, table);
      arr = lines.value;
      repaired = lines.repaired + (lines.dropped ? '/버림' + lines.dropped : '');
    } catch (lineErr) {
      const parsed = parseJsonArray(rawText, table);
      arr = parsed.value;
      repaired = 'array:' + parsed.repaired;
    }
  } catch (err) {
    /* stop_reason 을 반드시 함께 남긴다. 'JSON 파싱 실패' 만 적으면 원인이
       '모델이 이상한 걸 뱉었다' 인지 '길어서 잘렸다' 인지 못 가른다 —
       실제로 이 구분이 없어 배치 크기 문제를 한 회차 늦게 알았다. */
    /* **꼬리를 찍는다.** 머리는 언제나 '```json\n[{"i":0,' 이라 아무 정보가 없다 —
       parseJsonArray 주석이 그 교훈을 적어 뒀는데(2026-08-08, 87% 실패를 보고도
       원인을 못 갈랐다) 나는 head 만 찍어서 같은 실수를 반복했다.
       trailing comma·두 번째 배열·뒤에 붙은 산문은 전부 끝에서만 보인다. */
    /* 머리도 남긴다 (2026-09-02). 종전 주석은 "머리는 언제나 ```json\n[{\"i\":0,
       이라 아무 정보가 없다" 고 단정했는데, 이번 진단에서 **그 단정 자체가
       확인된 적 없다**는 게 문제였다. 모델이 산문을 앞에 붙였는지, 객체로
       감쌌는지는 머리를 봐야 안다. 꼬리만으로는 못 가른다. */
    console.error('[faq-en]', table, 'batch=' + useBatch,
      'stop_reason=' + (stopReason || '?'), 'len=' + rawText.length,
      '| head=' + JSON.stringify(rawText.slice(0, 200)),
      '| tail=' + JSON.stringify(rawText.slice(-300)),
      (err && err.message) || err);
    return {
      table, label, processed: 0, failed: true,
      truncated: stopReason === 'max_tokens',
      remaining: await countRemainingSafe(table, cutoff),
    };
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

  /* 요청 건수와 저장 건수가 다르면 그 사실을 남긴다. JSONL 은 한 줄이 깨져도
     나머지가 살아서 오는 게 장점인데, 그 '일부 유실' 이 안 보이면 장점이
     조용한 손실로 바뀐다. */
  return {
    table, label, processed, repaired,
    asked: rows.length,
    remaining: await countRemainingSafe(table, cutoff),
  };
}

/* 한 콜을 시작하려면 최소 이만큼은 남아 있어야 한다. 20초로는 콜을 **시작만
   하고** 타임아웃으로 죽는 일이 실제로 났다(editorialFaqI18nBackfill 의 'es' 건).
   돈은 나가고 데이터는 0이다. */
const START_FLOOR_MS = 35000;

/* 한 회차에 같은 표를 몇 번까지 다시 돌 것인가.
   무한 루프 방지용 안전핀이다 — 잔여가 안 줄어드는 경우는 아래에서 따로 끊지만,
   그 판정 자체가 틀릴 수 있으므로 회수 상한을 겹쳐 둔다. */
const MAX_WAVES = 6;

/**
 * 한 회차. 표를 **동시에** 부르고, 예산이 남으면 다시 돈다.
 *
 * ■ 왜 이렇게 바꿨나 (2026-09-02)
 * 종전에는 표마다 한 번씩만 부르고 끝냈다. 실측 실행 시간이 45~68초인데 함수
 * 예산은 100초다 — 30~50초를 매 회차 그냥 버렸다. 게다가 두 콜을 순서대로
 * 기다렸다: 기사 30초 + 화보 30초 = 60초인데, 둘은 서로 아무 상관이 없다.
 *
 * 크론 주기를 당기는 길은 막혀 있다 — vercel-cost-guard 실측이 2,598 / 2,600 이다.
 * 함수 시간을 늘리는 길(maxDuration 120 → 300)은 Vercel 이 **초 단위로도**
 * 과금하므로 비용이 는다. 동시 호출은 크론 호출도, 함수 시간도, 토큰도 늘지
 * 않는다 — 같은 벽시계 안에서 하는 일만 는다. 그래서 이쪽을 먼저 쓴다.
 *
 * 한 표를 이 회차에서 빼는 조건 (셋 다 "더 해봐야 소용없다" 는 뜻):
 *   · 실패했다        — 같은 원인으로 다음 파도도 실패한다. 예산만 태운다.
 *   · 0건 저장했다    — 대상이 없거나 응답이 못 쓸 것이다.
 *   · 잔여가 0이다    — 완주.
 *   · 잔여가 안 줄었다 — 저장은 됐다는데 잔여가 그대로면 둘 중 하나가 거짓말이다.
 *                        원인을 모른 채 반복하지 않는다.
 *
 * @returns {{processed:number, remaining:number|null, waves:number, note:string}}
 */
async function runFaqEnBatch({ batch = 8, timeoutMs = 90000, model } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY 환경변수 미설정.');
    e.statusCode = 503;
    throw e;
  }
  const useModel = model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const deadline = Date.now() + timeoutMs;

  /* 표별 누계. 파도마다 한 줄씩 찍으면 노트가 같은 라벨로 도배된다 —
     '기사:12 기사:12 기사:8' 이 아니라 '기사:32' 로 합쳐서 남긴다. */
  const acc = new Map();   // table -> { label, processed, asked, remaining, tag }
  const bump = (r) => {
    const cur = acc.get(r.table) || { label: r.label, processed: 0, asked: 0, remaining: null, tag: null };
    cur.processed += (r.processed || 0);
    cur.asked += (r.asked || 0);
    if (typeof r.remaining === 'number') cur.remaining = r.remaining;   // 늘 마지막 값
    if (r.failed && !cur.processed) cur.tag = r.truncated ? '잘림' : '실패';
    if (r.repaired && r.repaired !== 'none') cur.tag = r.repaired;
    acc.set(r.table, cur);
  };

  let live = TARGETS.slice();
  let waves = 0;

  while (live.length && waves < MAX_WAVES && Date.now() <= deadline - START_FLOOR_MS) {
    waves++;
    const budget = Math.max(20000, deadline - Date.now() - 5000);
    const before = new Map(live.map((t) => [t.table, (acc.get(t.table) || {}).remaining]));

    /* 표들을 **동시에** 부른다. 하나가 던져도 나머지를 죽이지 않으므로
       Promise.all 앞에서 각자 catch 한다 (allSettled 를 쓰면 결과 모양이
       한 겹 더 싸여서 아래 집계가 그만큼 복잡해진다). */
    const results = await Promise.all(live.map((t) =>
      runOneTable(t, batch, useModel, budget).catch((err) => {
        console.error('[faq-en]', t.table, (err && err.message) || err);
        return { table: t.table, label: t.label, processed: 0, failed: true, remaining: null };
      })));

    const next = [];
    for (const r of results) {
      bump(r);
      if (r.failed) continue;
      if (!r.processed) continue;
      if (r.remaining === 0) continue;
      const prev = before.get(r.table);
      if (typeof prev === 'number' && typeof r.remaining === 'number' && r.remaining >= prev) {
        console.error('[faq-en]', r.table, '잔여가 안 줄었다 — 이 회차에서 뺀다',
          'before=' + prev, 'after=' + r.remaining, 'processed=' + r.processed);
        continue;
      }
      const t = TARGETS.find((x) => x.table === r.table);
      if (t) next.push(t);
    }
    live = next;
  }

  let processed = 0;
  let remaining = 0;
  let remainingKnown = false;
  const per = [];
  for (const cur of acc.values()) {
    processed += cur.processed;
    if (typeof cur.remaining === 'number') { remaining += cur.remaining; remainingKnown = true; }
    if (!cur.processed && !cur.remaining && !cur.tag) continue;
    /* 요청 건수와 저장 건수가 다르면 그 사실을 남긴다. JSONL 은 한 줄이 깨져도
       나머지가 살아 오는 게 장점인데, 그 '일부 유실' 이 안 보이면 조용한 손실이 된다. */
    const short = cur.asked && cur.processed < cur.asked
      ? String(cur.processed) + '/' + cur.asked : String(cur.processed);
    const tag = (cur.tag === '실패' || cur.tag === '잘림') ? cur.tag
      : short + (cur.tag ? '(' + cur.tag + ')' : '');
    per.push(cur.label + ':' + tag);
  }

  return {
    processed,
    remaining: remainingKnown ? remaining : null,
    waves,
    /* 파도 수를 찍는다. 이 값이 늘 1이면 반복이 실제로는 안 도는 것이고,
       그건 노트를 안 보면 알 수 없다 — 종전에 시간을 버리던 것도 그래서 몰랐다. */
    note: '영문FAQ ' + processed + ' · 잔여 ' + (remainingKnown ? remaining : '?')
      + ' · ' + waves + '회전'
      + (per.length ? ' · ' + per.join(' ') : ''),
  };
}

module.exports = { runFaqEnBatch, runOneTable, fetchPending, countRemainingSafe, cutoffDate, recentLimit, buildPrompt, TARGETS };
