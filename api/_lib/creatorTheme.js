/**
 * 월간 크리에이터 소식 "이달의 테마" 후보 — api/_lib/creatorTheme.js (2026-09-24)
 *
 * 도메니코: "우리의 키워드를 기반으로 너가 항상 추천해 줄 수 있어? 그중 내가 고르는 거지"
 *
 * 매달 creator-monthly 크론이 초안을 만들 때 테마 후보 3개를 같이 만든다.
 * 도메니코는 관리자 캠페인 편집기에서 하나를 누르거나(텔레그램에도 같은 3개가 간다)
 * 직접 고쳐 쓴다. 고르지 않으면 테마 블록 없이 나간다. 고르는 것은 사람이다.
 *
 * 근거가 되는 브랜드 규칙 (볼트 50_Brand/PAP-브랜드-가이드.md · 도메니코 2026-09 화보 기획 발언):
 *   · 코어 키워드 9개: DREAMY · FUTURISM · SURREALISM · CONTEMPORARY · DIVERSITY ·
 *     ARTISTIC · CREATIVE · STORYTELLING · WITTY
 *   · 창의·초현실·몽환이 항상 중심 (과하게 드러나지 않아도 무드만 느껴지면 됨)
 *   · 잔잔한 저채도보다 채도 높고 파격적인 쪽
 *   · 아트는 색·조명·프레이밍에 스며드는 수준으로만. 메인 주제로 다루지 않는다
 *
 * AI 가 실패해도 후보는 반드시 3개 나온다 (FALLBACK, 키워드별 고정 문구 ko·en).
 */
'use strict';

const KEYWORDS = ['DREAMY', 'FUTURISM', 'SURREALISM', 'CONTEMPORARY', 'DIVERSITY', 'ARTISTIC', 'CREATIVE', 'STORYTELLING', 'WITTY'];
const LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];

/** 달마다 강조 키워드 3개가 돌아간다. 9개가 3달에 한 바퀴. 'YYYY-MM' 기준(소식이 다루는 달의 다음 달 = 촬영할 달). */
function keywordsForMonth(targetKey) {
  const m = Number(String(targetKey || '').slice(5, 7)) || 1;
  const base = ((m - 1) % 3) * 3;
  return [KEYWORDS[base], KEYWORDS[base + 1], KEYWORDS[base + 2]];
}

/** 소식이 다루는 달(지난달) 'YYYY-MM' → 테마가 쓰일 달(다음 달). */
function nextMonthKey(key) {
  const y = Number(String(key).slice(0, 4)), m = Number(String(key).slice(5, 7));
  if (!y || !m) return key;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}

const FALLBACK = {
  DREAMY: { ko: { title: '잠에서 덜 깬 도시', body: '새벽빛이 아직 남은 거리에서 찍어 보세요. 초점이 살짝 풀린 한 컷이 전체를 끌고 갑니다.' }, en: { title: 'Half-Awake City', body: 'Shoot in streets still holding the dawn light. One slightly soft frame can carry the whole story.' } },
  FUTURISM: { ko: { title: '내일의 작업복', body: '반사되는 소재와 차가운 조명으로 아직 오지 않은 일상을 입혀 보세요.' }, en: { title: 'Workwear for Tomorrow', body: 'Use reflective fabrics and cold light to dress a daily life that has not arrived yet.' } },
  SURREALISM: { ko: { title: '크기가 틀린 방', body: '소품 하나의 크기를 과감하게 틀어 보세요. 모델보다 커진 물건이 이야기를 시작합니다.' }, en: { title: 'The Room of Wrong Sizes', body: 'Break the scale of a single prop. An object bigger than the model starts the story.' } },
  CONTEMPORARY: { ko: { title: '지금 이 거리의 얼굴', body: '당신이 사는 도시의 오늘을 가장 선명한 색으로 기록해 보세요.' }, en: { title: 'The Face of This Street Now', body: 'Record today in your own city, in its most saturated colours.' } },
  DIVERSITY: { ko: { title: '서로 다른 몸, 같은 프레임', body: '나이·체형·배경이 다른 사람들을 한 화면에 세워 보세요. 대비가 곧 조화가 됩니다.' }, en: { title: 'Different Bodies, One Frame', body: 'Put people of different ages, shapes and backgrounds in one frame. The contrast becomes the harmony.' } },
  ARTISTIC: { ko: { title: '빛이 칠한 옷', body: '조명 색 하나로 옷의 색을 바꿔 보세요. 그림은 주제가 아니라 빛에 스며들게 둡니다.' }, en: { title: 'Clothes Painted by Light', body: 'Change a garment’s colour with a single light gel. Let the art sit in the light, not in the subject.' } },
  CREATIVE: { ko: { title: '규칙 하나 깨기', body: '늘 지키던 촬영 규칙 하나를 일부러 어겨 보세요. 거기서 새 화보가 나옵니다.' }, en: { title: 'Break One Rule', body: 'Deliberately break one shooting rule you always follow. That is where a new editorial begins.' } },
  STORYTELLING: { ko: { title: '열 장짜리 단편', body: '처음과 끝이 있는 한 편의 이야기로 컷을 배열해 보세요. 마지막 장에서 반전을 주세요.' }, en: { title: 'A Ten-Frame Short Story', body: 'Sequence your frames as a story with a beginning and an end, and save a twist for the last one.' } },
  WITTY: { ko: { title: '진지하게 웃긴 것', body: '가장 우아한 룩에 엉뚱한 소품 하나를 더해 보세요. 웃음이 스타일을 더 오래 남깁니다.' }, en: { title: 'Seriously Funny', body: 'Add one absurd prop to your most elegant look. A smile makes style last longer.' } },
};

function fallbackCandidates(targetKey) {
  return keywordsForMonth(targetKey).map((k) => ({ keywords: [k], source: 'fallback', i18n: { ko: FALLBACK[k].ko, en: FALLBACK[k].en } }));
}

const DASH_RE = /[—–]|--/g;
function clean(s, max) {
  return String(s == null ? '' : s).replace(DASH_RE, ', ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 모델 응답을 검사해 후보 배열로. 쓸 수 없는 후보는 버리고, 모자라면 fallback 으로 채운다. */
function normalizeCandidates(raw, targetKey) {
  const list = Array.isArray(raw && raw.candidates) ? raw.candidates : [];
  const out = [];
  for (const c of list) {
    if (!c || !c.ko || !c.en) continue;
    const i18n = {};
    for (const l of LANGS) {
      const v = c[l];
      if (v && v.title && v.body) i18n[l] = { title: clean(v.title, 60), body: clean(v.body, 280) };
    }
    if (!i18n.ko || !i18n.en) continue;
    const kws = (Array.isArray(c.keywords) ? c.keywords : []).map((k) => String(k).toUpperCase()).filter((k) => KEYWORDS.includes(k)).slice(0, 3);
    out.push({ keywords: kws, source: 'ai', i18n });
    if (out.length === 3) break;
  }
  if (out.length < 3) {
    const used = new Set(out.flatMap((c) => c.keywords));
    for (const fb of fallbackCandidates(targetKey)) {
      if (out.length === 3) break;
      if (!used.has(fb.keywords[0])) out.push(fb);
    }
    for (const fb of fallbackCandidates(targetKey)) { if (out.length === 3) break; out.push(fb); }
  }
  return out;
}

function buildPrompt(targetKey, context) {
  const kws = keywordsForMonth(targetKey);
  const system = [
    'PAP 매거진(아트 기반 패션·뷰티·컬쳐 디지털 매거진, 인스타 @pap_magazine)의 크리에이터 소식 테마 기획자.',
    '매달 포토그래퍼·스타일리스트·크리에이티브 팀에게 "이달의 테마"를 제안해 다음 화보 촬영을 떠올리게 한다.',
    '브랜드 규칙:',
    '- PAP 코어 키워드 9개: ' + KEYWORDS.join(' · '),
    '- 창의·초현실·몽환이 항상 중심이다. 과하게 드러내지 않아도 무드만 느껴지면 된다.',
    '- 잔잔한 저채도보다 채도 높고 파격적인 쪽이 PAP 에 맞다.',
    '- 아트는 색·조명·프레이밍에 스며드는 수준으로만. 미술 자체를 메인 주제로 삼지 않는다.',
    '- 실존 브랜드명·인물 이름·특정 작품명을 쓰지 않는다. 대시(—, –, --)를 쓰지 않는다.',
    '출력은 JSON 하나만.',
  ].join('\n');
  const user = [
    '테마가 쓰일 달: ' + targetKey + ' (계절감을 반영하되 뻔한 계절 클리셰는 피한다)',
    '이번 달 강조 키워드 3개(후보마다 하나씩 중심으로, 필요하면 나머지 키워드와 섞는다): ' + kws.join(', '),
    '지난달 PAP 에 실린 크리에이터 화보(제목·태그, 겹치지 않게 참고만): ' + String(context || '없음').slice(0, 1500),
    '',
    '후보 3개를 만든다. 서로 확실히 달라야 한다.',
    '각 후보: title(한국어 14자 이내, 다른 언어도 짧게), body(2문장 이내, 촬영 장치 하나를 구체적으로: 색·빛·소재·장소·소품 중).',
    '9개 언어 모두: ko, en, it, fr, es, ja, zh, ru, de. 번역투가 아니라 각 언어로 자연스럽게.',
    '형식: {"candidates":[{"keywords":["DREAMY"],"ko":{"title":"","body":""},"en":{"title":"","body":""},"it":{...},"fr":{...},"es":{...},"ja":{...},"zh":{...},"ru":{...},"de":{...}}]}',
  ].join('\n');
  return { system, user, keywords: kws };
}

/** 후보 3개를 만든다. 절대 throw 하지 않는다 (실패하면 fallback + 사유). */
async function generateThemeCandidates(targetKey, context, opts) {
  const o = opts || {};
  const fetchImpl = o.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!process.env.ANTHROPIC_API_KEY || !fetchImpl) {
    return { candidates: fallbackCandidates(targetKey), note: 'AI 키 없음, 고정 후보' };
  }
  const { system, user } = buildPrompt(targetKey, context);
  try {
    const resp = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', max_tokens: 3500, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(o.timeoutMs || 70000),
    });
    if (!resp.ok) {
      try { await require('./aiCreditWatch').reportAiResponse(resp, 'creator-monthly'); } catch (_) {}
      return { candidates: fallbackCandidates(targetKey), note: 'AI ' + resp.status + ', 고정 후보' };
    }
    const j = await resp.json();
    const block = Array.isArray(j.content) ? j.content.find((b) => b && typeof b.text === 'string') : null;
    const parsed = require('./jsonRepair').parseJsonObject(block ? block.text : '', 'creator-theme');
    const candidates = normalizeCandidates(parsed && parsed.value, targetKey);
    const aiCount = candidates.filter((c) => c.source === 'ai').length;
    return { candidates, note: 'AI 후보 ' + aiCount + '개' + (aiCount < 3 ? ' + 고정 ' + (3 - aiCount) : '') };
  } catch (e) {
    return { candidates: fallbackCandidates(targetKey), note: 'AI 실패(' + String((e && e.message) || e).slice(0, 80) + '), 고정 후보' };
  }
}

module.exports = { KEYWORDS, LANGS, keywordsForMonth, nextMonthKey, fallbackCandidates, normalizeCandidates, buildPrompt, generateThemeCandidates, FALLBACK };
