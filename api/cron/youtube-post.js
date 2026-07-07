/**
 * PAP Magazine — YouTube Shorts 자동 업로드 크론
 * Route: /api/cron/youtube-post   (하루 2회 — 10:15 / 22:15 KST)
 *
 * 소스: IG 수집 기사 중 영상(articles.videos — 영구 보관 mp4)이 있는
 * 최근 3일 내 미게시 기사 1건. 릴스 원본(세로 ≤3분)이라 Shorts 로
 * 자동 분류된다 — 별도 렌더링 불필요.
 *
 * 흐름: mp4 다운로드(Storage) → YouTube resumable 업로드 →
 *       youtube_posts.article_id 기록 (기사당 1회 보장, failed 는 재시도 허용)
 *
 * 공개 게이트 (tiktok-post 와 동일 패턴):
 *   YOUTUBE_PUBLIC=1  → public 업로드 + 크론 자동 실행
 *   미설정            → 크론은 대기 모드 (관리자 수동 트리거는 private 테스트 업로드)
 *   ※ 미감사 프로젝트의 공개 업로드가 비공개로 잠기는지 첫 수동 업로드로
 *     확인 후 전환할 것. 쿼터: 업로드당 1,600 units (기본 10,000/일 — 6회 한도).
 *
 * 수동 트리거: 관리자 토큰 GET/POST (?dry=1 로 선택 결과만 확인).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { uploadVideo } = require('../_lib/youtube');

const MAX_BYTES = 100 * 1024 * 1024; // 안전 상한 (IG 아카이브는 ≤60MB)

function firstSentence(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    .split(/(?<=[.!?다요])\s/)[0] || '';
}

function buildDescription(art, url) {
  const lines = [];
  lines.push(art.title + ' — PAP MAGAZINE');
  lines.push('');
  const fs = firstSentence(art.content);
  if (fs && fs.length <= 300) { lines.push(fs); lines.push(''); }
  lines.push('▶ 기사 전문 : ' + url);
  lines.push('▶ pap-magazine.com — 아트 기반 패션·뷰티·컬쳐 매거진');
  lines.push('');
  const cat = art.category ? '#' + String(art.category).replace(/[^A-Za-z0-9가-힣]/g, '').toUpperCase() : null;
  lines.push(['#Shorts', '#PAPMAGAZINE', '#패션뉴스', cat].filter(Boolean).join(' '));
  return lines.join('\n').slice(0, 4900);
}

module.exports = async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  // 공개 전환 전 대기 모드 (관리자 수동은 private 테스트 업로드 허용)
  if (cronOk && process.env.YOUTUBE_PUBLIC !== '1') {
    return res.status(200).json({ ok: true, note: '공개 전환 대기 — YOUTUBE_PUBLIC=1 설정 시 자동 업로드 시작' });
  }

  try {
    // 이미 게시된 기사 집합 — failed 는 제외해 재시도 허용
    const { data: posted } = await supabaseAdmin.from('youtube_posts').select('article_id, status').limit(5000);
    const done = new Set((posted || []).filter((p) => p.status !== 'failed').map((p) => p.article_id).filter(Boolean));

    // 신선도 창(최근 3일) 안의 영상 있는 미게시 기사 1건
    const freshCutoff = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data: arts } = await supabaseAdmin.from('articles')
      .select('id, title, slug, custom_url, content, videos, category')
      .eq('status', 'published')
      .gte('published_date', freshCutoff)
      .order('published_date', { ascending: false }).limit(200);
    const art = (arts || []).find((a) =>
      !done.has(a.id) && Array.isArray(a.videos) && a.videos.length >= 1 && a.videos[0]);
    if (!art) return res.status(200).json({ ok: true, note: '업로드할 영상 기사 없음' });

    const artUrl = 'https://www.pap-magazine.com/article/' + (art.custom_url || art.slug || '');
    const isPublic = process.env.YOUTUBE_PUBLIC === '1';
    const title = (art.title + ' | PAP MAGAZINE').slice(0, 95);
    const description = buildDescription(art, artUrl);

    if (req.query && req.query.dry === '1') {
      return res.status(200).json({ ok: true, dry: true, pick: { title: art.title, video: art.videos[0] }, description });
    }

    // mp4 다운로드 (Supabase Storage 영구 보관본)
    const vr = await fetch(art.videos[0], { signal: AbortSignal.timeout(60000) });
    if (!vr.ok) throw new Error('영상 다운로드 실패 ' + vr.status);
    const len = Number(vr.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('영상 ' + Math.round(len / 1048576) + 'MB — 상한 초과');
    const buffer = Buffer.from(await vr.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error('영상 크기 상한 초과');

    let videoId = null; let status = 'submitted'; let detail = null;
    try {
      const v = await uploadVideo(buffer, {
        title, description,
        tags: ['PAP MAGAZINE', '패션', 'fashion', 'kfashion', art.category].filter(Boolean),
        privacyStatus: isPublic ? 'public' : 'private',
      });
      videoId = v.id;
      // 미감사 프로젝트 잠금 감지: public 요청했는데 private 로 내려오면 기록
      const got = v.status && v.status.privacyStatus;
      if (isPublic && got && got !== 'public') {
        detail = 'privacy 강제 전환됨: ' + got + ' (YouTube API 감사 필요 신호)';
      }
    } catch (err) {
      status = 'failed';
      detail = String(err && err.message || err).slice(0, 400);
    }
    await supabaseAdmin.from('youtube_posts').upsert({
      article_id: art.id, video_id: videoId, status, detail,
    }, { onConflict: 'article_id' });

    if (status === 'failed') return res.status(502).json({ error: 'youtube post failed', title: art.title, detail });
    return res.status(200).json({ ok: true, posted: art.title, video_id: videoId, url: 'https://youtube.com/shorts/' + videoId, note: detail || undefined });
  } catch (err) {
    console.error('[youtube-post] error:', err);
    return res.status(500).json({ error: 'youtube cron failed', detail: String(err && err.message || err).slice(0, 200) });
  }
};
