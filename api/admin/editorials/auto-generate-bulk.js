/**
 * POST /api/admin/editorials/auto-generate-bulk — fill EVERY editorial
 * with a missing description / instagram_caption in one sweep. Useful
 * for cleaning up legacy admin-created editorials (like Inner Offerings)
 * that never went through the submission-approval path and therefore
 * never got auto-gen.
 *
 * Gated to MAIN admin only because this hits the Anthropic API repeatedly
 * (one call per editorial) and can rack up tokens fast. We rate-limit to
 * ~1 call per 1.5 seconds to stay polite under the burst quota.
 *
 * Body: {
 *   overwrite?: boolean = false,      // replace existing non-empty fields
 *   limit?: number     = 25,          // safety cap per invocation
 *   onlyMissing?: bool = true,        // skip rows whose all 3 fields are populated
 * }
 *
 * Returns: {
 *   processed: number,                // rows we attempted
 *   updated:   number,                // rows that actually got new values
 *   skipped:   number,                // rows we walked past (all populated)
 *   errors:    [{ id, title, err }],  // per-row failure log
 * }
 */

const { supabaseAdmin } = require('../../_lib/supabase');
const { requireMainAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { generateEditorialDescriptions } = require('../../_lib/editorialAi');
const { buildPapIgCaption } = require('../../_lib/igCaption');

const _IG_PUBLISHER_HANDLE = '@kangdm';
const _IG_HOUSE_HANDLE     = '@pap_magazine';
const _IG_SEPARATOR        = '————- ';
const _IG_SITE_BASE        = 'https://www.pap-magazine.com/editorial/';

function _normalizeIgHandle(s) {
  let h = String(s || '').trim();
  if (!h) return '';
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
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'editorial';
}
function _isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === '' || String(v).trim() === '(KR)';
}
function _buildCaption(ed, descKr, descEn, descIt, extra) {
  const title = String(ed.title || '').trim() || 'Untitled';

  const credits = Array.isArray(ed.credits) ? ed.credits : [];
  const creditLines = [];
  const starringParts = [];
  credits.forEach((c) => {
    if (!c || !c.name) return;
    const handle = _normalizeIgHandle(c.instagram || c.website || '');
    if (!handle) return;
    // QA #302 — 다중 역할 병합 (auto-generate.js 와 동일 패턴).
    const roles = Array.isArray(c.roles) ? c.roles : (c.roles ? [c.roles] : []);
    const primary = roles[0] || c.role || 'Credit';
    const allRoles = roles.length ? roles : [primary];
    const isStarring = allRoles.some(function (r) {
      return /^(model|starring|talent|cast)/i.test(String(r || ''));
    });
    if (isStarring) {
      starringParts.push(handle);
    } else {
      const label = allRoles
        .map(function (r) { return _normalizeRoleLabel(r); })
        .filter(Boolean)
        .join(' & ');
      creditLines.push(`${label || _normalizeRoleLabel(primary)} ${handle}`);
    }
  });

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

  // 새 형식 조립은 공용 빌더(api/_lib/igCaption.js)가 담당.
  return buildPapIgCaption({
    title,
    hook: (extra && extra.hook) || '',
    moodTag: (extra && extra.moodTag) || '',
    descKo: descKr, descEn, descIt,
    creditLines,
    starring: starringParts,
    brandHandles,
    slug: (ed && ed.slug) || _slugify(title),
  });
}

function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  const user = await requireMainAdmin(req, res);
  if (!user) return;

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = body ? JSON.parse(body) : {}; } catch (_) { body = {}; }
  }
  const overwrite   = body.overwrite === true;
  const onlyMissing = body.onlyMissing !== false; // default true
  const limit       = Math.max(1, Math.min(50, parseInt(body.limit, 10) || 25));

  try {
    /* 2026-08-27 페이지네이션 수리 — '자른 뒤 거른다' 안티패턴 제거.
       종전: 가장 오래된 limit 건만 SELECT 한 뒤 필터 → 앞줄이 전부 채워진
       행이면 뒤의 진짜 대상(실측 14건)에 영원히 닿지 못했다. faqBackfill 의
       2026-08-04 교훈과 동일 — '거른 뒤 자른다'로 뒤집고, 한 페이지가 전부
       탈락이어도 다음 페이지로 걸어 나간다. */
    const SPAN = Math.min(200, Math.max(limit * 8, 60));
    const MAX_PAGES = 5;
    const wanted = (r) => {
      if (!onlyMissing) return true;
      return _isEmpty(r.description) || _isEmpty(r.description_en) || _isEmpty(r.instagram_caption);
    };
    const candidates = [];
    let scanned = 0;
    for (let page = 0; page < MAX_PAGES && candidates.length < limit; page++) {
      const from = page * SPAN;
      const { data: rows, error: listErr } = await supabaseAdmin
        .from('editorials')
        .select('id, title, slug, gallery, credits, fashion, description, description_en, instagram_caption, source_submission_id')
        .order('created_at', { ascending: true })
        .range(from, from + SPAN - 1);
      if (listErr) {
        console.error('Bulk list error:', listErr);
        return res.status(500).json({ message: 'List failed', detail: listErr.message });
      }
      scanned += (rows || []).length;
      for (const r of (rows || [])) {
        if (candidates.length >= limit) break;
        if (wanted(r)) candidates.push(r);
      }
      if (!rows || rows.length < SPAN) break; // 마지막 페이지
    }

    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const ed of candidates) {
      try {
        // Skip rows with no usable input (no images AND no source text)
        const gallery = Array.isArray(ed.gallery) ? ed.gallery : [];
        let artistStatement = '';
        if (ed.source_submission_id) {
          try {
            const { data: sub } = await supabaseAdmin
              .from('submissions').select('description').eq('id', ed.source_submission_id).single();
            if (sub && sub.description) {
              const desc = typeof sub.description === 'string' ? JSON.parse(sub.description) : sub.description;
              if (desc && desc.artistStatement) artistStatement = String(desc.artistStatement).trim();
            }
          } catch (_) {}
        }
        if (!gallery.length && !artistStatement) {
          skipped++;
          continue;
        }

        const out = await generateEditorialDescriptions({
          title: ed.title, artistStatement, imageUrls: gallery,
        });
        const descKr = out.kr || '';
        const descEn = out.en || '';
        const descIt = out.it || '';
        const caption = _buildCaption(ed, descKr, descEn, descIt, {
          hook: (out && out.hook) || '',
          moodTag: (out && out.moodTag) || '',
        });

        const upd = {};
        if (descKr && (overwrite || _isEmpty(ed.description)))             upd.description = descKr;
        if (descEn && (overwrite || _isEmpty(ed.description_en)))         upd.description_en = descEn;
        if (caption && (overwrite || _isEmpty(ed.instagram_caption)))     upd.instagram_caption = caption;

        if (Object.keys(upd).length === 0) {
          skipped++;
          continue;
        }
        upd.updated_at = new Date().toISOString();

        const { error: updErr } = await supabaseAdmin
          .from('editorials').update(upd).eq('id', ed.id);
        if (updErr) {
          errors.push({ id: ed.id, title: ed.title, err: updErr.message });
        } else {
          updated++;
        }

        // Rate-limit pause — Anthropic recommends ~1 RPS for small accounts;
        // 1500ms keeps us well under any throttle window.
        await _sleep(1500);
      } catch (rowErr) {
        console.error('Bulk row error', ed && ed.id, rowErr);
        errors.push({ id: ed.id, title: ed.title, err: rowErr && rowErr.message });
      }
    }

    return res.status(200).json({
      processed: candidates.length,
      updated,
      skipped,
      errors,
      limit,
      overwrite,
      onlyMissing,
    });
  } catch (err) {
    console.error('Bulk auto-generate error:', err);
    return res.status(500).json({ message: 'Server error', detail: err && err.message });
  }
};
