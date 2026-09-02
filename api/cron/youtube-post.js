/**
 * PAP Magazine — YouTube Shorts 자동 업로드 크론
 * Route: /api/cron/youtube-post   (하루 2회 — 10:15 / 22:15 KST)
 *
 * 소스: IG 수집 기사 중 **원본 media_type = 'VIDEO' (=릴스)** 기사 최근 3일
 * 내 미게시 1건. 캐러셀(CAROUSEL_ALBUM) 안에 섞인 영상이나 단일 이미지
 * 게시물은 대상 아님. 릴스 원본(세로 ≤3분)이라 Shorts 로 자동 분류된다.
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
const { withCronGuard } = require('../_lib/cronGuard');
const { buildTitle, buildHashtags, buildTagList } = require('../_lib/youtubeMeta');
/* 2026-08-05 도메니코 — "캡션크레딧이 PAP일 경우에만 유튜브에 업로드" +
   "음악은 인스타에서 설정한거니 음소거해서". 두 규칙 모두 fail closed 다.  */
const { verdictForMedia } = require('../_lib/igCredit');
const { muteMp4 } = require('../_lib/mp4Mute');

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pap-magazine.com';
const MAX_BYTES = 100 * 1024 * 1024; // 안전 상한 (IG 아카이브는 ≤60MB)
const ART_COLS = 'id, title, slug, custom_url, content, videos, category, source_media_type, tags, source_instagram_post_id';
// 크레딧 게이트가 한 번에 Graph 재조회할 후보 수 상한 (외부 크레딧 릴스는 건너뛴다)
const CREDIT_SCAN_MAX = 5;

function firstSentence(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    .split(/(?<=[.!?다요])\s/)[0] || '';
}

function buildDescription(art, url) {
  const lines = [];
  /* < > 는 YouTube 가 거부한다. 2026-07-19 '<오디세이>' 기사가 여기서
     그대로 흘러들어가 upload init 400 (invalid video description) 으로 죽었다. */
  lines.push(String(art.title || '').replace(/[<>]/g, '') + ' — PAP MAGAZINE');
  lines.push('');
  const fs = firstSentence(art.content);
  if (fs && fs.length <= 300) { lines.push(fs); lines.push(''); }
  /* 2026-08-08 — 성장 헌법 3조: 유튜브 설명란 링크는 클릭 가능하므로 계측한다.
     (유튜브는 링크의 쿼리 파라미터를 보존한다 — 미디어킷의 '외부 앱이 쿼리를
     지운다' 교훈은 IG 프로필 링크(/ig/youtube 경로형) 쪽에만 해당.) */
  lines.push('▶ 기사 전문 : ' + url + (url.indexOf('?') >= 0 ? '&' : '?')
    + 'utm_source=youtube&utm_medium=social&utm_campaign=pap_auto');
  /* 인스타 유입 링크 (2026-07-30 도메니코 요청).
   * 유튜브는 설명란 외부 링크를 감점하지 않는다 — 정책상 제재 대상은
   * 가이드라인 위반 사이트·멀웨어·스팸이다. 다만 첫 줄부터 링크로 도배하면
   * 스팸 신호가 되므로 본문(제목·첫 문장) 뒤에만 둔다.
   * 계측: 직링크 대신 /ig/youtube 를 태워 ig_outclicks 에 남긴다. 그래야
   * "유튜브가 실제로 인스타 팔로워를 만들어 주는가" 를 숫자로 답할 수 있다.
   * 경로형인 이유는 미디어킷 실측 교훈(외부 앱이 쿼리 파라미터를 지운다). */
  lines.push('▶ 인스타그램 : ' + SITE + '/ig/youtube');
  lines.push('▶ pap-magazine.com — 아트 기반 패션·뷰티·컬쳐 매거진');
  lines.push('');
  /* 2026-08-04 도메니코 — 해시태그를 '기사에 관련있는 셀럽이나 내용의 단어'로.
     articles.tags 가 이미 셀럽명·브랜드명·제품명을 담고 있어 그대로 쓴다. */
  lines.push(buildHashtags(art).join(' '));
  return lines.join('\n').slice(0, 4900);
}

module.exports = withCronGuard('youtube-post', async function handler(req, res) {
  res.locals = res.locals || {};
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  // 공개 전환 전 대기 모드 (관리자 수동은 private 테스트 업로드 허용)
  if (cronOk && process.env.YOUTUBE_PUBLIC !== '1') {
    res.locals.cronNote = '공개 전환 대기 — YOUTUBE_PUBLIC=1 설정 시 자동 업로드 시작';
    return res.status(200).json({ ok: true, note: res.locals.cronNote });
  }

  try {
    // 일일 업로드 상한 — 크론이 10분 주기 스위퍼로 바뀌면서 쿼터 보호 필요.
    // 업로드당 1,600 units, 기본 쿼터 10,000/일 ≈ 6회 → 기본 상한 4로 여유 확보.
    // 관리자 수동 트리거는 상한을 우회한다 (cronOk 일 때만 적용).
    if (cronOk) {
      const DAILY_LIMIT = parseInt(process.env.YOUTUBE_DAILY_LIMIT || '4', 10) || 4;
      // 기준일은 KST(UTC+9) 자정. UTC 자정으로 잡으면 상한 리셋이 09:00 KST가 되어,
      // 상한이 걸린 날은 한국 새벽~오전(00~09시)이 통째로 죽는다.
      const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
      const kstMidnight = new Date(Date.now() + KST_OFFSET_MS);
      kstMidnight.setUTCHours(0, 0, 0, 0);
      const dayStart = new Date(kstMidnight.getTime() - KST_OFFSET_MS);
      /* 2026-09-02 — 상한은 '실제로 올린 것' 만 센다.
         예전에는 failed 만 뺐다(.neq('status','failed')). 그러면 아무것도 올리지 않은 행이
         하루치를 갉아먹는다:
           · skipped  — 같은 기사가 이미 유튜브에 있어 건너뛴 것. 업로드 0.
           · removed  — 도메니코가 저작권으로 지운 것. 지금 올린 게 아니다.
           · orphan   — 중복 업로드 사고 기록.
         게다가 drive-youtube-post·drive-story-shorts 는 이 상한을 확인하지 않으면서
         같은 표에 행을 쓴다. 그래서 드라이브 업로드가 릴스 몫을 먹었다.
         실측(최근 21일, 상한 4): 08-17 은 4칸 중 3칸이 헛칸이라 릴스가 하루에 1건만
         올라가고 나머지 시간이 통째로 막혔다. 08-25 는 2칸, 09-02 는 2칸이 헛칸이었다.
         → submitted 만 센다. 드라이브 경로에도 상한을 걸지는 별도 판단(2026-09-02 미결). */
      const { count: todayCount } = await supabaseAdmin.from('youtube_posts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'submitted')
        .gte('created_at', dayStart.toISOString());
      if ((todayCount || 0) >= DAILY_LIMIT) {
        res.locals.cronNote = '일일 업로드 상한 도달 (' + todayCount + '/' + DAILY_LIMIT + ', KST 기준) — 익일 00:00 KST 재개';
        return res.status(200).json({ ok: true, note: res.locals.cronNote, today: todayCount });
      }
    }

    // 이미 게시된 기사 집합 — failed 는 제외해 재시도 허용
    const { data: posted } = await supabaseAdmin.from('youtube_posts').select('article_id, status').limit(5000);
    const done = new Set((posted || []).filter((p) => p.status !== 'failed').map((p) => p.article_id).filter(Boolean));

    // 신선도 창(최근 3일) 안의 릴스(원본 IG media_type = 'VIDEO') 미게시 기사 1건.
    // 캐러셀(CAROUSEL_ALBUM) 안에 영상이 섞여 있어도 스킵 — 릴스 원본만 세로 3분 이하가
    // 보장되어 Shorts 자동 분류에 적합. IMAGE 게시물도 당연히 제외.
    /* 관리자 지정 업로드 (?article=<slug|custom_url|id>).
     * 2026-08-04 도메니코 "이 다섯 개만 올려줘" — 신선도 창을 벗어난 기사를
     * 지목해 올리려면 선택기를 우회할 길이 필요했다.
     * 크론(cronOk)에는 열지 않는다. 자동 실행이 임의 기사를 집을 수 있으면
     * 발행 통제가 무너진다 — 지목은 사람만 한다.
     * 키는 [A-Za-z0-9-_] 로 제한한다. PostgREST .or() 필터에 그대로 들어가므로
     * 쉼표·괄호가 섞이면 필터 구문이 깨진다(주입). */
    const rawTarget = !cronOk && req.query && req.query.article ? String(req.query.article).trim() : '';
    if (rawTarget && !/^[A-Za-z0-9_-]{1,120}$/.test(rawTarget)) {
      return res.status(400).json({ ok: false, error: 'article 파라미터 형식 오류 (영숫자·하이픈·밑줄만)' });
    }

    let art = null; let credit = null;
    if (rawTarget) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawTarget);
      const { data: hits } = await supabaseAdmin.from('articles')
        .select(ART_COLS)
        .or(isUuid ? 'id.eq.' + rawTarget : 'slug.eq.' + rawTarget + ',custom_url.eq.' + rawTarget)
        .limit(2);
      art = (hits || [])[0] || null;
      if (!art) {
        return res.status(404).json({ ok: false, error: '기사를 찾을 수 없음: ' + rawTarget });
      }
      if (done.has(art.id)) {
        return res.status(409).json({ ok: false, error: '이미 업로드된 기사 — youtube_posts 에 기록 있음', article_id: art.id });
      }
      if (!(Array.isArray(art.videos) && art.videos.length >= 1 && art.videos[0])) {
        return res.status(409).json({
          ok: false,
          error: 'videos 가 비어 있음 — IG 미디어 캡처 실패. 먼저 백필할 것',
          backfill: '/api/admin/articles/backfill-video?slug=' + (art.slug || art.id),
        });
      }
      /* 지목 업로드에도 크레딧 게이트를 건다. 사람이 지목했다는 사실이
         권리를 만들어 주지는 않는다 — 규칙은 경로와 무관하게 같다. */
      credit = await verdictForMedia(art.source_instagram_post_id);
      if (!credit.owned) {
        return res.status(409).json({
          ok: false,
          error: 'PAP 크레딧이 아님 — 유튜브 업로드 보류',
          detail: credit.reason,
          credits: credit.credits,
        });
      }
    } else {
      /* ?days=N (1~14) 으로 창을 넓힐 수 있다. 기본은 3일 그대로.
         수집 버그로 mp4 가 비어 후보에서 탈락했던 릴스는 복구 시점엔 이미
         창 밖인 경우가 많다 — video-repair 가 복구 직후 days=7 로 깨워
         그 구제 통로를 연다. 기본값을 늘리지 않는 이유는 쇼츠는 '지금 것'
         이어야 하고, 창을 상시로 넓히면 옛 릴스가 밀려 올라오기 때문이다. */
      const freshDays = Math.max(1, Math.min(14, Number((req.query && req.query.days) || 3) || 3));
      const freshCutoff = new Date(Date.now() - freshDays * 86400000).toISOString();
      const { data: arts } = await supabaseAdmin.from('articles')
        .select(ART_COLS)
        .eq('status', 'published')
        .eq('source_media_type', 'VIDEO')
        .gte('published_date', freshCutoff)
        .order('published_date', { ascending: false }).limit(200);
      const candidates = (arts || []).filter((a) =>
        !done.has(a.id) && Array.isArray(a.videos) && a.videos.length >= 1 && a.videos[0]);
      /* 크레딧 게이트는 후보를 '건너뛴다'. 첫 후보가 외부 크레딧이라고 거기서
         멈춰 버리면 그 릴스가 신선도 창에 있는 동안 쇼츠가 통째로 죽는다.
         Graph 재조회 비용 때문에 한 번에 CREDIT_SCAN_MAX 건까지만 본다. */
      const skipped = [];
      for (const cand of candidates.slice(0, CREDIT_SCAN_MAX)) {
        const v = await verdictForMedia(cand.source_instagram_post_id);
        if (v.owned) { art = cand; credit = v; break; }
        skipped.push({ title: cand.title, reason: v.reason });
      }
      if (!art) {
        res.locals.cronNote = '업로드할 릴스 기사 없음 (source_media_type=VIDEO 필터, 최근 ' + freshDays + '일'
          + ', 후보 ' + candidates.length + '건 / 크레딧 스킵 ' + skipped.length + '건)';
        return res.status(200).json({ ok: true, note: res.locals.cronNote, skipped });
      }
    }

    const artUrl = 'https://www.pap-magazine.com/article/' + (art.custom_url || art.slug || '');
    const isPublic = process.env.YOUTUBE_PUBLIC === '1';
    // 2026-08-04 도메니코 — 채널 실측 접두사 규칙([ CELEBRITY ] 등)을 코드로.
    const title = buildTitle(art);
    const description = buildDescription(art, artUrl);

    if (req.query && req.query.dry === '1') {
      return res.status(200).json({ ok: true, dry: true, credit, pick: { title, source_title: art.title, video: art.videos[0] }, tags: buildTagList(art), description });
    }

    // mp4 다운로드 (Supabase Storage 영구 보관본)
    const vr = await fetch(art.videos[0], { signal: AbortSignal.timeout(60000) });
    if (!vr.ok) throw new Error('영상 다운로드 실패 ' + vr.status);
    const len = Number(vr.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('영상 ' + Math.round(len / 1048576) + 'MB — 상한 초과');
    const buffer = Buffer.from(await vr.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error('영상 크기 상한 초과');

    /* 음소거 — 릴스 음악은 인스타 음원 라이브러리 것이라 인스타 안에서만
       라이선스된다. 그대로 유튜브에 올리면 Content ID 클레임 대상이다.
       벗겨내지 못하면 올리지 않는다 (fail closed). */
    const mute = muteMp4(buffer);
    if (!mute.ok) {
      res.locals.cronNote = '음소거 실패 — 업로드 보류: ' + mute.reason;
      return res.status(409).json({ ok: false, error: '음소거 실패 — 업로드 보류', detail: mute.reason, title: art.title });
    }
    const uploadBuffer = mute.buffer;

    let videoId = null; let status = 'submitted'; let detail = null;
    try {
      const v = await uploadVideo(uploadBuffer, {
        title, description,
        tags: buildTagList(art),
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
    res.locals.cronNote = '업로드 완료: ' + art.title + ' (' + videoId + ') / ' + mute.reason + (detail ? ' / ' + detail : '');
    return res.status(200).json({ ok: true, posted: art.title, video_id: videoId, url: 'https://youtube.com/shorts/' + videoId, credit: credit && credit.reason, mute: mute.reason, note: detail || undefined });
  } catch (err) {
    console.error('[youtube-post] error:', err);
    throw err; // cronGuard 가 이메일 알림 + cron_runs 기록
  }
});
