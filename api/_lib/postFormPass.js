/**
 * PAP Magazine — 형태(post_form) 판정 2차 패스 (2026-09-08 신설)
 *
 * celeb-classify 크론이 자기 일을 끝낸 뒤 이 함수를 부른다.
 *
 * 왜 남의 크론에 얹는가 ──────────────────────────────────────────────
 * tests/vercel-cost-guard 실측: 하루 크론 호출 2,598 / 예산 2,600. 여유가 2회다.
 * 새 크론을 만들면 예산을 올려야 하고, 그건 도메니코 돈이라 코드가 혼자 정할 일이
 * 아니다. 반면 celeb-classify 는 10분마다(하루 144회) 도는데 **대기열이 0건**이다
 * (published 2,592건 전부 digest_kind 채워짐, 2026-09-08 실측). 아무것도 안 하고
 * 돌아 나가던 자리에 이 일을 넣는다 — 추가 호출 0.
 *
 * 대기열을 IG 게시물로 한정하는 이유 ─────────────────────────────────
 * 형태는 **계측용 라벨**이다. 계측 대상은 인스타에 올라간 글뿐이다
 * (도달·저장·공유가 그것에만 붙는다). source_instagram_url 이 없는 기사까지
 * 물으면 2,592건에 AI 를 쓰고 쓸 데가 없다.
 *
 * 안전 설계 (celeb-classify 와 같은 규칙) ────────────────────────────
 *   · post_form_by='manual' 은 절대 안 건드린다 (저장 시 .is('post_form', null))
 *   · 응답이 깨지면 그 배치는 통째로 버린다 — 반만 저장하면 어디까지 됐는지 모른다
 *   · upsert 금지, UPDATE 만 (2026-08-07 celeb-classify 사고: PostgREST upsert 는
 *     INSERT ... ON CONFLICT 라 NOT NULL 컬럼에서 터진다)
 *   · 실패해도 celeb-classify 의 응답을 500 으로 만들지 않는다 — 이건 곁다리 일이다
 */

'use strict';

const { supabaseAdmin } = require('./supabase');
const { SYSTEM, buildUserPrompt, parseFormVerdicts } = require('./postForm');
const { reportAiResponse } = require('./aiCreditWatch');

const MODEL = process.env.POST_FORM_MODEL || process.env.CELEB_CLASSIFY_MODEL || 'claude-haiku-4-5-20251001';
const BATCH = Math.max(1, Math.min(50, Number(process.env.POST_FORM_BATCH) || 25));
const MAX_BATCHES = Math.max(0, Math.min(10, Number(process.env.POST_FORM_MAX_BATCHES) || 2));
/* 창을 좁히는 이유: 도달 지표(ig_post_metric)가 2026-07-24 부터만 있다.
   그 이전 글에 라벨을 붙여도 짝이 될 숫자가 없다. 0 을 주면 전체. */
const DAYS = Number(process.env.POST_FORM_DAYS || 120);

async function askClaude(rows) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUserPrompt(rows) }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  const j = await r.json().catch(() => ({}));
  try { reportAiResponse({ ok: r.ok, status: r.status, body: j, where: 'post-form' }); } catch (_e) { /* 알림 실패가 분류를 막지 않는다 */ }
  if (!r.ok) throw new Error('AI 호출 실패 ' + r.status + ': ' + JSON.stringify(j).slice(0, 200));
  const text = (j.content || []).map((c) => c.text || '').join('');
  return parseFormVerdicts(text);
}

async function applyForm(ids, form) {
  if (!ids || !ids.length) return null;
  const { error } = await supabaseAdmin.from('articles')
    .update({ post_form: form, post_form_by: 'ai' })
    .in('id', ids)
    .is('post_form', null);          // 그 사이 사람이 채운 값을 덮지 않는다
  return error || null;
}

/**
 * @returns {{saved:number, batches:number, remaining:number|null, note:string, failures:string[]}}
 *          note 는 celeb-classify 의 note 뒤에 붙일 한 조각.
 */
async function runPostFormPass(opts) {
  const maxBatches = (opts && typeof opts.maxBatches === 'number') ? opts.maxBatches : MAX_BATCHES;
  const out = { saved: 0, batches: 0, remaining: null, note: '', failures: [] };
  if (!maxBatches) { out.note = '형태 판정 꺼짐'; return out; }
  if (!process.env.ANTHROPIC_API_KEY) { out.note = '형태 판정 건너뜀 (AI 키 없음)'; return out; }

  let q = supabaseAdmin.from('articles')
    .select('id, title, category, tags, instagram_caption, post_form')
    .eq('status', 'published')
    .not('source_instagram_url', 'is', null)
    .is('post_form', null)
    .order('published_date', { ascending: false })
    .limit(BATCH * maxBatches);
  if (DAYS > 0) q = q.gte('published_date', new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10));

  const { data, error } = await q;
  if (error) { out.failures.push('대기열 조회 실패: ' + error.message); out.note = '형태 판정 대기열 조회 실패'; return out; }

  const rows = data || [];
  for (let i = 0; i < rows.length && out.batches < maxBatches; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    out.batches += 1;
    let verdicts = null;
    try {
      verdicts = await askClaude(chunk);
    } catch (e) {
      out.failures.push(String((e && e.message) || e).slice(0, 120));
      break;                                  // 한도·장애면 다음 실행에 재개
    }
    if (!verdicts || !verdicts.length) { out.failures.push('응답 파싱 실패 (배치 ' + out.batches + ')'); continue; }

    const byForm = new Map();
    verdicts.forEach((v) => {
      if (!chunk[v.i]) return;
      if (!byForm.has(v.form)) byForm.set(v.form, []);
      byForm.get(v.form).push(chunk[v.i].id);
    });
    for (const [form, ids] of byForm) {
      const e = await applyForm(ids, form);
      if (e) { out.failures.push('저장 실패: ' + e.message); return finish(out); }
      out.saved += ids.length;
    }
  }
  return finish(out);
}

/* 남은 대기열은 DB 에 직접 묻는다 — 이번에 '가져온' 수로 진행률을 적으면
   거짓말이 된다(2026-08-07 celeb-classify 가 그 실수를 했다). */
async function finish(out) {
  try {
    let c = supabaseAdmin.from('articles').select('id', { count: 'exact', head: true })
      .eq('status', 'published').not('source_instagram_url', 'is', null).is('post_form', null);
    if (DAYS > 0) c = c.gte('published_date', new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10));
    const { count } = await c;
    if (typeof count === 'number') out.remaining = count;
  } catch (_e) { /* 못 세면 null 로 둔다 — 모르는 걸 아는 척하지 않는다 */ }
  out.note = out.saved
    ? '형태 판정 ' + out.saved + '건' + (out.remaining == null ? '' : ' · 남은 ' + out.remaining + '건')
    : (out.failures.length ? '형태 판정 0건 — ' + out.failures[0] : '형태 판정 대기 없음');
  return out;
}

module.exports = { runPostFormPass, applyForm, BATCH, MAX_BATCHES, DAYS };
