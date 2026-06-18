/**
 * POST /api/admin/films/:id/translate — AI-fill film.description /
 * description_en / description_it using whichever language slot the
 * editor wrote first as the source.
 *
 * QA #251. Mirrors the editorial auto-generate endpoint (QA #184) but
 * with a tighter scope: films don't carry per-look fashion descriptors
 * or gallery captions, so there's no vision blurb to write — we only
 * translate the source text into the other two languages.
 *
 * Source-detection rule:
 *   1. body.source.text + body.source.lang  (explicit; admin UI sends this)
 *   2. otherwise: first non-empty of description / description_en /
 *      description_it on the row, with language guessed from script.
 *   3. if none of them are filled → 400 (nothing to translate).
 *
 * Body:
 *   {
 *     overwrite?: boolean    // default false — only fill blank slots
 *     source?: { text, lang } // optional override (admin sends current
 *                              //  textarea contents so unsaved drafts
 *                              //  translate too)
 *   }
 *
 * Returns:
 *   {
 *     description, description_en, description_it,
 *     fieldsUpdated: { description: bool, description_en: bool, description_it: bool },
 *     sourceLang: 'kr' | 'en' | 'it'
 *   }
 *
 * Security: requireAdmin (any admin role — staff/main both can translate).
 * Rate limit: same `RATE_LIMITS.api` bucket as other admin POSTs.
 */

const { supabaseAdmin } = require('../../../_lib/supabase');
const { requireAdmin } = require('../../../_lib/auth');
const { handleCors } = require('../../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../../_lib/rateLimit');
const { generateEditorialDescriptions, _guessLanguage } =
  require('../../../_lib/editorialAi');
const { recordContentChange } = require('../../../_lib/audit');

function _isEmpty(v) {
  return v == null || String(v).trim() === '';
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
  if (!id) return res.status(400).json({ error: 'film id is required' });

  const overwrite = !!(req.body && req.body.overwrite);
  const explicitSource = req.body && req.body.source;

  // 1) Load the current film row so we know which slots are already
  //    filled and have a fallback source if `source` isn't provided.
  const { data: film, error: loadErr } = await supabaseAdmin
    .from('films')
    .select('id, title, description, description_en, description_it')
    .eq('id', id)
    .single();
  if (loadErr || !film) {
    return res.status(404).json({ error: 'film not found' });
  }

  // 2) Resolve the source text + language.
  let sourceText = '';
  let sourceLang = '';
  if (explicitSource && explicitSource.text && String(explicitSource.text).trim()) {
    sourceText = String(explicitSource.text).trim();
    sourceLang = String(explicitSource.lang || '').toLowerCase();
    if (!['kr', 'en', 'it'].includes(sourceLang)) {
      sourceLang = _guessLanguage(sourceText);
    }
  } else {
    // No explicit override — pick whichever slot on the row has content,
    // preferring the languages in the order editors typically write first
    // (KR → EN → IT for this team).
    if (!_isEmpty(film.description)) {
      sourceText = String(film.description).trim();
      sourceLang = 'kr';
    } else if (!_isEmpty(film.description_en)) {
      sourceText = String(film.description_en).trim();
      sourceLang = 'en';
    } else if (!_isEmpty(film.description_it)) {
      sourceText = String(film.description_it).trim();
      sourceLang = 'it';
    }
  }

  if (!sourceText) {
    return res.status(400).json({
      error: '번역할 원문이 없습니다. KR / EN / IT 중 하나의 설명을 먼저 입력해주세요.',
    });
  }

  // 3) Hand off to the shared editorial AI lib. Pass an empty imageUrls
  //    array — films don't have a gallery, so the vision fallback
  //    path is irrelevant; we want pure translation mode (mode 1 in
  //    editorialAi.js). title is included so the model has context.
  let result;
  try {
    result = await generateEditorialDescriptions({
      title: film.title || '',
      artistStatement: sourceText,
      imageUrls: [],
    });
  } catch (e) {
    console.error('[films/translate] generator failed:', e && e.message ? e.message : e);
    return res.status(500).json({
      error: '번역 생성에 실패했습니다. 잠시 후 다시 시도해주세요.',
    });
  }

  // generateEditorialDescriptions always returns { kr, en, it } — empty
  // strings on graceful failure. If the source-language slot came back
  // blank, restore it from sourceText so we don't accidentally null it.
  const out = {
    kr: result.kr || (sourceLang === 'kr' ? sourceText : ''),
    en: result.en || (sourceLang === 'en' ? sourceText : ''),
    it: result.it || (sourceLang === 'it' ? sourceText : ''),
  };

  // 4) Decide which slots to actually write.
  //    overwrite=false → only fill EMPTY slots on the row
  //    overwrite=true  → write all three from the generator output
  const updates = {};
  const fieldsUpdated = {
    description: false, description_en: false, description_it: false,
  };
  if (out.kr && (overwrite || _isEmpty(film.description))) {
    updates.description    = out.kr;
    fieldsUpdated.description = true;
  }
  if (out.en && (overwrite || _isEmpty(film.description_en))) {
    updates.description_en = out.en;
    fieldsUpdated.description_en = true;
  }
  if (out.it && (overwrite || _isEmpty(film.description_it))) {
    updates.description_it = out.it;
    fieldsUpdated.description_it = true;
  }

  if (Object.keys(updates).length) {
    updates.updated_by = user.id;
    const { error: updErr } = await supabaseAdmin
      .from('films').update(updates).eq('id', id);
    if (updErr) {
      console.error('[films/translate] update failed:', updErr);
      return res.status(500).json({ error: 'DB update failed' });
    }
    // Audit log so editors can see "AI 번역" rows in the contents
    // history panel (QA #209) alongside hand edits.
    try {
      await recordContentChange({
        content_type: 'film',
        content_id:   id,
        action:       'update',
        actor:        user,
        summary:      `AI 자동 번역 (${sourceLang.toUpperCase()} → ${
          Object.keys(fieldsUpdated).filter(k => fieldsUpdated[k] && k !== 'description').map(k => k === 'description_en' ? 'EN' : 'IT').join(', ') || 'KR'
        })`,
        diff:         null,
      });
    } catch (_) { /* best-effort */ }
  }

  return res.status(200).json({
    description:    overwrite ? out.kr : (film.description    || out.kr),
    description_en: overwrite ? out.en : (film.description_en || out.en),
    description_it: overwrite ? out.it : (film.description_it || out.it),
    fieldsUpdated,
    sourceLang,
  });
};
