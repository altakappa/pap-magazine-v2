/**
 * PAP Magazine — X 에는 셀럽 기사만 올린다 (2026-11-02 신설)
 *
 * 도메니코 2026-11-02: "모든 기사가 아니라 셀럽에 관련된 기사만 X에 올리는걸로 설정하자."
 *
 * 왜: X API 는 링크 달린 글 1건에 약 $0.20 이다(2026-10 기준). 한도에 걸리기 전 하루 23건,
 * 월 약 $138 를 썼고 그 30일 X 유입은 390명(1명당 약 $0.35). 10/23 월 지출 한도에 걸려
 * 10일간 X 가 멈췄다. 14일 실측으로 발행 기사의 61%(160건 중 98건)가 셀럽이다.
 *
 * 판정 = 다이제스트가 이미 쓰는 갈래(digest_kind)와 같은 기준:
 *   ① 태그 마커(digestKind.markerKind)가 celeb → 바로 통과 (돈 안 듦, 아이돌은 대부분 여기서 걸린다)
 *   ② 아니면 celeb-classify 와 **같은 프롬프트**로 하이쿠에 한 번 묻는다
 *      (배우·할리우드 셀럽은 마커가 못 잡는다: 변우석·우도환·헤일리 비버 …)
 *      판정은 articles.digest_kind 에 저장해 celeb-classify 가 다시 묻지 않게 한다.
 *   ③ AI 가 실패하면 올리지 않는다 — 돈이 드는 쪽이 안전한 기본값이 아니다.
 *
 * 끄기: Vercel 환경변수 X_SCOPE=all → 예전처럼 전부 X 에 올린다.
 * 절대 throw 하지 않는다. 판정 실패가 웹 발행·스레드를 막으면 안 된다.
 */
'use strict';

const AI_TIMEOUT_MS = 8000;

function xScopeAll() {
  return String(process.env.X_SCOPE || 'celeb').trim().toLowerCase() === 'all';
}

/**
 * @param {{id?:string, title?:string, tags?:any, category?:string}} article
 * @param {{ask?:Function, save?:Function}} [deps] 테스트용 주입
 * @returns {Promise<{post:boolean, why:string}>}
 */
async function celebForX(article, deps) {
  try {
    if (xScopeAll()) return { post: true, why: 'scope_all' };
    const a = article || {};
    const { markerKind } = require('./digestKind');
    if (markerKind(a).kind === 'celeb') return { post: true, why: 'marker' };

    const d = deps || {};
    const ask = d.ask || askOnce;
    const kind = await ask(a);
    if (!kind) return { post: false, why: 'ai_unavailable' };
    if (a.id) { try { await (d.save || saveKind)(a.id, kind); } catch (_) { /* 저장 실패는 판정을 안 바꾼다 */ } }
    return { post: kind === 'celeb', why: 'ai_' + kind };
  } catch (e) {
    console.warn('[xCelebGate] 판정 실패 → X 건너뜀:', (e && e.message) || e);
    return { post: false, why: 'error' };
  }
}

/** celeb-classify 와 같은 SYSTEM 프롬프트로 한 건만 묻는다. 실패하면 null. */
async function askOnce(a) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const cc = require('../cron/celeb-classify');   // SYSTEM·buildUserPrompt·parseVerdicts 재사용 (같은 기준)
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.CELEB_CLASSIFY_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: cc.SYSTEM,
      messages: [{ role: 'user', content: cc.buildUserPrompt([a]) }],
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  const text = (j.content || []).map((c) => c.text || '').join('');
  const v = cc.parseVerdicts(text);
  return (v && v[0] && v[0].kind) || null;
}

/** 판정을 저장 — 비어 있을 때만 (사람이 고친 값·이미 있는 값은 안 건드린다) */
async function saveKind(id, kind) {
  if (!process.env.SUPABASE_URL) return;
  const { supabaseAdmin } = require('./supabase');
  await supabaseAdmin.from('articles').update({ digest_kind: kind, kind_by: 'ai' })
    .eq('id', id).is('digest_kind', null);
}

module.exports = { celebForX, xScopeAll, AI_TIMEOUT_MS };
