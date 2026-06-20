/**
 * POST /api/admin/editorials/parse-credits-pdf — Extract structured
 * editorial credits + fashion brand list from a PDF transcript.
 *
 * QA #262. The editor's workflow before this endpoint required them to
 * type every credit row by hand (Photographer / Stylist / MUA / Hair /
 * Set Designer / Model + each handle), which was the slowest part of
 * uploading an editorial. Contributing teams already produce a credit
 * sheet PDF for every editorial — this endpoint reads that PDF text and
 * returns the same JSON shape the admin form already accepts, so the
 * editor can click one button and have the entire credits section
 * filled in.
 *
 * The PDF parsing itself happens client-side via pdf.js (text layer
 * extraction is fast and runs entirely in the browser; no server
 * upload of the PDF binary). This endpoint only sees the extracted
 * text — never the raw file.
 *
 * Body:
 *   { text: string }   // extracted PDF text content (pdf.js .getTextContent)
 *
 * Returns:
 *   {
 *     credits: [{ roles: [string], name: string, instagram: string }],
 *     brands:  [{ name: string,    instagram: string }],
 *     lookCredits: [{ index: number, text: string }],  // QA #263 — per-image
 *                                                       // outfit lines, 1-based
 *     warnings: [string]
 *   }
 *
 * Security: requireAdmin (any admin role can use this).
 * Rate limit: same `RATE_LIMITS.api` bucket as other admin POSTs.
 */

const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

// Roles the credits area dropdown understands. Anything Claude returns
// outside this list will be passed through verbatim (the form supports
// free-text custom roles, so editors can still see them) but they get
// flagged in the warnings list so the editor knows to double-check.
const KNOWN_ROLES = [
  'Photographer', 'Stylist', 'Stylist Assistant',
  'Hair', 'Hair Assistant',
  'Makeup', 'Makeup Assistant',
  'Nails',
  'Set Designer', 'Set Designer Assistant',
  'Production', 'Producer',
  'Casting', 'Casting Director',
  'Creative Direction', 'Art Direction',
  'Model', 'Models',
  'Agency',
  'Photographer Assistant',
  'Retouch', 'Post Production',
  'Editor',
];

function _normalizeHandle(s) {
  if (!s) return '';
  var t = String(s).trim();
  // Strip URL prefix forms; keep just the trailing handle.
  t = t.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
  t = t.replace(/^@+/, '');
  t = t.replace(/\/+$/, '');
  // Whitespace inside a handle isn't possible — anything after the first
  // space is probably a stray label.
  t = t.split(/\s+/)[0];
  return t ? '@' + t : '';
}

function _coerceCredit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var roles;
  if (Array.isArray(raw.roles)) {
    roles = raw.roles.map(function(r){ return String(r || '').trim(); }).filter(Boolean);
  } else if (raw.role) {
    roles = [String(raw.role).trim()];
  } else {
    roles = [];
  }
  var name = String(raw.name || '').trim();
  var ig   = _normalizeHandle(raw.instagram || raw.ig || raw.handle || '');
  if (!name && !ig && !roles.length) return null;
  return { roles: roles, name: name, instagram: ig };
}

function _coerceBrand(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var name = String(raw.name || '').trim();
  var ig   = _normalizeHandle(raw.instagram || raw.ig || raw.handle || '');
  if (!name && !ig) return null;
  return { name: name, instagram: ig };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await requireAdmin(req, res);
  if (!user) return;

  const text = String((req.body && req.body.text) || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'PDF에서 추출된 텍스트가 비어 있습니다.' });
  }
  // Hard cap so a hostile or malformed PDF can't burn through quota.
  // 60k chars is roughly 20 pages of credit-sheet text — way more than
  // any real editorial needs.
  const HARD_CAP = 60 * 1024;
  const truncated = text.length > HARD_CAP ? text.slice(0, HARD_CAP) : text;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다. Vercel 환경변수를 확인해주세요.',
    });
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const prompt = [
    'You are parsing an editorial credit sheet PDF transcript for PAP Magazine.',
    'Extract the production credits and fashion brand list, then return ONLY a JSON object.',
    '',
    'Rules:',
    '- Each credit person → one entry with { roles: [...], name: "...", instagram: "@handle" }.',
    '- `roles` is an array because some people wear multiple hats (e.g. ["Creative Direction", "Stylist"]).',
    '- Use these canonical role names when possible: ' + KNOWN_ROLES.join(', ') + '.',
    '- If a role is unusual (e.g. "Choreographer"), keep it verbatim.',
    '- If a credit row lists multiple models / agencies, output one entry per model with role "Model" and the agency in a parallel "Agency" entry IF the agency is clearly named.',
    '- Instagram handles: keep the leading @ and use only the handle (no URLs).',
    '- If a handle is missing, leave `instagram` as empty string "".',
    '- Brands list → { name: "BrandName", instagram: "@handle_if_known" }. Treat fashion houses + accessory brands the same.',
    '- DO NOT invent handles you do not see in the text.',
    '- DO NOT include the editorial title, location, or photographer studio names in the brand list.',
    '',
    'QA #263 — per-image outfit credits:',
    '- The PDF may contain "LOOK 1 / LOOK 2 / ..." or "Image 1 / Image 2 / ..." or "#1 / #2 / ..." sections listing what the model wears in each image.',
    '- For each such section, output one entry in `lookCredits` with the 1-based image index and a SHORT comma-separated text string in the format expected by the gallery: "@brand1 Jacket, @brand2 Pants, @brand3 Shoes".',
    '- Use @handles when available, otherwise just the brand name. Capitalise item names (Jacket, not jacket).',
    '- If no per-look section exists in the PDF, return `lookCredits: []`.',
    '',
    'Output format (and nothing else — no prose, no markdown fences):',
    '{',
    '  "credits": [{"roles": ["Photographer"], "name": "Full Name", "instagram": "@handle"}, ...],',
    '  "brands":  [{"name": "Balenciaga", "instagram": "@balenciaga"}, ...],',
    '  "lookCredits": [{"index": 1, "text": "@balenciaga Jacket, @prada Bag"}, ...]',
    '}',
    '',
    'PDF transcript:',
    '---',
    truncated,
    '---',
  ].join('\n');

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
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!apiRes.ok) {
      const errBody = await apiRes.text().catch(function(){ return ''; });
      console.error('[parse-credits-pdf] Claude API error:', apiRes.status, errBody);
      return res.status(502).json({
        error: 'Claude API 호출 실패 (' + apiRes.status + '). 잠시 후 다시 시도해주세요.',
      });
    }
    claudeJson = await apiRes.json();
  } catch (e) {
    console.error('[parse-credits-pdf] fetch threw:', e && e.message ? e.message : e);
    return res.status(502).json({ error: 'Claude API에 연결할 수 없습니다.' });
  }

  // Claude messages API → first content block's text → must be JSON.
  let raw = '';
  try {
    raw = String(claudeJson.content[0].text || '').trim();
  } catch (_) {
    return res.status(502).json({ error: 'Claude 응답이 예상 형식이 아닙니다.' });
  }
  // Drop any defensive markdown fences just in case.
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[parse-credits-pdf] JSON parse failed. Raw:', raw.slice(0, 500));
    return res.status(502).json({
      error: 'Claude가 반환한 JSON을 파싱할 수 없습니다. PDF 내용이 너무 비정형일 수 있습니다.',
    });
  }

  // Coerce + filter.
  const credits = Array.isArray(parsed.credits)
    ? parsed.credits.map(_coerceCredit).filter(Boolean)
    : [];
  const brands  = Array.isArray(parsed.brands)
    ? parsed.brands.map(_coerceBrand).filter(Boolean)
    : [];
  // QA #263 — per-image outfit lines. Coerce to { index, text } where
  // index is 1-based positive integer and text is the trimmed string.
  const lookCredits = Array.isArray(parsed.lookCredits)
    ? parsed.lookCredits.map(function(l){
        if (!l || typeof l !== 'object') return null;
        const idx = parseInt(l.index, 10);
        const txt = String(l.text || '').trim();
        if (!idx || idx < 1 || !txt) return null;
        return { index: idx, text: txt };
      }).filter(Boolean)
    : [];

  // Warnings for unknown role values so the editor double-checks them.
  const warnings = [];
  const knownLower = KNOWN_ROLES.map(function(r){ return r.toLowerCase(); });
  credits.forEach(function(c) {
    (c.roles || []).forEach(function(r){
      if (r && knownLower.indexOf(String(r).toLowerCase()) === -1) {
        warnings.push('알 수 없는 역할: "' + r + '" (' + (c.name || '이름 없음') + ')');
      }
    });
  });
  if (!credits.length && !brands.length && !lookCredits.length) {
    warnings.push('PDF에서 크레딧을 찾지 못했습니다. 텍스트 레이어가 비어 있거나 스캔 이미지 PDF일 가능성이 있습니다.');
  }

  return res.status(200).json({
    credits: credits,
    brands:  brands,
    lookCredits: lookCredits,
    warnings: warnings,
  });
};
