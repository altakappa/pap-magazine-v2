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
      if (!resp.ok) throw new Error('Claude ' + resp.status);
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
  const visionImages = (Array.isArray(imageUrls) ? imageUrls : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
    .slice(0, 3)
    .map((url) => ({ type: 'image', source: { type: 'url', url } }));

  if (visionImages.length === 0) {
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
    if (!resp.ok) throw new Error('Claude ' + resp.status);
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
