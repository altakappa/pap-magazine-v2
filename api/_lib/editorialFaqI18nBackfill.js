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
/* 네 칸짜리 계단(jsonRepair). seoTranslateBackfill 의 동명 함수는 세 칸이고
   번역 배치 전용이다 — 파서가 세 벌이었고 나는 처음에 세 칸짜리를 골랐다. */
const { parseJsonArray, parseJsonLines } = require('./jsonRepair');

/* ko 는 원본, en 은 faq_en 칼럼(마이그레이션 139 · faqEnBackfill.js)이 담당한다.
   2026-08-28 까지 이 목록에 'en' 이 있었지만 죽은 항목이었다 — 이 백필은
   **기존 번역행 UPDATE 만** 하는데 seo_translations 에 en 행은 0개다.
   매 회차 조회 0건으로 조용히 넘어가느라 죽은 줄도 안 보였다. */
const TARGET_LANGS = ['it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'];

/* 언어 회전 (2026-09-02) ────────────────────────────────────────────────
   실측 — JSONL 전환 직후 언어판이 살아났는데(0 → 12건/회) 채워지는 언어가
   앞 두 개뿐이었다:

     lang  채움   빈칸
     fr     277   2234
     it     132   2382
     es      37   2474
     de       1   2295     ← 사실상 시작도 못 함
     ja       1   2509
     ru       1   2295
     zh       1   2295

   원인: 목록을 **항상 처음부터** 돌았다. 한 회차의 시간 예산(100초에서 원본
   생성분을 뺀 나머지)으로는 언어 2~3개가 한계라, 매번 it·fr 에서 끝났다.
   it·fr 가 각 2,300건을 끝내려면 이 속도로 약 27일이고, **es 이후는 그 27일이
   지나야 시작한다.** 뒤쪽 네 언어는 영원히 차례가 안 온다.

   고침: 회차마다 시작 위치를 한 칸씩 민다. 크론이 10분 주기이므로 10분 슬롯을
   세어 인덱스로 쓴다 — 서버리스라 회차 간 기억이 없으므로 **시계가 유일한
   무상태 커서**다. DB 에 커서를 두는 방법도 있지만 조회·갱신·경합 처리가 늘고,
   이 문제엔 그만한 정밀도가 필요 없다.

   결과: 7개 언어가 7회차(약 70분)에 한 바퀴 돈다. 회차당 2~3개를 도므로
   실제로는 그보다 촘촘하다. 한 회차를 걸러도 다음 회차가 다음 칸을 잡는다. */
const ROTATE_SLOT_MS = 10 * 60 * 1000;   // vercel.json: 4,14,24,34,44,54 * * * *

/**
 * 이번 회차에 어느 언어부터 돌 것인가.
 * @param {number} [now] 시각(ms). 테스트에서 고정한다.
 * @returns {string[]} TARGET_LANGS 를 회전시킨 목록
 */
function rotatedLangs(now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const n = TARGET_LANGS.length;
  const i = ((Math.floor(t / ROTATE_SLOT_MS) % n) + n) % n;   // 음수 시각도 안전
  return TARGET_LANGS.slice(i).concat(TARGET_LANGS.slice(0, i));
}

/* 한 배치의 출력 토큰. 배치를 키우는 것보다 회차를 늘리는 쪽이 안전하다 —
   잘린 응답은 그 배치 전멸이고, 작은 배치는 그냥 다음 회차로 넘어갈 뿐이다. */
const MAX_TOKENS = 8000;

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
    /* JSONL 로 바꾼다 (2026-09-02). 종전 "배열 하나로 달라" 계약에서 모델이
       **바깥 배열의 닫는 ] 를 빼먹는다.** 실측(런타임 로그 5회 x it·fr·es):
         it 08:24 end_turn len=3599 tail=..."}]}      ← 바깥 ] 없음
         it 08:44 end_turn len=3657 tail=..."}]}}     ← ] 자리에 }
         fr 전부        len=4176~4458 tail=..."}]     ← } 와 ] 둘 다 없음
       전부 end_turn 이고 길이는 상한(8000)의 절반이다 — 잘린 게 아니다.
       기사·화보 영문판(faqEnBackfill)에서 똑같은 모양을 먼저 확인했다.
       근거 전문은 jsonRepair.parseJsonLines 머리말.

       줄 단위면 닫을 바깥 괄호가 없어 놓칠 것이 없고, 한 줄이 깨져도 그 한 건만
       잃는다. 실측에 {"i":6,"faq":[]} 처럼 모델이 한 항목을 포기한 경우도
       있었는데, 배열 계약에서는 그것 때문에 6건이 통째로 죽었다. */
    '- Output one JSON object per line (JSONL). Do NOT wrap them in an array.\n' +
    '- Each line: {"i":<index>,"faq":[{"q":"...","a":"..."}]}\n' +
    '- Exactly one line per input item, in the same order. No prose, no code fences,\n' +
    '  no blank lines, no trailing commas.\n' +
    'Input JSON:\n' + JSON.stringify(payload);

  /* callClaude 는 문자열이 아니라 {text, stopReason} 객체를 돌려준다.
     2026-08-27~28 사이 이 자리는 String(raw) 였고, 그 값은 언제나
     "[object Object]" 였다 → JSON.parse 실패 → 배열 정규식도 실패 →
     매 회차 조용히 processed:0. cron_runs 에 '화보FAQ 언어판 0 · it:0 fr:0'
     이 24시간 찍히는 동안 Claude 호출만 나가고 저장은 0건이었다.
     (GROWTH-LEDGER 교훈 1 "돌았다 ≠ 했다" 의 네 번째 재발) */
  const raw = await callClaude(prompt, MAX_TOKENS, model, timeoutMs);
  const text = String((raw && raw.text) || '');

  /* 파싱은 **공용 계단**(parseJsonArray)을 쓴다. 2026-08-28 까지 이 자리에는
     JSON.parse + /\[[\s\S]*\]/ 정규식이라는 **두 번째 파서**가 따로 있었다.
     2026-08-25 에 jsonRepair 에 넷째 칸(균형 잡힌 덩어리 고르기)을 붙였는데
     그 수리는 parseJsonArray 에만 들어갔고 여기는 옛 정규식 그대로였다 —
     교훈 2("규칙이 두 벌이면 한쪽만 고쳐진다")가 그대로 재현됐다.

     그리고 실패 경로가 **아무것도 안 찍고** 조용히 0을 반환했다. 그래서
     callClaude 오용을 고친 뒤에도 'it:0 fr:0' 이 왜 계속 0인지 로그로 알 수
     없었다. 이제 stop_reason 과 응답 머리를 남긴다 — '잘렸다' 와 '이상한 걸
     뱉었다' 는 고치는 방법이 다르다(fd95059 에서 이미 배운 구분). */
  let arr;
  let repaired = 'none';
  try {
    /* 줄 단위로 먼저 읽는다. 이 파서는 대괄호를 세지 않으므로 모델이 옛 계약대로
       배열을 보내와도 그대로 읽힌다 — 계약을 바꾸는 동안 한쪽이 죽지 않는다.
       게다가 지금 오는 **바깥 ] 없는 응답도 그대로 살린다**(원소 객체는 온전하다). */
    const lines = parseJsonLines(text, 'faq-i18n/' + lang);
    arr = lines.value;
    repaired = lines.repaired + (lines.dropped ? '/버림' + lines.dropped : '');
  } catch (lineErr) {
  try {
    const parsed = parseJsonArray(text, 'faq-i18n/' + lang);
    arr = parsed.value;
    repaired = 'array:' + parsed.repaired;
  } catch (err) {
    /* 머리가 아니라 **꼬리**를 찍는다 — 머리는 언제나 '```json\n[{"i":0,' 이라
       종류를 못 가른다. trailing comma·두 번째 배열·뒤에 붙은 산문은 끝에만 있다. */
    /* 머리도 남긴다 (2026-09-02) — 앞에 붙은 산문이나 감싼 객체는 꼬리로 못 본다.
       2026-08-08 교훈은 "꼬리를 반드시 남겨라" 였지 "머리를 남기지 마라" 가 아니다. */
    console.error('[faq-i18n]', lang, 'batch=' + take.length,
      'stop_reason=' + ((raw && raw.stopReason) || '?'), 'len=' + text.length,
      '| head=' + JSON.stringify(text.slice(0, 200)),
      '| tail=' + JSON.stringify(text.slice(-300)),
      (err && err.message) || err);
    return { processed: 0, remaining: pending.length, lang, failed: true };
  }
  }
  if (!Array.isArray(arr)) {
    console.error('[faq-i18n]', lang, '배열이 아님',
      'stop_reason=' + ((raw && raw.stopReason) || '?'), 'len=' + text.length,
      '| tail=' + JSON.stringify(text.slice(-300)));
    return { processed: 0, remaining: pending.length, lang };
  }

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
  /* 요청 건수를 함께 돌려준다 — JSONL 은 일부만 살아 오는 게 장점인데
     그 유실이 안 보이면 장점이 조용한 손실이 된다. */
  return { processed, remaining: Math.max(0, pending.length - processed),
    lang, repaired, asked: take.length };
}

/** 한 회차: 언어를 순회하며 예산 안에서 처리. */
async function runEditorialFaqI18nBatch({ batch = 8, timeoutMs = 90000, model, now: opts_now } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY 환경변수 미설정.');
    e.statusCode = 503;
    throw e;
  }
  const useModel = model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const srcMap = await recentWithFaq();
  if (!srcMap.size) return { processed: 0, remaining: 0, note: '화보FAQ 언어판 0 · 원본 FAQ 없음' };

  const deadline = Date.now() + timeoutMs;
  /* 이번 회차의 언어 순서. 항상 처음부터 돌면 앞 두 개만 채워진다(위 주석). */
  const order = rotatedLangs(opts_now);
  let processed = 0;
  let remaining = 0;
  /* 이 회차에 실제로 본 언어 수. 시간 예산 때문에 매번 다르다 —
     그래서 remaining 도 매번 다르다(2026-09-02 실측: 2개 언어 215, 3개 언어 478).
     그 숫자를 '전체 잔여'인 것처럼 적어 두면 노트가 거짓말을 한다. */
  let visited = 0;
  const per = [];
  for (const lang of order) {
    /* 문턱을 20초에서 35초로 올렸다 (2026-08-28). 20초로는 콜을 **시작만 하고**
       타임아웃으로 죽는 일이 실제로 났다 — 07:04 실행의 'es The operation was
       aborted due to timeout'. 돈은 나가고 데이터는 0이다. 끝낼 수 없는 콜은
       시작하지 않는다. 이 회차에 못 돈 언어는 다음 회차가 맡는다(10분 뒤). */
    if (Date.now() > deadline - 35000) break;
    try {
      const r = await runOneLang(lang, srcMap, batch, useModel,
        Math.max(20000, deadline - Date.now() - 5000));
      visited++;
      processed += r.processed;
      remaining += (r.remaining || 0);
      if (r.processed || r.remaining) {
        /* '실패' 와 '일부만 저장' 을 가른다. 종전에는 둘 다 'it:0' 으로 보여
           파싱이 죽은 것과 대상이 없는 것을 구분할 수 없었다. */
        const short = r.failed ? '실패'
          : (r.asked && r.processed < r.asked
            ? String(r.processed) + '/' + r.asked : String(r.processed));
        per.push(lang + ':' + short
          + (r.repaired && r.repaired !== 'none' ? '(' + r.repaired + ')' : ''));
      }
    } catch (err) {
      console.error('[faq-i18n]', lang, (err && err.message) || err);
      per.push(lang + ':실패');
    }
  }
  return {
    processed, remaining,
    visited,
    /* 잔여 뒤에 '(N개 언어)' 를 붙인다. 이 값은 전체가 아니라 **이번에 확인한
       언어들의 합**이다. 안 적으면 215↔478 진동이 원인 불명으로 보인다. */
    order,
    note: '화보FAQ 언어판 ' + processed
      + ' · 잔여 ' + remaining + '(' + visited + '/' + TARGET_LANGS.length + '개 언어, ' + order[0] + '부터)'
      + (per.length ? ' · ' + per.join(' ') : ''),
    scope: srcMap.size,
  };
}

module.exports = { runEditorialFaqI18nBatch, runOneLang, rotatedLangs, ROTATE_SLOT_MS, recentWithFaq, recentLimit, TARGET_LANGS };
