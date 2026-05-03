/**
 * PAP Magazine — OpenAI embeddings helper.
 *
 * Single function exposed: embed(text). Returns a 1536-dim Float32 array
 * for `text-embedding-3-small`, or null if the OPENAI_API_KEY env var is
 * missing / the API call fails. Callers MUST handle null gracefully so
 * the site degrades to tag-bucketing instead of breaking on a transient
 * OpenAI outage.
 *
 * Design choices:
 *   - text-embedding-3-small (1536 dims, multilingual, $0.02/1M tokens).
 *     Strong enough for matching editorial titles to theme bundles; if we
 *     ever bump to -large we'd need to drop the editorials.embedding
 *     column + theme_embeddings rows and re-backfill (model dimensionality
 *     mismatch).
 *   - No retry/backoff in this version. OpenAI rate limits are 3000 RPM
 *     for embeddings; we're nowhere near that. A 429 just returns null
 *     and lets the caller fall back.
 *   - Truncates input to 8000 chars (≈ 2000 tokens) so a comically long
 *     description doesn't blow past the model's 8191-token limit. Real
 *     editorial titles + descriptions are tiny (a few hundred chars).
 *   - No SDK dependency — plain fetch. Keeps the deploy bundle slim.
 */

const OPENAI_URL = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-3-small';
const MAX_INPUT_CHARS = 8000;

async function embed(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[embeddings] OPENAI_API_KEY missing — returning null');
    return null;
  }
  const cleaned = String(text || '').trim().slice(0, MAX_INPUT_CHARS);
  if (!cleaned) return null;

  try {
    const resp = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, input: cleaned }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(function () { return ''; });
      console.error('[embeddings] OpenAI', resp.status, body.slice(0, 300));
      return null;
    }
    const json = await resp.json();
    const vec = json && json.data && json.data[0] && json.data[0].embedding;
    if (!Array.isArray(vec) || vec.length !== 1536) {
      console.error('[embeddings] unexpected response shape');
      return null;
    }
    return vec;
  } catch (err) {
    console.error('[embeddings] fetch failed', err && err.message);
    return null;
  }
}

// pgvector accepts arrays as `[1.23, 4.56, ...]`-style strings via the
// PostgREST JSON path, but the supabase-js v2 client also accepts a plain
// JS number array. Provide both forms in case downstream code prefers one.
function toPgVectorString(vec) {
  return '[' + vec.join(',') + ']';
}

// ── Editorial-specific helpers ──────────────────────────────────────────
// Kept here (not in api/editorials/index.js) so the module's `module.exports
// = handler` pattern doesn't clobber the helper exports. Multiple endpoints
// (POST /editorials, PUT /editorials/:id, /admin/backfill-embeddings) all
// call this to keep the embedding text formatting identical.

const { supabaseAdmin } = require('./supabase');

// Build the embedding-input string for one editorial row. Title + description
// + tag list gives the model human-readable subject AND keyword signal —
// works in any language because text-embedding-3-small is natively multilingual.
function editorialEmbeddingText(ed) {
  const tagsStr = Array.isArray(ed.tags) ? ed.tags.join(', ') : '';
  const descStr = (ed.description || '').toString().trim();
  const titleStr = (ed.title || '').toString().trim();
  return [titleStr, descStr, tagsStr ? 'Tags: ' + tagsStr : ''].filter(Boolean).join('. ');
}

// Embed an editorial row and persist the vector. Returns boolean so the
// admin POST/PUT handlers can log without surfacing transient OpenAI
// failures to admins (the editorial itself is already saved).
async function embedAndStoreEditorial(ed) {
  if (!ed || !ed.id) return false;
  const vec = await embed(editorialEmbeddingText(ed));
  if (!vec) return false;
  const { error } = await supabaseAdmin
    .from('editorials')
    .update({ embedding: toPgVectorString(vec) })
    .eq('id', ed.id);
  if (error) {
    console.warn('[embeddings] editorial DB update failed', ed.id, error.message);
    return false;
  }
  return true;
}

module.exports = { embed, toPgVectorString, MODEL, editorialEmbeddingText, embedAndStoreEditorial };
