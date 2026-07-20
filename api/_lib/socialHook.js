/**
 * PAP Magazine — 대화형 소셜 카피 (2026-07-21 신설)
 *
 * 왜: 스레드·X 에 기사를 던지듯 올리면 반응이 없다. 도메니코 요청 —
 * "기사를 내고 투박하게 접근하기보다, 친근하게 관심 갈 만한 걸 콕 집어
 * 이야기하는 식으로. 다만 모든 기사가 아니라 그런 글감이 있을 때만."
 *
 * 예시(도메니코): 제니 앨범 자켓에 함께 등장한 인물이 누구인지 팬들이
 * 추론 중이라는 화제 → "너는 누구일 것 같아?" 식으로 말을 건다.
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

/* 대화거리 신호 — 사람들이 이미 말하고 있거나, 말할 여지가 있는 소재.
   가중치는 "댓글이 붙을 확률" 기준으로 손으로 매겼다 (추후 스냅샷으로 조정). */
const SIGNALS = [
  // 미스터리·추측 — 가장 강한 신호
  { w: 4, re: /(정체|누구|미공개|베일|가려진|익명|추측|추정|설왕설래|갑론을박|의문|왜 하필|숨은)/ },
  { w: 4, re: /(mystery|unidentified|who is|speculat|rumou?r has|fans think)/i },
  // 비교·선택 — 취향을 물을 수 있다
  { w: 3, re: /(vs\.?|대결|비교|어느 쪽|둘 중|재현|오마주|닮은|같은 옷|겹치)/ },
  // 의외성·반전
  { w: 3, re: /(의외|반전|처음으로|파격|깜짝|예상 밖|이례적|아무도)/ },
  // 해석 여지 — 아트디렉션·상징
  { w: 2, re: /(상징|의미|해석|메시지|컨셉|레퍼런스|모티프|왜 지금)/ },
  // 화제성 자체가 이미 형성됨
  { w: 2, re: /(화제|난리|들썩|술렁|뜨겁|반응 폭발|댓글|커뮤니티|온라인에서|의견이 갈|말이 많)/ },
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

/** 이 점수부터 대화형으로 쓴다. 낮추면 어색한 글이 늘고, 높이면 기회를 놓친다. */
const HOOK_MIN = Number(process.env.SOCIAL_HOOK_MIN || 5);

const SYSTEM = [
  'PAP MAGAZINE(서울·밀라노 기반 패션·뷰티·컬쳐 매거진)의 소셜 담당자로서',
  '스레드/X 에 올릴 짧은 글을 쓴다. 기사 요약이 아니라 사람에게 말을 거는 글이다.',
  '',
  '어떻게 쓰나:',
  '- 지금 사람들이 무엇을 두고 얘기하는지 첫 줄에 콕 집는다. 제목 복붙 금지.',
  '- 매체 공지 어투("~를 공개했다", "화제를 모으고 있다") 대신 사람 말투로.',
  '- 내 시선을 한 줄 넣어도 된다. 단정 대신 관찰.',
  '- 마지막은 열린 질문. 답이 정해진 질문("멋지지 않나요?")은 쓰지 않는다.',
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
 * 대화형 카피 생성. 기준 미달이거나 실패하면 null → 호출부가 기존 방식으로.
 * @param {object} art  {title, body, tags, category}
 * @param {'threads'|'x'} platform
 * @returns {Promise<{text:string, angle:string, score:number}|null>}
 */
async function generateConversationalPost(art, platform, opts) {
  const gate = hookScore(art);
  const min = (opts && opts.min) || HOOK_MIN;
  if (gate.blocked || gate.score < min) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  // X 는 링크·태그를 뺀 본문 여유가 200자 남짓. 스레드는 넉넉하다(500).
  const limit = platform === 'x' ? 180 : 420;

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
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: JSON.stringify({
            platform,
            max_chars: limit,
            title: art.title || '',
            body: String(art.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1500),
            tags: art.tags || [],
            detected: gate.signals,
          }),
        }],
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
    const text = g && typeof g.text === 'string' ? g.text.trim() : '';
    if (!text || text.length > limit * 1.3) return null; // 길이 폭주 방어
    return { text, angle: (g.angle || '').trim(), score: gate.score };
  } catch (_) {
    return null;
  }
}

module.exports = { hookScore, generateConversationalPost, HOOK_MIN, SIGNALS, BLOCK };
