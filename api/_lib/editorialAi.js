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

async function generateEditorialDescriptions({ title, artistStatement, imageUrls }) {
  const raw = (artistStatement || '').trim();
  if (!process.env.ANTHROPIC_API_KEY) {
    const slot = _guessLanguage(raw);
    return {
      kr: slot === 'kr' ? raw : '',
      en: slot === 'en' ? raw : '',
      it: slot === 'it' ? raw : '',
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
      '',
      'Tone for the translations: editorial, sensory, confident. Match the register of high-end fashion magazines (i-D, Dazed, Vogue Italia, Nylon). Avoid generic praise.',
      'Keep proper nouns, brand names, named subjects as-is in every language.',
      '',
      'Output ONLY a JSON object: {"kr": "<korean>", "en": "<english>", "it": "<italian>"}. No prose, no markdown fences.',
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
      };
    }
  }

  // ── Mode 2: no statement → vision-based generation ──
  const visionImages = (Array.isArray(imageUrls) ? imageUrls : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
    .slice(0, 3)
    .map((url) => ({ type: 'image', source: { type: 'url', url } }));

  if (visionImages.length === 0) {
    return { kr: '', en: '', it: '' };
  }

  const visionSystem = [
    'You are the editorial copywriter for PAP Magazine — a global fashion / beauty / culture publication.',
    'You will see an editorial title and a few of its key images. Write a short, evocative 3-4 sentence description for the editorial in THREE languages.',
    'Tone: editorial, sensory, confident. Avoid generic praise; describe what is visually distinctive (palette, mood, styling references, conceptual angle).',
    'Languages: Korean (kr), English (en), Italian (it). Each version must read natively — not a literal translation.',
    'Output ONLY a JSON object: {"kr": "<korean>", "en": "<english>", "it": "<italian>"}. No prose, no markdown fences.',
  ].join('\n');
  const visionUser = [
    { type: 'text', text: 'Editorial title: ' + String(title || '').trim() + '\n\nReference images:' },
    ...visionImages,
    { type: 'text', text: 'Write the JSON now.' },
  ];

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify({
        model,
        max_tokens: 1800,
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
    };
  } catch (err) {
    console.error('[editorialAi] vision-mode failed:', err && err.message);
    return { kr: '', en: '', it: '' };
  }
}

// Re-export the language guesser too — useful for the bulk endpoint to
// pick a fallback slot for legacy rows.
module.exports = { generateEditorialDescriptions, _guessLanguage };
