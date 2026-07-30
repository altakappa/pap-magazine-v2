/**
 * PAP Magazine — shared editorial AI generator.
 *
 * Extracted from api/submissions/[id]/review.js so it can be reused by:
 *   • The auto-stage-on-approve flow (existing user-submission path)
 *   • The "🤖 AI 자동 생성" button on the admin editorial editor
 *   • The bulk fill action for editorials that were created manually by
 *     admin and never had a submission to trigger auto-gen
 *
 * `generateEditorialDescriptions({ title, artistStatement, imageUrls })`
 * returns `{ kr, en, it }` — three editorial-tone strings ready to land in
 * `editorials.description` / `description_en` / the (IT) block of
 * `instagram_caption`.
 *
 * Mode 1 — submitter provided an artist statement
 *   Claude auto-detects the source language, keeps the original verbatim,
 *   and writes natural (non-literal) translations in the other two.
 *
 * Mode 2 — statement is blank
 *   Vision mode: Claude reads the first 3 images and the title, then
 *   writes a fresh 3-4 sentence editorial blurb in all three languages.
 *
 * Failures degrade gracefully — when Claude is unreachable or
 * ANTHROPIC_API_KEY isn't configured, the function returns whatever raw
 * statement is available stashed in its guessed-language slot, so the
 * editorial isn't left with nothing.
 */

/* Anthropic 장애(크레딧 소진·키 오류)를 원인 단계에서 텔레그램으로 알린다.
   2026-07-30: 크레딧이 4시간 비어 서술문 생성이 0건이었는데 아무 알림도 없었다. */
const { reportAiResponse } = require('./aiCreditWatch');
// 매직바이트 판별 — 업로드 검증에서 쓰던 것을 재사용한다(의존 없는 순수 모듈).
const { sniffMime } = require('./fileSignature');

/* 이미지를 서버에서 직접 받아 base64 블록으로 만든다.
 *
 * 왜 URL 전달을 버렸나 (2026-07-30 근본원인 규명):
 *   Claude 의 `source:{type:'url'}` 은 "바로 이미지 바이트를 주는 URL" 만 받는다.
 *   우리 발행분 상당수의 cover_image 는 `drive.google.com/thumbnail?id=…` 인데
 *   이건 googleusercontent 로 리다이렉트되는 링크라 Claude 쪽에서 가져오지 못하고
 *   호출 전체가 죽는다. 실측: 최근 12시간 실패 293건 중 269건(92%)이 드라이브 URL,
 *   성공 21건은 전부 S3·wixstatic 직링크였다. 이미지 자체는 공개이며 브라우저에서
 *   1600×2071 로 정상 로드된다 — 문제는 링크 형태였다.
 *   → 서버(Vercel)는 CORS·리다이렉트 제약이 없으니 우리가 받아서 인라인으로 넘긴다.
 *
 * 안전장치: 지원 포맷만(jpeg/png/gif/webp) · 장당 4MB 상한 · 8초 타임아웃 ·
 *   개별 실패는 건너뛰고 나머지로 진행(한 장도 못 받으면 호출을 아예 하지 않는다).
 */
const _VISION_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const _MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** 드라이브 썸네일은 폭을 낮춰 base64 payload 를 줄인다(서술문 생성엔 충분한 해상도). */
function _slimUrl(url) {
  if (/drive\.google\.com\/thumbnail/i.test(url)) {
    return url.replace(/([?&])sz=w\d+/i, '$1sz=w1024');
  }
  return url;
}

/* 이미지 한 장을 비전 블록으로. 못 쓰면 null + 사유 로그.
 *
 * 2026-07-30 두 가지를 고쳤다. 20편이 3회 시도를 다 쓰고 영구 제외됐는데,
 * 로그가 한 줄도 없어 원인을 못 찾던 상태였다:
 *
 *  ① 조용한 실패 — 여기서 null 을 반환하면 호출부(_toVisionBlocks)가 걸러내고,
 *     전부 걸러지면 generateEditorialDescriptions 가 빈 결과를 '정상' 으로
 *     반환한다. 예외도 로그도 없어 크론은 그냥 empty++ 만 세고 넘어갔다.
 *     → 거부할 때마다 사유(status/type/size)를 남긴다. 오늘 세 번 반복한
 *       교훈이다 — 관측되지 않는 실패는 존재하지 않는 것처럼 보인다.
 *
 *  ② Content-Type 만 믿던 것 — 레거시 S3 버킷(pap-korea-bucket)에 올라간
 *     오래된 이미지는 ContentType 지정 없이 업로드돼 binary/octet-stream 으로
 *     내려온다. 브라우저는 매직바이트를 스니핑해 멀쩡히 렌더하므로 사람 눈에는
 *     정상이고, 서버만 조용히 거부했다. 실패 20편 중 13편이 이 버킷이다.
 *     → 헤더가 쓸모없으면 매직바이트로 판별한다. 판별기는 이미 저장소에 있다
 *       (_lib/fileSignature.sniffMime — 업로드 검증에서 검증된 코드).
 *     헤더를 무시하는 게 아니라 '헤더가 이미지 타입이 아닐 때만' 스니핑하므로,
 *     위장 파일이 통과하는 게 아니라 오히려 실제 바이트로 확인하는 셈이다. */
async function _fetchImageBlock(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  const _skip = (why) => { console.warn('[editorialAi] 이미지 제외', why, String(url).slice(0, 120)); return null; };
  try {
    const resp = await fetch(_slimUrl(url), { redirect: 'follow', signal: ctl.signal });
    if (!resp.ok) return _skip('http=' + resp.status);
    let type = String(resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (type === 'image/jpg') type = 'image/jpeg';           // 비표준 별칭
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) return _skip('빈 응답');
    if (buf.length > _MAX_IMAGE_BYTES) return _skip('용량 ' + Math.round(buf.length / 1048576) + 'MB');
    if (!_VISION_TYPES.has(type)) {
      const sniffed = sniffMime(buf);                        // 헤더가 못 미더우면 실제 바이트로
      if (!_VISION_TYPES.has(sniffed)) return _skip('타입 ' + (type || '없음') + '/sniff=' + (sniffed || '불명'));
      type = sniffed;
    }
    return { type: 'image', source: { type: 'base64', media_type: type, data: buf.toString('base64') } };
  } catch (e) {
    return _skip('fetch 실패: ' + String((e && e.message) || e).slice(0, 60));
  } finally {
    clearTimeout(timer);
  }
}

async function _toVisionBlocks(imageUrls) {
  const urls = (Array.isArray(imageUrls) ? imageUrls : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
    .slice(0, 3);
  if (!urls.length) return [];
  const blocks = await Promise.all(urls.map(_fetchImageBlock));
  return blocks.filter(Boolean);
}

// Same lightweight heuristic the review handler used. Detects Korean
// hangul / Italian-specific diacritics; everything else defaults to en.
function _guessLanguage(text) {
  const s = String(text || '');
  if (!s) return 'en';
  if (/[가-힯]/.test(s)) return 'kr';
  // Italian-specific diacritics that don't show up in EN/KR
  if (/[àèéìòùÀÈÉÌÒÙ]/.test(s)) return 'it';
  return 'en';
}

/* longForm (2026-07-28, GEO 감사):
 *   기본 비전 프롬프트는 "3-4 sentence" 라 한국어 80~110자가 나온다. 인스타 캡션엔
 *   맞지만 AI 검색엔진이 인용할 본문으로는 너무 짧다(실측: 이 길이로 채워진 행이
 *   120자 기준에 계속 미달해 백필이 헛돌았다). longForm=true 면 300자 이상의
 *   서술을 요청한다. credits 를 함께 넘기면 브랜드·태그 같은 실제 고유명사를
 *   본문에 넣어 검색·인용 대상이 되게 한다.
 *   ★ 근거 없는 사실(촬영지·인물·시즌)은 지어내지 않는다 — 프롬프트에 명시.
 *   기존 호출부는 두 인자를 넘기지 않으므로 동작이 바뀌지 않는다.
 */
async function generateEditorialDescriptions({ title, artistStatement, imageUrls, longForm, credits }) {
  const raw = (artistStatement || '').trim();
  if (!process.env.ANTHROPIC_API_KEY) {
    const slot = _guessLanguage(raw);
    return {
      kr: slot === 'kr' ? raw : '',
      en: slot === 'en' ? raw : '',
      it: slot === 'it' ? raw : '',
      hook: '', moodTag: '',
    };
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const apiUrl = 'https://api.anthropic.com/v1/messages';
  const commonHeaders = {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  };

  function _pickText(result) {
    if (!result || !Array.isArray(result.content)) return '';
    const block = result.content.find((b) => b && typeof b.text === 'string');
    return block ? block.text.trim() : '';
  }

  function _parseJson(text) {
    if (!text) return null;
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try { return JSON.parse(stripped); } catch (_) { return null; }
  }

  // ── Mode 1: artist statement present → auto-detect + fill 3 languages ──
  if (raw) {
    const system = [
      'You are an editorial translator for PAP Magazine — a global fashion / beauty / culture publication.',
      '',
      'You will receive an editorial description written by the submitting crew. The source language could be English, Korean, or Italian (most often English).',
      '',
      'Your task:',
      '  1. Detect the source language.',
      '  2. Keep the original text VERBATIM in its detected language slot.',
      '  3. Write a NATURAL translation (not a literal one) in each of the other two languages — Korean (kr), English (en), Italian (it).',
      '  4. Write "hook": ONE short Korean line for the very top of the Instagram caption. It must stop the scroll with a fact or striking image from the editorial, in plain confident Korean. NO exclamation marks, NO clickbait, NO "이것 좀 봐" style. Good example: "인류가 사라진 지구에, 여왕이 내려왔다."',
      '  5. Write "moodTag": ONE Korean hashtag word (no #) that Korean fashion fans would actually search for this editorial\'s mood/genre, e.g. "사이버펑크", "올드머니룩", "아방가르드".',
      '',
      'Tone for the translations: editorial, sensory, confident. Match the register of high-end fashion magazines (i-D, Dazed, Vogue Italia, Nylon). Avoid generic praise.',
      'The Korean (kr) version must read like a Korean fashion editor wrote it — flowing connectives (~인데, ~하고), never literal translationese.',
      'Keep proper nouns, brand names, named subjects as-is in every language.',
      '',
      'Output ONLY a JSON object: {"kr": "<korean>", "en": "<english>", "it": "<italian>", "hook": "<korean one-liner>", "moodTag": "<korean tag word>"}. No prose, no markdown fences.',
    ].join('\n');
    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          system,
          messages: [{ role: 'user', content: raw }],
        }),
      });
      if (!resp.ok) { await reportAiResponse(resp, 'editorialAi.statement'); throw new Error('Claude ' + resp.status); }
      const parsed = _parseJson(_pickText(await resp.json())) || {};
      const out = {
        kr: String(parsed.kr || '').trim(),
        en: String(parsed.en || '').trim(),
        it: String(parsed.it || '').trim(),
        hook: String(parsed.hook || '').trim(),
        moodTag: String(parsed.moodTag || '').trim(),
      };
      if (!out.kr && !out.en && !out.it) {
        const slot = _guessLanguage(raw);
        out[slot] = raw;
      }
      return out;
    } catch (err) {
      console.error('[editorialAi] translate-mode failed:', err && err.message);
      const slot = _guessLanguage(raw);
      return {
        kr: slot === 'kr' ? raw : '',
        en: slot === 'en' ? raw : '',
        it: slot === 'it' ? raw : '',
        hook: '', moodTag: '',
      };
    }
  }

  // ── Mode 2: no statement → vision-based generation ──
  const visionImages = await _toVisionBlocks(imageUrls);

  if (visionImages.length === 0) {
    /* 2026-07-30 — 여기가 20편을 조용히 태워먹던 자리다. 이미지가 전부 걸러지면
       예외도 없이 빈 결과를 반환했고, 크론은 그걸 '시도했으나 못 만듦' 으로만
       세서 3회 만에 영구 제외했다. 원인이 로그에 없으니 손쓸 방법도 없었다. */
    console.warn('[editorialAi] 비전 이미지 0장 — 생성 불가',
      (Array.isArray(imageUrls) ? imageUrls.slice(0, 3) : []).map((u) => String(u).slice(0, 100)));
    return { kr: '', en: '', it: '', hook: '', moodTag: '' };
  }

  const _lengthRule = longForm
    ? 'Write a substantial description of AT LEAST 5 sentences — the Korean version must be 300+ characters, the English 350+ characters. This text is the page body that search engines and AI assistants quote, so it must stand on its own as readable prose.'
    : 'Write a short, evocative 3-4 sentence description for the editorial in THREE languages.';
  const visionSystem = [
    'You are the editorial copywriter for PAP Magazine — a global fashion / beauty / culture publication.',
    'You will see an editorial title and a few of its key images. ' + _lengthRule + ' Produce all THREE languages.',
    'Tone: editorial, sensory, confident. Avoid generic praise; describe what is visually distinctive (palette, mood, styling references, conceptual angle).',
    ...(longForm ? [
      'Ground every sentence in what is actually visible in the images, or in the credits given below. NEVER invent facts you cannot see — no photographer or model names, no shoot location, no season or collection year, no brand names that are not in the credits. Inventing such facts is worse than a shorter description.',
      'Where credits are supplied, weave those brand names naturally into the prose (they are what readers search for). Also name concrete visual specifics: colour palette, fabric and silhouette, light quality, setting type, and the styling genre.',
    ] : []),
    'Languages: Korean (kr), English (en), Italian (it). Each version must read natively — not a literal translation. The Korean version must read like a Korean fashion editor wrote it — flowing connectives (~인데, ~하고), never translationese.',
    'Also write "hook": ONE short Korean line for the very top of the Instagram caption. It must stop the scroll with a fact or striking image from the editorial, in plain confident Korean. NO exclamation marks, NO clickbait. Good example: "인류가 사라진 지구에, 여왕이 내려왔다."',
    'Also write "moodTag": ONE Korean hashtag word (no #) Korean fashion fans would search for this mood/genre, e.g. "사이버펑크", "올드머니룩", "아방가르드".',
    'Output ONLY a JSON object: {"kr": "<korean>", "en": "<english>", "it": "<italian>", "hook": "<korean one-liner>", "moodTag": "<korean tag word>"}. No prose, no markdown fences.',
  ].join('\n');
  const _creditLine = (function () {
    const c = credits && typeof credits === 'object' ? credits : null;
    if (!c) return '';
    const brands = Array.isArray(c.brands)
      ? c.brands.map((b) => String((b && (b.name || b.instagram)) || '').replace(/^@/, '').trim())
          .filter(Boolean).slice(0, 20)
      : [];
    const tags = Array.isArray(c.tags) ? c.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10) : [];
    const parts = [];
    if (brands.length) parts.push('Brands featured (use these exact names): ' + brands.join(', '));
    if (tags.length) parts.push('Tags: ' + tags.join(', '));
    return parts.length ? '\n\n' + parts.join('\n') : '';
  })();
  const visionUser = [
    { type: 'text', text: 'Editorial title: ' + String(title || '').trim() + _creditLine + '\n\nReference images:' },
    ...visionImages,
    { type: 'text', text: 'Write the JSON now.' },
  ];

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify({
        model,
        // longForm 은 3개 언어 × 300자+ 라 1800 으로는 잘릴 수 있다(잘리면 JSON
        // 파싱이 실패해 빈 결과가 되고, 그 행은 시도 횟수만 소진한다)
        max_tokens: longForm ? 3000 : 1800,
        system: visionSystem,
        messages: [{ role: 'user', content: visionUser }],
      }),
    });
    if (!resp.ok) { await reportAiResponse(resp, 'editorialAi.vision'); throw new Error('Claude ' + resp.status); }
    const parsed = _parseJson(_pickText(await resp.json())) || {};
    return {
      kr: String(parsed.kr || '').trim(),
      en: String(parsed.en || '').trim(),
      it: String(parsed.it || '').trim(),
      hook: String(parsed.hook || '').trim(),
      moodTag: String(parsed.moodTag || '').trim(),
    };
  } catch (err) {
    console.error('[editorialAi] vision-mode failed:', err && err.message);
    return { kr: '', en: '', it: '', hook: '', moodTag: '' };
  }
}

// Re-export the language guesser too — useful for the bulk endpoint to
// pick a fallback slot for legacy rows.
module.exports = { generateEditorialDescriptions, _guessLanguage };
