/**
 * PAP Magazine — Threads 기사 자동 게시 크론
 * Route: /api/cron/threads-post   (3시간마다 :45 — 1건씩)
 *
 * IG 공동게시는 인스타에 올린 것만 Threads 로 가므로, 이 크론이 그 공백
 * — 웹사이트에 발행되는 기사 — 를 @pap_magazine 스레드로 채운다.
 *
 * 형식: TEXT 스레드 (제목 + 첫 문장 + 기사 URL) — 본문 첫 URL이
 * 링크 프리뷰 카드가 되어 웹 유입 통로가 된다 (X 자동 트윗과 동일 논리).
 *
 * 전제: /api/threads/oauth 1회 인증 (@pap_magazine 이 앱의 Threads 테스터).
 * 게이트: 인증 전이면 조용히 대기. 신선도 창 3일, 기사당 1회 (failed 재시도 허용).
 *
 * 수동 트리거: 관리자 토큰 GET/POST (?dry=1 로 선택 결과만 확인).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { postText } = require('../_lib/threads');

function firstSentence(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    .split(/(?<=[.!?다요])\s/)[0] || '';
}

function buildText(art, url) {
  // 500자 한도 — 제목 + 첫 문장 + URL + 태그
  const lines = [art.title];
  const fs = firstSentence(art.content);
  if (fs && fs.length <= 200) { lines.push(''); lines.push(fs); }
  lines.push('');
  lines.push(url);
  lines.push('');
  lines.push('#PAPMAGAZINE');
  let text = lines.join('\n');
  if (text.length > 500) {
    // 첫 문장을 줄여서 한도 맞춤 (URL 은 반드시 보존)
    const overflow = text.length - 500;
    const trimmed = fs.slice(0, Math.max(0, fs.length - overflow - 1)) + '…';
    text = [art.title, '', trimmed, '', url, '', '#PAPMAGAZINE'].join('\n').slice(0, 500);
  }
  return text;
}

module.exports = async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const invokedAt = new Date().toISOString();
  console.log('[threads-post] invoked at', invokedAt, 'via', cronOk ? 'cron' : 'admin');

  try {
    // 인증 전이면 대기 모드 (크론이 에러 알림을 쏟아내지 않게)
    const { data: authRow } = await supabaseAdmin.from('threads_auth').select('access_token').eq('id', 1).maybeSingle();
    if (!authRow || !authRow.access_token) {
      console.log('[threads-post] skip: no access_token');
      return res.status(200).json({ ok: true, note: 'Threads 미인증 — /api/threads/oauth 1회 인증 시 자동 게시 시작' });
    }

    const { data: posted } = await supabaseAdmin.from('threads_posts').select('article_id, status').limit(5000);
    const done = new Set((posted || []).filter((p) => p.status !== 'failed').map((p) => p.article_id).filter(Boolean));

    // freshCutoff — 최근 7일 창 (기존 3일은 너무 좁아서 발행 빈도 낮으면 항상 후보 없음)
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
    const text = buildText(art, url);

    if (req.query && req.query.dry === '1') {
      return res.status(200).json({ ok: true, dry: true, pick: { title: art.title }, text });
    }

    let threadId = null; let status = 'submitted'; let detail = null;
    try {
      threadId = await postText(text);
      status = 'published';
    } catch (err) {
      status = 'failed';
      detail = String(err && err.message || err).slice(0, 400);
    }
    await supabaseAdmin.from('threads_posts').upsert({
      article_id: art.id, thread_id: threadId, status, detail,
    }, { onConflict: 'article_id' });

    if (status === 'failed') return res.status(502).json({ error: 'threads post failed', title: art.title, detail });
    return res.status(200).json({ ok: true, posted: art.title, thread_id: threadId });
  } catch (err) {
    console.error('[threads-post] error:', err);
    return res.status(500).json({ error: 'threads cron failed', detail: String(err && err.message || err).slice(0, 200) });
  }
};
