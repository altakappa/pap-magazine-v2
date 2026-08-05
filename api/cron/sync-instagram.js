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

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { pingNewContent, SITE } = require('../_lib/pingSearch');
const { postTweet, buildArticleTweet, isConfigured: xConfigured, buildConversationalTweet } = require('../_lib/xPost');
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
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
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
      // env 미설정 계정은 조용히 스킵(200) — 크론이 실패 알림을 쏟지 않게.
      return res.status(200).json({ ok: true, skipped: 'account ' + account + ' env 미설정', account, token_source: picked.source });
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
        .select('key').eq('key', doneKey).maybeSingle();
      if (doneSt) return res.status(200).json({ ok: true, backfill_done: true, account: account || 'magazine', note: '백필 완주 — 재실행하려면 ops_alert_state 의 ' + doneKey + ' 삭제' });
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
      const cat = String(generated.category || '').toLowerCase();
      const isEditorial = cat === 'editorial'
        || (backfillMode && !ARTICLE_CATEGORIES.includes(cat));
      if (isEditorial){ results.skipped_editorial_ai++; return; }
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
        if (h && pubStatus === 'published'){
          const artUrl = SITE + '/article/' + encodeURIComponent(h);
          if (!backfillMode){
            newUrls.push(artUrl);
            // X 자동 게시 — 발행 즉시 트윗 (키 미설정 시 조용히 스킵).
            if (xConfigured()){
              try {
                const artForX = { title: generated.title_ko || row.title, url: artUrl, tags: generated.tags, body: generated.body_ko, category: generated.category };
                let xText = null;
                try {
                  const conv = await buildConversationalTweet(artForX);
                  if (conv) { xText = conv.text; console.log('[sync-ig] 대화형 트윗 (점수 ' + conv.score + '): ' + conv.angle); }
                } catch (_) { /* 실패는 삼키고 기본 빌더로 */ }
                const tw = await postTweet(xText || buildArticleTweet(artForX));
                results.tweets = (results.tweets || []).concat(tw.ok ? [tw.id] : ['실패:' + (tw.detail || tw.status)]);
              } catch (_) {}
            }
            // Threads 자동 게시 — 실패해도 수집 흐름 계속(스위퍼가 재시도).
            if (process.env.THREADS_AUTOPOST !== 'false'){
              try {
                const th = await postArticleToThreads({
                  id: inserted.id, title: row.title, content: row.content,
                  category: row.category, url: artUrl,
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
          if (shortcode && editorialShortcodes.has(shortcode)){ results.skipped_editorial_db++; continue; }
          if (isLikelyEditorialCaption(m.caption)){ results.skipped_editorial_caption++; continue; }
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
        while (_qi < toProcess.length && Date.now() - startedAt < TIME_BUDGET_MS){
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
            sendTextToTelegramPersonalSafe(
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

    // 3) 게시물 분류·처리.
    for (const m of media){
      if (existingSet.has(m.id)) continue;
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
      if (cls !== 'article') continue;
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
