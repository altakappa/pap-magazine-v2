/**
 * /api/cron/backfill-ig-captions — 인스타 캡션 소급 백필 (2026-08-17)
 *
 * articles.instagram_caption 은 2026-08-14(마이그레이션 124)부터만 채워진다.
 * 그 전 수집분 약 2,300편은 캡션이 비어 있고, 그래서 두 가지가 막힌다.
 *
 *   ① 자체 취재 판별 — 네이버 초안 선정이 캡션의 '🎥 PAP' 크레딧을 본다.
 *      캡션이 없으면 전부 '자체 취재 아님'으로 떨어진다.
 *   ② 본문 보강 — 근거가 없으면 형용사로 채우게 된다. 실측했다:
 *      캡션 없이 워터밤 기사를 보강하니 521자 → 589자로 목표(800자)에 못 미쳤다.
 *
 * 하는 일은 하나뿐이다. source_instagram_post_id 로 Graph API 에서 캡션을 받아
 * articles.instagram_caption 에 넣는다. **다른 컬럼은 건드리지 않는다.**
 * 본문·제목·상태를 바꾸지 않으므로 발행 판단과 무관하다.
 *
 * 재시도 폭주 방지 — 삭제·비공개 게시물은 다시 받아도 없다. 그때는 빈 문자열을
 * 넣는다. NULL(아직 안 해봄)과 ''(해봤는데 없음)를 구분해야 매 회차마다 같은
 * 건을 다시 두드리지 않는다.
 *
 * 순서 — GSC 상위 노출 대상(article_body_backfill)을 먼저, 그다음 최신순.
 * 지금 값이 나오는 기사부터 채워야 다음 작업이 바로 굴러간다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { withCronGuard } = require('../_lib/cronGuard');
const { fetchCaptionById } = require('../_lib/instagramImport');

/* 한 회차 예산. Vercel 함수 상한 120s 안에서 끝내야 한다.
   호출 1건은 보통 0.3~1초지만 느릴 때를 대비해 넉넉히 잡는다. */
const BUDGET_MS = Number(process.env.IG_CAPTION_BUDGET_MS || 90000);
const PER_CALL_RESERVE_MS = 16000;          // fetchCaptionById 타임아웃 15s + 여유
const PER_RUN_MAX = Math.max(1, Math.min(200, parseInt(process.env.IG_CAPTION_RUN_MAX || '60', 10) || 60));

/** 아직 캡션을 시도하지 않은 기사. 상위 노출 대상 먼저, 그다음 최신순. */
async function pickTargets(limit) {
  const out = [];
  const seen = new Set();

  // 1) GSC 상위 노출 보강 대상 (article_body_backfill 에 올라온 것)
  const { data: hot } = await supabaseAdmin
    .from('article_body_backfill').select('article_id').order('impressions', { ascending: false }).limit(200);
  const hotIds = (hot || []).map((r) => r.article_id);
  if (hotIds.length) {
    const { data } = await supabaseAdmin.from('articles')
      .select('id, source_instagram_post_id')
      .in('id', hotIds)
      .is('instagram_caption', null)
      .not('source_instagram_post_id', 'is', null);
    for (const r of data || []) {
      if (out.length >= limit) break;
      if (seen.has(r.id)) continue;
      seen.add(r.id); out.push(r);
    }
  }

  // 2) 나머지는 최신순
  if (out.length < limit) {
    const { data } = await supabaseAdmin.from('articles')
      .select('id, source_instagram_post_id')
      .is('instagram_caption', null)
      .not('source_instagram_post_id', 'is', null)
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .limit(limit - out.length + 20);
    for (const r of data || []) {
      if (out.length >= limit) break;
      if (seen.has(r.id)) continue;
      seen.add(r.id); out.push(r);
    }
  }
  return out;
}

/** 남은 대상 수 (보고용) */
async function remainingCount() {
  const { count } = await supabaseAdmin.from('articles')
    .select('id', { count: 'exact', head: true })
    .is('instagram_caption', null)
    .not('source_instagram_post_id', 'is', null)
    .eq('status', 'published');
  return count || 0;
}

module.exports = withCronGuard('backfill-ig-captions', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  if (!(process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET)) {
    return res.status(401).json({ error: 'cron only' });
  }
  if (String(process.env.IG_CAPTION_BACKFILL_ENABLED || '').toLowerCase() === 'false') {
    return res.status(200).json({ ok: true, note: '비활성화 (IG_CAPTION_BACKFILL_ENABLED=false)' });
  }

  const started = Date.now();
  const targets = await pickTargets(PER_RUN_MAX);

  let filled = 0, gone = 0, failed = 0, deferred = 0;
  for (let i = 0; i < targets.length; i++) {
    if (i > 0 && Date.now() - started > BUDGET_MS - PER_CALL_RESERVE_MS) {
      deferred = targets.length - i;
      break;                                  // 다음 회차가 이어받는다
    }
    const t = targets[i];
    try {
      const m = await fetchCaptionById(t.source_instagram_post_id);
      // 삭제·비공개는 '' 로 표시해 다음 회차가 다시 두드리지 않게 한다
      const caption = m && m.caption ? m.caption : '';
      const { error } = await supabaseAdmin.from('articles')
        .update({ instagram_caption: caption }).eq('id', t.id);
      if (error) throw error;
      if (caption) filled++; else gone++;
    } catch (e) {
      failed++;
      console.error('[backfill-ig-captions]', t.id, (e && e.message) || e);
    }
  }

  const left = await remainingCount();
  const parts = [];
  if (filled) parts.push('캡션 ' + filled + '건 채움');
  if (gone) parts.push('원본 없음 ' + gone + '건');
  if (failed) parts.push('실패 ' + failed + '건');
  if (deferred) parts.push('시간 예산으로 ' + deferred + '건 이월');
  if (!parts.length) parts.push('대상 없음');

  res.locals = res.locals || {};
  res.locals.cronNote = parts.join(' · ') + ' · 남은 대상 ' + left + '건';

  return res.status(200).json({
    ok: true, filled, gone, failed, deferred, remaining: left, note: res.locals.cronNote,
  });
});

module.exports._pickTargets = pickTargets;
module.exports._BUDGET_MS = BUDGET_MS;
module.exports._PER_CALL_RESERVE_MS = PER_CALL_RESERVE_MS;
module.exports._PER_RUN_MAX = PER_RUN_MAX;
