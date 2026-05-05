/**
 * PAP Magazine — Community translation helper.
 *
 * Wraps OpenAI GPT-4o-mini behind a write-through DB cache
 * (`community_translations` table — see migration 022).
 *
 * Public API:
 *   getOrTranslate(targetType, targetId, field, sourceText, targetLang)
 *     → translatedText (string)  | original sourceText on any failure
 *
 *   translateBatch([{targetType,targetId,field,sourceText}], targetLang)
 *     → [translatedText, ...]  in same order
 *
 *   translateInline(sourceText, targetLang)
 *     → translatedText  (NO cache — for short throwaway text like UI labels)
 *
 * Cache strategy:
 *   key = (target_type, target_id, field, target_lang, source_hash)
 *   - First call: hits OpenAI, INSERTs row, returns translation
 *   - Subsequent calls: SELECT by key, returns cached
 *   - Edited source: source_hash changes → cache miss → re-translate, new row
 *
 * Cost discipline:
 *   - Skip if sourceText is empty / whitespace
 *   - Skip if detected source lang === target lang (Hangul detector covers ko)
 *   - Skip if OPENAI_API_KEY missing → returns sourceText (graceful no-op)
 *   - Skip if sourceText is too long (>4000 chars) — would blow tokens
 */

const crypto = require('crypto');
const { supabaseAdmin } = require('./supabase');

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL   = 'gpt-4o-mini';
const MAX_SOURCE_CHARS = 4000;

const LANG_NAMES = {
  ko: 'Korean', en: 'English', it: 'Italian', fr: 'French',
  es: 'Spanish', ja: 'Japanese', zh: 'Chinese (Simplified)',
  ru: 'Russian', de: 'German',
};

function _sha256_16(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

// Heuristic: if target is "en" and source contains no Hangul, no CJK ideograph,
// no Hiragana/Katakana, no Cyrillic — treat it as already-Latin and skip API.
// This is intentionally conservative: false negatives just mean we pay for
// translation that's already English-ish (cheap), false positives would
// leave non-English text untranslated (worse).
const HANGUL_RE   = /[가-힯]/;
const CJK_HAN_RE  = /[一-鿿]/;
const KANA_RE     = /[぀-ヿ]/;
const CYRILLIC_RE = /[Ѐ-ӿ]/;

function _looksAlreadyIn(targetLang, text) {
  if (!text) return true;
  // Most reliable check: same lang detection per script.
  if (targetLang === 'ko' && HANGUL_RE.test(text)) return true;
  if (targetLang === 'ja' && KANA_RE.test(text)) return true;
  if (targetLang === 'zh' && CJK_HAN_RE.test(text) && !KANA_RE.test(text) && !HANGUL_RE.test(text)) return true;
  if (targetLang === 'ru' && CYRILLIC_RE.test(text)) return true;
  if (targetLang === 'en') {
    // Only skip if NO non-Latin scripts at all
    return !HANGUL_RE.test(text) && !CJK_HAN_RE.test(text) && !KANA_RE.test(text) && !CYRILLIC_RE.test(text);
  }
  // it/fr/es/de all use Latin — same logic as en
  if (['it','fr','es','de'].includes(targetLang)) {
    return !HANGUL_RE.test(text) && !CJK_HAN_RE.test(text) && !KANA_RE.test(text) && !CYRILLIC_RE.test(text);
  }
  return false;
}

async function _callOpenAI(sourceText, targetLang) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[translate] OPENAI_API_KEY missing — returning source unchanged');
    return null;
  }
  const langName = LANG_NAMES[targetLang] || targetLang;
  const messages = [
    {
      role: 'system',
      content: 'You are a precise translator. Translate user-provided text to the target language and return ONLY the translation — no preamble, no quotes, no notes. If the text is already in the target language, return it unchanged. Preserve emoji, hashtags, @-handles, and URLs verbatim.',
    },
    {
      role: 'user',
      content: `Translate to ${langName} (${targetLang}):\n\n${sourceText}`,
    },
  ];

  try {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 2000,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[translate] OpenAI error', res.status, errText.slice(0, 200));
      return null;
    }
    const json = await res.json();
    const out = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    return (typeof out === 'string') ? out.trim() : null;
  } catch (e) {
    console.warn('[translate] OpenAI fetch failed:', e.message);
    return null;
  }
}

/**
 * Cached translation. Always returns a string — either the translation, or
 * the original sourceText on any failure. Never throws.
 */
async function getOrTranslate(targetType, targetId, field, sourceText, targetLang) {
  if (!sourceText || !sourceText.trim()) return sourceText || '';
  if (sourceText.length > MAX_SOURCE_CHARS) return sourceText; // Don't translate giant blobs
  if (_looksAlreadyIn(targetLang, sourceText)) return sourceText;
  if (!targetType || !targetId || !field || !targetLang) return sourceText;

  const sourceHash = _sha256_16(sourceText);

  // 1) Cache lookup
  try {
    const { data: cached } = await supabaseAdmin
      .from('community_translations')
      .select('translated_text')
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .eq('field', field)
      .eq('target_lang', targetLang)
      .eq('source_hash', sourceHash)
      .maybeSingle();
    if (cached && cached.translated_text) return cached.translated_text;
  } catch (e) {
    // Read failure is non-fatal — fall through to API call
  }

  // 2) Cache miss → API
  const translated = await _callOpenAI(sourceText, targetLang);
  if (!translated) return sourceText;
  // If API returned identical text (already in target lang per LLM judgment), still cache
  // so we don't pay again next time.

  // 3) Write-through cache. UNIQUE constraint protects against double-insert
  // races; on conflict we silently no-op (race winner already wrote it).
  try {
    await supabaseAdmin.from('community_translations').insert({
      target_type: targetType,
      target_id: targetId,
      field,
      target_lang: targetLang,
      source_hash: sourceHash,
      source_text: sourceText.length > 1000 ? sourceText.slice(0, 1000) + '…' : sourceText,
      translated_text: translated,
    });
  } catch (e) {
    // Race / dup — fine
  }
  return translated;
}

/**
 * Translate many small fields at once. Concurrency-bounded (3 in flight)
 * to avoid hammering the API on a 100-comment list. Returns an array
 * matching the input order.
 */
async function translateBatch(items, targetLang) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const out = new Array(items.length);
  const CONCURRENCY = 3;
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      const it = items[i];
      try {
        out[i] = await getOrTranslate(it.targetType, it.targetId, it.field, it.sourceText || '', targetLang);
      } catch (e) {
        out[i] = it.sourceText || '';
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

/**
 * Throwaway translation (no cache). Use ONLY for short content where DB
 * round-trip would cost more than just calling the API.
 */
async function translateInline(sourceText, targetLang) {
  if (!sourceText || !sourceText.trim()) return sourceText || '';
  if (_looksAlreadyIn(targetLang, sourceText)) return sourceText;
  const t = await _callOpenAI(sourceText, targetLang);
  return t || sourceText;
}

module.exports = { getOrTranslate, translateBatch, translateInline };
