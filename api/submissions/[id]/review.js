/**
 * PUT /api/submissions/:id/review — Admin review a submission
 *
 * Approval is a TWO-STEP flow: approving a submission stages it as an
 * editorial draft (status='draft', published_date=null). The editor then
 * tunes metadata in the admin and clicks 발행 to flip it to 'published'
 * via PUT /api/editorials/:id. Approval ≠ public exposure.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { sendEmail, templates } = require('../../_lib/email');
const { getOptimizedThumbnail, getOptimizedHero } = require('../../_lib/imageOptimize');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

// ── QA #168 — converters from submission-shape to editorial-shape ──

// Title Case "photo_assist" → "Photo Assist" (matches editorial role labels).
function _humanizeRoleKey(k) {
  if (!k) return '';
  return String(k)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Parse legacy "Name (@handle)" / "Name (https://…)" credit strings into
// the structured form. Used as a fallback when desc.team is absent
// (submissions filed before QA #168 only stored desc.credits flat).
function _parseLegacyCreditString(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  const m = str.match(/^(.+?)\s*\(\s*([^)]+?)\s*\)\s*$/);
  if (!m) return { name: str, instagram: '', website: '' };
  const name = m[1].trim();
  const link = m[2].trim();
  if (/^https?:\/\//i.test(link)) return { name, instagram: '', website: link };
  return { name, instagram: link, website: '' };
}

// Build editorial.credits array from submission description.
//   Output: [{ roles: ['Photographer'], name, instagram, website }, …]
// Priority order:
//   1. desc.team   — structured array saved since QA #168 (preferred)
//   2. desc.credits — legacy flat-string view, re-parsed back to structure
//   3. desc.models — appended as 'Starring' role entries
function _buildEditorialCredits(desc) {
  const out = [];
  if (Array.isArray(desc.team) && desc.team.length) {
    desc.team.forEach((m) => {
      if (!m || !m.name) return;
      const role = (m.role || '').trim() || 'Credit';
      out.push({
        roles: [role],
        name: String(m.name || '').trim(),
        instagram: String(m.instagram || '').trim(),
        website: String(m.website || '').trim(),
      });
    });
  } else if (desc.credits && typeof desc.credits === 'object') {
    Object.keys(desc.credits).forEach((roleKey) => {
      const arr = Array.isArray(desc.credits[roleKey]) ? desc.credits[roleKey] : [desc.credits[roleKey]];
      arr.forEach((entry) => {
        const parsed = _parseLegacyCreditString(entry);
        if (!parsed || !parsed.name) return;
        out.push({
          roles: [_humanizeRoleKey(roleKey)],
          name: parsed.name,
          instagram: parsed.instagram,
          website: parsed.website || '',
        });
      });
    });
  }
  if (Array.isArray(desc.models)) {
    desc.models.forEach((m) => {
      if (!m || !m.name) return;
      out.push({
        roles: ['Starring'],
        name: String(m.name || '').trim(),
        instagram: String(m.instagram || '').trim(),
        website: '',
      });
      if (m.agency) {
        out.push({
          roles: ['Agency'],
          name: String(m.agency || '').trim(),
          instagram: String(m.agencyInstagram || '').trim(),
          website: '',
        });
      }
    });
  }
  return out;
}

// Build editorial.fashion = { brands, imageCredits } from looks +
// lookImageMap + the final file_urls list.
//   Submission shape:
//     looks         = [{n, items:[{type, brand, instagram}, …]}, …]
//     lookImageMap  = [{lookN, imgIdxInLook}, …] — mirrors file_urls[i]
//   Editorial shape:
//     brands        = [{name, instagram}, …]   (deduped)
//     imageCredits  = { img_1: "@brand Type, @brand2 Type2", … }
function _buildEditorialFashion(desc, fileUrls) {
  const fashion = { brands: [], imageCredits: {} };
  const looksByN = {};
  if (Array.isArray(desc.looks)) {
    desc.looks.forEach((L) => { if (L && typeof L.n === 'number') looksByN[L.n] = L; });
  }
  // Dedupe brands across all looks
  const seen = new Set();
  Object.values(looksByN).forEach((L) => {
    (L.items || []).forEach((it) => {
      if (!it || !it.brand) return;
      const key = (it.brand + '|' + (it.instagram || '')).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      fashion.brands.push({ name: it.brand, instagram: it.instagram || '' });
    });
  });
  // Per-image credit lines, keyed img_<1-based> against the FINAL file_urls
  // order. Falls back gracefully when lookImageMap entries don't match a
  // known look (e.g. additional / non-look images at the tail of the list).
  if (Array.isArray(desc.lookImageMap)) {
    desc.lookImageMap.forEach((entry, idx) => {
      if (!entry || typeof entry.lookN !== 'number') return;
      const look = looksByN[entry.lookN];
      if (!look || !Array.isArray(look.items) || !look.items.length) return;
      const line = look.items
        .map((it) => {
          if (!it) return '';
          const handle = (it.instagram || '').trim();
          const type = (it.type || '').trim();
          if (!handle && !it.brand) return '';
          // Format expected by the editorial detail renderer: "@handle Type"
          // (admin "이미지별 착장 크레딧" parses the same shape).
          const lead = handle ? handle : '@' + String(it.brand || '').toLowerCase().replace(/\s+/g, '');
          return type ? (lead + ' ' + type) : lead;
        })
        .filter(Boolean)
        .join(', ');
      if (line) fashion.imageCredits['img_' + (idx + 1)] = line;
    });
  }
  return fashion;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  if (req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const { id } = req.query;
    const { status, reviewNote, coverImageIndex } = req.body;

    if (!status || !['approved', 'rejected', 'revision'].includes(status)) {
      return res.status(400).json({ message: 'Status must be "approved", "rejected", or "revision"' });
    }

    // Validate coverImageIndex if provided
    if (typeof coverImageIndex !== 'undefined' && (typeof coverImageIndex !== 'number' || coverImageIndex < 0)) {
      return res.status(400).json({ message: 'coverImageIndex must be a non-negative number' });
    }

    const { data: submission, error } = await supabaseAdmin
      .from('submissions')
      .update({
        status,
        admin_notes: reviewNote || '',
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Stage as editorial draft. The editor will polish metadata and
    // explicitly hit 발행 to expose it publicly. We deliberately skip
    // embedAndStoreEditorial here — embeddings happen at publish time
    // so half-baked drafts don't leak into semantic search results.
    //
    // QA #168 — full data-shape conversion. Submission stores credits/
    // looks in shapes optimised for the submission form; editorials
    // expects the admin-edit shapes. Earlier we just shallow-copied
    // desc.credits, which left the editorial modal blank because it
    // can't parse "{photographer: ['Name (@handle)']}". The converters
    // below normalise everything before INSERT.
    let stagedEditorialId = null;
    if (status === 'approved') {
      try {
        const desc = submission.description ? JSON.parse(submission.description) : {};
        const coverIdx = typeof coverImageIndex === 'number' ? coverImageIndex : (desc.coverImageIndex || 0);
        const coverUrl = submission.file_urls && submission.file_urls[coverIdx]
          ? submission.file_urls[coverIdx]
          : (submission.file_urls && submission.file_urls[0]) || null;

        if (coverUrl) {
          const tagsArr = Array.isArray(desc.genre) ? desc.genre : [];
          const description = (desc.artistStatement || '').trim() || null;

          // ── Convert team/credits → editorial.credits array ──
          // Editorial shape: [{ roles: ['Photographer'], name, instagram, website }, …]
          // Preferred input: desc.team (structured, saved since QA #168).
          // Fallback: desc.credits flat-string view, parsed back into structure
          //           for submissions filed before that fix landed.
          const credits = _buildEditorialCredits(desc);

          // ── Convert looks/lookImageMap → editorial.fashion ──
          // Editorial shape: { brands: [{name, instagram}], imageCredits: { img_N: "@brand Type, @brand2 Type2" } }
          const fashion = _buildEditorialFashion(desc, submission.file_urls || []);

          const { data: editorial, error: edErr } = await supabaseAdmin
            .from('editorials')
            .insert({
              title: submission.title,
              slug: null,
              cover_image: getOptimizedHero(coverUrl),
              thumbnail: getOptimizedThumbnail(coverUrl),
              gallery: submission.file_urls || [],
              credits,
              fashion,
              tags: tagsArr,
              issue: null,
              description,
              status: 'draft',
              published_date: null,
            })
            .select()
            .single();

          if (edErr) {
            console.error('Stage-as-editorial failed:', edErr);
          } else {
            stagedEditorialId = editorial.id;
            const notePrefix = reviewNote || '';
            const newNote = notePrefix + (notePrefix ? '\n' : '') + '[Staged as editorial id: ' + editorial.id + ']';
            await supabaseAdmin
              .from('submissions')
              .update({ admin_notes: newNote })
              .eq('id', submission.id)
              .catch(err => console.error('Failed to update admin_notes:', err));
          }
        }
      } catch (stageErr) {
        console.error('Stage-as-editorial error:', stageErr);
      }
    }

    // QA #165 — send an outcome-agnostic "review complete" email that
    // pushes the submitter back to the platform to read the verdict.
    // We pick the locale from profile.email_language (explicit newsletter
    // preference, set in mypage) → profile.language (site UI locale) →
    // 'en' as a last-resort fallback. The same dictionary covers all
    // 9 supported locales; submissionReviewComplete falls back to en
    // internally if it sees an unknown lang.
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email, display_name, language, email_language')
      .eq('id', submission.user_id)
      .single();
    if (profile && profile.email) {
      const lang = profile.email_language || profile.language || 'en';
      // Pass status so the template can attach the rejection-specific
      // courtesy block (English) for status='rejected'. Approved /
      // revision stay on the neutral localised body unchanged.
      const tpl = templates.submissionReviewComplete(
        { name: profile.display_name || '' },
        { title: submission.title },
        lang,
        status
      );
      sendEmail(profile.email, tpl).catch(() => {});
    }

    // editorialId lets the admin UI deep-link straight into the edit
    // screen for the staged draft, skipping the manual nav through
    // 에디토리얼 관리 → 임시저장 탭.
    return res.status(200).json({ submission, editorialId: stagedEditorialId });
  } catch (error) {
    console.error('Review submission error:', error);
    return res.status(500).json({ message: 'Failed to review submission' });
  }
};
