/**
 * POST /api/admin/editorials/:id/generate-tags — AI auto-generate 5-10
 * keyword hashtags from the editorial's title, description, and the
 * first 3 gallery images.
 *
 * QA #272. Mirrors the auto-generate-description flow:
 *   • Loads the editorial row from DB.
 *   • Accepts a `currentTitle`, `currentDescription`, `currentGallery`
 *     override in the body so the admin can preview tags BEFORE saving
 *     the form (same pattern as QA #264 for fashion brands).
 *   • Sends to Claude with a strict prompt for English mood/style/genre
 *     keywords (short, single-word preferred, lowercase).
 *   • Returns { tags: [string], rawResponse: string }.
 *
 * Body:
 *   {
 *     overwrite?: boolean,    // default false — return suggestions only,
 *                              //  don't write to DB
 *     currentTitle?: string,
 *     currentDescription?: string,
 *     currentGallery?: string[]
 *   }
 *
 * Security: requireAdmin (any admin role).
 * Rate limit: same RATE_LIMITS.api bucket.
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { requireAdmin } = require('../../../_lib/auth');
const { handleCors } = require('../../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../../_lib/rateLimit');

// Sanitize a single tag: lowercase, strip leading '#', collapse spaces,
// drop punctuation that doesn't belong in a hashtag.
function _normalizeTag(s) {
  if (!s) return '';
  var t = String(s).trim().toLowerCase();
  t = t.replace(/^#+/, '');
  t = t.replace(/[^a-z0-9가-힯\- ]/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  // Multi-word tags allowed (e.g. "street style"); we don't force them
  // to single words because some moods are inherently two words.
  return t;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await requireAdmin(req, res);
  if (!user) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'editorial id is required' });

  const body = req.body || {};
  const overwrite = !!body.overwrite;

  // 1) Load editorial row.
  const { data: ed, error: loadErr } = await supabaseAdmin
    .from('editorials')
    .select('id, title, description, description_en, gallery, tags')
    .eq('id', id)
    .single();
  if (loadErr || !ed) {
    return res.status(404).json({ error: 'Editorial not found' });
  }

  // 2) Resolve effective content (form overrides win).
  const title = (typeof body.currentTitle === 'string' && body.currentTitle.trim())
    ? body.currentTitle.trim()
    : (ed.title || '');
  const descRaw = (typeof body.currentDescription === 'string' && body.currentDescription.trim())
    ? body.currentDescription.trim()
    : ((ed.description_en && ed.description_en.trim()) || (ed.description || ''));
  const gallery = (Array.isArray(body.currentGallery) && body.currentGallery.length)
    ? body.currentGallery
    : (Array.isArray(ed.gallery) ? ed.gallery : []);

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' });
  }
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  // 3) Build messages array. If gallery is non-empty, send the first 3
  //    images as vision content blocks so Claude can see the mood. Text
  //    block carries the title + description.
  const sampleImages = gallery.slice(0, 3).filter(Boolean);
  const contentBlocks = [];
  for (let i = 0; i < sampleImages.length; i++) {
    contentBlocks.push({
      type: 'image',
      source: { type: 'url', url: sampleImages[i] },
    });
  }
  const promptText = [
    'You are tagging a fashion editorial on PAP Magazine.',
    'Suggest 5 to 10 lowercase English keyword hashtags that capture the editorial\'s mood, style, era, color palette, vibe, or subject matter.',
    '',
    'Rules:',
    '- Lowercase only.',
    '- 1–2 word tags (prefer single words).',
    '- No leading # in your output.',
    '- No special characters except letters / numbers / spaces / hyphens.',
    '- Prefer commonly-searched style descriptors: bold, dark, moody, retro, futuristic, minimal, maximalist, monochrome, romantic, ethereal, grunge, glam, sport, streetwear, vintage, surreal, soft, raw, editorial, beauty, etc.',
    '- Mix style keywords with concrete subject keywords visible in the photos (e.g. "metallic", "florals", "denim", "leather").',
    '- DO NOT include the editorial title or photographer names.',
    '- DO NOT invent tags that don\'t reflect the source content.',
    '',
    'Output: a single JSON array of strings, nothing else (no markdown fences).',
    'Example: ["bold","colorful","streetwear","metallic","y2k","editorial"]',
    '',
    'Editorial title: ' + title,
    descRaw ? ('Description: ' + descRaw.slice(0, 3000)) : '(no description provided)',
  ].join('\n');
  contentBlocks.push({ type: 'text', text: promptText });

  // 4) Call Claude.
  let claudeJson;
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1000,
        messages: [{ role: 'user', content: contentBlocks }],
      }),
    });
    if (!apiRes.ok) {
      const errBody = await apiRes.text().catch(() => '');
      console.error('[generate-tags] Claude error:', apiRes.status, errBody);
      return res.status(502).json({ error: 'Claude API 호출 실패 (' + apiRes.status + ').' });
    }
    claudeJson = await apiRes.json();
  } catch (e) {
    console.error('[generate-tags] fetch threw:', e && e.message ? e.message : e);
    return res.status(502).json({ error: 'Claude API 연결 실패' });
  }

  // 5) Parse JSON array from Claude's text response.
  let raw = '';
  try {
    raw = String(claudeJson.content[0].text || '').trim();
  } catch (_) {
    return res.status(502).json({ error: 'Claude 응답 형식이 예상과 다릅니다.' });
  }
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Fallback: try extracting the first JSON array substring.
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch (_) { parsed = null; }
    }
    if (!parsed) {
      console.error('[generate-tags] JSON parse failed. Raw:', raw.slice(0, 500));
      return res.status(502).json({ error: 'Claude가 반환한 JSON을 파싱할 수 없습니다.' });
    }
  }

  if (!Array.isArray(parsed)) {
    return res.status(502).json({ error: 'Claude 응답이 배열이 아닙니다.' });
  }

  // 6) Normalize, dedupe, cap to 10.
  const seen = new Set();
  const tags = [];
  for (let i = 0; i < parsed.length && tags.length < 10; i++) {
    const t = _normalizeTag(parsed[i]);
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    tags.push(t);
  }
  if (tags.length < 5) {
    // Not enough tags returned — still return what we have but warn.
    console.warn('[generate-tags] returned only', tags.length, 'tags');
  }

  // 7) Write to DB if overwrite=true. Otherwise just return suggestions.
  let written = false;
  if (overwrite) {
    const { error: updErr } = await supabaseAdmin
      .from('editorials')
      .update({ tags: tags, updated_by: user.id })
      .eq('id', id);
    if (updErr) {
      console.error('[generate-tags] DB update failed:', updErr);
      return res.status(500).json({ error: 'DB 업데이트 실패' });
    }
    written = true;
  }

  return res.status(200).json({ tags: tags, written: written });
};
