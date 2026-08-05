/**
 * /api/cron/naver-draft-sweep — 네이버 블로그 초안 자동 보충 (2026-07-17)
 *
 * 배경: 네이버는 글쓰기 API가 없고, 자동 발행 브라우저 조작도 안전 제한으로
 * 불가하다. 그래서 "발행 직전까지"를 서버에서 무인 자동화한다 — 최근 발행된
 * PAP 기사 중 아직 네이버 초안이 없는 것을 자동으로 초안 생성해 큐
 * (naver_blog_drafts, status='draft')에 쌓아둔다. 관리자는 /naver-blog 에서
 * 복사 → 네이버 붙여넣기 → 발행만 하면 된다(사람 손 = 마지막 붙여넣기뿐).
 *
 * ── 2026-08-05 개정 (도메니코 지시) ─────────────────────────────────────
 * 큐가 계속 불어나던 것을 멈춘다. 14일 실측: 생성 124건 / 발행 76건 →
 * 하루 +3.4건씩 쌓여 대기 58건, 가장 오래된 건 16일 묵었다.
 * 붙여넣기는 사람 손이라 생성 속도를 못 따라간다. 즉 넘치는 만큼은
 * **처음부터 돈만 쓰고 버려지는 초안**이었다(건당 Claude API 호출).
 *
 *   1) 만료   — 만든 지 NAVER_DRAFT_TTL_DAYS(기본 7)일 지난 draft 는
 *               status='expired' 로 내린다. **삭제가 아니라 상태 변경**이라
 *               되돌릴 수 있고, 관리자 목록(status='draft')에서만 빠진다.
 *   2) 상한   — 대기 큐가 NAVER_DRAFT_QUEUE_MAX(기본 30)건 이상이면 그 회차는
 *               생성을 건너뛴다. 버릴 초안을 미리 만들지 않는다 = 비용 절감.
 *   3) 순서   — '오래된 미전환부터' → '최신 기사부터'로 뒤집었다.
 *               큐를 줄이면 살아남는 초안이 최신이어야 검색 유입에 유리하다.
 *               (NAVER_DRAFT_ORDER=oldest 로 옛 동작 복귀 가능)
 *
 * 실행 순서가 중요하다 — 만료를 **먼저** 돌려 자리를 비운 뒤 상한을 잰다.
 * 반대로 하면 만료로 비는 자리를 그 회차가 못 쓴다.
 * ────────────────────────────────────────────────────────────────────────
 *
 * 발행/게시가 아니라 '초안 생성·저장'만 하므로 파괴적 작업 아님.
 * NAVER_DRAFT_SWEEP_ENABLED=false 로 끌 수 있다. 실행 1회당 상한 =
 * NAVER_DRAFT_DAILY_MAX(기본 4, 최대 4 — 함수 타임아웃 120s 안전선).
 * 크론이 4시간마다(하루 6회) 돈다.
 *
 * 초안 생성은 Claude API(ANTHROPIC_API_KEY)를 호출하므로 건당 비용이 있어
 * 한 실행에 최대 4건만 생성하고, 부족분은 다음 크론 실행이 이어서 채운다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { withCronGuard } = require('../_lib/cronGuard');
const { generateNext } = require('../admin/naver-blog-draft');

const BRAND = 'pap';
const KIND = 'article';

/** 대기 중(draft) 초안 수 */
async function queueCount() {
  const { count } = await supabaseAdmin.from('naver_blog_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('brand', BRAND).eq('kind', KIND).eq('status', 'draft');
  return count || 0;
}

/**
 * TTL 지난 draft 를 expired 로 내린다. 삭제하지 않는다.
 * @returns {Promise<number>} 만료시킨 건수
 */
async function expireStale(ttlDays) {
  if (!(ttlDays > 0)) return 0;
  const cutoff = new Date(Date.now() - ttlDays * 86400000).toISOString();
  const { data, error } = await supabaseAdmin.from('naver_blog_drafts')
    .update({ status: 'expired' })
    .eq('brand', BRAND).eq('kind', KIND).eq('status', 'draft')
    .lt('created_at', cutoff)
    .select('id');
  if (error) throw error;
  return (data || []).length;
}

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

  const dailyMax = Math.max(1, Math.min(4, parseInt(process.env.NAVER_DRAFT_DAILY_MAX || '4', 10) || 4));
  const ttlDays = Math.max(0, parseInt(process.env.NAVER_DRAFT_TTL_DAYS || '7', 10) || 0);
  const queueMax = Math.max(0, parseInt(process.env.NAVER_DRAFT_QUEUE_MAX || '30', 10) || 0);

  // 1) 만료 먼저 — 자리를 비운 뒤에 상한을 재야 그 자리를 이 회차가 쓴다
  const expired = await expireStale(ttlDays);

  // 2) 상한 — 큐가 차 있으면 생성을 건너뛴다 (버릴 초안을 미리 만들지 않는다)
  const before = await queueCount();
  const parts = [];
  if (expired) parts.push('만료 ' + expired + '건');

  if (queueMax && before >= queueMax) {
    parts.push('큐 상한 도달 — 생성 건너뜀 (' + before + '/' + queueMax + ')');
    res.locals = res.locals || {};
    res.locals.cronNote = parts.join(' · ') + ' · 큐 대기 ' + before + '건';
    return res.status(200).json({
      ok: true, generated: 0, items: [], expired,
      skipped: 'queue_full', queueDraftCount: before,
      queueMax, note: res.locals.cronNote,
    });
  }

  // 3) 생성 — 상한을 넘지 않는 만큼만
  const room = queueMax ? Math.max(0, queueMax - before) : dailyMax;
  const budget = Math.min(dailyMax, room);

  const generated = [];
  let doneReason = null;
  try {
    for (let i = 0; i < budget; i++) {
      const r = await generateNext(BRAND, KIND);
      if (r.done) { doneReason = '미전환 기사 없음 (큐 최신 상태)'; break; }
      generated.push({ slug: r.slug, title: r.draft && r.draft.title });
    }
  } catch (e) {
    // 한 건 실패해도 이미 생성된 건 유지하고 보고 (cronGuard 가 실패 기록/알림)
    console.error('[naver-draft-sweep] error:', e && e.message);
    if (!generated.length) throw e;
  }

  const after = await queueCount();
  parts.push(generated.length
    ? generated.length + '건 초안 생성'
    : (doneReason || '생성할 신규 없음'));

  res.locals = res.locals || {};
  res.locals.cronNote = parts.join(' · ') + ' · 큐 대기 ' + after + '건'
    + (queueMax ? '/' + queueMax : '');

  return res.status(200).json({
    ok: true, generated: generated.length, items: generated,
    expired, queueDraftCount: after, queueMax, ttlDays,
    note: res.locals.cronNote,
  });
});

// 테스트용 — 순수 로직 검증에 쓴다
module.exports._expireStale = expireStale;
module.exports._queueCount = queueCount;
