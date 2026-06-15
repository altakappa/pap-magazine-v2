/**
 * PUT /api/submissions/:id/review — Admin review a submission
 *
 * Approval is a TWO-STEP flow: approving a submission stages it as an
 * editorial draft (status='draft', published_date=null). The editor then
 * tunes metadata in the admin and clicks 발행 to flip it to 'published'
 * via PUT /api/editorials/:id. Approval ≠ public exposure.
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin, requireMainAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { sendEmail, templates } = require('../../_lib/email');
const { getOptimizedThumbnail, getOptimizedHero } = require('../../_lib/imageOptimize');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
// QA #184 — AI description generator was moved into the shared lib so
// the admin-side "🤖 자동 생성" button + bulk-fill endpoint can reuse the
// exact same prompts. Keeps the behaviour identical to what this file
// has been doing on submission-approval.
const { generateEditorialDescriptions: _generateEditorialDescriptions } = require('../../_lib/editorialAi');

// (Old inline _generateEditorialDescriptions definition lived here. It is
// now exclusively in api/_lib/editorialAi.js so the admin auto-generate
// button and the bulk fill endpoint can reuse the same prompts.)

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

// ── QA #170 — Instagram caption builder ──────────────────────────────────
// Renders submission data into PAP's exact IG caption style. Format
// (taken verbatim from a published example):
//
//   'TITLE' exclusive for @pap_magazine published by @kangdm ㅡ link in bio
//
//   ————-
//   Role @handle Role @handle Role @handle …          ← inline, single line
//
//   Starring @model @agency [@model2 @agency2]
//
//   ————-
//   (KR) Korean description…
//
//   (EN) English description…
//
//   (IT) Italian description…
//
//   ————-
//   Full Story link🔎
//   https://www.pap-magazine.com/editorial/<slug>
//
//   Fashion by @brand1 @brand2 @brand3 …
//
// Editors can hand-tune the text in the admin modal before publishing —
// the textarea is plain TEXT and round-trips through the editorial PUT
// endpoint. The (EN) / (IT) translations are auto-filled when the
// editorial has description_en (we don't yet store description_it; admin
// pastes the IT translation into the textarea directly until that column
// lands).
const _IG_PUBLISHER_HANDLE = '@kangdm';      // Domenico Kang, founding editor
const _IG_HOUSE_HANDLE     = '@pap_magazine';
const _IG_SEPARATOR        = '————- ';        // em-dash × 4 + hyphen + space
const _IG_SITE_BASE        = 'https://www.pap-magazine.com/editorial/';

function _normalizeIgHandle(s) {
  if (!s) return '';
  let h = String(s).trim();
  // Strip instagram URL prefix
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, '');
  if (!h) return '';
  return h.charAt(0) === '@' ? h : '@' + h;
}

// Title Case fallback for free-form role text. Editorial role names are
// shown verbatim (e.g. "Photography, Art Directing & Retouching") — we
// only intervene when the role looks like a snake_case key (legacy
// {photographer:[]} shape).
function _normalizeRoleLabel(raw) {
  const str = String(raw || '').trim();
  if (!str) return 'Credit';
  // If it looks like a snake/lower key, Title-Case it.
  if (/^[a-z0-9_]+$/.test(str)) {
    return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return str;
}

// Slug fallback when the editorial row hasn't been slugged yet (review.js
// inserts with slug=null and the editor may publish before setting one).
// Mirrors api/seo/editorial/[slug].js' lookup which accepts decoded title
// as a 3rd-step fallback.
function _slugifyForUrl(title) {
  const s = String(title || '').trim();
  if (!s) return '';
  return s.toLowerCase()
    .replace(/['"`]+/g, '')
    .replace(/[^\w\s가-힣-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function _buildInstagramCaption(desc, title, opts) {
  const slug = (opts && opts.slug) || _slugifyForUrl(title);
  const descKo = (opts && opts.descKo) || (desc && desc.artistStatement) || '';
  const descEn = (opts && opts.descEn) || '';
  const descIt = (opts && opts.descIt) || '';

  const lines = [];

  // ── 1) Header ──
  lines.push(`'${String(title || '').trim()}' exclusive for ${_IG_HOUSE_HANDLE} published by ${_IG_PUBLISHER_HANDLE} ㅡ link in bio`);
  lines.push('');

  // ── 2) Crew credits (inline single line) + Starring ──
  lines.push(_IG_SEPARATOR);
  const creditParts = [];
  if (Array.isArray(desc.team) && desc.team.length) {
    desc.team.forEach((m) => {
      if (!m || !m.name) return;
      const handle = _normalizeIgHandle(m.instagram || m.website || '');
      if (!handle) return;
      const label = _normalizeRoleLabel(m.role);
      creditParts.push(`${label} ${handle}`);
    });
  } else if (desc.credits && typeof desc.credits === 'object') {
    // Legacy {photographer: ["Name (@handle)"]} shape — parse back.
    Object.keys(desc.credits).forEach((roleKey) => {
      const arr = Array.isArray(desc.credits[roleKey]) ? desc.credits[roleKey] : [desc.credits[roleKey]];
      arr.forEach((entry) => {
        const str = String(entry || '').trim();
        if (!str) return;
        const m = str.match(/\(([^)]+)\)/);
        if (!m) return;
        const handle = _normalizeIgHandle(m[1]);
        if (!handle) return;
        creditParts.push(`${_normalizeRoleLabel(roleKey)} ${handle}`);
      });
    });
  }
  if (creditParts.length) lines.push(creditParts.join(' '));

  // Models — "Starring @model @agency …"
  if (Array.isArray(desc.models) && desc.models.length) {
    if (creditParts.length) lines.push('');
    const modelParts = [];
    desc.models.forEach((m) => {
      if (!m || !m.name) return;
      const model = _normalizeIgHandle(m.instagram || m.name);
      const agency = _normalizeIgHandle(m.agencyInstagram || m.agency || '');
      if (model) modelParts.push(model);
      if (agency) modelParts.push(agency);
    });
    if (modelParts.length) lines.push('Starring ' + modelParts.join(' '));
  }
  lines.push('');

  // ── 3) Descriptions in three languages ──
  lines.push(_IG_SEPARATOR);
  lines.push('(KR) ' + (descKo || '').trim());
  lines.push('');
  lines.push('(EN) ' + (descEn || '').trim());
  lines.push('');
  lines.push('(IT) ' + (descIt || '').trim());
  lines.push('');

  // ── 4) Full Story link ──
  lines.push(_IG_SEPARATOR);
  lines.push('Full Story link🔎');
  lines.push(_IG_SITE_BASE + slug);
  lines.push('');

  // ── 5) Brands — single line "Fashion by @brand1 @brand2 …" ──
  const seen = new Set();
  const brandHandles = [];
  if (Array.isArray(desc.looks)) {
    desc.looks.forEach((L) => {
      (L && L.items || []).forEach((it) => {
        if (!it) return;
        const h = _normalizeIgHandle(it.instagram || it.brand || '');
        if (!h) return;
        const key = h.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        brandHandles.push(h);
      });
    });
  }
  if (brandHandles.length) lines.push('Fashion by ' + brandHandles.join(' '));

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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

  // QA #169 — role-gated review. Staff can request revisions (low-risk;
  // bounces the work back to the submitter), but the final approve/reject
  // signoff is reserved for the main admin. We peek at the body first to
  // pick the right middleware, so non-admins still see the regular 403.
  const intendedStatus = req.body && req.body.status;
  const requiresMainAdmin = intendedStatus === 'approved' || intendedStatus === 'rejected';
  const admin = requiresMainAdmin
    ? await requireMainAdmin(req, res)
    : await requireAdmin(req, res);
  if (!admin) return;

  try {
    const { id } = req.query;
    // QA #172 — approval email moved out of this handler; Day/Month are
    // now collected in the editorial save modal, not here. Body still
    // carries them harmlessly when older clients are mid-deploy, but the
    // handler no longer reads or forwards them.
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

          // ── QA #170 — Instagram caption ──
          // Slug is generated alongside so the embedded /editorial/<slug>
          // URL works the moment the editor copies the caption. AI step
          // generates the (EN) / (IT) translations (and (KR) too when the
          // submitter left artistStatement blank) — see
          // _generateEditorialDescriptions above. Failure is non-fatal:
          // a Claude error leaves (EN)/(IT) blank for the admin to fill
          // in by hand. The whole call is awaited because the resulting
          // caption is persisted to editorials.instagram_caption in the
          // INSERT that follows; running it post-INSERT would race the
          // admin opening the editorial modal immediately after approval.
          const editorialSlug = _slugifyForUrl(submission.title || '');
          const igDescriptions = await _generateEditorialDescriptions({
            title: submission.title,
            artistStatement: (desc.artistStatement || '').trim(),
            imageUrls: submission.file_urls || [],
          });
          const instagramCaption = _buildInstagramCaption(desc, submission.title, {
            slug: editorialSlug,
            descKo: igDescriptions.kr,
            descEn: igDescriptions.en,
            descIt: igDescriptions.it,
          });

          const { data: editorial, error: edErr } = await supabaseAdmin
            .from('editorials')
            .insert({
              title: submission.title,
              // QA #170 — auto-seed slug at approval so the IG caption's
              // /editorial/<slug> URL works the moment the editor copies
              // the caption. Admin can still rename the slug later (and
              // the SSR endpoint's title-fallback covers the brief window
              // before they do).
              slug: editorialSlug || null,
              cover_image: getOptimizedHero(coverUrl),
              thumbnail: getOptimizedThumbnail(coverUrl),
              gallery: submission.file_urls || [],
              credits,
              fashion,
              tags: tagsArr,
              issue: null,
              // The submitter may have written in any language (most often
              // English). After Claude's auto-detect + translate step,
              // igDescriptions.kr / .en always contain the LANGUAGE we
              // want in each column — regardless of the original language.
              // Prefer those over the raw artistStatement so the public
              // /editorial page in KR shows Korean and the EN locale shows
              // English. Falls back to the raw text only when Claude was
              // unavailable, so the editorial isn't empty.
              description:    igDescriptions.kr || description || null,
              description_en: igDescriptions.en || null,
              // QA #204 — IT translation now persists in its own column
              // (migration 039), so a later admin edit / regeneration
              // can keep KR + EN + IT in sync end-to-end. The caption
              // blob still embeds (IT) too for the IG copy-paste flow.
              description_it: igDescriptions.it || null,
              instagram_caption: instagramCaption,
              // QA #172 — link back to the submission so the editorial
              // save handler can look up the submitter when the admin
              // ticks "✉️ 저장 시 승인 메일 발송".
              source_submission_id: submission.id,
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

    // QA #165 — outcome email goes out IMMEDIATELY for all three
    // statuses (approved / rejected / revision). Locale picked from
    // profile.email_language → profile.language → 'en'.
    //
    // QA #185 — Previously the APPROVED branch waited for the admin to
    // tick "✉️ 저장 시 승인 메일 발송" on the staged editorial. In practice
    // that checkbox was never clicked (DB shows 12 approved / 0 mails
    // sent) so submitters were silently left hanging. Auto-send aligns
    // approval with rejection/revision and removes the manual step.
    //
    // The "send again with publication Day/Month + payment details"
    // checkbox in the editorial editor is KEPT so the editor can
    // re-notify the submitter once the publication date is locked in.
    // approval_email_sent_at idempotency-stamps after the first send,
    // so re-tick + save will resend exactly once with the fresh dates.
    {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, display_name, language, email_language')
        .eq('id', submission.user_id)
        .single();
      if (profile && profile.email) {
        const lang = profile.email_language || profile.language || 'en';
        const tpl = templates.submissionReviewComplete(
          { name: profile.display_name || '' },
          { title: submission.title },
          lang,
          status
          // No approvalDay / approvalMonth passed — the template falls
          // back to bracketed placeholders, and the OPTIONAL editor
          // resend will overwrite the recipient's inbox with a dated
          // version once the publication schedule is set.
        );
        sendEmail(profile.email, tpl)
          .then(async (result) => {
            // For approved submissions, stamp the staged editorial's
            // approval_email_sent_at so the editor's later checkbox
            // tick acts as an explicit RESEND (idempotency clears the
            // stamp first — see editorial PUT handler).
            if (status === 'approved' && stagedEditorialId && result && result.sent) {
              try {
                await supabaseAdmin
                  .from('editorials')
                  .update({ approval_email_sent_at: new Date().toISOString() })
                  .eq('id', stagedEditorialId);
              } catch (e) {
                console.error('[review] approval stamp failed:', e && e.message);
              }
            }
          })
          .catch(() => {});
      }
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
