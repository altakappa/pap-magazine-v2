/**
 * PAP Magazine - Translation API
 * Translates Korean review notes to professional English using Anthropic Claude API
 *
 * POST /api/translate
 * Body: { text: string, mode?: 'review' | 'general' }
 * Returns: { data: { translated: string } }
 */

const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { rateLimit } = require('../_lib/rateLimit');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// System prompts per mode
const SYSTEM_PROMPTS = {
  review: `You are a professional editorial review translator for PAP Magazine, a global fashion/beauty/culture digital magazine.

Your task: translate the given Korean review feedback into English.

Tone requirements:
- Professional and authoritative — you represent an established editorial team
- Kind but honest — deliver constructive feedback with warmth
- Clear and precise — no ambiguity in editorial decisions
- Use fashion/editorial industry terminology where appropriate

Format rules:
- Output ONLY the translated English text, nothing else
- Do not add any explanation, notes, or commentary
- Maintain the original structure (paragraphs, line breaks)
- If the text contains specific names, brand names, or proper nouns, keep them as-is`,

  general: `You are a professional translator for PAP Magazine.

Translate the given Korean text into natural, professional English.
Output ONLY the translated text, nothing else.
Maintain the original formatting and structure.`
};

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, { limit: 20, windowMs: 60 * 1000 })) return;

  // Admin only
  const user = await requireAdmin(req, res);
  if (!user) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate API key
  if (!ANTHROPIC_API_KEY) {
    console.error('[translate] ANTHROPIC_API_KEY not configured');
    return res.status(500).json({ error: 'Translation service not configured. Add ANTHROPIC_API_KEY to environment variables.' });
  }

  const { text, mode = 'review' } = req.body || {};

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Text is required' });
  }

  if (text.length > 5000) {
    return res.status(400).json({ error: 'Text too long (max 5000 characters)' });
  }

  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.review;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          { role: 'user', content: text.trim() }
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[translate] Anthropic API error:', response.status, errBody);
      return res.status(502).json({ error: 'Translation service error (' + response.status + ')' });
    }

    const result = await response.json();
    const translated = result.content && result.content[0] && result.content[0].text;

    if (!translated) {
      return res.status(502).json({ error: 'Empty translation response' });
    }

    return res.status(200).json({
      data: {
        translated: translated.trim(),
        source: 'ko',
        target: 'en',
        model: 'claude-sonnet-4-20250514',
      }
    });

  } catch (err) {
    console.error('[translate] Error:', err);
    return res.status(500).json({ error: 'Translation failed: ' + (err.message || 'Unknown error') });
  }
};
