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
// 크레딧 역할 표준화 — 서브미션 라벨('Photo')을 관리자 기준값('Photographer')으로.
// 매핑 정의와 배경은 api/_lib/creditRoles.js 참조.
const { normalizeRole } = require('../../_lib/creditRoles');
// QA #184 — AI description generator was moved into the shared lib so
// the admin-side "🤖 자동 생성" button + bulk-fill endpoint can reuse the
// exact same prompts. Keeps the behaviour identical to what this file
// has been doing on submission-approval.
const { generateEditorialDescriptions: _generateEditorialDescriptions } = require('../../_lib/editorialAi');
const { buildPapIgCaption } = require('../../_lib/igCaption');
const { sendTextToTelegramSafe } = require('../../_lib/telegram');

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
// QA #286 — `@handle` 또는 `https://...` 만 들어 있는 케이스도 인식.
// 기존 regex는 `Name (handle)` 패턴만 매칭해서, instagram만 입력된 entry는
// 전체 string을 name으로 잘못 저장. `_normalizeCreditFields`가 후처리하지만
// 이 단에서도 명확하게 분리.
function _parseLegacyCreditString(s) {
  const str = String(s || '').trim();
  if (!str) return null;

  // "Name (handle)" 패턴
  const m = str.match(/^(.+?)\s*\(\s*([^)]+?)\s*\)\s*$/);
  if (m) {
    const name = m[1].trim();
    const link = m[2].trim();
    if (/^https?:\/\//i.test(link)) return { name, instagram: '', website: link };
    return { name, instagram: link, website: '' };
  }

  // 괄호 없음 — 전체가 instagram 핸들/URL인지 검사
  if (/^@/.test(str)) {
    return { name: '', instagram: str, website: '' };
  }
  if (/^https?:\/\//i.test(str)) {
    return { name: '', instagram: '', website: str };
  }
  // 순수 이름 (링크 없음)
  return { name: str, instagram: '', website: '' };
}

// QA #286 — name 자리에 @handle 또는 URL이 들어가 있는 잘못 매핑을 자동 보정.
// 사용자가 서브미션 폼에서 실수로 이름 칸에 `@johnkim`을 입력한 케이스 + 레거시
// 데이터에서 동일한 오매핑이 발생한 케이스를 모두 후처리로 정정.
function _normalizeCreditFields(rawName, rawInstagram, rawWebsite) {
  let name = String(rawName || '').trim();
  let instagram = String(rawInstagram || '').trim();
  let website = String(rawWebsite || '').trim();

  // 이름 자리에 @handle이 들어 있고 instagram이 비어있으면 swap.
  if (!instagram && /^@\S+$/.test(name)) {
    instagram = name;
    name = '';
  }
  // 이름 자리에 https URL이 들어 있고 website가 비어있으면 swap.
  if (!website && /^https?:\/\//i.test(name)) {
    website = name;
    name = '';
  }
  // instagram 자리에 https URL이 들어 있고 website가 비어있으면 swap.
  if (!website && /^https?:\/\//i.test(instagram)) {
    website = instagram;
    instagram = '';
  }
  // instagram이 @ 없이 들어 있으면 보강.
  if (instagram && !/^@/.test(instagram) && !/^https?:\/\//i.test(instagram)) {
    instagram = '@' + instagram.replace(/^@+/, '');
  }
  return { name, instagram, website };
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
      if (!m) return;
      // QA #286 — name 자리에 @handle/URL 들어가는 잘못 매핑 자동 보정.
      const fixed = _normalizeCreditFields(m.name, m.instagram, m.website);
      // 모든 필드가 비어있으면 skip. name만 비어있고 instagram/website가 있으면 유지.
      if (!fixed.name && !fixed.instagram && !fixed.website) return;
      const role = (m.role || '').trim() || 'Credit';
      out.push({
        roles: [role],
        name: fixed.name,
        instagram: fixed.instagram,
        website: fixed.website,
      });
    });
  } else if (desc.credits && typeof desc.credits === 'object') {
    Object.keys(desc.credits).forEach((roleKey) => {
      const arr = Array.isArray(desc.credits[roleKey]) ? desc.credits[roleKey] : [desc.credits[roleKey]];
      arr.forEach((entry) => {
        const parsed = _parseLegacyCreditString(entry);
        if (!parsed) return;
        const fixed = _normalizeCreditFields(parsed.name, parsed.instagram, parsed.website);
        if (!fixed.name && !fixed.instagram && !fixed.website) return;
        out.push({
          roles: [_humanizeRoleKey(roleKey)],
          name: fixed.name,
          instagram: fixed.instagram,
          website: fixed.website,
        });
      });
    });
  }
  if (Array.isArray(desc.models)) {
    desc.models.forEach((m) => {
      if (!m) return;
      // QA #286 — model에도 동일 normalize 적용.
      const fixedModel = _normalizeCreditFields(m.name, m.instagram, '');
      if (fixedModel.name || fixedModel.instagram){
        out.push({
          roles: ['Starring'],
          name: fixedModel.name,
          instagram: fixedModel.instagram,
          website: '',
        });
      }
      if (m.agency) {
        const fixedAgency = _normalizeCreditFields(m.agency, m.agencyInstagram, '');
        if (fixedAgency.name || fixedAgency.instagram){
          out.push({
            roles: ['Agency'],
            name: fixedAgency.name,
            instagram: fixedAgency.instagram,
            website: '',
          });
        }
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
  // 2026-07-21 — 여기서 표준값 매핑까지 한다. 예전엔 snake_case 를 Title Case
  // 로 바꾸는 게 전부여서 서브미션의 'Photo'/'MUAH' 가 그대로 에디토리얼에
  // 꽂혔고, 관리자 목록('Photographer'/'Make Up & Hair')과 영영 어긋났다.
  // 모르는 값은 creditRoles 가 원본을 보존하므로 자유입력 역할은 안 깨진다.
  return normalizeRole(str) || 'Credit';
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
  // 새 형식 (2026-07) — 조립은 api/_lib/igCaption.js 공용 빌더가 담당.
  // 여기서는 SUBMISSION shape(desc.team / desc.models / desc.looks)에서
  // 부품(크레딧 줄·스타링·브랜드)만 추출한다.
  const descKo = (opts && opts.descKo) || (desc && desc.artistStatement) || '';
  const descEn = (opts && opts.descEn) || '';
  const descIt = (opts && opts.descIt) || '';

  // 크레딧 — 한 줄에 하나 ("Role @handle")
  const creditLines = [];
  if (Array.isArray(desc.team) && desc.team.length) {
    desc.team.forEach((m) => {
      if (!m || !m.name) return;
      const handle = _normalizeIgHandle(m.instagram || m.website || '');
      if (!handle) return;
      // QA #302 — m.role 이 array (다중 역할) 형태로 들어올 수도 있어 모두 합침.
      const rolesArr = Array.isArray(m.role) ? m.role : (m.role ? [m.role] : []);
      const label = rolesArr.length
        ? rolesArr.map(function (r) { return _normalizeRoleLabel(r); }).filter(Boolean).join(' & ')
        : _normalizeRoleLabel('');
      creditLines.push(`${label} ${handle}`);
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
        creditLines.push(`${_normalizeRoleLabel(roleKey)} ${handle}`);
      });
    });
  }

  // Starring — "@model @agency …"
  const starring = [];
  if (Array.isArray(desc.models) && desc.models.length) {
    desc.models.forEach((m) => {
      if (!m || !m.name) return;
      const model = _normalizeIgHandle(m.instagram || m.name);
      const agency = _normalizeIgHandle(m.agencyInstagram || m.agency || '');
      if (model) starring.push(model);
      if (agency) starring.push(agency);
    });
  }

  // Brands
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

  return buildPapIgCaption({
    title,
    hook: (opts && opts.hook) || '',
    moodTag: (opts && opts.moodTag) || '',
    descKo, descEn, descIt,
    creditLines, starring, brandHandles,
    slug: (opts && opts.slug) || _slugifyForUrl(title),
  });
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
  // QA #215 — if the submitter (or an admin earlier in the pipeline)
  // already typed per-image credits into desc.fashion.imageCredits,
  // seed the editorial fashion map with those so manual values aren't
  // overwritten by the auto-generated lookImageMap below. The PATCH
  // handler re-keys this object whenever file_urls is curated, so the
  // img_N keys here always line up with the FINAL fileUrls order.
  if (desc && desc.fashion && desc.fashion.imageCredits && typeof desc.fashion.imageCredits === 'object') {
    const seed = desc.fashion.imageCredits;
    const max = Array.isArray(fileUrls) ? fileUrls.length : 0;
    for (const k of Object.keys(seed)) {
      const m = /^img_(\d+)$/.exec(k);
      if (!m) continue;
      const idx = parseInt(m[1], 10);
      // Drop orphan keys whose index has no surviving image.
      if (idx < 1 || idx > max) continue;
      if (seed[k]) fashion.imageCredits[k] = seed[k];
    }
  }
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
      // QA #215 — only overwrite when the slot doesn't already have an
      // admin-curated value seeded from desc.fashion.imageCredits above.
      const slotKey = 'img_' + (idx + 1);
      if (line && !fashion.imageCredits[slotKey]) {
        fashion.imageCredits[slotKey] = line;
      }
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
  // QA #211 — 'pending' added so the admin can recover a rejected
  // submission within the 30-day window. Recovery requires the main
  // admin role (same gate as the original approve/reject decision).
  const requiresMainAdmin = intendedStatus === 'approved'
                         || intendedStatus === 'rejected'
                         || intendedStatus === 'pending';
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

    if (!status || !['approved', 'rejected', 'revision', 'pending'].includes(status)) {
      return res.status(400).json({ message: 'Status must be "approved", "rejected", "revision", or "pending"' });
    }

    // Validate coverImageIndex if provided
    if (typeof coverImageIndex !== 'undefined' && (typeof coverImageIndex !== 'number' || coverImageIndex < 0)) {
      return res.status(400).json({ message: 'coverImageIndex must be a non-negative number' });
    }

    // QA #211 — stamp rejected_at when transitioning to 'rejected' so the
    // 30-day auto-purge cron can find this row. Set to NULL when leaving
    // the rejected state (e.g. admin recovers via status='pending'); the
    // cron only deletes rows that still have a non-null stamp.
    const reviewPatch = {
      status,
      admin_notes: reviewNote || '',
    };
    if (status === 'rejected') {
      reviewPatch.rejected_at = new Date().toISOString();
    } else {
      // Recovery path — clear stamp so a row brought back from rejection
      // doesn't get scooped up by the cron.
      reviewPatch.rejected_at = null;
    }

    const { data: submission, error } = await supabaseAdmin
      .from('submissions')
      .update(reviewPatch)
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
            hook: igDescriptions.hook,
            moodTag: igDescriptions.moodTag,
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
              // QA #206 — make the NULL explicit so a future trigger or
              // backfill can't accidentally treat the row as
              // "admin-touched" the moment Postgres' updated_at trigger
              // fires (which it does on every INSERT). The Drafts tab
              // query in /api/editorials/index.js gates visibility on
              // admin_edited_at IS NOT NULL — keeping this NULL is what
              // keeps freshly-approved submissions OUT of 임시저장 until
              // an admin actually opens & saves them.
              admin_edited_at: null,
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
        .select('email, display_name, language, email_language, subscription_plan, subscription_status')
        .eq('id', submission.user_id)
        .single();

      // 2026-07-10 — 유료 회원(Standard/Premium) 반려 시 운영자 텔레그램 알림.
      // 등급 혜택 "서브미션 탈락 피드백 제공" 이행용: 운영자가 직접 피드백을 작성해
      // 회신해야 하는 건을 놓치지 않도록 즉시 알린다. (알림 실패는 리뷰 저장에 무영향)
      if (status === 'rejected' && profile) {
        const _plan = String(profile.subscription_plan || '').toLowerCase();
        const _paid = _plan.indexOf('standard') === 0 || _plan.indexOf('premium') === 0;
        const _active = String(profile.subscription_status || '').toLowerCase() === 'active';
        if (_paid && _active) {
          sendTextToTelegramSafe(
            '💬 유료 회원 서브미션 반려 — 피드백 작성 필요\n'
            + '회원: ' + (profile.display_name || '이름 없음') + ' (' + (profile.email || '') + ') · ' + _plan.toUpperCase() + '\n'
            + '작품: ' + (submission.title || submission.id) + '\n'
            + (reviewNote ? ('반려 메모: ' + String(reviewNote).slice(0, 300) + '\n') : '')
            + '관리자에서 피드백 회신: https://www.pap-magazine.com/admin'
          );
        }
      }

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
