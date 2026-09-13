'use strict';
/**
 * 드라이브 영상 → 틱톡: 두 크론이 함께 쓰는 규칙 한 벌.
 *
 * ── 왜 이 파일이 생겼나 (2026-09-07) ──────────────────────────
 * 도메니코: "틱톡에는 영상이 가끔 누락되거나 중복으로 올라가더라."
 *
 * 실측으로 원인이 갈렸다.
 *
 * ■ 중복 — 크론 둘이 서로를 못 봤다
 *   tiktok-reels        기사 기준, 열쇠 article_id      (매시 01·31분)
 *   drive-tiktok-post   파일 기준, 열쇠 drive_file_id   (10분마다)
 *   열쇠가 다르니 같은 내용을 각자 한 번씩 올린다.
 *   DB 에는 중복 행이 없다 — 그래서 지금까지 안 보였다.
 *   같은 기사가 두 번 나간 쌍 12개를 찾았다. 예:
 *     기사 09-06 09:31  "컴백 이틀 만에 페스티벌, 몬스타엑스의 무대 장악"
 *     파일 09-06 10:16  0906_컴백 이틀 만에 페스티벌까지.mp4
 *
 *   더 나쁜 건, 드라이브 경로가 '이 기사는 이미 올라갔다'는 걸 **알면서도**
 *   올렸다는 것이다. 그 확인이 게시 뒤에 있었고, 유니크 충돌만 피하려고
 *   article_id 를 비웠다 (2026-08-12). 주석엔 "중복 게시가 훨씬 나쁘다"고
 *   적혀 있는데 코드는 반대로 하고 있었다.
 *
 * ■ 도메니코 결정 (2026-09-07): **드라이브가 이긴다.**
 *   드라이브 영상은 사람이 편집한 세로 영상이고, 릴스는 기사에서 자동으로
 *   나온 것이다. 그래서 릴스가 양보한다 — 아직 안 올라간 드라이브 영상이
 *   그 기사를 가리키고 있으면 릴스는 그 기사를 건너뛴다.
 *
 * ■ 누락 — 숫자 두 개가 서로 다른 말을 했다
 *     drive-tiktok-post  MAX_BYTES = 100MB   ← 통과시키고
 *     supabase storage   실제 상한 50MB      ← 여기서 거절
 *   50~100MB 영상은 사전 검사를 통과한 뒤 업로드에서 죽었다. 실패 행은
 *   다음 회차에 다시 후보가 되므로 **10분마다 영원히 재시도하며 영원히 실패**했다.
 *   실측 3건 (08-21 · 09-02 · 09-05) 전부 같은 오류.
 *
 * ── 이 파일의 존재 이유 ──────────────────────────────────────
 * 위 두 가지 다 '규칙이 두 벌이라 한쪽만 맞았다'는 같은 모양이다.
 * 상한도, 파일 선별도, 기사 조회 창도 여기 한 곳에만 둔다.
 */

const { supabaseAdmin } = require('./supabase');
const { matchArticle } = require('./koMatch');
const { doneIdsFrom } = require('./driveClaim');
const drive = require('./driveVideos');

/* 우리 스토리지(media 버킷)의 실제 상한과 같은 값이어야 한다.
 * 버킷에 자체 상한이 없어(null) 프로젝트 전역 50MB 가 걸린다 —
 * 2026-09-07 storage.buckets 조회로 확인. 이 숫자를 올리려면 먼저 스토리지
 * 상한을 올려야 한다. 여기만 올리면 08~09월 사고가 그대로 돌아온다. */
const MAX_BYTES = Number(process.env.TIKTOK_DRIVE_MAX_BYTES || 50 * 1024 * 1024);

const LOOKBACK_DAYS = Number(process.env.DRIVE_MATCH_LOOKBACK_DAYS || 21);
const ART_COLS = 'id, title, slug, custom_url, content, category, tags, published_date, instagram_caption';

/**
 * 드라이브 파일에서 틱톡에 올릴 수 있는 것만 고른다 — 순수 함수.
 * @returns {{candidates:Array, skipped:Array<{name,why}>}}
 */
function pickViable(files, doneSet) {
  const done = doneSet || new Set();
  const candidates = [];
  const skipped = [];
  for (const f of (files || [])) {
    if (!f || !f.id) continue;
    if (done.has(f.id)) continue;
    const why = drive.shouldSkip(f.name, null, 'tiktok');
    if (why) { skipped.push({ name: f.name, why }); continue; }
    if (f.bytes > MAX_BYTES) {
      /* 사전에 걸러서 보류로 보여준다. 예전엔 통과시킨 뒤 업로드에서 죽어
       * 10분마다 조용히 재시도했다 — 사람 눈에는 '그 영상만 안 올라감' 이었다. */
      skipped.push({
        name: f.name, over: true, mb: Math.round(f.bytes / 1048576),
        why: Math.round(f.bytes / 1048576) + 'MB — 상한 '
          + Math.round(MAX_BYTES / 1048576) + 'MB 초과 (스토리지가 못 받는다)',
      });
      continue;
    }
    candidates.push(f);
  }
  return { candidates, skipped };
}

/** 매칭에 쓸 최근 발행 기사. 두 크론이 같은 창·같은 컬럼을 본다. */
async function recentArticles(limit = 400) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const { data } = await supabaseAdmin.from('articles')
    .select(ART_COLS).eq('status', 'published')
    .gte('published_date', since)
    .order('published_date', { ascending: false }).limit(limit);
  return data || [];
}

/** 이미 처리한 드라이브 파일 id 집합 (failed 는 재시도 대상이라 제외). */
async function doneDriveIds() {
  const { data } = await supabaseAdmin.from('tiktok_posts')
    .select('drive_file_id, status, created_at').not('drive_file_id', 'is', null).limit(5000);
  return doneIdsFrom(data);
}

/**
 * **아직 안 올라간** 드라이브 영상이 가리키는 기사 id 집합.
 * 릴스가 양보할 대상이다.
 *
 * 매칭은 drive-tiktok-post 와 글자 그대로 같은 함수·같은 기사 목록을 쓴다.
 * 파일→기사 방향 하나뿐이라 두 크론의 판단이 갈릴 수 없다.
 * (기사 목록을 줄여서 부르면 koMatch 의 tokenIsLive·MARGIN 이 다르게 동작한다.
 *  그래서 반드시 같은 목록을 통째로 넘긴다.)
 *
 * @returns {Promise<{ids:Set<string>, files:number, note:string}>}
 */
async function articlesWaitingForDrive() {
  if (!drive.isConfigured()) return { ids: new Set(), files: 0, note: '드라이브 미설정' };
  let files;
  try {
    files = await drive.listVideos();
  } catch (e) {
    /* 드라이브를 못 보면 양보 판단을 할 수 없다. 그때는 양보하지 않는다 —
     * 최악이 '중복 1건' 이고, 여기서 멈추면 틱톡이 통째로 죽는다. */
    return { ids: new Set(), files: 0, note: '드라이브 조회 실패: ' + String((e && e.message) || e).slice(0, 120) };
  }
  const done = await doneDriveIds();
  const { candidates } = pickViable(files, done);
  if (!candidates.length) return { ids: new Set(), files: files.length, note: '대기 중인 드라이브 영상 없음' };

  const articles = await recentArticles();
  const ids = new Set();
  for (const f of candidates) {
    const m = matchArticle(f.name, articles);
    if (m && m.matched && m.matched.id) ids.add(m.matched.id);
  }
  return { ids, files: files.length, note: '드라이브 대기 ' + candidates.length + '건 · 기사 ' + ids.size + '건 예약' };
}

/* ── 적체 판정 (2026-09-07) ────────────────────────────────────
 * 도메니코: "오늘부터 앞으로 안 올라가는 건 없게 하자."
 *
 * 그러려면 '안 올라간 것' 을 누군가 보고 있어야 한다. 지금은 아무도 안 본다.
 * pipeline-watch 의 틱톡 감시는 **화보 사진 경로(tiktok-post)만** 본다.
 * 드라이브 영상 경로와 릴스 경로는 감시 대상이 아니었다 — 그래서 50MB 초과
 * 영상 3건이 10분마다 실패하는 동안 아무 알림도 안 갔다.
 *
 * 이 함수는 원인을 가리지 않는다. 상한 초과든, 기사 매칭 실패든, 크론이
 * 죽었든, 결과는 하나다: **폴더에 넣었는데 안 올라간 영상이 있다.**
 * 그 하나만 본다.
 *
 * 순수 함수다 — 네트워크 없이 테스트한다.
 */
const STALE_HOURS = Number(process.env.TIKTOK_DRIVE_STALE_HOURS || 6);
/* 상한 초과를 곧바로 알리지 않고 기다리는 시간 (2026-09-07 오후 수정).
 * 첫 판에서 "파일을 줄여서 다시 넣어 주세요" 라고 사람에게 시켰다. 틀렸다 —
 * 그건 맥미니 압축기가 5분마다 자동으로 하는 일이다. 실제로 '0822_포핸즈'는
 * 알림이 나간 지 15분 만에 압축기가 50.5MB → 12.4MB 로 처리했다.
 * 사람에게 기계가 이미 하는 일을 시키는 알림은 없느니만 못하다.
 * 그래서 압축기에게 몇 바퀴 줄 시간을 준다. 그 시간이 지나도 남아 있으면
 * 그건 파일 문제가 아니라 **압축기가 그 파일을 못 보고 있다**는 뜻이다. */
const OVERSIZE_GRACE_H = Number(process.env.TIKTOK_DRIVE_OVERSIZE_GRACE_H || 1);

function judgeDriveBacklog(files, doneSet, opts) {
  const o = opts || {};
  const now = o.now ? new Date(o.now).getTime() : Date.now();
  const staleH = Number.isFinite(o.staleHours) ? o.staleHours : STALE_HOURS;
  const { candidates, skipped } = pickViable(files, doneSet);

  const ageH = (f) => (f.modifiedAt ? (now - Date.parse(f.modifiedAt)) / 3600000 : 0);

  /* 방금 넣은 영상은 아직 정상 대기다. 10분마다 도니까 몇 시간이면 충분하다. */
  const stuck = candidates
    .filter((f) => ageH(f) >= staleH)
    .map((f) => ({ name: f.name, hours: Math.round(ageH(f)) }))
    .sort((a, b) => b.hours - a.hours);

  /* 상한 초과 — 압축기에게 시간을 준 뒤에도 남아 있는 것만 센다.
   * (파일명에 _ 를 붙였거나 '완료' 가 들어간 의도적 제외는 여기 안 들어온다) */
  const graceH = Number.isFinite(o.oversizeGraceHours) ? o.oversizeGraceHours : OVERSIZE_GRACE_H;
  const byName = new Map((files || []).filter((f) => f && f.name).map((f) => [f.name, f]));
  const oversize = skipped.filter((x) => x && x.over)
    .map((x) => ({ name: x.name, mb: x.mb, hours: Math.round(ageH(byName.get(x.name) || {})) }))
    .filter((x) => x.hours >= graceH);

  const healthy = stuck.length === 0 && oversize.length === 0;
  let cause = null;
  const parts = [];
  if (oversize.length) parts.push('압축기가 못 줄인 영상 ' + oversize.length + '건');
  if (stuck.length) parts.push(staleH + '시간 넘게 안 올라간 영상 ' + stuck.length + '건 (최장 ' + stuck[0].hours + '시간)');
  let reason = '드라이브 영상 적체 없음 (대기 ' + candidates.length + '건)';
  if (parts.length) {
    /* 원인이 둘이면 둘 다 적는다. 첫 판은 제목에 하나만 적고 밑에 다른 원인을
     * 나열해서, 읽는 사람이 둘을 한 가지 일로 오해했다 (2026-09-07 실제 발생). */
    cause = oversize.length && stuck.length ? 'both' : (oversize.length ? 'oversize' : 'stuck');
    reason = parts.join(' · ');
  }
  return { healthy, cause, reason, stuck, oversize, waiting: candidates.length,
    staleHours: staleH, oversizeGraceHours: graceH };
}

/** 실제 드라이브·DB 를 읽어 적체를 판정한다. */
async function driveBacklog(opts) {
  if (!drive.isConfigured()) return { healthy: true, cause: null, reason: '드라이브 미설정', stuck: [], oversize: [], waiting: 0 };
  const files = await drive.listVideos();
  const done = await doneDriveIds();
  return judgeDriveBacklog(files, done, opts);
}

module.exports = {
  MAX_BYTES, LOOKBACK_DAYS, ART_COLS, STALE_HOURS,
  pickViable, recentArticles, doneDriveIds, articlesWaitingForDrive,
  judgeDriveBacklog, driveBacklog,
};
