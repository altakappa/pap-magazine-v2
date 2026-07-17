/**
 * /api/cron/naver-draft-sweep — 네이버 블로그 초안 자동 보충 (2026-07-17)
 *
 * 배경: 네이버는 글쓰기 API가 없고, 자동 발행 브라우저 조작도 안전 제한으로
 * 불가하다. 그래서 "발행 직전까지"를 서버에서 무인 자동화한다 — 최근 발행된
 * PAP 기사 중 아직 네이버 초안이 없는 것을 매일 자동으로 초안 생성해 큐
 * (naver_blog_drafts, status='draft')에 쌓아둔다. 관리자는 /naver-blog 에서
 * 복사 → 네이버 붙여넣기 → 발행만 하면 된다(사람 손 = 마지막 붙여넣기뿐).
 *
 * 발행/게시가 아니라 '초안 생성·저장'만 하므로 파괴적 작업 아님.
 * NAVER_DRAFT_SWEEP_ENABLED=false 로 끌 수 있다. 하루 상한 = NAVER_DRAFT_DAILY_MAX(기본 2).
 *
 * 초안 생성은 Claude API(ANTHROPIC_API_KEY)를 호출하므로 건당 비용이 있어
 * 한 실행에 소량(기본 2건)만 생성한다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { withCronGuard } = require('../_lib/cronGuard');
const { generateNext } = require('../admin/naver-blog-draft');

module.exports = withCronGuard('naver-draft-sweep', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    // 크론 시크릿 없이 열리면 거부 (관리자 수동 트리거는 /naver-blog 도구 사용)
    return res.status(401).json({ error: 'cron only' });
  }

  if (String(process.env.NAVER_DRAFT_SWEEP_ENABLED || '').toLowerCase() === 'false') {
    return res.status(200).json({ ok: true, note: '비활성화 (NAVER_DRAFT_SWEEP_ENABLED=false)' });
  }

  const dailyMax = Math.max(1, Math.min(5, parseInt(process.env.NAVER_DRAFT_DAILY_MAX || '2', 10) || 2));

  const generated = [];
  let doneReason = null;
  try {
    for (let i = 0; i < dailyMax; i++) {
      const r = await generateNext('pap', 'article');
      if (r.done) { doneReason = '미전환 기사 없음 (큐 최신 상태)'; break; }
      generated.push({ slug: r.slug, title: r.draft && r.draft.title });
    }
  } catch (e) {
    // 한 건 실패해도 이미 생성된 건 유지하고 보고 (cronGuard 가 실패 기록/알림)
    console.error('[naver-draft-sweep] error:', e && e.message);
    if (!generated.length) throw e;
  }

  const { count } = await supabaseAdmin.from('naver_blog_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('brand', 'pap').eq('kind', 'article').eq('status', 'draft');

  res.locals = res.locals || {};
  res.locals.cronNote = generated.length
    ? (generated.length + '건 초안 생성 · 큐 대기 ' + (count || '?') + '건')
    : (doneReason || '생성할 신규 없음') + ' · 큐 대기 ' + (count || '?') + '건';

  return res.status(200).json({
    ok: true, generated: generated.length, items: generated,
    queueDraftCount: count || 0, note: res.locals.cronNote,
  });
});
