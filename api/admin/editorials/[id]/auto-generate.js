/**
 * POST /api/admin/editorials/:id/auto-generate — AI-fill description +
 * description_en + instagram_caption for an editorial that was either
 * created manually by admin (no source submission to trigger the
 * approve-time auto-gen) or got auto-gen earlier but came back empty.
 *
 * QA #184 — main-admin gated. The flow:
 *   1. Load editorial by id (+ source submission's description if linked,
 *      so a stylist-written artistStatement still drives the translation
 *      path instead of the vision-only fallback).
 *   2. Call generateEditorialDescriptions(title, artistStatement, gallery)
 *      from the shared lib. Returns { kr, en, it }.
 *   3. Stitch the IG caption together: editorial header + team credits
 *      from editorial.credits + (KR)/(EN)/(IT) blocks + permalink + brand
 *      handles from editorial.fashion.
 *   4. UPDATE editorials. `overwrite=false` (default) only fills blank
 *      slots; `overwrite=true` replaces existing content.
 *
 * Body: { overwrite?: boolean = false }
 * Returns: { description, description_en, instagram_caption,
 *            fieldsUpdated: { description: bool, description_en: bool,
 *                              instagram_caption: bool } }
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { requireAdmin } = require('../../../_lib/auth');
const { handleCors } = require('../../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../../_lib/rateLimit');
const { generateEditorialDescriptions } = require('../../../_lib/editorialAi');

// Same IG header constants as the submission-approval path so the
// auto-fill caption matches the in-house style exactly.
const _IG_PUBLISHER_HANDLE = '@kangdm';
const _IG_HOUSE_HANDLE     = '@pap_magazine';
const _IG_SEPARATOR        = '————- ';
const _IG_SITE_BASE        = 'https://www.pap-magazine.com/editorial/';

function _normalizeIgHandle(s) {
  let h = String(s || '').trim();
  if (!h) return '';
  // Strip URL scheme + domain — pull out the last path segment.
  const m = h.match(/instagram\.com\/+([A-Za-z0-9_.]+)/i);
  if (m) h = m[1];
  if (h[0] !== '@') h = '@' + h.replace(/^@+/, '');
  return h.replace(/\s/g, '');
}

function _normalizeRoleLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'Credit';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function _slugify(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'editorial';
}

// Build the IG caption from EDITORIAL-shape data (credits[] + fashion).
// Differs from review.js's _buildInstagramCaption which works on
// SUBMISSION shape (desc.team / desc.looks / desc.models). The two
// rendering styles are kept in sync visually but operate on different
// inputs.
function _buildCaptionFromEditorial(ed, descKr, descEn, descIt) {
  const lines = [];
  const title = String(ed.title || '').trim() || 'Untitled';
  const slug  = (ed.slug && String(ed.slug).trim()) || _slugify(title);

  // ── 1) Header ──
  lines.push(`'${title}' exclusive for ${_IG_HOUSE_HANDLE} published by ${_IG_PUBLISHER_HANDLE} ㅡ link in bio`);
  lines.push('');

  // ── 2) Credits — single line "Role @handle Role @handle …" ──
  lines.push(_IG_SEPARATOR);
  const credits = Array.isArray(ed.credits) ? ed.credits : [];
  const creditParts = [];
  const starringParts = [];
  credits.forEach((c) => {
    if (!c || !c.name) return;
    const handle = _normalizeIgHandle(c.instagram || c.website || '');
    if (!handle) return;
    const roles = Array.isArray(c.roles) ? c.roles : (c.roles ? [c.roles] : []);
    const role = (roles[0] || c.role || 'Credit');
    // Models go on a separate "Starring" line so the IG-style template
    // matches the submission-approval output.
    if (/^(model|starring|talent|cast)/i.test(role)) {
      starringParts.push(handle);
    } else {
      creditParts.push(`${_normalizeRoleLabel(role)} ${handle}`);
    }
  });
  if (creditParts.length) lines.push(creditParts.join(' '));
  if (starringParts.length) {
    if (creditParts.length) lines.push('');
    lines.push('Starring ' + starringParts.join(' '));
  }
  lines.push('');

  // ── 3) Tri-lingual descriptions ──
  lines.push(_IG_SEPARATOR);
  lines.push('(KR) ' + (descKr || '').trim());
  lines.push('');
  lines.push('(EN) ' + (descEn || '').trim());
  lines.push('');
  lines.push('(IT) ' + (descIt || '').trim());
  lines.push('');

  // ── 4) Permalink ──
  lines.push(_IG_SEPARATOR);
  lines.push('Full Story link🔎');
  lines.push(_IG_SITE_BASE + slug);
  lines.push('');

  // ── 5) Brands (deduped) ──
  const fashion = (ed.fashion && typeof ed.fashion === 'object') ? ed.fashion : {};
  const brands = Array.isArray(fashion.brands) ? fashion.brands : [];
  const seen = new Set();
  const brandHandles = [];
  brands.forEach((b) => {
    if (!b) return;
    const h = _normalizeIgHandle(b.instagram || b.name || '');
    if (!h) return;
    const k = h.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    brandHandles.push(h);
  });
  if (brandHandles.length) lines.push('Fashion by ' + brandHandles.join(' '));

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Admin (both tiers) can trigger — this is a content-fill action, not
  // a status change, so staff don't need to wait on main admin.
  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ message: 'Missing editorial id' });

    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
    }
    const overwrite = body.overwrite === true;

    // 1) Load editorial
    const { data: ed, error: loadErr } = await supabaseAdmin
      .from('editorials')
      .select('*')
      .eq('id', id)
      .single();
    if (loadErr || !ed) {
      return res.status(404).json({ message: 'Editorial not found' });
    }

    // 2) If editorial was staged from a submission, pull the original
    // artistStatement so translate-mode (better quality) wins over
    // vision-only mode (no source text to anchor the prose).
    let artistStatement = '';
    if (ed.source_submission_id) {
      try {
        const { data: sub } = await supabaseAdmin
          .from('submissions')
          .select('description')
          .eq('id', ed.source_submission_id)
          .single();
        if (sub && sub.description) {
          const desc = typeof sub.description === 'string'
            ? JSON.parse(sub.description)
            : sub.description;
          artistStatement = (desc && desc.artistStatement) ? String(desc.artistStatement).trim() : '';
        }
      } catch (_) { /* ignore parse errors */ }
    }

    const imageUrls = Array.isArray(ed.gallery) ? ed.gallery : [];

    // 3) Call shared AI generator
    const out = await generateEditorialDescriptions({
      title: ed.title,
      artistStatement,
      imageUrls,
    });
    const descKr = (out && out.kr) || '';
    const descEn = (out && out.en) || '';
    const descIt = (out && out.it) || '';

    // 4) Build caption
    const caption = _buildCaptionFromEditorial(ed, descKr, descEn, descIt);

    // 5) Decide which fields to write — respect overwrite flag.
    const updates = {};
    const fieldsUpdated = {
      description: false,
      description_en: false,
      instagram_caption: false,
    };

    function _isEmpty(v) {
      return v === null || v === undefined || String(v).trim() === '' || String(v).trim() === '(KR)';
    }

    if (descKr && (overwrite || _isEmpty(ed.description))) {
      updates.description = descKr;
      fieldsUpdated.description = true;
    }
    if (descEn && (overwrite || _isEmpty(ed.description_en))) {
      updates.description_en = descEn;
      fieldsUpdated.description_en = true;
    }
    if (caption && (overwrite || _isEmpty(ed.instagram_caption))) {
      updates.instagram_caption = caption;
      fieldsUpdated.instagram_caption = true;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(200).json({
        message: 'No fields to update (all populated; pass overwrite=true to replace).',
        description: ed.description,
        description_en: ed.description_en,
        instagram_caption: ed.instagram_caption,
        fieldsUpdated,
        previewKr: descKr,
        previewEn: descEn,
        previewIt: descIt,
      });
    }

    updates.updated_at = new Date().toISOString();

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('editorials')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (updErr) {
      console.error('Auto-generate update failed:', updErr);
      return res.status(500).json({ message: 'Update failed', detail: updErr.message });
    }

    return res.status(200).json({
      message: 'Editorial auto-fill complete',
      description: updated.description,
      description_en: updated.description_en,
      instagram_caption: updated.instagram_caption,
      fieldsUpdated,
      previewKr: descKr,
      previewEn: descEn,
      previewIt: descIt,
    });
  } catch (err) {
    console.error('Auto-generate error:', err);
    return res.status(500).json({ message: 'Server error', detail: err && err.message });
  }
};
