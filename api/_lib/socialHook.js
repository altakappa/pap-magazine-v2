/**
 * PAP Magazine — 대화형 소셜 카피 (2026-07-21 신설)
 *
 * 왜: 스레드·X 에 기사를 던지듯 올리면 반응이 없다. 도메니코 요청 —
 * "기사를 내고 투박하게 접근하기보다, 친근하게 관심 갈 만한 걸 콕 집어
 * 이야기하는 식으로. 다만 모든 기사가 아니라 그런 글감이 있을 때만."
 *
 * 예시(도메니코): 제니 앨범 자켓에 함께 등장한 인물이 누구인지 팬들이
 * 추론 중이라는 화제 → "패퍼들은 누구일 것 같아?" 식으로 말을 건다.
 *
 * 구조:
 *   1) hookScore()  — 기사에 대화거리가 있는지 점수화 (순수 함수, 테스트 대상)
 *   2) generateConversationalPost() — 기준을 넘으면 Claude 로 플랫폼별 카피
 *   3) 기준 미달이면 null → 호출부는 기존 방식(제목+링크)을 그대로 쓴다
 *
 * 판단 주체(도메니코 결정): AI 자동 판단 + 사후 확인. 즉시 게시하되
 * 게시 결과를 기록해 나중에 훑어볼 수 있게 한다.
 *
 * 안전선 — 이것만 지킨다:
 *   미확인 인물을 **실명으로 지목하지 않는다**. 앨범 자켓처럼 공개된 홍보물을
 *   두고 도는 이야기는 다뤄도 되지만, 우리가 특정인을 답으로 제시하면
 *   그 사람은 아무 말 없이 소문의 당사자가 된다. 화제는 전하되 지목은 안 한다.
 */

'use strict';

const { HTML_TAG_RE, dropKnownTags } = require('./stripHtml');
const papVoice = require('./papVoice');

/* 대화거리 신호 — 사람들이 이미 말하고 있거나, 말 붙일 여지가 있는 소재.
   2026-07-21 도메니코: "꼭 미스터리·추측 위주로 하지 않아도 된다. 그냥 가볍게
   주제를 던져도 되고 사람들 의견을 듣는 정도면 충분하다."
   → 추측형에 몰려 있던 가중치를 평탄화하고, 취향·스타일·트렌드처럼
     의견이 갈릴 만한 일상적 소재를 신호로 추가했다. */
const SIGNALS = [
  // 미스터리·추측
  { w: 3, re: /(정체|누구|미공개|베일|가려진|익명|추측|추정|설왕설래|갑론을박|의문|왜 하필|숨은)/ },
  { w: 3, re: /(mystery|unidentified|who is|speculat|rumou?r has|fans think)/i },
  // 비교·선택 — 취향을 물을 수 있다
  { w: 3, re: /(vs\.?|대결|비교|어느 쪽|둘 중|재현|오마주|닮은|같은 옷|겹치|나란히)/ },
  // 의외성·반전
  { w: 3, re: /(의외|반전|처음으로|파격|깜짝|예상 밖|이례적|아무도|돌아왔|부활)/ },
  // 취향·스타일 — 가볍게 의견을 물을 수 있는 가장 흔한 소재
  { w: 3, re: /(스타일링|착장|룩|공항패션|레드카펫|코디|컬러|실루엣|소재|디테일|조합|매치)/ },
  // 트렌드·유행 — "요즘 이거 어때?" 가 성립
  { w: 3, re: /(트렌드|유행|다시 뜨|재유행|올해의|시즌|무드|열풍|붐)/ },
  // 아트·컬쳐 — 정답이 없어 의견을 나누기 좋은 영역
  //   2026-07-21 도메니코: "아트나 컬쳐에 대해 의견을 나누는 것도 좋다."
  { w: 3, re: /(전시|작가|작품|아트|예술|갤러리|비엔날레|아카이브|필름|영화|사진|건축|디자인|음악|앨범)/ },
  // 해석 여지 — 아트디렉션·상징
  { w: 2, re: /(상징|의미|해석|메시지|컨셉|레퍼런스|모티프|왜 지금|영감|시선|관점|취향)/ },
  // 화제성 자체가 이미 형성됨
  { w: 2, re: /(화제|난리|들썩|술렁|뜨겁|반응 폭발|댓글|커뮤니티|온라인에서|의견이 갈|말이 많)/ },
  // 신작·공개 — 감상을 물을 자리
  { w: 2, re: /(공개|선보|출시|발표|데뷔|컴백|신곡|신작|커버|화보|캠페인)/ },
];

/* 대화형으로 만들면 안 되는 소재 — 가볍게 말 걸 자리가 아니다. */
const BLOCK = /(사망|별세|추모|비보|음주운전|마약|성범죄|폭행|고소|소송|학폭|사과문|입장문|해명)/;

/**
 * 기사에 대화거리가 있는가.
 * @param {{title?:string, body?:string, tags?:string[], category?:string}} art
 * @returns {{score:number, signals:string[], blocked:boolean}}
 */
function hookScore(art) {
  const a = art || {};
  const text = [a.title || '', a.body || '', (a.tags || []).join(' ')].join(' ');
  if (!text.trim()) return { score: 0, signals: [], blocked: false };
  if (BLOCK.test(text)) return { score: 0, signals: [], blocked: true };

  let score = 0;
  const signals = [];
  for (const s of SIGNALS) {
    const m = text.match(s.re);
    if (m) { score += s.w; signals.push(m[0]); }
  }
  // 셀럽·컬쳐물이 대화가 붙기 쉽다 (에디토리얼 화보는 감상 대상에 가깝다)
  if (/news|celeb|culture/i.test(a.category || '')) score += 1;
  return { score, signals, blocked: false };
}

/** 이 점수부터 대화형으로 쓴다.
    2026-07-21 5 → 4 (도메니코: 가볍게 던지는 정도면 충분).
    낮추면 어색한 글이 늘고 높이면 기회를 놓친다 — 실제 반응 보고 조정. */
const HOOK_MIN = Number(process.env.SOCIAL_HOOK_MIN || 4);

const SYSTEM = [
  'PAP MAGAZINE(서울·밀라노 기반 패션·뷰티·컬쳐 매거진)의 소셜 담당자로서',
  '스레드/X 에 올릴 짧은 글을 쓴다. 기사 요약이 아니라 사람에게 말을 거는 글이다.',
  '',
  '어떻게 쓰나:',
  '- 기사에서 사람들이 한마디 보탤 만한 지점을 하나 골라 첫 줄에 콕 집는다.',
  '  꼭 미스터리일 필요 없다. 스타일 취향, 의외의 선택, 요즘 유행,',
  '  전시·작품·영화 같은 아트/컬쳐 이야기, "이거 어떻게 생각해" 정도의',
  '  가벼운 화제면 충분하다. 제목 복붙 금지.',
  '- 아트·컬쳐는 정답이 없는 영역이다. 평가를 내리기보다 어떻게 생각하는지 나누자는',
  '  자리로 만든다. 해석이 갈리는 지점을 짚어주면 대화가 붙는다.',
  '- 매체 공지 어투("~를 공개했다", "화제를 모으고 있다") 대신 사람 말투로.',
  '- 내 시선을 한 줄 넣어도 된다. 단정 대신 관찰.',
  '- 마지막을 꼭 질문으로 끝내지 않는다. 정말 답이 궁금할 때만 묻고,',
  '  아니면 여운 있는 한 줄이나 관찰로 닫는다. 질문이 습관이 되면 아무도 답하지 않는다.',
  '  물을 때도 답이 정해진 질문("멋지지 않나?")은 동의를 강요하는 것이라 쓰지 않는다.',
  '- 3~5문장. 이모지 최대 1개, 없어도 된다. 과장·감탄사·홍보 문구 금지.',
  '',
  '지켜야 할 선:',
  '- 미확인 인물을 실명으로 지목하지 않는다. "누구인지 얘기가 오간다"까지는 되지만',
  '  "A씨로 보인다"는 안 된다. 우리가 답을 제시하면 그 사람이 소문의 당사자가 된다.',
  '- 기사 본문에 없는 사실을 지어내지 않는다.',
  '- 사람의 외모·신체를 평가하지 않는다.',
  '',
  'JSON 객체만 출력: {"text":"본문(링크 제외)","angle":"무엇으로 말을 걸었는지 한 줄"}',
].join('\n');

/**
 * 줄표 제거 (2026-07-21 도메니코 지시 — "AI 티가 나니까 항상 빼줘").
 *
 * 프롬프트로도 금지하지만 프롬프트는 확률이라 샌다. 게시 직전에 기계적으로
 * 한 번 더 걸러야 "항상"이 보장된다. 이게 마지막 관문이다.
 *
 * 대상: em dash(—) / en dash(–) / horizontal bar(―) / figure dash(‒)
 *       한글 'ㅡ'(U+3161 — 줄표 대신 흔히 타이핑되는 글자) / 연속 하이픈(--)
 * 주의: 'ㅡ'는 낱자로 쓰일 일이 사실상 없지만, 안전하게 "앞뒤가 공백이거나
 *       문장부호일 때"만 지운다. 단어 안(예: 자모 분리 텍스트)은 건드리지 않는다.
 *
 * 치환 규칙: 줄표는 대개 앞뒤 절을 잇는 자리라 쉼표로 바꾸면 자연스럽다.
 * 앞이 이미 문장부호면 쉼표를 겹치지 않도록 공백만 남긴다.
 */
function stripDashes(input) {
  let s = String(input == null ? '' : input);

  // URL 은 건드리지 않는다. 슬러그에 '--' 가 들어있으면 링크가 깨지고,
  // 그러면 링크 프리뷰 카드까지 같이 죽는다. 잠시 치워두고 마지막에 되돌린다.
  const urls = [];
  s = s.replace(/https?:\/\/\S+/g, (u) => {
    urls.push(u);
    return '%%PAPURL' + (urls.length - 1) + '%%';
  });

  // 한글 'ㅡ' 는 앞뒤가 공백/문장부호일 때만 줄표로 간주한다.
  // (단어 안이나 자모 분리 텍스트를 건드리지 않기 위한 안전장치)
  s = s.replace(/(^|[\s,.!?…])ㅡ(?=[\s,.!?…]|$)/g, '$1—');

  const DASH = '[\\u2014\\u2013\\u2015\\u2012]|--';
  // 1) 앞이 이미 문장부호면 쉼표를 겹치지 않게 줄표만 뺀다
  s = s.replace(new RegExp('([,.!?…])\\s*(?:' + DASH + ')\\s*', 'g'), '$1 ');
  // 2) 그 외에는 쉼표로. 줄표 자리는 대개 앞뒤 절을 잇는 자리다
  s = s.replace(new RegExp('\\s*(?:' + DASH + ')\\s*', 'g'), ', ');

  // 뒷정리: 쉼표 중복, 문장부호 앞 쉼표, 줄 끝 쉼표, 공백 중복
  s = s.replace(/,\s*,+/g, ',')
       .replace(/,\s*([.!?…])/g, '$1')
       .replace(/[ \t]+/g, ' ')
       .replace(/ ?, *\n/g, '\n')
       .replace(/,\s*$/g, '')
       .replace(/[ \t]+\n/g, '\n');

  return s.replace(/%%PAPURL(\d+)%%/g, (_, i) => urls[Number(i)]).trim();
}

/* 어투 규칙의 이력 — 뒤집힌 지시가 두 번이라 경위를 남겨둔다.
   · 2026-07-21 "전부 반말로 통일" → 스레드에만 있던 규칙을 X 까지 넓혔다.
   · 2026-08-03 "인스타는 평서체, 스레드는 반말, 나머지는 존댓말"
     → 위 지시를 대체한다. 스레드와 X 가 여기서 다시 갈린다.
   갈라진 것은 어미와 호칭뿐이고 문장 리듬 규칙은 papVoice 안에서 공유한다.
   샤오홍슈·카카오톡(socialRepurpose.js)은 여기 묶지 않는다. 중국어에는
   반말/존댓말 구분이 없고, 카톡은 처음부터 정중체 채널이었다.

   2026-08-03: 어투 문자열은 papVoice.js 로 단일화돼 있다.
   여기서 문자열을 직접 고치지 말고 papVoice 쪽을 고친다. */
const SOCIAL_TONE = papVoice.SOCIAL_VOICE;   // 스레드 — 반말
const X_TONE = papVoice.X_VOICE;             // X — 존댓말

/* 분기는 이 한 곳에만 둔다. 호출부마다 삼항을 흩뿌리면 한 곳이 빠졌을 때
   그 경로로 나간 글만 어미가 다르고, 그건 눈으로 안 잡힌다. */
function toneFor(platform) { return platform === 'x' ? X_TONE : SOCIAL_TONE; }
function isPolite(platform) { return platform === 'x'; }

/**
 * 대화형 카피 생성. 기준 미달이거나 실패하면 null → 호출부가 기존 방식으로.
 * @param {object} art  {title, body, tags, category}
 * @param {'threads'|'x'} platform  스레드는 반말, X 는 존댓말 (2026-08-03)
 * @returns {Promise<{text:string, angle:string, score:number}|null>}
 */
/* 모델 호출 한 곳 (2026-09-03 분리).

   말투 생성기가 둘이 되면서 fetch·파싱·호칭 정규화를 두 벌로 두지 않는다.
   "규칙이 두 벌이면 한쪽만 고쳐진다" — 이 저장소가 올해 네 번 겪은 사고다
   (jsonRepair 세 벌, 파서 두 벌, 감시 차선 누락). */
async function _ask(system, payload, limit, platform) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
        max_tokens: 700,
        // 2026-08-03 도메니코 지시 — 채널별 어미. 스레드 반말 / X 존댓말.
        // 어느 쪽이든 본문과 마지막 문장의 어미가 갈리면 안 된다. 예전에
        // 본문은 반말인데 끝만 존댓말로 튀던 사고가 있었고, 원인은 프롬프트에
        // 박아둔 예시 문구였다. 그래서 예시는 지시와 같은 어미로만 적는다.
        system: system + '\n' + toneFor(platform),
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;

    const j = await r.json();
    const block = Array.isArray(j.content) ? j.content.find(b => b && typeof b.text === 'string') : null;
    const raw = (block ? block.text : '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    let g;
    try { g = JSON.parse(raw); } catch (_) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try { g = JSON.parse(m[0]); } catch (_) { return null; }
    }
    const raw2 = g && typeof g.text === 'string' ? g.text.trim() : '';
    // 2026-08-03 — 독자 호칭('패퍼들')과 "어떻게 생각해"는 프롬프트로만 두면
    // 샌다. 길이 판정 전에 확정한다. 치환으로 글자 수가 늘기 때문에(너는 →
    // 패퍼들은) 나중에 걸면 X 의 280자 판정이 어긋난다.
    const text = papVoice.normalizeSocialAddress(raw2, { polite: isPolite(platform) });
    if (!text || text.length > limit * 1.3) return null; // 길이 폭주 방어
    return { text, angle: (g.angle || '').trim() };
  } catch (_) {
    return null;
  }
}

function _limitFor(platform) {
  // X 는 링크·태그를 뺀 본문 여유가 200자 남짓. 스레드는 넉넉하다(500).
  return platform === 'x' ? 180 : 420;
}

function _payload(art, platform, limit, extra) {
  return Object.assign({
    platform,
    max_chars: limit,
    title: art.title || '',
    body: String(art.body || '').replace(HTML_TAG_RE, dropKnownTags(' ')).replace(/\s+/g, ' ').slice(0, 1500),
    tags: art.tags || [],
  }, extra || {});
}

async function generateConversationalPost(art, platform, opts) {
  const gate = hookScore(art);
  const min = (opts && opts.min) || HOOK_MIN;
  if (gate.blocked || gate.score < min) return null;
  const limit = _limitFor(platform);
  const r = await _ask(SYSTEM, _payload(art, platform, limit, { detected: gate.signals }), limit, platform);
  return r ? { text: r.text, angle: r.angle, score: gate.score } : null;
}

/* 말투 폴백 (2026-09-03, 도메니코 "1번") ─────────────────────────────────
   ■ 무엇이 문제였나 — 어제 붙인 x_posts 기록이 바로 답을 줬다

     본문 트윗 12건 중 PAP 말투는 **1건**. 나머지는 이렇게 나갔다:

       입생로랑 뷰티가 성수에 연 특별한 아지트
       (빈 줄)
       입생로랑 뷰티(YSL Beauty)가 성수동에 새로운 부띠크를 열었다.
       (빈 줄)
       #YSLBEAUTY #SEONGSU #PAPMAGAZINE

     제목 + 기사 첫 문장 + 태그. SYSTEM 이 "매체 공지 어투를 쓰지 마라" 고
     금지한 바로 그 문체이고, 종결도 존댓말이 아니다.

   ■ 왜 그랬나
     generateConversationalPost 는 hookScore 문턱을 못 넘으면 null 을 주고,
     호출부는 기계식 폴백(제목+첫 문장)으로 간다. 대부분의 기사가 문턱을 못 넘는다.

   ■ 판단 (도메니코)
     문턱은 "말을 걸 만한 기사인가" 를 보는 것이지 "말투를 쓸 자격" 이 아니다.
     대화거리가 없어도 PAP 말투로는 쓴다. 억지 질문을 만들지 않을 뿐이다.

   그래서 이 생성기는 **묻지 않는다.** 소식을 PAP 목소리로 짧게 전한다.
   실패하면 여전히 기계식 폴백이 받는다 — 트윗을 잃지 않는다. */
const VOICE_SYSTEM = [
  'PAP MAGAZINE(서울·밀라노 기반 패션·뷰티·컬쳐 매거진)의 소셜 담당자로서',
  '스레드/X 에 올릴 짧은 글을 쓴다. 기사 하나를 우리 목소리로 전하는 글이다.',
  '',
  '어떻게 쓰나:',
  '- **묻지 않는다.** 이 기사에는 말 붙일 거리가 마땅치 않아 이 자리에 왔다.',
  '  억지 질문이나 "어떻게 생각하세요" 는 쓰지 않는다. 소식을 전하고 닫는다.',
  '- 제목을 그대로 옮기지 않는다. 제목이 이미 있는 자리에 같은 문장을 또 쓰지 않는다.',
  '- 매체 공지 어투를 쓰지 않는다. "~를 공개했다", "화제를 모으고 있다",',
  '  "선보인다" 같은 보도자료 문장 대신 사람이 말하듯 쓴다.',
  '- 기사에서 가장 구체적인 한 장면이나 사실 하나를 골라 앞에 둔다.',
  '  날짜·장소·물건·행동처럼 손에 잡히는 것. 형용사로 분위기를 설명하지 않는다.',
  '- 2~4문장. 이모지 최대 1개, 없어도 된다. 과장·감탄사·홍보 문구 금지.',
  '- 마지막 문장은 요약이 아니라 여운이다. 정리하지 말고 남긴다.',
  '',
  '지켜야 할 선:',
  '- 미확인 인물을 실명으로 지목하지 않는다.',
  '- 기사 본문에 없는 사실을 지어내지 않는다.',
  '- 사람의 외모·신체를 평가하지 않는다.',
  '',
  'JSON 객체만 출력: {"text":"본문(링크 제외)"}',
].join('\n');

/**
 * 대화거리가 없어도 PAP 말투로 쓴다. 문턱 없음 — 차단 소재만 거른다.
 * @returns {Promise<{text:string, angle:string, score:number}|null>}
 */
async function generateVoicePost(art, platform) {
  /* 차단 소재(사망·사고·소송 등)는 여기서도 막는다. 가볍게 말할 자리가 아닌 건
     대화형이든 전달형이든 마찬가지다 — 문턱만 없앴지 안전선까지 없앤 게 아니다. */
  const gate = hookScore(art);
  if (gate.blocked) return null;
  const limit = _limitFor(platform);
  const r = await _ask(VOICE_SYSTEM, _payload(art, platform, limit), limit, platform);
  return r ? { text: r.text, angle: '말투', score: 0 } : null;
}

module.exports = {
  stripDashes, hookScore, generateConversationalPost, HOOK_MIN, SIGNALS, BLOCK,
  toneFor, isPolite, generateVoicePost, VOICE_SYSTEM };
