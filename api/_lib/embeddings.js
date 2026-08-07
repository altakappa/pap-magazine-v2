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

// ── Article-specific helpers (2026-08-07) ───────────────────────────────
// 왜 지금 —  기사(2,300편)에는 임베딩 자체가 없었다. 'MORE ARTICLES' 추천이
// '같은 카테고리 + 발행일 인접' 이라, 2019년 기사를 읽던 사람에게 2019년
// 기사를 붙여 주고 있었다. 그런데 사이트→IG 아웃클릭의 94%가 SSR 기사
// 페이지에서 나온다 — 사람이 실제로 들어오는 문에 제일 약한 추천이 달려
// 있었다는 뜻이다. 에디토리얼에서 이미 검증된 구조를 그대로 복사한다.
//
// 본문(content)은 넣지 않는다. 제목+요약+태그로 충분하고(에디토리얼에서
// 확인됨), 본문까지 넣으면 8k 자 상한에 걸려 잘리는 기사가 생긴다.
function articleEmbeddingText(a) {
  if (!a) return '';
  const tags = Array.isArray(a.tags) ? a.tags.join(', ')
    : (typeof a.tags === 'string' ? a.tags : '');
  /* articles 에는 summary/description 컬럼이 없다(실측). 있는 것은
     title · subtitle · category · tags · content 다. 본문은 통째로 넣지 않고
     앞 1,200자만 쓴다 — 주제는 도입부에서 거의 결정되고, 8k 자 상한에
     걸려 잘리는 사고도 막는다. */
  const body = (a.content || '').toString().replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 1200);
  const parts = [
    (a.title || '').toString().trim(),
    (a.subtitle || '').toString().trim(),
    (a.category || '').toString().trim(),
    tags ? 'Tags: ' + tags : '',
    body,
  ];
  return parts.filter(Boolean).join('. ');
}

async function embedAndStoreArticle(a) {
  if (!a || !a.id) return false;
  const vec = await embed(articleEmbeddingText(a));
  if (!vec) return false;
  const { error } = await supabaseAdmin
    .from('articles')
    .update({ embedding: toPgVectorString(vec) })
    .eq('id', a.id);
  if (error) {
    console.warn('[embeddings] article DB update failed', a.id, error.message);
    return false;
  }
  return true;
}

module.exports = { embed, toPgVectorString, MODEL,
  editorialEmbeddingText, embedAndStoreEditorial,
  articleEmbeddingText, embedAndStoreArticle };
