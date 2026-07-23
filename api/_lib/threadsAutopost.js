/**
 * PAP Magazine — Threads 자동 게시 공용 로직 (@pap_magazine)
 *
 * 소비자:
 *   api/cron/sync-instagram.js — IG 수집 → 기사 발행 즉시 게시 (실시간 경로)
 *   api/cron/threads-post.js   — 10분 주기 스위퍼 (실패 재시도 + 놓친 기사 보충)
 *
 * 콘텐츠 원칙 (2026-07-16 도메니코 결정): 인스타 캡션을 복사하지 않는다.
 * Threads 대화형 톤으로 Claude 가 재편집한 짧은 글 + 기사 링크(본문 첫 URL이
 * 링크 프리뷰 카드가 된다). AI 미설정/실패 시 결정적 폴백(제목+첫 문장+링크).
 *
 * env: ANTHROPIC_API_KEY, ANTHROPIC_MODEL(기본 claude-sonnet-4-5) — 선택.
 */

const { supabaseAdmin } = require('./supabase');
const { generateConversationalPost, stripDashes } = require('./socialHook');
const { postText } = require('./threads');

function htmlToText(html, cap) {
  let s = String(html || '');
  s = s.replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
       .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const max = cap || 1500;
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function firstSentence(html) {
  return htmlToText(html, 400).split(/(?<=[.!?다요])\s/)[0] || '';
}

// AI 실패/미설정 시 폴백 — 기존 threads-post 형식 (제목 + 첫 문장 + URL)
function fallbackText(art, url) {
  const lines = [art.title];
  const fs = firstSentence(art.content);
  if (fs && fs.length <= 200) { lines.push(''); lines.push(fs); }
  lines.push('');
  lines.push(url);
  lines.push('');
  lines.push('#PAPMAGAZINE');
  let text = lines.join('\n');
  if (text.length > 500) {
    const overflow = text.length - 500;
    const trimmed = fs.slice(0, Math.max(0, fs.length - overflow - 1)) + '…';
    text = [art.title, '', trimmed, '', url, '', '#PAPMAGAZINE'].join('\n').slice(0, 500);
  }
  return text;
}

const SYSTEM_PROMPT = [
  '너는 PAP 매거진(아트 기반 하이엔드 패션·뷰티·컬처 매거진)의 Threads(@pap_magazine) 운영 에디터야.',
  '기사 제목·카테고리·본문을 받아 Threads 게시글 하나를 새로 써줘.',
  '인스타그램 캡션이나 기사 문장을 그대로 복사하지 말 것. Threads 문법으로 완전히 재편집한다.',
  '',
  'Threads 어투 원칙:',
  '  1. 첫 줄은 스크롤을 멈추게 하는 훅. 제목 복붙 금지. 질문, 의외의 디테일, 한 줄 관찰 중 하나.',
  // 2026-07-21 도메니코 지시 — 해요체 → 전체 반말.
  '  2. 전체 2~4문장, 350자 이내. 매거진 에디터가 팔로워에게 직접 말 걸듯 자연스러운 반말.',
  '     처음부터 끝까지 반말로 간다. 마지막 질문만 존댓말로 바꾸지 마.',
  '     과장·낚시 금지, 이모지는 최대 1개.',
  '  3. 마지막은 가벼운 질문이나 여운 있는 한마디로 대화를 유도해도 좋다(선택). 이것도 반말.',
  '  4. 해시태그·링크는 넣지 마. 링크는 코드가 붙인다.',
  '  5. 인명·브랜드명·고유명사는 원문 그대로.',
  // 2026-07-21 도메니코 지시 — 줄표는 AI 티가 난다.
  '  6. 줄표(—, –, ㅡ)를 쓰지 마. 문장을 끊거나 쉼표를 쓴다.',
  '',
  '오직 JSON 객체 하나만 출력: {"text":"..."} 다른 말·마크다운 코드블록 금지.',
].join('\n');

/**
 * Threads 네이티브 카피 생성. 실패 시 폴백 텍스트 반환 (throw 하지 않음).
 * @returns {Promise<{text: string, ai: boolean}>}
 */
async function generateThreadsText(art, url) {
  if (!process.env.ANTHROPIC_API_KEY) return { text: stripDashes(fallbackText(art, url)), ai: false };

  /* 대화형 우선 (2026-07-21, 도메니코 요청). 기사에 "사람들이 이미 얘기하는
     거리"가 있으면 기사 소개 대신 말을 거는 글을 쓴다. 글감이 없으면 null 이
     돌아오고 아래 기존 경로로 간다 — 모든 기사에 쓰는 장치가 아니다. */
  try {
    const hook = await generateConversationalPost(
      { title: art.title, body: art.content, tags: art.tags, category: art.category },
      'threads');
    if (hook) {
      const text = (stripDashes(hook.text).slice(0, 430) + '\n\n' + url).slice(0, 500);
      console.log('[threadsAutopost] 대화형 (점수 ' + hook.score + '): ' + hook.angle);
      return { text, ai: true, conversational: true, angle: hook.angle, score: hook.score };
    }
  } catch (e) {
    console.warn('[threadsAutopost] 대화형 실패, 기본 카피로:', (e && e.message) || e);
  }

  try {
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
    const user = [
      '기사 제목: ' + String(art.title || ''),
      '카테고리: ' + String(art.category || ''),
      '',
      '기사 본문:',
      htmlToText(art.content, 1500),
    ].join('\n');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) throw new Error('Claude API ' + r.status);
    const j = await r.json();
    let raw = '';
    try { raw = String(j.content[0].text || '').trim(); } catch (_) { throw new Error('응답 형식 이상'); }
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    let parsed = null;
    try { parsed = JSON.parse(raw); }
    catch (_) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch (_) {} }
    }
    const body = parsed && String(parsed.text || '').trim();
    if (!body) throw new Error('빈 텍스트');
    // 본문(≤430자) + 빈 줄 + URL — 첫 URL이 링크 프리뷰 카드가 된다.
    const text = (stripDashes(body).slice(0, 430) + '\n\n' + url).slice(0, 500);
    return { text, ai: true };
  } catch (e) {
    console.error('[threadsAutopost] AI 카피 실패, 폴백 사용:', e && e.message);
    // 폴백은 기사 제목·첫 문장을 그대로 쓰므로 원문에 줄표가 있으면 딸려온다.
    return { text: stripDashes(fallbackText(art, url)), ai: false };
  }
}

/**
 * 기사 1건을 Threads 에 게시하고 threads_posts 에 기록한다.
 * 이미 게시된 기사(failed 제외)는 스킵. throw 하지 않는다.
 *
 * @param {{id, title, content, category, url}} art
 * @returns {Promise<{status: 'published'|'failed'|'skipped', thread_id?, detail?, text?, ai?}>}
 */
async function postArticleToThreads(art) {
  const { data: existing } = await supabaseAdmin
    .from('threads_posts')
    .select('id, status, attempts')
    .eq('article_id', art.id)
    .maybeSingle();
  if (existing && existing.status !== 'failed') {
    return { status: 'skipped', detail: '이미 게시됨' };
  }
  // 2026-07-23 — 재시도 상한. 같은 기사가 영구성 오류로 계속 실패하면
  // 10분마다 무한 재시도 + 6시간마다 실패 메일이 반복됐다 (제니 기사 실측).
  // 3회 실패한 기사는 건너뛴다 — 픽커의 done set 과 이중 방어.
  if (existing && existing.status === 'failed' && (existing.attempts || 0) >= 3) {
    return { status: 'skipped', detail: '실패 ' + existing.attempts + '회 — 재시도 상한 도달' };
  }

  const { text, ai } = await generateThreadsText(art, art.url);

  let threadId = null; let status = 'published'; let detail = null;
  try {
    threadId = await postText(text);
  } catch (err) {
    status = 'failed';
    detail = String(err && err.message || err).slice(0, 400);
  }
  const { error: upErr } = await supabaseAdmin.from('threads_posts').upsert({
    article_id: art.id, thread_id: threadId, status, detail,
    // 실패 시 시도 횟수 누적 (3회 도달 시 위의 상한 가드가 스킵)
    attempts: status === 'failed' ? ((existing && existing.attempts) || 0) + 1 : 1,
  }, { onConflict: 'article_id' });
  if (upErr) console.error('[threadsAutopost] threads_posts 기록 실패:', upErr.message);

  return { status, thread_id: threadId, detail, text, ai };
}

module.exports = { postArticleToThreads, generateThreadsText, fallbackText, stripDashes };
