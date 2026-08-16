/**
 * PAP Magazine — 영어로 저장된 다국어 제목만 골라 다시 번역한다 (2026-08-16 신설)
 *
 * ── 왜 별도 경로인가 ─────────────────────────────────────────────────
 * seo_translations 전수 실측: 제목이 articles.title_en 과 **완전히 동일한** 행
 *     es 653/2,372 (27.5%) · it 603/2,370 (25.4%)
 *     fr 510/2,370 (21.5%) · de 139/2,369 (5.9%)   ja·zh·ru 은 0
 * ja/zh/ru 이 0 인 게 원인을 말해준다 — 문자가 다르면 못 속인다.
 * 라틴 문자 언어는 영어를 그대로 뱉어도 어떤 검사에도 안 걸렸다.
 * (근본 원인과 재발 방지는 커밋 b71e75e 에서 막았다. 여기는 **이미 저장된 것**의 수리다.)
 *
 * 기존 백필 큐로 고치려면 본문까지 통째로 재번역해야 한다 — 기사 1,905편의
 * 본문은 수백만 토큰이고, 도메니코의 돈이다. 제목은 한 줄이다.
 * **제목만 고치면 같은 결과를 1/100 비용으로 얻는다.** 그래서 경로를 나눈다.
 *
 * ── 안전 ─────────────────────────────────────────────────────────────
 * · seo_translations.title 만 UPDATE 한다. 발행 상태·본문·삭제는 건드리지 않는다.
 * · 새 제목이 검사를 통과할 때만 쓴다. 못 고치면 **그냥 둔다** — 영어 제목이
 *   깨진 제목보다는 낫다.
 * · 기본은 dry-run 이다. 호출자가 명시적으로 켜야 쓴다.
 */

'use strict';

const { hasHangul, isEnglishEcho, nameRule, LANG_NAMES } = require('./seoTranslateBackfill');

/* 이 수리가 대상으로 삼는 언어. ja/zh/ru 은 애초에 이 사고가 안 난다. */
const REPAIR_LANGS = ['es', 'it', 'fr', 'de'];

/** 이 행을 고쳐야 하는가. 순수 함수 — 테스트가 동작을 직접 본다.
 *  @param row { lang, title, title_en, title_ko }
 */
function needsRepair(row) {
  if (!row || !REPAIR_LANGS.includes(row.lang)) return false;
  if (!row.title || !row.title_en) return false;
  return isEnglishEcho(row.title, row.title_en, row.lang);
}

/** 제목만 번역시키는 배치 프롬프트.
 *  본문·설명을 안 싣는 것이 이 경로의 전부다 — 토큰이 거기서 나온다. */
function buildTitlePrompt(items, lang) {
  const src = items.map((e, i) => ({
    i,
    korean_title: String(e.title_ko || ''),
    english_title: String(e.title_en || ''),
  }));
  return `You are localising fashion-magazine HEADLINES for PAP MAGAZINE into ${LANG_NAMES[lang]}.\n`
    + `Each input has the Korean original and an English version of the same headline.\n`
    + `Rules:\n`
    + `- Return the headline in ${LANG_NAMES[lang]}. Translate the sentence.\n`
    + `- The English version is a REFERENCE ONLY. Returning it unchanged is a failure — `
    + `${LANG_NAMES[lang]} uses the same alphabet as English, which is exactly how this went wrong before.\n`
    + `- Brand names and stylized Latin titles (Prada, Converse, "CRIMSON") stay as they are, `
    + `but the sentence around them must be in ${LANG_NAMES[lang]}.\n`
    + `- The output MUST NOT contain any Hangul (Korean script).\n`
    + `- ${nameRule(lang)}\n`
    + `- Keep it headline-length. No trailing period, no quotes around the whole line.\n`
    + `- Return ONLY a JSON array, one object per input: {"i":<index>,"title":"..."}. `
    + `No prose, no code fences.\n`
    + `Input JSON:\n` + JSON.stringify(src);
}

/** 응답에서 {i,title} 만 건져낸다. 코드펜스·잡문이 섞여도 죽지 않는다. */
function parseTitles(text) {
  const s = String(text || '');
  const a = s.indexOf('[');
  const b = s.lastIndexOf(']');
  if (a === -1 || b === -1 || b <= a) return [];
  let arr;
  try { arr = JSON.parse(s.slice(a, b + 1)); } catch (_) { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter(o => o && typeof o === 'object'
    && Number.isInteger(o.i) && typeof o.title === 'string' && o.title.trim());
}

/** 고쳐진 제목을 받아들일 것인가. 못 고쳤으면 옛것을 그대로 둔다.
 *  @returns null 이면 통과, 문자열이면 거부 사유 */
function rejectReason(newTitle, row) {
  const t = String(newTitle || '').trim();
  if (!t) return 'empty';
  if (hasHangul(t)) return 'hangul';
  if (isEnglishEcho(t, row.title_en, row.lang)) return 'still_english';
  if (t === String(row.title || '').trim()) return 'unchanged';
  if (t.length > 300) return 'too_long';
  return null;
}

module.exports = { REPAIR_LANGS, needsRepair, buildTitlePrompt, parseTitles, rejectReason };
