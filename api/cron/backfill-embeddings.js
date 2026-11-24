/**
 * PAP Magazine — 임베딩 백필 크론 (2026-08-07 신설)
 * Route: /api/cron/backfill-embeddings   (10분 주기)
 *
 * 왜 필요한가 ───────────────────────────────────────────────────────
 * 추천의 재료를 채우는 일이다. 실측 상태:
 *   에디토리얼 2,295편 → 임베딩 2,259 (36편 고아)
 *   기사       2,300편 → 임베딩 0     (컬럼 자체가 오늘 생겼다)
 *
 * 임베딩이 없는 글은 추천에서 **양방향으로** 빠진다 — 자기도 추천을 못 받고,
 * 남의 추천 후보에도 안 오른다. 고아 36편이 그 상태로 방치돼 있었다.
 *
 * 기존 /api/admin/backfill-embeddings 는 관리자가 손으로 누르는 일회성이다.
 * 2,336건을 한 번에 처리할 수 없고(함수 시간 제한), 새 글이 들어올 때마다
 * 누가 눌러 줘야 한다. 그래서 스스로 도는 크론으로 만든다.
 *
 * 설계 ──────────────────────────────────────────────────────────────
 *   · 에디토리얼 고아를 먼저 비운다 — 이미 추천 UI 가 붙어 있어 효과가 즉시다.
 *   · 그다음 기사. 최신순으로 채운다 — 검색 유입이 최신 기사에 몰린다.
 *   · 실행마다 시간 예산(기본 45초)을 지킨다. 남으면 다음 실행이 이어받는다.
 *     '한 번에 다 하기' 보다 '매번 조금씩, 절대 안 죽기' 가 낫다.
 *   · OPENAI_API_KEY 가 없으면 조용히 넘어간다 — 추천은 폴백으로 계속 돈다.
 *   · 한 건 실패가 배치를 멈추지 않는다. 다음 실행에 다시 만난다.
 *
 * 비용: text-embedding-3-small 은 $0.02/1M 토큰. 글 하나가 ~200토큰이니
 * 2,336건 전량이 약 $0.01 이다. 이후에는 새 글만 처리한다.
 *
 * 환경변수:
 *   OPENAI_API_KEY                 필수 (없으면 건너뜀)
 *   EMBED_BACKFILL_BUDGET_MS       기본 45000 (상한 90000)
 *   EMBED_BACKFILL_MAX             기본 60 (한 실행 최대 건수)
 */

'use strict';

const { bearerOk } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const {
  embedAndStoreEditorial, editorialEmbeddingText,
  embedAndStoreArticle, articleEmbeddingText,
  lastEmbedFailure, isFatalEmbedFailure,
} = require('../_lib/embeddings');
const bb = require('../_lib/billingBackoff');   // 결제 막힘 백오프 (2026-11-24)
const BB_KEY = 'openai-embeddings';

/* 2026-11-17 — 실패 사유를 note 에 싣고, 계정 고장이면 멈춘다. 11/02~11/17 크레딧
 * 소진 동안 note 엔 글 id 뿐이었고 10분마다 73번씩 같은 429 를 두드렸다. */
function failTag(f) {
  if (!f) return '';
  const label = { credit: '크레딧 소진', auth: '키 오류', rate: '레이트리밋',
    network: '네트워크', shape: '응답 형태 이상' }[f.kind] || 'HTTP';
  return 'openai ' + (f.status || '-') + ' ' + label;
}

function envInt(name, dflt, min, max) {
  const n = parseInt(process.env[name] || '', 10);
  if (!isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
const BUDGET_MS = envInt('EMBED_BACKFILL_BUDGET_MS', 45000, 10000, 90000);
const MAX_ITEMS = envInt('EMBED_BACKFILL_MAX', 60, 1, 200);

function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

module.exports = withCronGuard('backfill-embeddings', async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  res.locals = res.locals || {};

  // 버셀 크론은 Authorization: Bearer $CRON_SECRET 을 보낸다.
  // (x-vercel-cron 헤더는 오지 않는다 — celeb-classify 가 그걸로 하루를 버렸다.)
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
  if (!cronOk) {
    const admin = await requireAdmin(req, res);
    if (!admin) { note(res, '인증 거부 — 크론 시크릿도 관리자 세션도 아님'); return; }
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({ ok: true,
      note: note(res, 'OPENAI_API_KEY 미설정 — 건너뜀 (추천은 폴백으로 계속 돈다)') });
  }

  /* 2026-11-24 — 결제로 막혔는데 30분마다 같은 429 를 두드리던 걸 멈춘다.
     11/02~11/24 동안 약 1,050회가 그랬다. 창이 닫혀 있으면 OpenAI 를
     아예 부르지 않고, 연속 3회부터는 503 으로 돌려 cronGuard 가 실패로
     적게 한다 — 그 1,050회는 전부 ok=true 로 기록됐다.
     어드민이 ?force=1 로 부르면 창을 무시한다(충전 직후 즉시 확인용). */
  const forced = !!(req.query && (req.query.force === '1' || req.query.force === 'true'));
  const block = await bb.check(BB_KEY);
  if (block.skip && !forced) {
    const msg = note(res, '건너뜀 — ' + bb.describe(block));
    return res.status(block.shouldFail ? 503 : 200).json({
      ok: !block.shouldFail, skipped: 'billing_blocked', note: msg,
      consecutive: block.consecutive, nextAttemptAt: block.nextAt,
    });
  }

  const started = Date.now();
  const left = () => BUDGET_MS - (Date.now() - started);

  let edDone = 0, artDone = 0, failed = 0;
  const errors = [];
  let lastFail = null;     // 마지막 임베딩 실패(종류 포함)
  let halted = false;      // 크레딧·키 고장으로 배치를 멈췄나

  // ── 1) 에디토리얼 고아부터 (추천 UI 가 이미 붙어 있어 효과가 즉시다)
  const { data: eds, error: edErr } = await supabaseAdmin
    .from('editorials').select('id, title, description, tags')
    .eq('status', 'published').is('embedding', null)
    .order('published_date', { ascending: false }).limit(MAX_ITEMS);
  if (edErr) {
    note(res, '에디토리얼 대기열 조회 실패: ' + edErr.message);
    return res.status(502).json({ ok: false, error: 'editorial queue failed', detail: edErr.message });
  }
  for (const ed of (eds || [])) {
    if (left() < 3000) break;
    if (!editorialEmbeddingText(ed)) { failed += 1; errors.push('빈 텍스트(ed) ' + ed.id); continue; }
    const ok = await embedAndStoreEditorial(ed);
    if (ok) edDone += 1; else {
      failed += 1; errors.push('ed ' + ed.id);
      lastFail = lastEmbedFailure() || lastFail;
      if (isFatalEmbedFailure(lastEmbedFailure())) { halted = true; break; }
    }
  }

  // ── 2) 기사 — 최신순 (검색 유입이 최신에 몰린다)
  const roomLeft = MAX_ITEMS - edDone;
  if (!halted && roomLeft > 0 && left() > 3000) {
    const { data: arts, error: artErr } = await supabaseAdmin
      .from('articles').select('id, title, subtitle, category, tags, content')
      .eq('status', 'published').is('embedding', null)
      .order('published_date', { ascending: false }).limit(roomLeft);
    if (artErr) {
      note(res, '기사 대기열 조회 실패: ' + artErr.message);
      return res.status(502).json({ ok: false, error: 'article queue failed', detail: artErr.message });
    }
    for (const a of (arts || [])) {
      if (left() < 3000) break;
      if (!articleEmbeddingText(a)) { failed += 1; errors.push('빈 텍스트(art) ' + a.id); continue; }
      const ok = await embedAndStoreArticle(a);
      if (ok) artDone += 1; else {
        failed += 1; errors.push('art ' + a.id);
        lastFail = lastEmbedFailure() || lastFail;
        if (isFatalEmbedFailure(lastEmbedFailure())) { halted = true; break; }
      }
    }
  }

  // ── 3) 남은 대기 — 진행률은 DB 에 직접 묻는다 (근사치는 거짓말을 한다)
  let edLeft = null, artLeft = null;
  try {
    const [e1, a1] = await Promise.all([
      supabaseAdmin.from('editorials').select('id', { count: 'exact', head: true })
        .eq('status', 'published').is('embedding', null),
      supabaseAdmin.from('articles').select('id', { count: 'exact', head: true })
        .eq('status', 'published').is('embedding', null),
    ]);
    edLeft = typeof e1.count === 'number' ? e1.count : null;
    artLeft = typeof a1.count === 'number' ? a1.count : null;
  } catch (_e) { /* 못 세도 처리 결과는 남긴다 */ }

  /* 결과를 백오프에 적는다. 한 건이라도 성공했으면 계정은 살아 있다 —
     줄을 지워 즉시 정상으로 돌린다. 반대로 계정 고장이면 창을 뒤로 민다. */
  let bbState = null;
  if (halted && lastFail) {
    bbState = await bb.recordBlocked(BB_KEY, lastFail.status, lastFail.kind);
  } else if (edDone + artDone > 0 || (!failed && !halted)) {
    if (block.consecutive) await bb.clear(BB_KEY);
  }

  const total = edDone + artDone;
  const why = failed ? failTag(lastFail) : '';
  const tail = (why ? ' [' + why + ']' : '')
    + (halted ? ' · 계정 고장이라 이번 회차 중단(남은 대기 ' + ((edLeft || 0) + (artLeft || 0)) + ')' : '')
    + (bbState ? ' · 다음 시도 ' + bbState.waitMin + '분 뒤(연속 ' + bbState.consecutive + '회)' : '');
  const msg = (total === 0
    ? (edLeft === 0 && artLeft === 0
      ? '임베딩 대기 없음 — 완주'
      : '이번 실행 0건' + (failed ? (' · 실패 ' + failed + ' (' + errors[0] + ')') : ''))
    : '임베딩 ' + total + '건 (에디토리얼 ' + edDone + ' · 기사 ' + artDone + ')'
      + ' · 남은 대기 에디토리얼 ' + (edLeft == null ? '?' : edLeft)
      + ' · 기사 ' + (artLeft == null ? '?' : artLeft)
      + (failed ? ' · 실패 ' + failed : '')) + tail;

  /* 연속 3회 이상 결제로 막혔으면 5xx. cronGuard 가 ok=false 로 적고
     cron-failing-streak 감시가 그걸 집어 든다. 돌았다는 게 한 일은 아니다. */
  const failNow = !!(bbState && bbState.shouldFail);
  return res.status(failNow ? 503 : 200).json({
    ok: !failNow, editorials: edDone, articles: artDone, failed,
    failure: lastFail ? { status: lastFail.status, kind: lastFail.kind } : null, halted,
    remaining: { editorials: edLeft, articles: artLeft },
    elapsedMs: Date.now() - started,
    errors: errors.slice(0, 3),
    note: note(res, msg),
  });
});
