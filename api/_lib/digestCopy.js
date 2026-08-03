/**
 * PAP Magazine — 소셜 다이제스트 문안 생성 (2026-08-03, 도메니코 지시).
 *
 * digestBuckets 가 고른 소재로 X·스레드에 나갈 "모아보기" 한 글을 만든다.
 * 도메니코가 정한 규칙 네 가지가 이 파일의 뼈대다.
 *
 *   1) 링크는 딱 하나. 본문엔 제목만 쓰고 맨 끝에 인스타 프로필 링크.
 *      기사별 링크를 붙이면 사람들이 사이트로 흩어진다. X·스레드는
 *      인스타로 밀어넣는 장치이므로 나가는 문은 하나여야 한다.
 *   2) 완전 자동 발행. 사람이 안 본다 → 모델이 링크를 못 쓰게 막아야 한다.
 *      그래서 모델에겐 *한두 줄 소개말만* 시키고, 제목·링크·순서는 이 파일이
 *      기계적으로 조립한다. 모델 출력에서 URL 비슷한 건 전부 지운다.
 *   3) 항목마다 기사 내용을 축약한 한두 줄.
 *   4) X 는 압축 한 글 / 스레드는 여유 있게 한 글. 답글 체인 없음.
 *
 * 어미는 socialHook 의 toneFor/isPolite 를 그대로 쓴다. 채널별 말투 분기는
 * 저장소에 딱 한 군데(socialHook)만 있어야 한다 — tests/social-tone.test.js
 * 가 그걸 지키고 있다. 여기서 platform === 'x' 삼항을 또 쓰면 안 된다.
 */

const papVoice = require('./papVoice');
const socialHook = require('./socialHook');
const { weightedLen } = require('./xPost');

/* 나가는 문은 이 하나뿐이다. */
const IG_URL = 'https://www.instagram.com/pap_magazine/';

/* X 는 280 가중치. 링크는 무조건 23 으로 계산되므로(t.co), 링크 자리를
   먼저 빼두고 본문을 채운다. 줄바꿈 여유로 2 를 더 남긴다. */
const X_WEIGHTED_MAX = 280;
const X_LINK_COST = 23 + 2;

/* 스레드는 500자. 넘치면 잘리는 게 아니라 게시가 실패하므로 여유를 둔다. */
const THREADS_MAX = 480;

const HEADLINE = {
  editorial:  { x: '이번 주 PAP 오리지널 에디토리얼', threads: '이번 주 PAP 에 새로 올라간 오리지널 에디토리얼' },
  collection: { x: '요 며칠 소개한 아트 콜렉션',      threads: '요 며칠 소개한 아트 콜렉션' },
  celeb:      { x: '요 며칠의 셀럽 소식',             threads: '요 며칠 셀럽들 소식 모아봤어' },
};

/* 모델이 뱉을 수 있는 링크 흔적. 자동 발행이라 사람이 못 거르니 기계로 지운다. */
const URLISH = /(https?:\/\/\S+|www\.\S+|\b[\w-]+\.(?:com|net|org|co\.kr|kr|io|me|ly)\b\S*)/gi;

/** 소개말 한 줄 정제 — 링크·해시태그·따옴표·군더더기 제거. */
function cleanNote(raw) {
  let s = String(raw || '')
    .replace(URLISH, '')
    .replace(/#\S+/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  s = socialHook.stripDashes(s);
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
 * 기사 하나에 붙일 한두 줄을 모델에게 받는다.
 * 실패하면 null — 소개말 없이 제목만 나가도 글은 성립한다. 자동 발행에서
 * 모델 한 번 삐끗했다고 그날 다이제스트를 통째로 날리는 건 손해다.
 */
async function generateNotes(items, bucket, platform) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!items.length) return null;

  const polite = socialHook.isPolite(platform);
  const sys = [
    'PAP 매거진 에디터로서 소셜에 올릴 "모아보기" 글의 소개말을 쓴다.',
    socialHook.toneFor(platform),
    '',
    '규칙:',
    '- 기사마다 내용을 축약하는 한두 줄. 40자 안쪽으로 짧게.',
    '- 제목을 그대로 되풀이하지 않는다. 제목은 따로 나간다.',
    '- URL, 링크, 해시태그, 이모지, 계정 아이디를 절대 쓰지 않는다.',
    '- 없는 사실을 지어내지 않는다. 제목에서 확실한 것만 쓴다.',
    '- 빈칸으로 두는 것이 지어내는 것보다 낫다.',
    '',
    'JSON 으로만 답한다: {"intro":"...","notes":["...","..."],"closing":"..."}',
    'intro 는 오늘 묶음을 여는 한 줄, closing 은 인스타로 오라는 한 줄이다.',
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
        max_tokens: 900,
        system: sys,
        messages: [{
          role: 'user',
          content: JSON.stringify({
            bucket,
            platform,
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
      intro: papVoice.normalizeSocialAddress(cleanNote(g.intro), { polite }),
      closing: papVoice.normalizeSocialAddress(cleanNote(g.closing), { polite }),
      notes: items.map((_, i) => papVoice.normalizeSocialAddress(cleanNote(notes[i]), { polite })),
    };
  } catch (_) {
    return null;
  }
}

/* 모델이 죽었을 때 나가는 문장.
   normalizeSocialAddress 는 호칭과 "어떻게 생각해"만 손보지 어미는 못 바꾼다.
   그래서 존댓말·반말 두 벌을 미리 적어 둔다. 채널 판정은 socialHook.isPolite
   하나뿐이고 여기서는 그 결과(boolean)만 쓴다. */
function fallbackCopy(items, polite) {
  return {
    intro: '',
    closing: polite ? '전체 기사는 인스타에서 보실 수 있어요' : '전체 기사는 인스타에 있어',
    notes: items.map(() => ''),
  };
}

/** 한 줄 조립: "1. 제목 — 소개말" 이 아니라 두 줄로 나눈다 (대시 금지). */
function renderItem(n, title, note) {
  const head = n + '. ' + title;
  return note ? head + '\n   ' + note : head;
}

function assembleThreads(headline, copy, items) {
  const build = (n) => {
    const lines = [headline];
    if (copy.intro) lines.push(copy.intro);
    lines.push('');
    for (let i = 0; i < n; i++) lines.push(renderItem(i + 1, cleanTitle(items[i].title), copy.notes[i]));
    lines.push('');
    if (copy.closing) lines.push(copy.closing);
    lines.push(IG_URL);
    return lines.join('\n');
  };
  /* 넘치면 뒤 항목부터 덜어낸다. 소개말을 먼저 버리면 남은 항목이 제목만
     나열된 목록이 되어 읽을 게 없어진다 — 항목 수를 줄이는 쪽이 낫다. */
  for (let n = items.length; n > 1; n--) {
    const t = build(n);
    if (t.length <= THREADS_MAX) return t;
  }
  return build(1);
}

function assembleX(headline, copy, items) {
  /* X 는 자리가 좁다. 소개말은 통째로 빼고 제목 + 아주 짧은 한 줄만.
     그래도 안 들어가면 항목을 줄인다. */
  const build = (n, withNotes) => {
    const lines = [headline];
    for (let i = 0; i < n; i++) {
      const t = cleanTitle(items[i].title);
      lines.push(withNotes && copy.notes[i] ? t + '\n' + copy.notes[i] : t);
    }
    if (copy.closing) lines.push(copy.closing);
    lines.push(IG_URL);
    return lines.join('\n');
  };
  const fits = (s) => weightedLen(s.replace(IG_URL, '')) + X_LINK_COST <= X_WEIGHTED_MAX;

  for (let n = Math.min(items.length, 5); n >= 1; n--) {
    const withNotes = build(n, true);
    if (fits(withNotes)) return withNotes;
    const bare = build(n, false);
    if (fits(bare)) return bare;
  }
  return build(1, false);
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

  const polite = socialHook.isPolite(platform);
  const headRow = HEADLINE[picked.bucket] || {};
  const headline = headRow[platform] || picked.label;

  const copy = (await generateNotes(items, picked.bucket, platform)) || fallbackCopy(items, polite);

  let text = (ASSEMBLE[platform] || assembleThreads)(headline, copy, items);

  text = socialHook.stripDashes(text);

  /* 검수 게이트는 로그만 남긴다 (auditKoreanBody). 자동 발행이라 오탐 하나로
     그날 글을 통째로 막으면 안 된다 — b2616fa 에서 정한 방침이다. */
  try {
    /* structure:false — 린터의 단락·길이 규칙은 기사 본문 기준이다.
       다이제스트는 애초에 목록이라 단락이 여러 개인 게 정상이다. */
    papVoice.auditKoreanBody(text, {
      style: polite ? 'polite' : 'casual',
      structure: false,
      where: 'digest:' + picked.bucket + ':' + platform,
    });
  } catch (_) {}

  /* 링크는 하나여야 한다. 조립 과정에서 둘이 되면 그건 버그다. */
  const links = text.match(/https?:\/\/\S+/g) || [];
  if (links.length !== 1 || links[0] !== IG_URL) return null;

  /* 길이 때문에 덜어낸 항목은 '나갔다'고 기록하면 안 된다. 기록해 버리면
     중복 방지(social_digest_items)가 그 글을 영영 다시 안 뽑는다. */
  const used = items.filter((it) => text.includes(cleanTitle(it.title)));

  return { text, items: used };
}

module.exports = {
  IG_URL,
  X_WEIGHTED_MAX,
  THREADS_MAX,
  HEADLINE,
  cleanNote,
  cleanTitle,
  fallbackCopy,
  assembleX,
  assembleThreads,
  ASSEMBLE,
  build,
};
