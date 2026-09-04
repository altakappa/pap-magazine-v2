/**
 * GET /api/cron/sync-instagram — 2시간마다 실행되는 자동 동기화.
 *
 * QA #275 + 2026-07 확장. @pap_magazine 최근 25개 게시물 fetch →
 * "에디토리얼이 아닌" 신규 게시물만 Claude로 기사 생성 → articles 에
 * 품질 게이트 통과 시 published, 미달 시 draft 상태로 INSERT.
 *
 * ─── 품질 게이트 (2026-07-15 추가) ───
 * 환경변수 IG_QUALITY_GATE=on 시 활성화 (기본: off = 기존 동작 유지).
 * · IG_MIN_LIKES (기본 200): 좋아요 이상이면 자동 발행
 * · IG_MIN_COMMENTS (기본 10): 댓글 이상이면 자동 발행
 * 둘 중 하나라도 충족하면 published, 모두 미달이면 draft (수동 승인 대기).
 * 좋아요/댓글 수 조회 불가(null) 시 → draft 로 안전하게 처리.
 * IG_WEEKLY_AUTO_LIMIT (기본 5): 이번 주 자동발행 기사 수 상한. 초과 시
 *   나머지는 조건 충족해도 draft 처리 → 큐레이션 정체성 보호.
 *
 * 에디토리얼 제외 3겹 (에디토리얼은 운영자가 웹사이트에 사전 업로드하므로
 * 중복 수집 금지):
 *   ① DB 매칭   — editorials.source_instagram_url 의 shortcode 와 일치
 *   ② 휴리스틱  — 캡션의 크레딧 역할 라인·/editorial/ 링크 (isLikelyEditorialCaption)
 *   ③ AI 분류   — Claude 가 category='Editorial' 로 판정 시 스킵
 *
 * 수동 진단: 관리자 토큰으로 GET ?dry=1 → 분류 결과만 반환 (INSERT·AI 호출 없음).
 * 보안: Vercel cron secret 또는 관리자 토큰.
 */

const { bearerOk } = require('../_lib/secretCompare');
const { HTML_TAG_RE, dropKnownTags } = require('../_lib/stripHtml');
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { pingNewContent, SITE } = require('../_lib/pingSearch');
// 2026-08-09 — 골든아워 부스트: 새 에디토리얼 IG 게시물 감지 즉시 스레드·X 가
// 그 게시물로 트래픽을 쏜다 (실측: 첫 3시간 좋아요 ↔ 최종 도달 corr 0.94).
const { maybeBoostPost } = require('../_lib/goldenBoost');
const { postTweet, isConfigured: xConfigured, buildThreadsParityTweet, uploadArticleMedia } = require('../_lib/xPost');
const { postArticleToThreads } = require('../_lib/threadsAutopost');
const {
  listRecentMedia,
  listMediaPaged,
  fetchMediaPage,
  generateArticleFromPost,
  buildArticleRow,
  archiveImagesToStorage,
  archiveVideosToStorage,
  resolveVideoUrls,
  isLikelyEditorialCaption,
  normalizeMedia,
  hydrateChildren,
  _extractShortcode,
  sanitizeCredential,
  pickAccountToken,
} = require('../_lib/instagramImport');

module.exports = withCronGuard('sync-instagram', async function handler(req, res){
  // Vercel cron 보호 — CRON_SECRET 일치 또는 관리자 토큰 (수동 진단·트리거용).
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
  if (!cronOk){
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  // 2026-07-23 — 다계정 백필. ?account=celeb|beauty|fashion|trends|object 면
  // 해당 하위 계정 자격증명(IG_<KEY>_USER_ID / IG_<KEY>_ACCESS_TOKEN)을 쓴다.
  // account 미지정 = 기본 @pap_magazine(IG_USER_ID/IG_ACCESS_TOKEN, 불변).
  const ACCOUNT_KEYS = ['celeb', 'beauty', 'fashion', 'trends', 'object'];
  const account = String((req.query && req.query.account) || '').toLowerCase().trim();
  let cred = null; // null = 기본 env
  let tokenSource = 'main'; // 진단용 라벨 (토큰 값은 절대 노출하지 않는다)
  if (account){
    if (!ACCOUNT_KEYS.includes(account)){
      return res.status(400).json({ error: 'account 는 ' + ACCOUNT_KEYS.join('|') + ' 중 하나' });
    }
    const uid = sanitizeCredential(process.env['IG_' + account.toUpperCase() + '_USER_ID']);
    // 2026-07-26 — 계정 토큰이 비었거나 형식이 깨졌으면 본계정 토큰으로 폴백.
    // (5계정 토큰 = 본계정과 같은 유저 토큰 하나. 45_Business/2026-07-24 세팅 기록)
    const picked = pickAccountToken(
      process.env['IG_' + account.toUpperCase() + '_ACCESS_TOKEN'],
      process.env.IG_ACCESS_TOKEN
    );
    if (!uid || !picked.token){
      /* ── 2026-08-22 — '조용히 스킵' 을 걷어낸다 ────────────────────
         종전 주석: "env 미설정 계정은 조용히 스킵(200) — 크론이 실패 알림을
         쏟지 않게." 그 결과가 이거다:

           account=fashion token_source=main (계정 토큰 형식 불량)
           2026-07-26 14:39 ~ 2026-08-22 · **686회** · 수집 요약 0회

         27일 동안 시간마다 돌면서 한 건도 수집하지 않았다. 매번 200 OK 라
         실패로도 안 잡혔다. cron_runs 를 봐도 '토큰 라벨' 한 줄뿐이라
         '돌고는 있네' 로 읽힌다. 08-18 팝마트 34시간·08-22 스토리쇼츠와
         **정확히 같은 모양** — 양쪽이 다 조용한 정지다.

         vercel.json 에 크론으로 **등재된** 계정이 env 가 없다는 건 정상 상태가
         아니라 설정 오류다. 정상이라면 크론 줄을 빼면 된다. 그러니 시끄럽게 한다.
         (알림 쿨다운은 cronGuard 가 이미 갖고 있다 — 시간마다 도배되지 않는다) */
      const missing = [];
      if (!uid) missing.push('IG_' + account.toUpperCase() + '_USER_ID');
      if (!picked.token) missing.push('IG_' + account.toUpperCase() + '_ACCESS_TOKEN + IG_ACCESS_TOKEN(본계정)');
      const why = 'account=' + account + ' 건너뜀 — ' + missing.join(' · ') + ' 없음'
        + ' (Vercel env 에 넣고 재배포하거나, vercel.json 에서 이 크론 줄을 빼라)';
      res.locals = res.locals || {};
      res.locals.cronNote = why;
      return res.status(500).json({ error: why, account, token_source: picked.source, missing });
    }
    cred = { userId: uid, token: picked.token };
    tokenSource = picked.source;
    // 실패해도 cron_runs.note 에 남게 미리 기록 — 190 이 또 나면 어느 토큰으로
    // 시도했는지 브라우저 없이 DB 만으로 갈린다. 값이 아니라 라벨만 남는다.
    res.locals = res.locals || {};
    res.locals.cronNote = 'account=' + account + ' token_source=' + tokenSource;
  } else if (!process.env.IG_ACCESS_TOKEN || !process.env.IG_USER_ID){
    return res.status(503).json({
      error: 'Instagram 환경변수 미설정 (IG_ACCESS_TOKEN / IG_USER_ID).',
    });
  }
  // 계정별 done 플래그 키 — 백필 완주 상태를 계정마다 따로 관리
  const doneKey = account ? ('ig_backfill_done_' + account) : 'ig_backfill_done';
  const acctLabel = account ? ('@pap_' + account) : '@pap_magazine';

  const dry = !!(req.query && req.query.dry === '1');
  // 백필 모드: ?backfill=<일수>&max=<회당 처리 상한, 기본 40>
  // Vercel 함수 120초 제한 내에서 (AI 생성 + 이미지 아카이브) 처리 가능한
  // 만큼만 하고 remaining 을 반환 — 반복 호출로 기간 전체를 채운다.
  const backfillDays = parseInt((req.query && req.query.backfill) || '0', 10) || 0;
  // 백필은 실행 내 병렬 처리(BACKFILL_CONCURRENCY)로 회당 상한을 크게 잡을 수
  // 있다(타임아웃 자가치유). 상한 40. 최근-동기화 경로는 perCall 미사용.
  // 기본값은 상한과 동일한 40 — 시간예산(80s) 초과분은 커서 되돌림으로 자가치유되므로
  // 안전하며, 회당 처리량을 최대화해 전체 이력 백필 완주 속도를 끌어올린다.
  const perCall = Math.max(1, Math.min(40, parseInt((req.query && req.query.max) || '40', 10) || 40));

  // ── 품질 게이트 설정 ──
  const qualityGateOn = String(process.env.IG_QUALITY_GATE || '').toLowerCase() === 'on';
  const MIN_LIKES = parseInt(process.env.IG_MIN_LIKES || '200', 10) || 200;
  const MIN_COMMENTS = parseInt(process.env.IG_MIN_COMMENTS || '10', 10) || 10;
  const WEEKLY_LIMIT = parseInt(process.env.IG_WEEKLY_AUTO_LIMIT || '5', 10) || 5;

  try {
    // 백필 완주 후 조기 종료 — done 플래그가 있으면 IG 재조회 없이 반환
    // (스케줄 크론이 완주 뒤에도 계속 돌며 IG API·컴퓨트를 낭비하지 않게).
    if (backfillDays > 0 && !dry){
      const { data: doneSt } = await supabaseAdmin.from('ops_alert_state')
        .select('key, updated_at').eq('key', doneKey).maybeSingle();
      if (doneSt) {
        /* ── 2026-08-22 — 노트가 '한 일' 을 안 적어서 오진을 불렀다 ──────
           이 경로는 정상이다. 백필을 완주했으니 IG 를 다시 안 부르는 게 맞다.
           그런데 cron_runs.note 에는 위(110행)에서 찍은
             account=fashion token_source=main (계정 토큰 형식 불량)
           만 남았다. 읽는 사람에게는 **토큰이 깨진 채로 뭔가 돌고 있다**로
           읽힌다. 오늘 내가 정확히 그렇게 읽고 '27일간 죽어 있었다' 고
           오진해서 한 시간을 썼다. 조회 결과는 08-02 완주였다.

           08-19 GSC 건에서 이미 같은 교훈을 적었다 — '무엇을 달라고 했는가'
           는 의도이고 '무엇을 받았는가' 가 사실이다. 여기도 같다.
           **한 일을 적는다.** 언제 끝났는지와 되돌리는 법까지. */
        const doneAt = String(doneSt.updated_at || '').slice(0, 10);
        const why = 'account=' + (account || 'magazine') + ' · 백필 완주'
          + (doneAt ? '(' + doneAt + ')' : '') + ' — 할 일 없음'
          + ' · 재실행하려면 ops_alert_state 의 ' + doneKey + ' 삭제';
        res.locals = res.locals || {};
        res.locals.cronNote = why;
        return res.status(200).json({ ok: true, backfill_done: true, account: account || 'magazine', done_at: doneSt.updated_at || null, note: why });
      }
    }

    // ── 공용 상태 (백필·일반 양 경로 공용) ──
    const results = {
      imported: 0, skipped_existing: 0,
      skipped_editorial_db: 0, skipped_editorial_caption: 0, skipped_editorial_ai: 0,
      failed: 0, errors: [], dry: dry, classified: [],
    };
    const newUrls = []; // 이번 실행에서 발행된 기사 URL — 종료 시 즉시 검색 핑
    let videoImported = false; // 릴스(VIDEO) 기사 발행 여부 — 유튜브 즉시 넛지용
    const backfillMode = backfillDays > 0;

    // 에디토리얼 shortcode 집합 (①번 필터) — 양 경로 공용.
    const { data: eds } = await supabaseAdmin
      .from('editorials').select('source_instagram_url')
      .not('source_instagram_url', 'is', null).limit(5000);
    const editorialShortcodes = new Set(
      (eds || []).map((e) => _extractShortcode(e.source_instagram_url)).filter(Boolean)
    );

    // 품질 게이트 주간 카운트 — 일반(최근-동기화) 경로에서만 사용.
    let weeklyPublished = 0;
    if (qualityGateOn && !backfillMode){
      const now = new Date();
      const day = now.getUTCDay(); // 0=Sun
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() - ((day + 6) % 7));
      monday.setUTCHours(0, 0, 0, 0);
      const { count } = await supabaseAdmin
        .from('articles').select('id', { count: 'exact', head: true })
        .not('source_instagram_post_id', 'is', null)
        .eq('status', 'published').gte('instagram_imported_at', monday.toISOString());
      weeklyPublished = count || 0;
    }

    // ── 공용: 단일 게시물 처리 ──
    // AI 생성 → 에디토리얼(AI) 스킵 → 이미지/영상 아카이브 → articles INSERT →
    // 사이드이펙트. backfillMode 면 X·Threads 자동게시·검색핑을 전부 차단한다:
    // 과거 기사 수천 건 백필 시 소셜/검색엔진 스팸 방지 (2026-07-24).
    // 기사 카테고리 화이트리스트 — 백필은 이 목록 밖(에디토리얼·미상)이면 무조건 스킵.
    const ARTICLE_CATEGORIES = ['news', 'fashion', 'beauty', 'culture', 'celeb'];
    async function processOne(m){
      await hydrateChildren(m, cred);
      const post = normalizeMedia(m);
      // 백필은 엄격 모드(에디토리얼·룩북·화보·크레딧 → Editorial 판정, 애매하면 Editorial).
      const generated = await generateArticleFromPost(post, { strictEditorial: backfillMode });
      // ③ AI 분류 게이트: 'editorial' 이거나 (백필에서) 기사 카테고리 화이트리스트
      // 밖이면 수집하지 않는다 — "반드시 기사만" 보장.
      /* 2026-08-20 — 본문 길이를 회차 노트에 싣는다. 목표를 08-17 에 올렸는데
         실측 중앙값이 480자였고, 그걸 아무도 몰랐다.
         '지시했으니 됐겠지' 를 막는 유일한 방법은 결과를 세는 것이다.
         측정만 한다 — 짧다고 재시도하지 않는다(지어내기 압력이 생긴다).

         2026-08-22 — **재료도 같이 센다.**
         결과만 세다가 08-22 에 오진을 했다. 캡션 전체 길이(평균 1,044자)를
         한국어 재료로 착각해 "모델이 압축한다" 고 결론지었는데, 캡션은
         이중언어라 한국어 부분은 평균 350자뿐이었다. 실제 배율은 1.49 —
         모델은 이미 늘려 쓰고 있었다.
         결과만 재면 '왜' 를 못 본다. 재료(한국어 캡션)와 배율을 같이 남긴다. */
      {
        const _len = String(generated.body_ko || '').replace(HTML_TAG_RE, dropKnownTags('')).length;
        if (_len > 0){
          results.body_len = results.body_len || [];
          results.body_len.push(_len);
          /* 한글이 든 줄만 한국어 재료로 센다. 영문 번역 단락·핸들·해시태그·
             날짜 줄은 새 사실이 아니므로 재료가 아니다. 근사지만, 캡션 전체를
             세는 것보다 진실에 훨씬 가깝다(1,044 vs 350). */
          const _koSrc = String((post && post.caption) || '')
            .split('\n').filter((l) => /[가-힣]/.test(l)).join('\n').length;
          if (_koSrc > 0){
            results.src_len = results.src_len || [];
            results.src_len.push(_koSrc);
          }
        }
      }
      const cat = String(generated.category || '').toLowerCase();
      const isEditorial = cat === 'editorial'
        || (backfillMode && !ARTICLE_CATEGORIES.includes(cat));
      if (isEditorial){
        results.skipped_editorial_ai++;
        if (!backfillMode){ const b = await maybeBoostPost(m, { backfillMode, kind: 'editorial' }); if (b.boosted) results.boosted = (results.boosted||0)+1; }
        return;
      }
      // IG CDN 이미지는 수일 내 만료 — Supabase Storage 영구본으로 교체.
      const archivedUrls = await archiveImagesToStorage(post, 10);
      /* 릴스 mp4 — 목록 응답에 media_url 이 없으면 media id 로 단건 재조회한다.
         이 한 줄이 없어서 07-31~08-04 릴스 기사 6건이 videos:[] 로 발행됐고,
         유튜브 쇼츠 자동 업로드가 통째로 멈췄다. (instagramImport.resolveVideoUrls) */
      const resolveStat = await resolveVideoUrls(post, cred);
      if (resolveStat.attempted) {
        console.log('[sync-ig] video media_url 재조회: ' + resolveStat.resolved + '/' + resolveStat.attempted + ' 성공');
      }
      const videoReport = {};
      const videoUrls = await archiveVideosToStorage(post, 2, undefined, videoReport);
      /* VIDEO 인데 mp4 를 하나도 못 건졌으면 반드시 로그로 남긴다.
         조용히 넘어가면 "발행은 됐는데 쇼츠는 안 올라가는" 상태가 되고,
         youtube-post 는 그걸 '후보 없음' 으로만 보고해 아무도 눈치채지 못한다. */
      if (post.mediaType === 'VIDEO' && !videoUrls.length){
        results.video_missing = (results.video_missing || 0) + 1;
        console.error('[sync-ig] 릴스 mp4 수집 실패 — post ' + post.id
          + ' urls=' + (post.videoUrls || []).length
          + ' 재조회=' + resolveStat.resolved + '/' + resolveStat.attempted
          + ' 실패=' + JSON.stringify((videoReport.failures || []).slice(0, 2)));
      }
      // ── 품질 게이트: 발행 상태 결정. 백필은 무조건 published(원본 게시일 유지) ──
      let pubStatus = 'published';
      if (qualityGateOn && !backfillMode){
        const likes = post.likeCount;
        const comments = post.commentsCount;
        const passQuality = (typeof likes === 'number' && likes >= MIN_LIKES)
          || (typeof comments === 'number' && comments >= MIN_COMMENTS);
        const withinLimit = (weeklyPublished + results.imported) < WEEKLY_LIMIT;
        if (passQuality && withinLimit){
          pubStatus = 'published';
        } else {
          pubStatus = 'draft';
          results.gated_draft = (results.gated_draft || 0) + 1;
          if (!withinLimit) results.weekly_limit_hit = true;
        }
      }
      const row = buildArticleRow(post, generated, { status: pubStatus, archivedUrls, videoUrls });
      const { data: inserted, error: insErr } = await supabaseAdmin.from('articles')
        .insert(row).select('id, custom_url, slug').single();
      if (insErr){
        if (insErr.code === '23505'){ results.skipped_existing++; return; } // 동시 실행 race — skip
        throw insErr;
      }
      results.imported++;
      if (inserted){
        /* 2026-08-03 — slug 우선. 사이트맵(api/sitemap-articles.js:50)은
           slug || custom_url || id 순으로 정본 URL 을 내보내는데, 여기만
           custom_url 을 앞에 두고 있었다. 그래서 임포트 직후 X·스레드·
           IndexNow 로 나가는 링크가 사이트맵의 정본과 달라져 301 이 생겼다
           (2026-07-22 Ahrefs 감사에서 잡힌 그 문제와 같은 원인, 다른 자리).
           custom_url 은 레거시라 두 곳의 순서는 반드시 같아야 한다. */
        const h = inserted.slug || inserted.custom_url || inserted.id;
        /* 2026-08-09 — 품질 게이트에 걸려 draft 로 들어간 게시물: 웹 발행도
           자동 게시도 없지만 IG 게시물 자체는 살아 있다. 초기 속도가 가장
           필요한 게 바로 이들이다 — 부스트가 유일한 골든아워 푸시. */
        if (pubStatus !== 'published' && !backfillMode){
          const b = await maybeBoostPost(m, { backfillMode, kind: 'draft' });
          if (b.boosted) results.boosted = (results.boosted||0)+1;
        }
        if (h && pubStatus === 'published'){
          const artUrl = SITE + '/article/' + encodeURIComponent(h);
          if (!backfillMode){
            newUrls.push(artUrl);
            // X 자동 게시 — 발행 즉시 트윗 (키 미설정 시 조용히 스킵).
            if (xConfigured()){
              try {
                const artForX = { title: generated.title_ko || row.title, url: artUrl, tags: generated.tags, body: generated.body_ko, category: generated.category };
                /* 2026-08-18 (도메니코: "포맷은 스레드와 동일하게") — 본문에는
                   링크를 넣지 않고(도달 억제 회피), 링크는 본글 성공 직후
                   첫 답글로 붙인다. threadsAutopost 와 같은 구조, 말투만 X용. */
                const gen = await buildThreadsParityTweet(artForX);
                if (gen.angle) console.log('[sync-ig] 대화형 트윗 (점수 ' + gen.score + '): ' + gen.angle);
                /* 미디어를 붙여 올린다 (2026-08-07 도메니코 지시).
                   "현재 글만 올라가는 방식은 더이상 올리지말고 …
                    내가 인스타에 올리는 영상이나 이미지들을 그대로 올려줘."
                   uploadArticleMedia 는 x-publish(수동 경로)가 쓰던 것 그대로다 —
                   자동 경로만 텍스트로 나가고 있었다. 영상 1편 또는 이미지 ≤4장.
                   업로드가 실패해도 트윗 자체는 내보낸다(그림 없이라도 나가는 게
                   아무것도 안 나가는 것보다 낫다). 대신 결과에 표시를 남긴다. */
                let xMedia = { mediaIds: [], kind: 'none' };
                try { xMedia = await uploadArticleMedia(row, {}); }
                catch (e) { console.error('[sync-ig] X 미디어 업로드 실패:', (e && e.message) || e); }
                /* 2026-08-18 도메니코: "글만 올라가는 게시물은 없었으면" —
                   미디어가 있으면 스레드 패리티(본문+미디어, 링크는 답글),
                   미디어가 없으면 본문에 링크를 넣어 나간다. 어느 경로로도
                   이미지도 링크도 없는 트윗은 불가능하다. */
                const hasMedia = xMedia.mediaIds.length > 0;
                const tw = hasMedia
                  ? await postTweet(gen.body, { mediaIds: xMedia.mediaIds })
                  : await postTweet(gen.bodyWithLink || (gen.body + '\n\n' + gen.url));  // 미디어 없는 경로는 280자 제약이 빡빡해 링크 한 줄 유지 (IG 우선은 답글 경로에서)
                let mark = hasMedia ? '' : '(미디어없음→링크본문)';
                /* 링크 답글 — 미디어 본글이 성공했을 때만. 실패해도 본글은
                   유지하되 반드시 표시한다 (링크가 안 붙으면 웹 유입이 0 —
                   threadsAutopost 의 링크 답글 원칙과 동일). */
                if (hasMedia && tw.ok && gen.url) {
                  /* 2026-08-22 (도메니코: "모든 파이프라인을 IG 우선으로") —
                     답글에 IG 를 먼저, 웹을 다음에. 게시 횟수가 그대로라
                     X 과금($0.20/답글)도 그대로다. 웹 링크는 남긴다 —
                     웹은 2순위 도달점이고 유료 사다리가 거기 있다. */
                  const { igFirstLinkBlock } = require('../_lib/igFirstLink');
                  const rep = await postTweet(igFirstLinkBlock(post || {}, 'x', gen.url), { replyToId: tw.id });
                  if (!rep.ok) {
                    mark += '(링크답글실패:' + (rep.status || '') + ')';
                    console.error('[sync-ig] X 링크 답글 실패:', rep.status || '', rep.detail || rep.skipped || '');
                  }
                }
                results.tweets = (results.tweets || []).concat(
                  tw.ok ? [tw.id + mark] : ['실패:' + (tw.status || '') + ' ' + (tw.detail || '')]);
                /* 2026-08-17 (도메니코 지적: "X에 글이 안 올라간다") — 실측:
                   @papmagazine_ 마지막 트윗 8/1, 이후 17일간 0건인데 아무 경보가
                   없었다. 실패가 results.tweets 에만 담기고 로그·노트 어디에도
                   안 남아서다. 실패는 반드시 콘솔에 찍는다 (Vercel 로그에서
                   상태코드 401/403/429 를 봐야 원인을 가를 수 있다). */
                if (!tw.ok) console.error('[sync-ig] X 트윗 실패:', tw.status || '', tw.detail || tw.skipped || '');
              } catch (e) {
                results.tweets = (results.tweets || []).concat(['실패(예외):' + String(e && e.message || e).slice(0, 80)]);
                console.error('[sync-ig] X 트윗 예외:', e && e.message || e);
              }
            }
            // Threads 자동 게시 — 실패해도 수집 흐름 계속(스위퍼가 재시도).
            if (process.env.THREADS_AUTOPOST !== 'false'){
              try {
                const th = await postArticleToThreads({
                  id: inserted.id, title: row.title, content: row.content,
                  category: row.category, url: artUrl,
                  /* row 는 방금 insert 한 그 행이라 갤러리·영상이 이미 들어 있다.
                     이걸 안 넘기면 스레드가 텍스트로만 나간다 (2026-08-07). */
                  gallery: row.gallery, videos: row.videos,
                  source_media_type: row.source_media_type,
                });
                results.threads = (results.threads || []).concat(
                  th.status === 'published' ? [th.thread_id]
                    : th.status === 'skipped' ? ['스킵:' + (th.detail || '')]
                    : ['실패:' + String(th.detail || '').slice(0, 80)]);
              } catch (e){
                results.threads = (results.threads || []).concat(['실패:' + String(e && e.message || e).slice(0, 80)]);
              }
            }
          }
          if (row.source_media_type === 'VIDEO' && Array.isArray(row.videos) && row.videos.length) videoImported = true;
        }
      }
    }

    // ═══ 전체 이력 백필 (커서 재개) ═══
    // listMediaPaged 는 매 실행 최신부터 재-페이징하므로 수천 개(@pap_magazine
    // 4,240 등) 백필 시 rate-limit·타임아웃 위험이 크다. 여기서는 paging 커서를
    // ops_alert_state 에 저장해 실행마다 이어받아 실행당 IG API 호출을 최소화한다.
    // 커서 전진: 한 페이지의 후보(에디토리얼·기존 제외)를 perCall 예산 안에서 전부
    // 수집하면 다음 페이지로 전진, 예산 초과(후보 더 있음)면 커서 유지 → 다음 실행
    // 같은 페이지 재수집(처리분은 existing 으로 스킵).
    if (backfillMode && !dry){
      const cursorKey = account ? ('ig_backfill_cursor_' + account) : 'ig_backfill_cursor';
      let cursorAfter = null;
      {
        const { data } = await supabaseAdmin.from('ops_alert_state')
          .select('last_payload').eq('key', cursorKey).maybeSingle();
        // 불투명 after 커서만 저장(토큰 미저장). 구 next_url 값이 남아있으면 무시하고
        // 최신부터 재시작(existing 스킵으로 무해) — 토큰 유출 잔재도 다음 저장에 정리.
        cursorAfter = (data && data.last_payload && data.last_payload.after) || null;
      }

      const runStartAfter = cursorAfter;  // 이 실행 시작점 — 처리 미완 시 되돌림(유실 방지)
      const startedAt = Date.now();
      const TIME_BUDGET_MS = 80000;        // 80s 예산 — 게시물 25s 타임아웃과 합쳐 120s 한도 여유
      const toProcess = [];
      let pageAfter = cursorAfter;     // 이번에 부를 페이지 after 커서 (null=최신부터)
      let advanceAfter = cursorAfter;  // 다음 실행 재개 지점 (기본: 현재 유지)
      let reachedEnd = false;
      let scanned = 0;
      const PAGE_SCAN_CAP = 30;    // 실행당 최대 30페이지(=1500개) 스캔
      while (toProcess.length < perCall && scanned < PAGE_SCAN_CAP
             && Date.now() - startedAt < TIME_BUDGET_MS){
        scanned++;
        const { rows, nextCursor } = await fetchMediaPage({ afterCursor: pageAfter, ...(cred || {}) });
        if (!rows.length){
          if (!nextCursor){ reachedEnd = true; advanceAfter = null; break; }
          pageAfter = nextCursor; advanceAfter = nextCursor; continue;
        }
        const ids = rows.map((r) => r.id).filter(Boolean);
        const { data: ex } = await supabaseAdmin.from('articles')
          .select('source_instagram_post_id').in('source_instagram_post_id', ids);
        const exSet = new Set((ex || []).map((r) => r.source_instagram_post_id));
        let overflow = false;
        for (const m of rows){
          if (exSet.has(m.id)){ results.skipped_existing++; continue; }
          const shortcode = _extractShortcode(m.permalink);
          if (shortcode && editorialShortcodes.has(shortcode)){
            /* 2026-08-12 — 여기 있던 부스트 호출은 도달 불가 코드였다. 이 블록 전체가
               `if (backfillMode && !dry)` 안이라 `!backfillMode` 가 절대 참이 되지 않는다.
               백필은 원래 부스트 금지(소셜 스팸)이므로 스킵만 세고 넘어가는 게 맞다.
               진짜 부스트는 아래 최근-동기화 경로에 있다. */
            results.skipped_editorial_db++;
            continue;
          }
          if (isLikelyEditorialCaption(m.caption)){
            results.skipped_editorial_caption++;   /* 백필은 부스트 금지 — 위 주석 참조 */
            continue;
          }
          if (toProcess.length < perCall){ toProcess.push(m); }
          else { overflow = true; break; }
        }
        if (overflow){ advanceAfter = pageAfter; break; }   // 후보 더 있음 → 이 페이지 재수집
        if (!nextCursor){ reachedEnd = true; advanceAfter = null; break; }
        pageAfter = nextCursor; advanceAfter = nextCursor;
      }

      // 실행 내 병렬 처리(동시 4건) + 이중 시간 가드로 504 방지:
      //  (a) 시간 예산 80s 초과 시 새 게시물 착수 중단.
      //  (b) 게시물별 25s 타임아웃(Promise.race) — 느린 이미지 아카이브·AI 로
      //      한 게시물이 실행 전체를 붙잡아 120s 넘기는 걸 차단(504 근본 원인).
      //      타임아웃 게시물은 실패 처리(수집 시 커서 전진하므로 재발 없음).
      const BACKFILL_CONCURRENCY = 4;
      const POST_TIMEOUT_MS = 25000;
      let _qi = 0, _processed = 0;
      async function _worker(){
        /* 착수 조건에서 POST_TIMEOUT_MS 를 미리 빼둔다 (2026-08-11).
           예전 조건은 '79.9초에도 새 게시물을 시작'할 수 있었고, 그 게시물이
           25초 타임아웃까지 쓰면 105초 + 오버헤드 → 120초 상한을 넘겼다.
           실측 회차: 108s · 113s · 114s (상한 코앞) · 24시간에 2건 사망.
           이제 마지막 착수는 55초 이전 → 최악 80초에 끝난다. */
        while (_qi < toProcess.length
               && Date.now() - startedAt < TIME_BUDGET_MS - POST_TIMEOUT_MS){
          const m = toProcess[_qi++];
          try {
            await Promise.race([
              processOne(m),
              new Promise((_, rej) => setTimeout(() => rej(new Error('post timeout ' + POST_TIMEOUT_MS + 'ms')), POST_TIMEOUT_MS)),
            ]);
          } catch (e){
            results.failed++;
            results.errors.push({ post_id: m.id, error: (e && e.message) || String(e) });
            console.error('[sync-instagram] backfill post ' + m.id + ' failed:', e);
          }
          _processed++;
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(BACKFILL_CONCURRENCY, toProcess.length) }, () => _worker())
      );

      // 처리 미완(시간 예산 소진)이면 커서를 시작점으로 되돌려 유실 방지 —
      // 다음 실행이 재수집(이미 처리분은 existing 으로 스킵).
      if (_processed < toProcess.length){ advanceAfter = runStartAfter; reachedEnd = false; }

      // 커서 저장 (다음 실행 재개점) — 불투명 after 값만(토큰 미포함).
      try {
        await supabaseAdmin.from('ops_alert_state').upsert({
          key: cursorKey, last_alert_at: new Date().toISOString(),
          last_payload: { after: advanceAfter || null }, updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
      } catch (_) {}

      results.scanned_pages = scanned;
      results.processed = _processed;
      results.reached_end = reachedEnd;

      // 완주(가장 오래된 게시물 도달) → done 플래그 + 개인 텔레그램(1회).
      // 이후 백필 실행은 상단 조기 종료(ig_backfill_done)로 IG 재조회 없이 반환.
      if (reachedEnd){
        try {
          const { data: st } = await supabaseAdmin.from('ops_alert_state')
            .select('key').eq('key', doneKey).maybeSingle();
          if (!st){
            await supabaseAdmin.from('ops_alert_state').upsert({
              key: doneKey, last_alert_at: new Date().toISOString(),
              last_payload: { done: true }, updated_at: new Date().toISOString(),
            }, { onConflict: 'key' });
            const { sendTextToTelegramPersonalSafe } = require('../_lib/telegram');
            await sendTextToTelegramPersonalSafe(
              '✅ 인스타그램 전체 이력 백필 완주 — ' + acctLabel + ' 과거 게시물을 웹사이트 기사로 전량 가져왔습니다.'
            ).catch(() => {});
          }
        } catch (_) {}
      }
      return res.status(200).json(results);
    }

    // ═══ 최근-동기화(backfillDays===0) + dry 진단 경로 ═══
    // 1) 게시물 가져오기 — 기본: 최근 25개 / dry+백필: 기간 내 전체(페이지네이션)
    const media = backfillDays > 0
      ? await listMediaPaged({ sinceDays: backfillDays, maxCount: 2000, ...(cred || {}) })
      : await listRecentMedia({ limit: 25, ...(cred || {}) });
    if (!media.length) return res.status(200).json({ imported: 0, message: '게시물 없음.' });

    // 2) 이미 import된 게시물 ID들 조회 (중복 방지).
    const allIds = media.map((m) => m.id).filter(Boolean);
    const { data: existing } = await supabaseAdmin
      .from('articles').select('source_instagram_post_id')
      .in('source_instagram_post_id', allIds);
    const existingSet = new Set((existing || []).map((r) => r.source_instagram_post_id));
    results.skipped_existing = existingSet.size;

    /* 3) 게시물 분류·처리.
     *
     * ■ 시간 예산 (2026-08-11 신설) — 여기엔 예산이 **아예 없었다**.
     * 실측(24시간 312회): 대부분 2~4초(p95 2.2초)인데, 신규 게시물이 여러 개
     * 뜬 회차는 89~114초까지 갔다. 한 건이 Claude 생성 + 이미지·영상 아카이브
     * + X·Threads 게시 + 검색핑을 전부 하기 때문이다. 120초 상한을 넘긴 회차는
     * 통째로 잘려 나가 cron_runs 에 '끝나지 않음' 으로 남았다(24시간 2건).
     *
     * 안전하게 멈출 수 있는 이유: 아직 articles 에 INSERT 하기 전이므로
     * 남긴 게시물은 다음 실행(10분 뒤)에도 그대로 '신규' 로 잡힌다.
     * 즉 못 끝낸 몫은 유실이 아니라 이월이다. (backfill-translations 와 같은 형태) */
    const SYNC_STARTED = Date.now();
    const SYNC_BUDGET_MS = Number(process.env.IG_SYNC_BUDGET_MS || 85000);
    const PER_POST_RESERVE_MS = 30000;  // 한 건이 최악으로 쓰는 시간(AI+미디어+소셜)
    for (const m of media){
      if (existingSet.has(m.id)) continue;
      if (!dry && Date.now() - SYNC_STARTED > SYNC_BUDGET_MS - PER_POST_RESERVE_MS){
        results.deferred = (results.deferred || 0) + 1;
        continue;   // 다음 실행이 이어받는다
      }
      const shortcode = _extractShortcode(m.permalink);
      let cls = 'article';
      if (shortcode && editorialShortcodes.has(shortcode)){
        cls = 'editorial(db)'; results.skipped_editorial_db++;
      } else if (isLikelyEditorialCaption(m.caption)){
        cls = 'editorial(caption)'; results.skipped_editorial_caption++;
      }
      if (dry){
        results.classified.push({
          id: m.id, permalink: m.permalink, class: cls,
          caption_head: String(m.caption || '').slice(0, 80),
          like_count: m.like_count || null,
          comments_count: m.comments_count || null,
        });
        continue;
      }
      if (cls !== 'article'){
        /* 2026-08-12 — 골든아워의 진짜 구멍이 여기였다.
           editorial(db)·editorial(caption) 로 걸러진 게시물은 processOne 을 아예
           타지 않아 X·스레드 자동 게시도, 부스트도 나가지 않았다. 즉 초기 속도
           푸시가 0. 그런데 팔로우 전환은 캐러셀 에디토리얼이 사실상 전부다
           (평균 5.3 vs 영상 0.0). ig_boosts 가 신설(08-09) 이후 0건이던 이유.
           부스트 실패는 수집을 막지 않는다 (maybeBoostPost 는 전체 try/catch). */
        const b = await maybeBoostPost(m, { backfillMode, kind: 'editorial' });
        if (b.boosted) results.boosted = (results.boosted||0)+1;
        continue;
      }
      try { await processOne(m); }
      catch (e){
        results.failed++;
        results.errors.push({ post_id: m.id, error: (e && e.message) || String(e) });
        console.error('[sync-instagram] post ' + m.id + ' failed:', e);
      }
    }

    if (dry){
      results.account = account || 'magazine';
      results.token_source = tokenSource;
      results.editorial_shortcodes_known = editorialShortcodes.size;
      if (qualityGateOn) results.quality_gate = { on: true, min_likes: MIN_LIKES, min_comments: MIN_COMMENTS, weekly_limit: WEEKLY_LIMIT, weekly_published: weeklyPublished };
    }

    // 신규 발행 즉시 검색엔진 알림 — IndexNow(네이버·빙·얀덱스) + WebSub(구글
    // 계열 피드 재수집). 일간 IndexNow 크론은 보험으로 유지, 여기는 실시간 채널.
    if (newUrls.length){
      try { results.search_ping = await pingNewContent(newUrls); }
      catch (e){ results.search_ping = { error: String(e && e.message || e).slice(0, 100) }; }
    }

    // YouTube Shorts 즉시 업로드 넛지 — 릴스 기사가 이번 실행에서 발행됐으면
    // 스위퍼 크론(10분)을 기다리지 않고 youtube-post 를 바로 호출한다.
    // 짧은 타임아웃 후 끊어도 대상 함수는 서버에서 계속 실행되므로 best-effort
    // 넛지로 충분하다. 실패/타임아웃 시 10분 주기 스위퍼가 처리 (백필 모드 제외).
    if (videoImported && !dry && backfillDays === 0 && process.env.CRON_SECRET){
      try {
        const yr = await fetch(SITE + '/api/cron/youtube-post', {
          headers: { authorization: 'Bearer ' + process.env.CRON_SECRET },
          signal: AbortSignal.timeout(15000),
        });
        results.youtube_nudge = yr.status;
      } catch (_){
        results.youtube_nudge = 'nudged (응답 대기 안 함 — 업로드는 서버에서 계속, 스위퍼가 보증)';
      }
    }
    /* note 에 '무엇을 했고 무엇을 미뤘는지' 를 남긴다 (2026-08-11).
       이 크론은 지금까지 note 가 'account=… token_source=…' 뿐이라, 회차가
       몇 건을 이월했는지 대시보드에서 볼 수 없었다. 이월이 매 회차 쌓이면
       그건 예산이 모자란다는 신호다 — 보여야 고칠 수 있다.
       (2026-08-10 이관 크론에서 배운 것: note 가 비면 고장도 안 보인다.) */
    if (!dry){
      res.locals = res.locals || {};
      /* 2026-08-17 — X·스레드 발행 결과도 노트에 싣는다. X 가 8/1부터 조용히
         죽어 있었는데 노트에 트윗 결과가 없어 17일간 아무도 몰랐다.
         성공은 'X 1건', 실패는 실패 문자열 그대로 (상태코드가 보여야 한다). */
      const twArr = results.tweets || [];
      const twFail = twArr.filter(t => String(t).startsWith('실패'));
      const thArr = results.threads || [];
      const thFail = thArr.filter(t => String(t).startsWith('실패'));
      res.locals.cronNote = 'account=' + (account || 'magazine')
        + ' · 수집 ' + (results.imported || 0) + '건'
        + (results.deferred ? ' · 다음 회차로 이월 ' + results.deferred + '건' : '')
        + (results.failed ? ' · 실패 ' + results.failed + '건' : '')
        + (twArr.length ? ' · X ' + (twArr.length - twFail.length) + '/' + twArr.length + '건'
            + (twFail.length ? ' [' + twFail.join('; ').slice(0, 160) + ']' : '') : '')
        + (thArr.length ? ' · 스레드 ' + (thArr.length - thFail.length) + '/' + thArr.length + '건' : '')
        + (function (){
            const L = results.body_len || [];
            if (!L.length) return '';
            const avg = Math.round(L.reduce((a, b) => a + b, 0) / L.length);
            /* 목표는 2026-08-22 에 800 → 600 으로 현실화했다 (한국어 재료가
               평균 350자뿐이라 800 은 지어내기 없이는 불가능했다). */
            const ok = L.filter((n) => n >= 600).length;
            const S = results.src_len || [];
            let src = '';
            if (S.length){
              const savg = Math.round(S.reduce((a, b) => a + b, 0) / S.length);
              src = ' · 재료 ' + savg + '자 · 배율 ' + (avg / (savg || 1)).toFixed(2) + '배';
            }
            return ' · 본문 평균 ' + avg + '자 (600자↑ ' + ok + '/' + L.length + ')' + src;
          })()
        + ' · ' + Math.round((Date.now() - SYNC_STARTED) / 1000) + '초';
    }
    // (백필 완주 감지·done 플래그·텔레그램 통보는 커서 백필 브랜치에서 처리 —
    //  최근-동기화/dry 경로는 여기까지.)
    return res.status(200).json(results);
  } catch (e){
    console.error('[sync-instagram] top-level failure:', e);
    // cronGuard 가 이 예외를 잡아 알림 + cron_runs 기록.
    // 단 timeout/네트워크 류 일시성 실패는 silenceTransient 로 알림 제외
    // (backfill 대량 조회의 20초 초과는 정상 동작의 일부 — 다음 크론이 이어받음).
    throw e;
  }
}, { silenceTransient: true });
