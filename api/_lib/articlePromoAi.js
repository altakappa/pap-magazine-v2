/**
 * articlePromoAi.js — 아티클이 홍보성 글인지 AI 에게 묻는다 (2026-11-12 신설)
 *
 * 도메니코 2026-11-11: "아티클이 홍보성글인지 아닌지는 ai로 분석해서 잡아내면 좋겠어."
 *
 * ■ AI 는 **판정하지 않는다.** 관리자에게 의견을 올린다.
 * 돌려주는 것은 점수·근거·**본문 인용**·언급된 브랜드 목록이다. €790 을 자동으로
 * 매기지 않는다. 오탐의 비용이 비대칭이기 때문이다 — 비평 글을 홍보로 잘못 잡으면
 * 멀쩡한 필자에게 청구서가 가고 그 사람은 다시 쓰지 않는다. 반대로 홍보 글을
 * 놓치면 무료 게재 한 건의 손실로 끝난다.
 *
 * 2026-11-08 의 교훈도 같다: AI 가 캡션에 없는 사실을 지어내 19개 기사를 고쳤다.
 * **AI 출력은 근거와 함께 사람에게 보여주는 데까지**가 안전한 선이다. 그래서
 * 인용(quotes)을 반드시 받는다 — 도메니코가 그 문장을 본문에서 직접 확인할 수 있다.
 *
 * ■ 가르는 기준은 "브랜드가 몇 개 나오나"가 아니라 "이 글의 목적이 무엇인가"
 * 도메니코 2026-11-11: "어떠한 사회적현상에 대해서 설명하면서 거기에 관련된
 *   여러브랜드가 자연스레 뭍어나는것은 상관없음." 여러 브랜드가 나와도 한
 *   브랜드를 띄우는 글이면 홍보 글이고, 한 브랜드만 나와도 비평이면 일반 기고다.
 *   프롬프트가 이 구분을 그대로 담는다.
 *
 * ■ 절대 throw 하지 않는다
 * 분석 실패가 제출을 막으면 안 된다. 실패하면 { ok:false, error } 를 돌려주고
 * 관리자 화면에 '분석 실패' 로 뜬다 — 그 자리는 사람이 읽는 자리다.
 *
 * 끄기: Vercel 환경변수 ARTICLE_PROMO_AI=off → 분석을 건너뛴다(제출은 그대로).
 */

'use strict';

/* 긴 글 한 편을 읽는다 — 셀럽 분류(8초)보다 넉넉히.
   호출부가 예산을 줄여 쓸 수 있다: 제출 경로는 회원을 기다리게 하므로 짧게,
   관리자 재분석 경로는 넉넉하게. */
const AI_TIMEOUT_MS = 20000;
const MAX_BODY_CHARS = 24000;         // 토큰·비용 상한. 넘으면 앞부분만 보낸다(목적은 앞에 드러난다)
const MODEL_DEFAULT = 'claude-haiku-4-5-20251001';

const SYSTEM = [
  'You assess whether a magazine article submission is a PROMOTIONAL piece or EDITORIAL writing.',
  '',
  'PROMOTIONAL means the purpose of the text is to promote one specific brand, artist, product,',
  'collection, event or launch. It reads like a press release, or the piece exists to make that',
  'one subject look good.',
  '',
  'EDITORIAL means the purpose is to examine a phenomenon, trend, industry or idea. Brands and',
  'names may appear — even many of them — as evidence or examples. That is normal and NOT promotional.',
  '',
  'The deciding question is PURPOSE, not brand count:',
  '- Many brands mentioned, but the text exists to elevate one of them -> promotional.',
  '- Only one brand mentioned, but the text critiques or analyses it -> editorial.',
  '',
  'You do not decide fees or outcomes. You report an opinion with evidence for a human editor.',
  '',
  'Answer with ONE JSON object and nothing else:',
  '{"score":0-100,"reasons":["..."],"quotes":["..."],"brands":["..."],"primary_subject":"..."}',
  '',
  'score: 0 = clearly editorial, 100 = clearly a press release. Be calibrated, not dramatic.',
  'reasons: 2-3 short sentences in English explaining what drove the score.',
  'quotes: 1-3 sentences COPIED VERBATIM from the submitted body that support your reading.',
  '        Copy exactly. Never paraphrase, never invent a sentence that is not in the text.',
  'brands: brands, artists, products or organisations named in the text (max 12).',
  'primary_subject: if the piece centres on one brand/artist, name it; otherwise "".',
].join('\n');

function buildUserPrompt(sub) {
  const s = sub || {};
  const body = String(s.body || '').slice(0, MAX_BODY_CHARS);
  return [
    'TITLE: ' + String(s.title || '').slice(0, 300),
    'SUBTITLE: ' + String(s.subtitle || '').slice(0, 300),
    'TOPIC: ' + String(s.topic || ''),
    'LANGUAGE: ' + String(s.body_lang || s.bodyLang || ''),
    'SUBMITTER SELF-DECLARED PROMOTIONAL: ' + (s.promo_self_declared || s.promoSelfDeclared ? 'yes' : 'no'),
    '',
    'BODY:',
    body,
  ].join('\n');
}

/** 모델 응답에서 JSON 한 덩이를 꺼낸다. 못 꺼내면 null. */
function parseVerdict(text) {
  const raw = String(text == null ? '' : text);
  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) { /* 아래 복구 경로 */ }
  if (!obj) {
    try {
      const { parseJsonObject } = require('./jsonRepair');
      obj = parseJsonObject(raw);
    } catch (_) { obj = null; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const n = Number(obj.score);
  const score = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  if (score === null) return null;

  const strList = (v, max, maxLen) => (Array.isArray(v) ? v : [])
    .map((x) => String(x == null ? '' : x).trim())
    .filter(Boolean)
    .slice(0, max)
    .map((x) => x.slice(0, maxLen));

  return {
    score,
    reasons: strList(obj.reasons, 4, 400),
    quotes: strList(obj.quotes, 3, 600),
    brands: strList(obj.brands, 12, 80),
    primarySubject: String(obj.primary_subject || obj.primarySubject || '').trim().slice(0, 120),
  };
}

/**
 * 인용이 실제로 본문에 있는지 확인한다 — 지어낸 문장을 걸러내기 위한 관문.
 *
 * 2026-11-08 사고(AI 가 캡션에 없는 사실을 지어냄)의 직접적인 대비책이다.
 * 공백·따옴표 차이는 흔하므로 정규화해서 비교하고, 본문에 없는 인용은
 * 버리는 대신 verified:false 로 **표시해서 남긴다** — 지어냈다는 사실 자체가
 * 관리자에게 유용한 신호다(그 분석 전체를 의심할 근거가 된다).
 */
function verifyQuotes(quotes, body) {
  const norm = (s) => String(s == null ? '' : s)
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const hay = norm(body);
  return (quotes || []).map((q) => ({ text: q, verified: !!q && hay.indexOf(norm(q)) !== -1 }));
}

function enabled() {
  return String(process.env.ARTICLE_PROMO_AI || 'on').trim().toLowerCase() !== 'off';
}

/**
 * 한 건을 분석한다. 절대 throw 하지 않는다.
 *
 * @param {object} sub   { title, subtitle, topic, body_lang, body, promo_self_declared }
 * @param {object} [deps] { ask } 테스트용 주입 · { timeoutMs } 호출부 예산
 * @returns {Promise<object>} ok:true  → { ok, score, reasons, quotes[{text,verified}], brands, primarySubject, model, at }
 *                            ok:false → { ok:false, error, at }
 */
async function analyzePromo(sub, deps) {
  const at = new Date().toISOString();
  try {
    if (!enabled()) return { ok: false, error: 'disabled', at };
    const ask = (deps && deps.ask) || askOnce;
    const r = await ask(sub, { timeoutMs: (deps && deps.timeoutMs) || AI_TIMEOUT_MS });
    if (!r || !r.text) return { ok: false, error: (r && r.error) || 'ai_unavailable', at };
    const v = parseVerdict(r.text);
    if (!v) {
      try { await require('./aiCreditWatch').reportAiParseFailure('articlePromoAi', String(r.text).slice(0, 200)); } catch (_) {}
      return { ok: false, error: 'parse_failed', at };
    }
    return {
      ok: true,
      score: v.score,
      reasons: v.reasons,
      quotes: verifyQuotes(v.quotes, (sub && sub.body) || ''),
      brands: v.brands,
      primarySubject: v.primarySubject,
      model: r.model || null,
      at,
    };
  } catch (e) {
    console.warn('[articlePromoAi] 분석 실패(제출은 그대로 접수됨):', (e && e.message) || e);
    return { ok: false, error: 'error', at };
  }
}

/** Anthropic 에 한 번 묻는다. 실패하면 { error }. */
async function askOnce(sub, opts) {
  if (!process.env.ANTHROPIC_API_KEY) return { error: 'no_api_key' };
  const model = process.env.ARTICLE_PROMO_AI_MODEL || MODEL_DEFAULT;
  const timeoutMs = Math.max(2000, Number((opts && opts.timeoutMs) || AI_TIMEOUT_MS));
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUserPrompt(sub) }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    // 크레딧 소진·키 오류를 원인 단계에서 텔레그램으로 알린다(2026-07-30 교훈).
    try { await require('./aiCreditWatch').reportAiResponse(r, 'articlePromoAi'); } catch (_) {}
    return { error: 'http_' + r.status };
  }
  const j = await r.json().catch(() => ({}));
  const text = (j.content || []).map((c) => c.text || '').join('');
  return { text, model };
}

module.exports = {
  analyzePromo,
  parseVerdict,
  verifyQuotes,
  buildUserPrompt,
  enabled,
  SYSTEM,
  AI_TIMEOUT_MS,
  MAX_BODY_CHARS,
  MODEL_DEFAULT,
};
