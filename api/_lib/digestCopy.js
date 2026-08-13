/**
 * PAP Magazine — 소셜 다이제스트 문안 생성 (2026-08-03, 도메니코 지시).
 *
 * digestBuckets 가 고른 소재로 X·스레드에 나갈 "모아보기" 한 글을 만든다.
 * 도메니코가 정한 규칙이 이 파일의 뼈대다.
 *
 *   1) 링크는 딱 하나. 본문엔 제목만 쓰고 맨 끝에 인스타 프로필 링크.
 *      기사별 링크를 붙이면 사람들이 사이트로 흩어진다. X·스레드는
 *      인스타로 밀어넣는 장치이므로 나가는 문은 하나여야 한다.
 *   2) 완전 자동 발행. 사람이 안 본다 → 모델이 링크를 못 쓰게 막아야 한다.
 *      그래서 모델에겐 *기사마다 한 줄 소개말만* 시키고, 제목·링크·순서·머리말·
 *      마무리는 이 파일이 기계적으로 조립한다. 모델 출력에서 URL 비슷한 건 전부 지운다.
 *   3) 한 기사는 한 줄. 제목과 소개말을 두 줄로 쪼개지 않는다.
 *      (2026-08-03 2차 지시 — 그 전엔 제목 밑에 소개말을 들여썼다.)
 *   4) 소재를 고르지 않는다. 창(窓) 안에 있는 기사는 전부 싣는다.
 *      자리가 모자라면 *소개말을 먼저 버리고* 그래도 안 되면 그때 항목을 던다.
 *      항목 수가 소개말보다 우선한다 — 이것도 2026-08-03 2차 지시다.
 *   5) X 는 압축 한 글 / 스레드는 여유 있게 한 글. 답글 체인 없음.
 *   6) 글의 뼈대는 네 덩이뿐이다 (2026-08-03 4차 지시 — "좀 더 심플하게").
 *
 *        최근 셀럽들 소식 모음.
 *        (빈 줄)
 *        1. 제목 · 소개말
 *        2. 제목 · 소개말
 *        (빈 줄)
 *        더 많은 현장은 PAP 인스타그램에서 확인!
 *        https://www.instagram.com/pap_magazine/
 *
 *      빈 줄은 머리말 밑과 마무리 앞 두 군데뿐이다. 예전엔 모델이 쓴 '오늘의
 *      묶음을 여는 한 줄'(intro)이 머리말 밑에 또 붙었는데 그건 걷어냈다 —
 *      머리말이 이미 그 일을 한다.
 *
 * 어미는 socialHook 의 toneFor/isPolite 를 그대로 쓴다. 채널별 말투 분기는
 * 저장소에 딱 한 군데(socialHook)만 있어야 한다 — tests/social-tone.test.js
 * 가 그걸 지키고 있다. 여기서 platform === 'x' 삼항을 또 쓰면 안 된다.
 *
 * ── 페퍼릿 갈래 (2026-08-05, 도메니코 확정) ─────────────────────────
 * 페퍼릿은 PAP 과 톤이 완전히 다르다. **전체 존댓말**이고, 나가는 문도
 * @pepperitmag 이며, 무엇보다 **제목만 나열한다** — 항목별 소개말이 없다.
 *
 * 그래서 페퍼릿 경로는 generateNotes() 를 아예 부르지 않는다. 쓰지도 않을
 * 소개말을 만드느라 항목 수만큼 토큰을 쓰고, 자동 발행 경로에 실패할 수 있는
 * 외부 호출을 하나 더 매다는 셈이기 때문이다. 안 쓰는 값은 안 만든다.
 *
 * 여기서 갈리는 축은 '채널'이 아니라 '브랜드'다. 채널(x/threads) 말투 분기는
 * 여전히 socialHook 한 군데뿐이고, 이 파일이 더한 것은 PAP 이냐 페퍼릿이냐다.
 * 두 축을 섞지 않으려고 브랜드 분기는 isPoliteFor/igUrlFor/isTitleOnly 세
 * 함수에만 두었다 — 조립부·build() 는 그 결과만 받는다.
 *
 * papVoice 는 PAP 목소리 사전이다(호칭 '패퍼들' 치환까지 들어 있다).
 * 페퍼릿에는 태우지 않는다.
 */

const papVoice = require('./papVoice');
const socialHook = require('./socialHook');
const { weightedLen } = require('./xPost');

/* 나가는 문은 글 하나에 하나뿐이다. 다만 그 문이 브랜드마다 다르다.
   IG_URL 은 PAP 값으로 남겨 둔다 — 기존 호출부·테스트가 이 이름을 쓴다. */
const IG_URLS = {
  pap:      'https://www.instagram.com/pap_magazine/',
  pepperit: 'https://www.instagram.com/pepperitmag/',
};
const IG_URL = IG_URLS.pap;

/* 페퍼릿 갈래 이름. 브랜드 분기가 이 상수 하나를 보게 해서, 갈래 이름이
   문자열로 여기저기 박히는 걸 막는다. */
const PEPPERIT_BUCKET = 'pepperit';

/** 갈래 → 나가는 문(인스타 프로필). 모르는 갈래는 PAP 이다. */
function igUrlFor(bucket) {
  return bucket === PEPPERIT_BUCKET ? IG_URLS.pepperit : IG_URLS.pap;
}

/**
 * 제목만 나열하는 갈래인가 (= 소개말도, 그걸 만드는 AI 호출도 없음).
 * 지금은 페퍼릿 하나뿐이지만, 판정을 함수로 두면 늘어날 때 한 곳만 고친다.
 */
function isTitleOnly(bucket) {
  return bucket === PEPPERIT_BUCKET;
}

/**
 * 존댓말인가.
 *
 * 채널 축은 socialHook.isPolite 가 정한다(스레드=반말 / X=존댓말) — 그 판정은
 * 여기서 다시 쓰지 않고 그대로 넘겨받는다. 그 위에 브랜드 축이 하나 더 있다:
 * 페퍼릿은 채널과 무관하게 전체 존댓말이다. PAP 갈래는 예전 그대로다.
 */
function isPoliteFor(bucket, platform) {
  if (bucket === PEPPERIT_BUCKET) return true;
  return socialHook.isPolite(platform);
}

/* X 는 280 가중치. 링크는 무조건 23 으로 계산되므로(t.co), 링크 자리를
   먼저 빼두고 본문을 채운다. 줄바꿈 여유로 2 를 더 남긴다. */
const X_WEIGHTED_MAX = 280;
const X_LINK_COST = 23 + 2;

/* 스레드는 500자. 넘치면 잘리는 게 아니라 게시가 실패하므로 여유를 둔다. */
const THREADS_MAX = 480;

/* 소개말 길이 상한 (한글 기준).
   한 줄 안에 제목과 같이 들어가므로 예전보다 짧게 잡는다. 소개말이 길면
   항목이 통째로 밀려나는데, 도메니코 지시상 항목 수가 더 중요하다.
   2026-08-03 4차 — 스레드도 56에서 28로 줄인다. 도메니코가 보여준 본보기
   ("컴백 무드가 확 달라져.", "워터밤 현장 공기까지 그대로")가 다 그 언저리다.
   길게 쓸 자리를 주면 모델은 반드시 그 자리를 다 쓴다. */
const NOTE_LEN = { x: 24, threads: 28 };

/* 제목과 소개말을 잇는 자리. 줄표(—, ㅡ, --)는 stripDashes 가 쉼표로 바꿔
   버리므로 쓸 수 없다. 가운뎃점은 그 규칙에 걸리지 않는다. */
const SEP = ' · ';

/* 머리말. 스레드 쪽은 4차 지시대로 체언 + 마침표로 짧게 끊는다
   ("최근 셀럽들 소식 모음."). X 쪽은 가중 280자가 빠듯해 마침표도 아깝다. */
const HEADLINE = {
  editorial:  { x: '이번 주 PAP 오리지널 에디토리얼', threads: '이번 주 새로 올라온 PAP 오리지널 에디토리얼 모음.' },
  /* 2026-08-13 도메니코: 스레드 머리말만 '아트&컬쳐' 로. 이 묶음은 아트뿐 아니라
     패션·뷰티·컬쳐 기사까지 담고 있어서 '아트 콜렉션' 이 실제보다 좁게 들렸다.
     2026-08-13 2차: X 쪽도 같이 바꾼다. 가중 280자가 빠듯하지만 두 글자라
     본문 자리를 의미 있게 먹지 않고, 채널마다 브랜드 표현이 다른 게 더 나쁘다. */
  collection: { x: '최근 소개한 아트&컬쳐 콜렉션',    threads: '최근 소개한 아트&컬쳐 콜렉션 모음.' },
  celeb:      { x: '최근 셀럽 소식',                  threads: '최근 셀럽들 소식 모음.' },
  /* 페퍼릿은 스레드만 쓴다 (X 계정이 없다) — 그래서 x 칸이 없다.
     PAP 머리말이 체언 + 마침표로 끊는 것과 달리 문장으로 말을 건다.
     같은 표에 있어도 말투가 다른 게 정상이다. 2026-08-05 도메니코 확정. */
  pepperit:   { threads: '요 며칠 페퍼릿 소식 모아봤어요 🩷' },
};

/* 마무리 한 줄도 브랜드마다 다르다. PAP 은 존댓말/반말 두 벌이고(closingFor),
   페퍼릿은 어느 채널이든 이 한 줄이다. 2026-08-05 도메니코 확정. */
const PEPPERIT_CLOSING = '더 많은 소식은 인스타에서 확인해주세요 🩷';

/* 모델이 뱉을 수 있는 링크 흔적. 자동 발행이라 사람이 못 거르니 기계로 지운다. */
const URLISH = /(https?:\/\/\S+|www\.\S+|\b[\w-]+\.(?:com|net|org|co\.kr|kr|io|me|ly)\b\S*)/gi;

/**
 * 마무리 한 줄. 모델에게 맡기지 않는다 — 2026-08-03 에 한 번 당했다.
 * fallbackCopy 쪽만 고쳤더니 모델이 살아있는 실제 경로에서는 제 문장을
 * 그대로 내보냈다. 마무리는 브랜드 문구라 코드가 못 박는 게 맞다.
 *
 * normalizeSocialAddress 는 호칭과 "어떻게 생각해"만 손보지 어미는 못 바꾼다.
 * 그래서 존댓말·반말 두 벌을 미리 적어 둔다. 채널 판정은 socialHook.isPolite
 * 하나뿐이고 여기서는 그 결과(boolean)만 쓴다.
 */
function closingFor(polite, bucket) {
  if (bucket === PEPPERIT_BUCKET) return PEPPERIT_CLOSING;
  return polite ? '전체 기사는 인스타에서 보실 수 있어요' : '더 많은 현장은 PAP 인스타그램에서 확인!';
}

/** 소개말 한 줄 정제 — 링크·해시태그·따옴표·군더더기 제거. */
function cleanNote(raw, opts) {
  let s = String(raw || '')
    .replace(URLISH, '')
    .replace(/#\S+/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  s = socialHook.stripDashes(s);
  /* 모델이 상한을 넘기면 문장 끝에서 자른다. 글자 수로 뚝 자르면 말이
     중간에 끊겨 "어? 하다 만 글인가" 싶어진다 — 유입 장치에서 제일 나쁜 인상. */
  const max = (opts && opts.max) || 0;
  if (max && s.length > max) {
    const cut = s.slice(0, max + 12);
    const m = cut.match(/^[\s\S]*[.!?요다죠네]/);
    s = (m ? m[0] : s.slice(0, max)).trim();
  }
  return s;
}

/**
 * 제목은 모델을 거치지 않는다. 그대로 쓰되 소셜에서 깨지는 것만 정리한다.
 * 제목을 모델에 맡기면 조용히 바꿔 쓴다 — 매거진 이름값이 걸린 부분이다.
 */
function cleanTitle(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().replace(/\s*[|·ㅡ-]\s*PAP.*$/i, '').trim();
}

/**
 * 기사 하나에 붙일 한 줄을 모델에게 받는다.
 * 실패하면 null — 소개말 없이 제목만 나가도 글은 성립한다. 자동 발행에서
 * 모델 한 번 삐끗했다고 그날 다이제스트를 통째로 날리는 건 손해다.
 *
 * 모델이 만드는 건 notes 뿐이다. 머리말·마무리·순서는 코드 몫이다
 * (2026-08-03 4차 — 모델이 쓰던 intro 를 없앴다).
 */
async function generateNotes(items, bucket, platform) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!items.length) return null;

  const polite = socialHook.isPolite(platform);
  const noteMax = NOTE_LEN[platform] || NOTE_LEN.threads;
  const sys = [
    'PAP 매거진 에디터로서 소셜에 올릴 "모아보기" 글의 소개말을 쓴다.',
    socialHook.toneFor(platform),
    '',
    '규칙:',
    '- 기사마다 내용을 축약하는 한 줄. ' + noteMax + '자 안쪽.',
    '- 제목 뒤에 가운뎃점으로 이어 붙는다. 제목을 그대로 되풀이하지 않는다.',
    '- 요약이 아니라 미끼다. 읽는 사람이 본문을 더 보고 싶어지게 쓴다.',
    '  무엇을 다뤘는지 한 겹 더 들어가서 알려준다 (누가, 어디서, 무엇이 새로운지).',
    '- 짧게 끊는다. 한 문장이면 충분하다. 접속사와 군더더기 부사는 뺀다.',
    '  본보기: "워터밤 현장 공기까지 그대로", "컴백 무드가 확 달라져.",',
    '          "뮤비 티저부터 심상치 않아."',
    '- 지금 눈앞의 일처럼 현재형으로 쓴다. 지난 일을 되짚는 과거형은 쓰지 않는다.',
    '- 체언으로 끝내도 좋다.',
    '- URL, 링크, 해시태그, 이모지, 계정 아이디를 절대 쓰지 않는다.',
    '- 없는 사실을 지어내지 않는다. 제목에서 확실한 것만 쓴다.',
    '- 빈칸으로 두는 것이 지어내는 것보다 낫다.',
    '',
    'JSON 으로만 답한다: {"notes":["...","..."]}',
    '머리말과 마무리 문장은 쓰지 않는다 (코드가 붙인다). notes 만 보낸다.',
    'notes 배열 길이는 받은 기사 수와 정확히 같아야 한다.',
  ].join('\n');

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
        max_tokens: 1600,
        system: sys,
        messages: [{
          role: 'user',
          content: JSON.stringify({
            bucket,
            platform,
            max_note_chars: noteMax,
            titles: items.map((it) => cleanTitle(it.title)),
          }),
        }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    try { require('./aiCreditWatch').reportAiResponse(j, 'digestCopy'); } catch (_) {}
    const block = Array.isArray(j.content) ? j.content.find((b) => b && typeof b.text === 'string') : null;
    const raw = (block ? block.text : '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    let g;
    try { g = JSON.parse(raw); } catch (_) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try { g = JSON.parse(m[0]); } catch (_) { return null; }
    }
    const notes = Array.isArray(g.notes) ? g.notes : [];
    return {
      /* 모델이 intro·closing 을 보내와도 안 쓴다. 머리말과 마무리는 코드 몫이다. */
      closing: closingFor(polite, bucket),
      notes: items.map((_, i) => papVoice.normalizeSocialAddress(cleanNote(notes[i], { max: noteMax }), { polite })),
    };
  } catch (_) {
    return null;
  }
}

/* 모델이 죽었을 때 나가는 문장. 마무리는 위와 같은 문장을 쓴다.
   제목만 나열하는 갈래(페퍼릿)는 '모델이 죽었을 때'가 아니라 *늘* 이 경로다 —
   notes 가 전부 빈 문자열이라 조립부가 제목만 남긴다. bucket 은 마무리 한 줄을
   고르는 데만 쓴다. 안 주면 예전과 같이 PAP 문장이다. */
function fallbackCopy(items, polite, bucket) {
  return {
    closing: closingFor(polite, bucket),
    notes: items.map(() => ''),
  };
}

/**
 * 한 기사 = 한 줄. "1. 제목 · 소개말" (2026-08-03 도메니코 2차 지시).
 * 번호는 두 채널 공통이다. 소개말이 없으면 제목만 남는다.
 */
function renderItem(n, title, note) {
  return note ? n + '. ' + title + SEP + note : n + '. ' + title;
}

/**
 * 자리에 맞을 때까지 줄여 나가는 공통 절차.
 * 항목 수를 먼저 지키고(도메니코 — "고르지 말고 전부"), 같은 항목 수라면
 * 소개말이 붙은 판을 택한다. 소개말은 항목보다 먼저 버린다.
 */
function fitDown(items, build, fits) {
  for (let n = items.length; n >= 1; n--) {
    const rich = build(n, true);
    if (fits(rich)) return rich;
    const bare = build(n, false);
    if (fits(bare)) return bare;
  }
  return build(1, false);
}

/* 스레드 = 머리말 / 빈 줄 / 목록 / 빈 줄 / 마무리 / 링크. 그게 전부다.
   빈 줄은 두 군데 — 머리말 밑과 마무리 앞이다. 마무리는 목록의 일곱 번째
   항목이 아니라 딴 소리이므로 눈으로도 떨어져 보여야 한다 (5차 지시).
   X 는 그대로 붙여 쓴다. 가중 280자에 빈 줄 넣을 자리가 없다. */
function assembleThreads(headline, copy, items, igUrl) {
  const link = igUrl || IG_URL;
  const build = (n, withNotes) => {
    const lines = [headline, ''];
    for (let i = 0; i < n; i++) {
      lines.push(renderItem(i + 1, cleanTitle(items[i].title), withNotes ? copy.notes[i] : ''));
    }
    lines.push('');
    if (copy.closing) lines.push(copy.closing);
    lines.push(link);
    return lines.join('\n');
  };
  return fitDown(items, build, (s) => s.length <= THREADS_MAX);
}

function assembleX(headline, copy, items, igUrl) {
  const link = igUrl || IG_URL;
  const build = (n, withNotes) => {
    const lines = [headline];
    for (let i = 0; i < n; i++) {
      lines.push(renderItem(i + 1, cleanTitle(items[i].title), withNotes ? copy.notes[i] : ''));
    }
    if (copy.closing) lines.push(copy.closing);
    lines.push(link);
    return lines.join('\n');
  };
  /* X 는 자리가 좁다. 그래도 잘라내는 순서는 스레드와 같다 — 소개말 먼저. */
  return fitDown(items, build, (s) => weightedLen(s.replace(link, '')) + X_LINK_COST <= X_WEIGHTED_MAX);
}

/* 조립 방식은 채널별로 다르다. 분기를 함수 안에 삼항으로 두지 않고 표로
   빼 둔다 — 채널이 늘면 표에 한 줄 더하면 된다. */
const ASSEMBLE = { x: assembleX, threads: assembleThreads };

/**
 * 다이제스트 본문을 만든다.
 *
 * @param {{bucket:string, label:string, items:Array}} picked  digestBuckets.collect() 결과
 * @param {'x'|'threads'} platform
 * @returns {Promise<{text:string, items:Array}|null>}  소재가 없으면 null
 */
async function build(picked, platform) {
  const items = (picked.items || []).filter((it) => it && it.title);
  if (!items.length) return null;

  const bucket = picked.bucket;
  const polite = isPoliteFor(bucket, platform);
  const igUrl = igUrlFor(bucket);
  const headRow = HEADLINE[bucket] || {};
  const headline = headRow[platform] || picked.label;

  /* 제목만 나열하는 갈래는 모델을 아예 안 부른다. fallbackCopy 가 '실패했을 때
     쓰는 것'이 아니라 '이 갈래의 정상 경로'다 — notes 가 전부 빈 문자열이라
     조립부가 제목만 남긴다. 여기서 generateNotes 를 부르면 쓰지도 않을 소개말에
     항목 수만큼 토큰을 쓰고, 자동 발행 경로에 실패 지점을 하나 더 다는 셈이다. */
  const copy = isTitleOnly(bucket)
    ? fallbackCopy(items, polite, bucket)
    : ((await generateNotes(items, bucket, platform)) || fallbackCopy(items, polite, bucket));

  let text = (ASSEMBLE[platform] || assembleThreads)(headline, copy, items, igUrl);

  text = socialHook.stripDashes(text);

  /* 검수 게이트는 로그만 남긴다 (auditKoreanBody). 자동 발행이라 오탐 하나로
     그날 글을 통째로 막으면 안 된다 — b2616fa 에서 정한 방침이다.
     페퍼릿은 태우지 않는다 — papVoice 는 PAP 목소리 사전이라, 톤이 다른 브랜드를
     넣으면 매번 오탐만 쌓인다. 게다가 페퍼릿 본문은 제목 나열뿐이라 볼 것도 없다. */
  if (!isTitleOnly(bucket)) {
    try {
      /* structure:false — 린터의 단락·길이 규칙은 기사 본문 기준이다.
         다이제스트는 애초에 목록이라 단락이 여러 개인 게 정상이다. */
      papVoice.auditKoreanBody(text, {
        style: polite ? 'polite' : 'casual',
        structure: false,
        where: 'digest:' + bucket + ':' + platform,
      });
    } catch (_) {}
  }

  /* 링크는 하나여야 한다. 조립 과정에서 둘이 되면 그건 버그다.
     비교 대상은 갈래의 인스타 주소다 — 페퍼릿 글에 PAP 링크가 붙으면 그것도
     여기서 걸린다. */
  const links = text.match(/https?:\/\/\S+/g) || [];
  if (links.length !== 1 || links[0] !== igUrl) return null;

  /* 길이 때문에 덜어낸 항목은 '나갔다'고 기록하면 안 된다. 기록해 버리면
     중복 방지(social_digest_items)가 그 글을 영영 다시 안 뽑는다.
     반대로 여기 안 실린 기사는 다음 회차에 다시 후보로 올라온다. */
  const used = items.filter((it) => text.includes(cleanTitle(it.title)));

  return { text, items: used };
}

module.exports = {
  IG_URL,
  IG_URLS,
  PEPPERIT_BUCKET,
  PEPPERIT_CLOSING,
  igUrlFor,
  isTitleOnly,
  isPoliteFor,
  X_WEIGHTED_MAX,
  THREADS_MAX,
  NOTE_LEN,
  SEP,
  HEADLINE,
  closingFor,
  renderItem,
  cleanNote,
  cleanTitle,
  fallbackCopy,
  fitDown,
  assembleX,
  assembleThreads,
  ASSEMBLE,
  build,
};
