/**
 * PAP Magazine — Threads 자동 게시 스위퍼 크론
 * Route: /api/cron/threads-post   (10분마다 — 1건씩)
 *
 * 2026-07-16 도메니코 결정으로 재활성화. 단순 IG 복사가 아니라 Threads
 * 어투로 Claude 가 재편집한 글을 올린다 (api/_lib/threadsAutopost.js).
 *
 * 실시간 경로는 sync-instagram 이 담당 (기사 발행 즉시 게시). 이 크론은
 * 스위퍼 — 실시간 경로가 실패했거나(failed 재시도) 다른 경로로 발행된
 * 기사(관리자 수동 발행 등)를 10분 안에 보충 게시한다.
 *
 * 형식: TEXT 스레드 — 본문 첫 URL이 링크 프리뷰 카드가 되어 웹 유입
 * 통로가 된다 (X 자동 트윗과 동일 논리).
 *
 * 전제: /api/threads/oauth 1회 인증 (@pap_magazine 이 앱의 Threads 테스터).
 * 게이트: THREADS_CRON_ENABLED=false 로만 끈다 (기본 활성).
 * 신선도 창 7일, 기사당 1회 (failed 재시도 허용).
 *
 * 수동 트리거: 관리자 토큰 GET/POST (?dry=1 로 생성 카피만 확인).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { postArticleToThreads, generateThreadsText } = require('../_lib/threadsAutopost');

module.exports = withCronGuard('threads-post', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const invokedAt = new Date().toISOString();
  console.log('[threads-post] invoked at', invokedAt, 'via', cronOk ? 'cron' : 'admin');

  // 기본 활성 — 명시적으로 THREADS_CRON_ENABLED=false 일 때만 대기.
  // (2026-07-09 의 비활성화는 'IG 캡션 복사 중복' 문제였고, 지금은 Threads
  //  네이티브 재편집이라 중복이 아니다 — 도메니코 승인으로 기본 ON.)
  if (String(process.env.THREADS_CRON_ENABLED || '').toLowerCase() === 'false') {
    console.log('[threads-post] disabled via THREADS_CRON_ENABLED=false');
    return res.status(200).json({ ok: true, note: 'Threads 자동 게시 비활성화 (THREADS_CRON_ENABLED=false)' });
  }

  try {
    // 인증 전이면 대기 모드 (크론이 에러 알림을 쏟아내지 않게)
    const { data: authRow } = await supabaseAdmin.from('threads_auth').select('access_token').eq('id', 1).maybeSingle();
    if (!authRow || !authRow.access_token) {
      console.log('[threads-post] skip: no access_token');
      return res.status(200).json({ ok: true, note: 'Threads 미인증 — /api/threads/oauth 1회 인증 시 자동 게시 시작' });
    }

    // 2026-07-23 — 실패 3회 이상 기사는 done 취급해 다음 기사로 넘어간다.
    // (이전엔 failed 를 무조건 재시도해, 영구성 오류 기사 하나가 큐 전체를
    //  막고 10분마다 실패 + 6시간마다 알림 메일을 반복했다 — 제니 기사 실측)
    const { data: posted } = await supabaseAdmin.from('threads_posts').select('article_id, status, attempts').limit(5000);
    const done = new Set((posted || [])
      .filter((p) => p.status !== 'failed' || (p.attempts || 0) >= 3)
      .map((p) => p.article_id).filter(Boolean));

    // freshCutoff — 최근 7일 창
    const freshCutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: arts, error: artsErr } = await supabaseAdmin.from('articles')
      .select('id, title, slug, custom_url, content, category, published_date')
      .eq('status', 'published')
      .gte('published_date', freshCutoff)
      .order('published_date', { ascending: false }).limit(200);
    if (artsErr) {
      console.error('[threads-post] articles query failed:', artsErr);
      return res.status(500).json({ error: 'articles query failed', detail: artsErr.message });
    }
    console.log('[threads-post] found', (arts || []).length, 'published articles in last 7d, done set has', done.size);
    const art = (arts || []).find((a) => !done.has(a.id) && a.title);
    if (!art) {
      console.log('[threads-post] no candidate article to post');
      return res.status(200).json({ ok: true, note: '게시할 기사 없음', articles_found: (arts || []).length, done_count: done.size });
    }
    console.log('[threads-post] picked article:', art.id, art.title);

    const url = 'https://www.pap-magazine.com/article/' + (art.custom_url || art.slug || '');

    if (req.query && req.query.dry === '1') {
      const gen = await generateThreadsText(art, url);
      return res.status(200).json({ ok: true, dry: true, pick: { title: art.title }, text: gen.text, ai: gen.ai });
    }

    const r = await postArticleToThreads({ id: art.id, title: art.title, content: art.content, category: art.category, url });
    if (r.status === 'failed') return res.status(502).json({ error: 'threads post failed', title: art.title, detail: r.detail });
    return res.status(200).json({ ok: true, posted: art.title, thread_id: r.thread_id, ai: r.ai });
  } catch (err) {
    console.error('[threads-post] error:', err);
    throw err; // cronGuard 가 이메일 알림 + cron_runs 기록
  }
});
