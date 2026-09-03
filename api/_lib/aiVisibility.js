/**
 * aiVisibility.js — AI 답변 점유율(SoV) 프로브 (2026-08-28 신설)
 *
 * ■ 왜 만들었나
 * AEO/GEO 교육자료 8장("측정과 KPI — 클릭이 아니라 점유율")이 통째로 비어
 * 있었다. 우리가 재던 것은 둘 뿐이고 둘 다 **결과**다:
 *
 *   ai_crawl_daily    AI 봇이 우리 글을 읽어 갔나   (선행 지표)
 *   social_inclicks   사람이 그 링크를 눌렀나        (결과)
 *
 * "브랜드명 없는 카테고리 질문에 AI 가 우리를 답하는가", "우리 대신 누구를
 * 답하는가", "우리를 어떻게 서술하는가" — 순위를 대체하는 핵심 지표가 없었다.
 *
 * ■ 두 레이어를 절대 합치지 않는다
 * 교재 3장: 답변은 두 소스에서 나온다.
 *   pretrain  모델에 각인된 브랜드 인식 (웹검색 끔) — 장기 자산
 *   search    질문 시점 웹 검색 요약   (웹검색 켬) — 즉시 공략 가능
 * 합계를 내면 둘 다 의미를 잃는다 (크롤과 유입을 안 더하는 것과 같은 이유).
 *
 * pretrain 열은 2026-08-22 학습 크롤러 차단(GPTBot·ClaudeBot 등)의 장기
 * 비용을 재는 **유일한 계기**다. 차단 후 train 크롤은 0이 됐고 live·index 는
 * 전혀 줄지 않았다(실측). 남은 위험은 "다음 모델이 우리를 모르게 되는 것"
 * 하나이고, 그건 이 열이 내려가는 것으로만 보인다.
 *
 * ■ 판정은 결정론이다 — AI 에게 "내가 나왔니?" 를 묻지 않는다
 * 등장 여부를 모델에게 물으면 모델이 자기 답을 채점하는 꼴이고, 잘 보이려는
 * 방향으로 흔들린다. 답변 원문을 받아 **별칭 정규식**으로 우리가 센다.
 * 별칭은 seoRenderer 의 ORG_PUBLISHER.alternateName 하나를 재사용한다 —
 * 여기 다시 적으면 '팹매거진' 같은 표기를 한쪽만 추가하는 날이 온다(교훈 2).
 *
 * ■ 알려진 한계 (정직하게 적어 둔다)
 * - 이건 ChatGPT·Claude **API** 이지 chatgpt.com 웹앱이 아니다. 시스템
 *   프롬프트·개인화·랭킹이 다르므로 웹앱 답변과 1:1 로 같지 않다.
 *   그래도 같은 모델·같은 검색 계층을 쓰므로 **추세 지표로는 유효**하다.
 * - Gemini·Perplexity·구글 AI 오버뷰는 키가 없어 못 잰다. 교재의 6대 엔진
 *   중 2개만 본다는 뜻이다. 키가 생기면 ENGINES 에 추가하면 된다.
 * - 답변은 확률적이다. 1회 관찰로 결론 내지 않는다 — 주 1회씩 쌓아 추세로 본다
 *   (교재 8장 "AI 출력은 확률적이므로 1회 관찰로 결론 내리지 않는다").
 * - 원문 답변은 저장하지 않는다. 판정과 근거 문장만 남긴다.
 */

'use strict';

const { ORG_PUBLISHER } = require('./seoRenderer');
/* 콜 예산은 손으로 계산하지 않는다 — 같은 산술을 세 곳이 각자 쓰다가
   하루에 세 번 같은 타임아웃 버그를 밟았다 (callBudget.js 헤더 참조). */
const { canStart, budgetFor } = require('./callBudget');

/* supabase 는 **지연 로드**한다. 모듈 최상단에서 require 하면 클라이언트가
   즉시 만들어지고, env 없는 환경(CI·순수 규칙 테스트)에서 require 만으로
   'supabaseUrl is required' 로 죽는다. 2026-07-30 에 같은 이유로 CI 가
   깨졌고 faqHealth.js 가 그 교훈을 적어 뒀다. 판정 로직(analyze 등)은
   DB 없이 검사할 수 있어야 한다 — 이 파일에서 실제로 검사하는 건 그쪽이다. */
function db() {
  // 이 줄은 반드시 들여쓴 채로 둔다 — no-eager-npm-deps 가드가 들여쓰기로
  // '지연 로드' 를 판별한다. 한 줄로 붙이면 최상단 require 로 오인돼 걸린다.
  return require('./supabase').supabaseAdmin;
}

/* ── 질문 세트 ────────────────────────────────────────────────
   교재 8장 "20분 GEO 감사": **브랜드명이 들어가지 않은** 카테고리 질문.
   PAP 이름을 넣으면 "PAP 를 아느냐" 를 재는 것이고, 그건 점유율이 아니다.

   key 는 고정한다 — 질문 문구를 다듬어도 추이가 이어져야 한다.
   ko/en 을 섞는 이유: 인용 언어 실측이 ko 42 / en 41 로 거의 동률이다. */
const PROBES = [
  { key: 'kr_digital_fashion_mag', lang: 'ko', q: '한국 디지털 패션 매거진 추천해줘' },
  { key: 'instagram_magazine',     lang: 'ko', q: '인스타그램 매거진이 뭐야? 한국에서 대표적인 곳은 어디야?' },
  { key: 'kr_editorial_mag',       lang: 'ko', q: '화보가 좋은 한국 패션 매거진 알려줘' },
  { key: 'submit_editorial_ko',    lang: 'ko', q: '패션 에디토리얼 무료로 투고할 수 있는 매거진 있어?' },
  { key: 'kr_digital_fashion_en',  lang: 'en', q: 'Which Korean digital fashion magazines are worth following?' },
  { key: 'submit_editorial_en',    lang: 'en', q: 'Where can photographers submit fashion editorials for free publication?' },
  { key: 'kfashion_where',         lang: 'en', q: 'Where do people read about Korean fashion and K-pop style online?' },
  { key: 'seoul_fashion_mag',      lang: 'en', q: 'Independent fashion magazines based in Seoul?' },
];

/* ── 엔진 ─────────────────────────────────────────────────────
   키가 없는 엔진은 조용히 건너뛴다 (호출 자체를 안 한다).
   Gemini·Perplexity 는 키가 없어 목록에 없다 — 없는 걸 있는 척하지 않는다. */
const ENGINES = ['chatgpt', 'claude'];
const MODES = ['pretrain', 'search'];

/* 우리 대신 언급되는 매체. IG 핸들 목록(competitor-watch)과 **다른 어휘**다 —
   AI 답변에는 핸들이 아니라 매체명이 나온다. 그래서 목록을 따로 둔다.
   표기 흔들림(띄어쓰기·한영)을 별칭으로 흡수한다. */
const RIVALS = [
  { name: 'Dazed Korea', aliases: ['dazed', '데이즈드'] },
  { name: 'Hypebeast', aliases: ['hypebeast', '하입비스트'] },
  { name: 'eyesmag', aliases: ['eyesmag', '아이즈매거진', '아이즈 매거진'] },
  { name: 'Vogue Korea', aliases: ['vogue korea', '보그 코리아', '보그코리아'] },
  { name: 'W Korea', aliases: ['w korea', '더블유 코리아'] },
  { name: 'Elle Korea', aliases: ['elle korea', '엘르 코리아', '엘르코리아'] },
  { name: 'Harper\'s Bazaar Korea', aliases: ['bazaar korea', '바자 코리아', '하퍼스 바자'] },
  { name: 'Marie Claire Korea', aliases: ['marie claire', '마리끌레르', '마리 끌레르'] },
  { name: 'Nylon Korea', aliases: ['nylon korea', '나일론 코리아'] },
  { name: 'Allure Korea', aliases: ['allure korea', '얼루어'] },
  { name: 'Cosmopolitan Korea', aliases: ['cosmopolitan korea', '코스모폴리탄'] },
  { name: 'GQ Korea', aliases: ['gq korea', '지큐 코리아'] },
  { name: 'Singles', aliases: ['싱글즈'] },
  { name: 'fastpaper', aliases: ['fastpaper', '패스트페이퍼'] },
  { name: 'Daily Fashion News', aliases: ['daily fashion news', '데일리 패션 뉴스'] },
  { name: 'Hipkr', aliases: ['hipkr', '힙코리아'] },
];

/* 서술 정확도 — llms.txt 가 못박은 범주가 AI 답변에 실제로 나오는지 본다. */
const DESC_GOOD = [
  'digital fashion magazine', 'fashion magazine', 'korean', 'seoul',
  '디지털 패션', '패션 매거진', '한국', '서울', '매거진',
];

/* 아래는 우리가 그렇게 **불리면 안** 되는 표현들이다 — 자칭이 아니라 금지 목록이다.
   llms.txt 가 명시한다: PAP 는 한국어 우선 매체이고 /en/ 은 그 번역이므로
   영어권 매체로 불리면 안 된다. 종이 잡지도 아니다.
   AI 가 이렇게 서술하면 desc_ok=false 로 떨어뜨린다 — 교재 8장의
   "잘못된 카테고리·왜곡 서술은 미노출보다 위험하다" 가 이 줄의 근거다. */
const DESC_BAD = [
  'english-language magazine',  // 이렇게 불리면 안 된다 — llms.txt 가 금지
  '영문 매거진',                 // 이렇게 불리면 안 된다 — 자칭이 아니라 금지어다
  'print magazine', '종이 잡지', '인쇄 매거진',
];

/** 정규식 이스케이프 — 별칭에 특수문자가 섞여도 안전하게. */
function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* PAP 별칭 — ORG_PUBLISHER.alternateName 를 재사용하되 **단독 'PAP' 는 뺀다.**
   실측 오탐: "A pap smear is a screening test." 가 present=true 로 잡혔다.
   'pap' 은 흔한 영어 단어라 단어 경계를 줘도 못 막는다. 지표가 거짓으로
   부풀면 이 계기 전체가 쓸모없어지므로, 모호한 별칭 하나를 버리는 쪽이 낫다.

   대신 'PAP + 매거진류' 결합형을 따로 넣어 "PAP magazine"·"PAP 매거진" 은
   전부 잡는다. 실제 답변에서 우리를 가리킬 때는 거의 항상 이 형태다.
   놓치는 경우: 앞 문장에서 소개한 뒤 뒤에서 "PAP" 로만 재언급하는 문단.
   그건 present 판정에 이미 앞 문장이 걸리므로 실질 손실이 없다. */
const AMBIGUOUS = new Set(['pap']);

function papPatterns() {
  const names = (ORG_PUBLISHER.alternateName || []).concat([
    ORG_PUBLISHER.name, 'pap-magazine.com', 'papmagazine',
  ]).filter(Boolean).filter((n) => !AMBIGUOUS.has(String(n).trim().toLowerCase()));

  const pats = names.map((n) => {
    const e = esc(String(n).toLowerCase());
    // 한글 별칭은 단어 경계가 안 먹으므로 그대로, 라틴은 경계를 요구한다.
    return /[a-z]/.test(e) ? new RegExp('(?<![a-z0-9])' + e + '(?![a-z0-9])', 'i')
                           : new RegExp(e, 'i');
  });
  // 결합형 — 'PAP magazine' / 'PAP 매거진' / 'PAP mag'
  pats.push(/(?<![a-z0-9])pap[\s·]*(?:magazine|mag\b|매거진)/i);
  return pats;
}

/** 텍스트를 문장 단위로 쪼갠다 (한국어 종결 + 서양 문장부호 + 줄바꿈·불릿). */
function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 답변 원문 → 판정. AI 를 쓰지 않는다.
 * @returns {{present:boolean, described:string|null, desc_ok:boolean|null, rivals:string[]}}
 */
function analyze(text) {
  const raw = String(text || '');
  const pats = papPatterns();
  const hit = (s) => pats.some((p) => p.test(s));

  const present = hit(raw);

  let described = null;
  let desc_ok = null;
  if (present) {
    /* 우리를 언급한 조각부터 **뒤 두 조각까지** 붙여서 본다.
       2026-08-30 첫 실측이 이 보정 없이는 못 쓴다는 걸 보여줬다 — 5건 전부
       described 가 '**PAP MAGAZINE**' · '• PAP MAGAZINE' 같은 **제목 줄뿐**이었다.
       AI 답변은 대개 목록형이라 이름은 한 줄, 설명은 그 다음 줄에 온다.
       제목 줄만 보면 DESC_GOOD 이 하나도 안 걸려 desc_ok 가 전부 false 가 되고,
       그건 "AI 가 우리를 잘못 서술한다" 가 아니라 **내 계측이 틀린 것**이다.
       미노출보다 위험한 게 왜곡 서술인데(교재 8장), 그 지표가 거짓 0% 를
       가리키면 있느니만 못하다. */
    const parts = sentences(raw);
    const i = parts.findIndex(hit);
    if (i >= 0) {
      described = parts.slice(i, i + 3).join(' ').slice(0, 500);
    }
    if (described) {
      const low = described.toLowerCase();
      const bad = DESC_BAD.some((w) => low.includes(w.toLowerCase()));
      const good = DESC_GOOD.some((w) => low.includes(w.toLowerCase()));
      // 틀린 서술이 하나라도 있으면 좋은 단어가 있어도 통과시키지 않는다.
      desc_ok = bad ? false : good;
    }
  }

  const low = raw.toLowerCase();
  const rivals = RIVALS
    .filter((r) => r.aliases.some((a) => low.includes(a.toLowerCase())))
    .map((r) => r.name);

  return { present, described, desc_ok, rivals };
}

/* 응답 텍스트에서 인용 URL 을 뽑는다 (search 모드용).
   우리 도메인도 **뺐다가 다시 넣었다** — 우리가 인용됐다는 증거가 바로 그것이고,
   교재 8장의 '인용(citation) 수' 는 우리 URL 이 나온 횟수를 세는 지표다. */
function extractCitations(text, extra) {
  const out = new Set();
  for (const u of (extra || [])) if (u) out.add(String(u).slice(0, 500));
  const m = String(text || '').match(/https?:\/\/[^\s)\]}"'<>]+/g) || [];
  for (const u of m) out.add(u.slice(0, 500));
  return Array.from(out).slice(0, 20);
}

/* ── 엔진 호출 ────────────────────────────────────────────────
   두 API 모두 "웹검색 도구를 붙였나" 로 모드가 갈린다. 도구를 안 붙이면
   모델은 학습 데이터만으로 답한다 — 그게 pretrain 레이어다. */

/* 프로브 전용 모델. 저장소 공용 ANTHROPIC_MODEL 을 쓰지 않는다 —
   그쪽 기본값은 claude-sonnet-4-5 이고, 아래 최신 web_search 도구를 지원하지
   않는다. 그리고 이 계기는 "요즘 답변 엔진이 뭐라고 답하나" 를 재는 것이라
   백필용 모델과 수명주기를 묶으면 안 된다. */
const SOV_CLAUDE_MODEL = process.env.SOV_ANTHROPIC_MODEL || 'claude-sonnet-5';

/* 웹검색 도구 타입도 세대가 갈린다: 최신은 web_search_20260209(동적 필터링,
   Sonnet 4.6+·Opus 4.6+), 구형 모델은 web_search_20250305 뿐이다.
   OpenAI 쪽과 같은 이유로 두 이름을 순서대로 시도한다 — 로컬에 키가 없어
   어느 쪽이 통하는지 확인하지 못했고, 틀리면 8칸이 매주 통째로 빈다. */
const CLAUDE_SEARCH_TOOLS = ['web_search_20260209', 'web_search_20250305'];

async function askClaude(question, mode, timeoutMs) {
  const attempts = mode === 'search' ? CLAUDE_SEARCH_TOOLS : [null];
  let j = null;
  let lastStatus = 0;

  for (const tool of attempts) {
    const body = {
      model: SOV_CLAUDE_MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: question }],
    };
    /* max_uses 5 → 3 (2026-08-30 실측). 검색을 많이 돌수록 한 콜이 길어지는데,
       claude/search 8칸 중 4칸이 타임아웃으로 날아갔다. 우리가 재는 건
       "이 질문에 우리가 나오나" 이지 답변의 완성도가 아니라, 검색 3회면 충분하다. */
    if (tool) body.tools = [{ type: tool, name: 'web_search', max_uses: 3 }];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) { j = await res.json(); break; }
    lastStatus = res.status;
    if (res.status !== 400) break;   // 도구 이름 문제가 아니면 재시도해도 같다
  }
  if (!j) throw new Error('anthropic ' + lastStatus);

  const blocks = Array.isArray(j.content) ? j.content : [];
  const text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
  // 인용은 text 블록의 citations 에 담겨 온다.
  const urls = [];
  for (const b of blocks) {
    for (const c of (b && b.citations) || []) if (c && c.url) urls.push(c.url);
  }
  /* 서버 도구는 실패해도 예외를 던지지 않는다 — HTTP 200 에 결과 블록의
     content 가 에러 객체로 온다(성공은 배열). 검색이 실제로 돌았는지 여기서
     가른다. 안 돌았는데 search 로 세면 그건 학습 레이어 답변을 답변 레이어
     칸에 넣는 것이고, 두 레이어를 나눈 의미가 사라진다. */
  const searched = blocks.some(
    (b) => b && b.type === 'web_search_tool_result' && Array.isArray(b.content));
  return { text, urls, searched };
}

/* 웹검색 도구 타입이 모델·시점마다 'web_search' 와 'web_search_preview' 로
   갈린다. **로컬에 OpenAI 키가 없어 어느 쪽이 맞는지 확인하지 못했다**(비밀값은
   도메니코가 콘솔에서만 다룬다). 틀린 쪽을 고르면 chatgpt/search 8칸이 매주
   통째로 비고, 그건 한 주가 지나야 안다. 그래서 400 이면 다른 이름으로 한 번
   더 시도한다 — 맞는 이름이 무엇이든 첫 회차부터 데이터가 남는다.
   재시도는 400(도구 이름 거절)에만 한다. 401·429·5xx 는 그대로 실패시킨다. */
const OPENAI_SEARCH_TOOLS = ['web_search', 'web_search_preview'];

async function askChatGpt(question, mode, timeoutMs) {
  /* Responses API — 웹검색 도구가 여기 붙는다. chat/completions 에는 없다. */
  const attempts = mode === 'search' ? OPENAI_SEARCH_TOOLS : [null];
  let res = null;
  let lastStatus = 0;

  for (const tool of attempts) {
    const body = {
      model: process.env.OPENAI_SOV_MODEL || 'gpt-4.1',
      input: question,
      max_output_tokens: 1500,
    };
    if (tool) body.tools = [{ type: tool }];

    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) break;
    lastStatus = res.status;
    if (res.status !== 400) break;   // 도구 이름 문제가 아니면 재시도해도 같다
  }
  if (!res || !res.ok) throw new Error('openai ' + (lastStatus || (res && res.status)));
  const j = await res.json();

  let text = '';
  const urls = [];
  let searched = false;
  for (const item of (j.output || [])) {
    // Responses API 는 검색이 돌면 web_search_call 항목을 출력에 남긴다.
    if (item && typeof item.type === 'string' && /web_search/.test(item.type)) searched = true;
    for (const c of (item && item.content) || []) {
      if (c && typeof c.text === 'string') text += (text ? '\n' : '') + c.text;
      for (const a of (c && c.annotations) || []) if (a && a.url) urls.push(a.url);
    }
  }
  if (!text && typeof j.output_text === 'string') text = j.output_text;
  return { text, urls, searched };
}

function engineReady(engine) {
  if (engine === 'claude') return !!process.env.ANTHROPIC_API_KEY;
  if (engine === 'chatgpt') return !!process.env.OPENAI_API_KEY;
  return false;
}

async function ask(engine, question, mode, timeoutMs) {
  if (engine === 'claude') return askClaude(question, mode, timeoutMs);
  if (engine === 'chatgpt') return askChatGpt(question, mode, timeoutMs);
  throw new Error('unknown engine ' + engine);
}

/**
 * 한 회차 — 질문 × 엔진 × 모드 전부를 돌고 ai_sov_probes 에 적는다.
 * 실패한 조합은 error 를 남기고 present=null 로 적는다. **빼지 않는다** —
 * 빠진 행과 "없다"는 행은 다르고, 빼면 분모가 조용히 줄어 점유율이 부풀려진다.
 */
/* 동시 실행 6 → 10 (2026-08-30 실측). 32콜 중 웹검색 모드 16콜이 느리고,
   6이면 웨이브가 6번이라 뒤 웨이브가 예산 끝에 몰려 타임아웃으로 죽었다.
   10이면 4웨이브. 제공사별로는 5개씩이라 레이트리밋에 닿지 않는다. */
async function runSovProbe({ timeoutMs = 240000, probes = PROBES, engines = ENGINES, concurrency = 10 } = {}) {
  const usable = engines.filter(engineReady);
  if (!usable.length) {
    const e = new Error('SoV 프로브: 쓸 수 있는 엔진 키가 없다.');
    e.statusCode = 503;
    throw e;
  }

  const deadline = Date.now() + timeoutMs;

  /* 조합을 먼저 펼치고 풀로 돌린다. 순차로 돌면 32콜이 함수 예산을 넘는다
     (웹검색 모드는 한 콜에 10~30초). 순서는 결과에 영향이 없다 — 행마다
     질문·엔진·모드가 다 적혀 있다. */
  const tasks = [];
  for (const p of probes) {
    for (const engine of usable) {
      for (const mode of MODES) tasks.push({ p, engine, mode });
    }
  }

  const rows = [];
  const skipped = [];
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      const { p, engine, mode } = tasks[i];
      const base = { question_key: p.key, question: p.q, lang: p.lang, engine, mode };

      /* 남은 시간이 한 콜에 못 미치면 **부르지 않고 건너뛴다.**
         호출해 놓고 타임아웃으로 죽이면 돈은 나가고 데이터는 없다.
         검색 모드는 훨씬 오래 걸리므로 문턱도 다르다 — canStart 가 그걸 안다. */
      const kind = mode === 'search' ? 'ai-search' : 'ai';
      if (!canStart(deadline, kind)) { skipped.push(p.key + '/' + engine + '/' + mode); continue; }

      try {
        const { text, urls, searched } = await ask(engine, p.q, mode,
          budgetFor(deadline, kind));

        /* 검색 모드인데 검색이 실제로 안 돌았으면 그 답은 학습 레이어 답이다.
           그걸 답변 레이어 칸에 넣으면 두 레이어를 나눈 의미가 사라지고,
           더 나쁘게는 'GPTBot 차단이 학습 레이어를 깎았나' 라는 질문에
           오염된 답을 준다. 판정 불가로 남긴다 — 빼지는 않는다. */
        if (mode === 'search' && !searched) {
          rows.push({
            ...base, present: null, described: null, desc_ok: null,
            rivals: [], citations: [],
            error: '웹검색 미실행 — 답변 레이어로 세지 않음',
          });
          continue;
        }

        const a = analyze(text);
        rows.push({
          ...base,
          present: a.present,
          described: a.described,
          desc_ok: a.desc_ok,
          rivals: a.rivals,
          citations: mode === 'search' ? extractCitations(text, urls) : [],
          error: null,
        });
      } catch (err) {
        console.error('[sov]', p.key, engine, mode, (err && err.message) || err);
        /* 실패도 행으로 남긴다. **빼지 않는다** — 빠진 행과 "없다"는 행은
           다르고, 빼면 분모가 조용히 줄어 점유율이 부풀려진다. */
        rows.push({
          ...base, present: null, described: null, desc_ok: null,
          rivals: [], citations: [],
          error: String((err && err.message) || 'failed').slice(0, 200),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker));

  if (rows.length) {
    const { error } = await db().from('ai_sov_probes').insert(rows);
    if (error) throw error;
  }

  const done = rows.filter((r) => r.present !== null);
  const present = done.filter((r) => r.present).length;
  const failed = rows.length - done.length;

  return {
    inserted: rows.length,
    engines: usable,
    skipped,
    note: 'SoV ' + present + '/' + done.length
      + (failed ? ' · 실패 ' + failed : '')
      + (skipped.length ? ' · 시간부족 ' + skipped.length : ''),
  };
}

/* ── 리포트 ───────────────────────────────────────────────────
   결정론 집계다 (성적표·IG 장부와 같은 원칙). AI 서사가 죽어도 이 표는 나간다. */

function pct(n, d) { return d ? Math.round((n / d) * 100) : null; }

/** 최근 두 회차를 레이어별로 비교한다. @returns null 이면 데이터 없음. */
async function buildSovReport({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data, error } = await db()
    .from('ai_sov_probes')
    .select('day, engine, mode, present, desc_ok, rivals, question_key')
    .gte('day', since)
    .order('day', { ascending: false });
  if (error) throw error;
  const all = data || [];
  if (!all.length) return null;

  const days_ = Array.from(new Set(all.map((r) => r.day))).sort().reverse();
  const latest = days_[0];
  const prev = days_[1] || null;

  const slice = (day, mode) => all.filter(
    (r) => r.day === day && r.mode === mode && r.present !== null);

  const layer = (mode) => {
    const cur = slice(latest, mode);
    const old = prev ? slice(prev, mode) : [];
    const byEngine = {};
    for (const e of ENGINES) {
      const rows = cur.filter((r) => r.engine === e);
      if (rows.length) byEngine[e] = { n: rows.length, hit: rows.filter((r) => r.present).length };
    }
    const descRows = cur.filter((r) => r.present && r.desc_ok !== null);
    return {
      n: cur.length,
      hit: cur.filter((r) => r.present).length,
      sov: pct(cur.filter((r) => r.present).length, cur.length),
      prevSov: old.length ? pct(old.filter((r) => r.present).length, old.length) : null,
      byEngine,
      descOk: descRows.length ? pct(descRows.filter((r) => r.desc_ok).length, descRows.length) : null,
    };
  };

  // 우리가 안 나온 자리에 누가 나왔나 — 그게 다음 멘션 타겟이다.
  const missRivals = {};
  for (const r of all.filter((x) => x.day === latest && x.present === false)) {
    for (const name of (r.rivals || [])) missRivals[name] = (missRivals[name] || 0) + 1;
  }
  const topRivals = Object.entries(missRivals).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // 두 레이어 모두에서 한 번도 안 나온 질문 = 가장 아픈 구멍
  const blind = [];
  for (const key of Array.from(new Set(all.map((r) => r.question_key)))) {
    const rows = all.filter((r) => r.day === latest && r.question_key === key && r.present !== null);
    if (rows.length && rows.every((r) => !r.present)) blind.push(key);
  }

  return { latest, prev, pretrain: layer('pretrain'), search: layer('search'), topRivals, blind };
}

function arrow(cur, old) {
  if (cur == null || old == null) return '';
  const d = cur - old;
  if (d === 0) return ' (전회 대비 ±0)';
  return ' (전회 대비 ' + (d > 0 ? '+' : '') + d + 'p)';
}

/** 브리핑에 그대로 붙는 마크다운. AI 산출물 아님. */
function renderSovMd(rep) {
  if (!rep) return '\n## AI 답변 점유율\n\n아직 프로브 기록이 없다.\n';
  const L = [];
  L.push('\n## AI 답변 점유율 (SoV) — ' + rep.latest);
  L.push('');
  L.push('> 브랜드명을 넣지 않은 카테고리 질문에 AI 가 우리를 답하는 비율.');
  L.push('> **두 레이어는 더하지 않는다** — 학습(웹검색 끔)은 장기 자산, 답변(웹검색 켬)은 즉시 공략분.');
  L.push('');
  L.push('| 레이어 | 점유율 | 서술 정확도 | 엔진별 |');
  L.push('|---|---|---|---|');
  for (const [k, label] of [['pretrain', '학습 (검색 끔)'], ['search', '답변 (검색 켬)']]) {
    const s = rep[k];
    if (!s || !s.n) { L.push('| ' + label + ' | — | — | 기록 없음 |'); continue; }
    const eng = Object.entries(s.byEngine).map(([e, v]) => e + ' ' + v.hit + '/' + v.n).join(' · ') || '—';
    L.push('| ' + label + ' | **' + s.sov + '%** (' + s.hit + '/' + s.n + ')' + arrow(s.sov, s.prevSov)
      + ' | ' + (s.descOk == null ? '—' : s.descOk + '%') + ' | ' + eng + ' |');
  }
  L.push('');
  if (rep.blind.length) {
    L.push('**두 레이어 모두에서 0인 질문** (가장 아픈 구멍): ' + rep.blind.join(', '));
  }
  if (rep.topRivals.length) {
    L.push('**우리가 없을 때 대신 나온 곳**: '
      + rep.topRivals.map(([n, c]) => n + ' ' + c).join(' · ')
      + '  ← 다음 멘션 타겟');
  }
  if (rep.pretrain && rep.pretrain.sov != null && rep.pretrain.prevSov != null
      && rep.pretrain.sov < rep.pretrain.prevSov) {
    L.push('');
    L.push('> ⚠️ **학습 레이어가 내려갔다.** 2026-08-22 학습 크롤러 차단'
      + '(robots.txt 의 GPTBot·ClaudeBot 블록)의 장기 비용일 수 있다.'
      + ' 두 회차 연속 내려가면 그 블록을 지우고 재관찰할 것 — 되돌리기 쉬운 결정이다.');
  }
  L.push('');
  return L.join('\n');
}

module.exports = {
  runSovProbe, buildSovReport, renderSovMd,
  analyze, extractCitations, papPatterns, sentences,
  PROBES, ENGINES, MODES, RIVALS, DESC_GOOD, DESC_BAD, engineReady,
};
