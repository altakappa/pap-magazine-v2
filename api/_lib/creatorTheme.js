/**
 * 월간 크리에이터 소식 "이달의 테마" 후보 — api/_lib/creatorTheme.js (2026-09-24)
 *
 * 도메니코 (2026-09-24, 두 번에 걸쳐 확정):
 *   "우리의 키워드를 기반으로 너가 항상 추천해 줄 수 있어? 그중 내가 고르는 거지"
 *   "항상 드리미, 서리얼리즘, 스토리텔링, 크리에이티비티를 기본 키워드로 하고
 *    여기에 최신 트렌드와 맞춰서 테마 후보를 꼽자. 후보는 구체적이기보다 포괄적이면 좋겠어"
 *
 * 그래서:
 *   · 기본 키워드 4개는 **매달 고정**: DREAMY · SURREALISM · STORYTELLING · CREATIVITY
 *     (첫 버전의 '9개 중 달마다 3개 순환'은 폐기)
 *   · 여기에 **최신 트렌드 신호**를 겹친다: 패션·아트 매체 RSS 헤드라인 + 우리
 *     trend_reports 최근 30일 키워드. 셀럽·브랜드 뉴스 자체가 아니라 그 밑에 흐르는
 *     넓은 미감·문화 흐름을 읽게 한다.
 *   · 후보는 **포괄적으로**: 촬영 장치(소품·색·장소)를 지시하지 않고, 크리에이터가
 *     각자 해석할 여지가 있는 큰 개념 + 무드 한두 문장.
 *   · 후보마다 어떤 트렌드를 읽었는지(trend) 한 줄을 붙여 도메니코가 고를 때 근거로 본다.
 *   · 고르는 것은 도메니코. AI 가 실패해도 고정 후보 3개가 나온다. throw 없음.
 *
 * 브랜드 규칙(볼트 50_Brand/PAP-브랜드-가이드.md · 2026-09 화보 기획 발언)도 프롬프트에 둔다:
 *   채도 높고 파격적인 쪽, 아트는 색·조명·프레이밍에 스며드는 수준(메인 주제 금지).
 */
'use strict';

const { stripHtmlTight } = require('./stripHtml');   // 태그 제거는 공용 규칙 한 벌 (tests/strip-html.test.js)

const BASE_KEYWORDS = ['DREAMY', 'SURREALISM', 'STORYTELLING', 'CREATIVITY'];
// 코어 키워드 9개 (브랜드 가이드). 모델이 기본 4개 외 키워드를 붙여도 이 안에서만 받는다.
const KEYWORDS = ['DREAMY', 'FUTURISM', 'SURREALISM', 'CONTEMPORARY', 'DIVERSITY', 'ARTISTIC', 'CREATIVE', 'STORYTELLING', 'WITTY'];
const ALLOWED_KW = new Set(KEYWORDS.concat(BASE_KEYWORDS));
const LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];

const TREND_FEEDS = [
  { source: 'Dazed', url: 'https://www.dazeddigital.com/rss' },
  { source: 'Vogue', url: 'https://www.vogue.com/feed/rss' },
  { source: 'Hypebeast', url: 'https://hypebeast.com/feed' },
  { source: 'ARTnews', url: 'https://www.artnews.com/feed/' },
  { source: 'Hyperallergic', url: 'https://hyperallergic.com/feed/' },
];

/** 매달 같은 기본 키워드 4개 (도메니코 확정). 인자는 호환용. */
function keywordsForMonth() { return BASE_KEYWORDS.slice(); }

/** 소식이 다루는 달(지난달) 'YYYY-MM' → 테마가 쓰일 달(다음 달). */
function nextMonthKey(key) {
  const y = Number(String(key).slice(0, 4)), m = Number(String(key).slice(5, 7));
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

// 포괄적인 고정 후보 3개 (AI 실패 시). 촬영 장치를 지시하지 않는다.
const FALLBACK = [
  { keywords: ['DREAMY', 'SURREALISM'], ko: { title: '깨어 있는 꿈', body: '현실과 꿈의 경계가 흐려지는 순간을 당신만의 방식으로 담아 주세요.' }, en: { title: 'Waking Dream', body: 'Capture, in your own way, the moment where reality and dream begin to blur.' } },
  { keywords: ['STORYTELLING', 'DREAMY'], ko: { title: '한 장면의 이야기', body: '한 사람과 한 벌의 옷이 만드는 이야기를 자유롭게 풀어 주세요.' }, en: { title: 'A Story in One Scene', body: 'Let one person and one look tell a story, however you choose to tell it.' } },
  { keywords: ['CREATIVITY', 'SURREALISM'], ko: { title: '아무도 가지 않은 길', body: '익숙한 규칙을 벗어난 시선으로 당신만의 새로움을 보여 주세요.' }, en: { title: 'The Road Not Taken', body: 'Step outside the familiar rules and show us what only you can see.' } },
];

function fallbackCandidates() {
  return FALLBACK.map((f) => ({ keywords: f.keywords.slice(), trend: '', source: 'fallback', i18n: { ko: f.ko, en: f.en } }));
}

const DASH_RE = /[—–]|--/g;
function clean(s, max) {
  return String(s == null ? '' : s).replace(DASH_RE, ', ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 모델 응답을 검사해 후보 배열로. 쓸 수 없는 후보는 버리고, 모자라면 고정 후보로 채운다. */
function normalizeCandidates(raw) {
  const list = Array.isArray(raw && raw.candidates) ? raw.candidates : [];
  const out = [];
  for (const c of list) {
    if (!c || !c.ko || !c.en) continue;
    const i18n = {};
    for (const l of LANGS) {
      const v = c[l];
      if (v && v.title && v.body) i18n[l] = { title: clean(v.title, 60), body: clean(v.body, 240) };
    }
    if (!i18n.ko || !i18n.en) continue;
    const kws = (Array.isArray(c.keywords) ? c.keywords : []).map((k) => String(k).toUpperCase()).filter((k) => ALLOWED_KW.has(k)).slice(0, 4);
    out.push({ keywords: kws, trend: clean(c.trend, 120), source: 'ai', i18n });
    if (out.length === 3) break;
  }
  for (const fb of fallbackCandidates()) {
    if (out.length === 3) break;
    if (!out.some((o) => o.i18n.ko.title === fb.i18n.ko.title)) out.push(fb);
  }
  return out;
}

function parseRssTitles(xml, source) {
  const out = [];
  const chunks = String(xml || '').split(/<item[\s>]/).slice(1, 16);
  for (const c of chunks) {
    const t = c.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const title = t && t[1] ? stripHtmlTight(t[1]).replace(/&amp;/g, '&').replace(/&#8217;|&#039;/g, "'").trim() : '';
    if (title) out.push(source + ': ' + title.slice(0, 140));
  }
  return out;
}

/** 최신 트렌드 신호: 매체 RSS 헤드라인 + trend_reports 최근 30일 키워드 빈도. 실패는 삼킨다. */
async function gatherTrendSignals(opts) {
  const o = opts || {};
  const fetchImpl = o.fetch || (typeof fetch === 'function' ? fetch : null);
  let headlines = [];
  if (fetchImpl) {
    const got = await Promise.allSettled(TREND_FEEDS.map(async (f) => {
      const r = await fetchImpl(f.url, { headers: { 'User-Agent': 'PAPMagazineBot/1.0 (+https://www.pap-magazine.com)' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(f.source + ' ' + r.status);
      return parseRssTitles(await r.text(), f.source).slice(0, 12);
    }));
    headlines = got.filter((g) => g.status === 'fulfilled').flatMap((g) => g.value);
  }
  let keywords = [];
  if (o.supabase) {
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const { data } = await o.supabase.from('trend_reports').select('items').gte('report_date', since);
      const freq = new Map();
      for (const row of (data || [])) for (const it of (Array.isArray(row.items) ? row.items : [])) {
        for (const k of (Array.isArray(it && it.keywords) ? it.keywords : [])) {
          const key = String(k || '').trim();
          if (key) freq.set(key, (freq.get(key) || 0) + 1);
        }
      }
      keywords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => k + '(' + n + ')');
    } catch (_) { /* 트렌드 표가 없어도 후보는 나온다 */ }
  }
  return { headlines, keywords };
}

function buildPrompt(targetKey, context, trends) {
  const t = trends || { headlines: [], keywords: [] };
  const system = [
    'PAP 매거진(아트 기반 패션·뷰티·컬쳐 디지털 매거진, 인스타 @pap_magazine)의 크리에이터 소식 테마 기획자.',
    '매달 포토그래퍼·스타일리스트·크리에이티브 팀에게 "이달의 테마"를 제안해 다음 화보를 떠올리게 한다.',
    '기본 키워드 4개는 매달 고정이다: ' + BASE_KEYWORDS.join(' · ') + '. 모든 후보는 이 네 가지 결 위에 선다.',
    '여기에 최신 트렌드를 겹친다. 주어진 트렌드 신호에서 셀럽·브랜드·행사 뉴스 자체는 버리고,',
    '그 밑에 반복해서 흐르는 넓은 미감·감정·문화의 흐름을 읽어 테마에 녹인다.',
    '후보는 구체적이기보다 포괄적이어야 한다: 소품·색·장소·조명 같은 촬영 지시를 쓰지 않는다.',
    '크리에이터가 각자 자기 방식으로 해석할 여지가 있는 큰 개념과 무드만 준다.',
    '브랜드 결: 잔잔한 저채도보다 대담하고 파격적인 쪽. 미술 자체를 메인 주제로 삼지 않는다.',
    '실존 브랜드명·인물 이름·작품명을 쓰지 않는다. 대시(—, –, --)를 쓰지 않는다. 출력은 JSON 하나만.',
  ].join('\n');
  const user = [
    '테마가 쓰일 달: ' + targetKey + ' (계절은 은은하게만, 뻔한 계절 클리셰 금지)',
    '최신 트렌드 신호 (매체 헤드라인): ' + (t.headlines.length ? t.headlines.slice(0, 50).join(' / ') : '없음'),
    '최신 트렌드 신호 (PAP 트렌드 리포트 30일 키워드 빈도): ' + (t.keywords.length ? t.keywords.join(', ') : '없음'),
    '지난달 PAP 에 실린 크리에이터 화보(겹치지 않게 참고만): ' + String(context || '없음').slice(0, 1200),
    '',
    '후보 3개. 서로 확실히 다른 방향. 각 후보는:',
    '- keywords: 기본 키워드 4개 중 이 후보가 중심에 둔 1~2개',
    '- trend: 이 후보가 읽은 트렌드 흐름을 한국어 한 줄로 (도메니코가 고를 때 근거로 본다)',
    '- 9개 언어 ko, en, it, fr, es, ja, zh, ru, de 각각 {title, body}. title 은 짧은 개념어(한국어 12자 이내),',
    '  body 는 무드와 방향을 담은 1~2문장. 번역투가 아니라 각 언어로 자연스럽게.',
    '형식: {"candidates":[{"keywords":["DREAMY"],"trend":"","ko":{"title":"","body":""},"en":{"title":"","body":""},"it":{...},"fr":{...},"es":{...},"ja":{...},"zh":{...},"ru":{...},"de":{...}}]}',
  ].join('\n');
  return { system, user, keywords: BASE_KEYWORDS.slice() };
}

/** 후보 3개를 만든다. 절대 throw 하지 않는다 (실패하면 고정 후보 + 사유). */
async function generateThemeCandidates(targetKey, context, opts) {
  const o = opts || {};
  const fetchImpl = o.fetch || (typeof fetch === 'function' ? fetch : null);
  const trends = o.trends || { headlines: [], keywords: [] };
  const trendNote = '트렌드 신호 헤드라인 ' + trends.headlines.length + ' · 키워드 ' + trends.keywords.length;
  if (!process.env.ANTHROPIC_API_KEY || !fetchImpl) {
    return { candidates: fallbackCandidates(), note: 'AI 키 없음, 고정 후보 (' + trendNote + ')' };
  }
  const { system, user } = buildPrompt(targetKey, context, trends);
  try {
    const resp = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', max_tokens: 3500, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(o.timeoutMs || 70000),
    });
    if (!resp.ok) {
      try { await require('./aiCreditWatch').reportAiResponse(resp, 'creator-monthly'); } catch (_) {}
      return { candidates: fallbackCandidates(), note: 'AI ' + resp.status + ', 고정 후보 (' + trendNote + ')' };
    }
    const j = await resp.json();
    const block = Array.isArray(j.content) ? j.content.find((b) => b && typeof b.text === 'string') : null;
    const parsed = require('./jsonRepair').parseJsonObject(block ? block.text : '', 'creator-theme');
    const candidates = normalizeCandidates(parsed && parsed.value);
    const aiCount = candidates.filter((c) => c.source === 'ai').length;
    return { candidates, note: 'AI 후보 ' + aiCount + '개' + (aiCount < 3 ? ' + 고정 ' + (3 - aiCount) : '') + ' (' + trendNote + ')' };
  } catch (e) {
    return { candidates: fallbackCandidates(), note: 'AI 실패(' + String((e && e.message) || e).slice(0, 80) + '), 고정 후보 (' + trendNote + ')' };
  }
}

module.exports = {
  BASE_KEYWORDS, KEYWORDS, LANGS, TREND_FEEDS, FALLBACK,
  keywordsForMonth, nextMonthKey, fallbackCandidates, normalizeCandidates,
  parseRssTitles, gatherTrendSignals, buildPrompt, generateThemeCandidates,
};
