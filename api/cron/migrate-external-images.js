/**
 * PAP Magazine — 외부 이미지 Supabase 이관 크론 (2026-07-22 신설, 도메니코 승인)
 * Route: /api/cron/migrate-external-images   (vercel.json: 매시, 완주 후 무해 공회전)
 *
 * 왜: CREATURES 사고 — 커버가 구글 드라이브 링크였는데 드라이브에서 원본이
 * 사라져 카드가 빈 배경으로 노출됐다. 전수 조사 결과 published 에디토리얼 중
 * 드라이브 1,077건 · 구 S3 888건이 외부 호스트 의존 → 외부에서 파일이 사라지면
 * 조용히 깨진다. 커버·썸네일·갤러리를 Supabase Storage(media 버킷)로 옮겨
 * 단일 소스로 만든다.
 *
 * 동작:
 *  - external_image_editorials(lim) SQL 함수로 배치 선별 (gallery 는 text[] 라
 *    PostgREST ilike 불가 → DB 함수. migration image_migration_infra)
 *  - 행별 외부 URL 수집 → fetch(15s 타임아웃·15MB 상한·이미지 MIME 검증)
 *    → media 버킷 migrated/<editorialId>/ 에 업로드 → 행 UPDATE (한 번에)
 *  - 실패 URL 은 image_migration_failures 에 기록하고 이후 실행에서 건너뜀
 *    (죽은 링크 무한 재시도 방지 — 발견 보고는 image-link-check 크론 담당)
 *  - 시간 예산 90s: 초과 시 그 시점까지 저장하고 종료 (다음 실행이 이어감)
 *  - 이관된 행은 선별 조건에서 자연히 빠지므로 멱등
 */
'use strict';
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { sendTextToTelegramSafe } = require('../_lib/telegram');

/* 이관 대상 호스트 (2026-08-09 wixstatic 추가)
 *
 * 실측 — published 에디토리얼 2,295건의 커버 호스트:
 *     google drive 1,077 · supabase(자사) 958 · 구 S3 180 · wixstatic 71
 * wixstatic 71건은 여태 **어느 크론의 대상도 아니었다.** 주간 점검이 잡아내는
 * 403 이 바로 이들이고(위 사이트의 핫링크 차단), 해법은 재등록이 아니라 이관이다.
 *
 * ⚠️ 이 정규식이 곧 '완주' 의 정의다. 이 크론을 스케줄에서 뺄 때는 반드시
 * **이 정규식에 걸리는 잔량**으로 재야 한다. 2026-07-28 커밋 64bc86d 는
 * '인스타 CDN 잔존 0건'을 근거로 껐는데, 인스타 CDN 은 여기 없다.
 * 그래서 드라이브 1,077건이 12일간 그대로였다(끄기 전과 정확히 같은 수). */
const EXTERNAL_RE = /drive\.google\.com|pap-korea-bucket\.s3|static\.wixstatic\.com/;

/* ─── 실패 사유의 '성격' — 이 파일의 유일한 기준 (2026-08-12) ───────────────
 *
 * 오늘 하루에 세 번 다시 분류했다. 매번 알림 문구만 고쳤기 때문이다.
 * 이번엔 판정을 한 곳에 모으고, 알림·재시도가 **같은 함수**를 쓰게 한다.
 *
 *   영구   HTTP 404 · 410 · 403   원본이 없거나 영영 막혔다 → 재업로드 외 방법 없음
 *          (403: wix 79장을 브라우저로 직접 확인 — 진짜 사망이었다)
 *   설정   too large              우리 상한 문제 → 상한 조정·리사이즈
 *   일시적 5xx · storage · timeout · text/html
 *                                 저쪽 서버가 잠깐 흔들렸거나 우리 업로드가 튕겼다
 *
 * 왜 text/html 이 일시적인가: 드라이브는 파일이 진짜 없으면 404 를 준다.
 * 200 + HTML 은 대개 그 순간의 오류·제한 페이지다. 실측(2026-08-12): 4시간
 * 1,000장 남짓 중 4건, 한 에디토리얼에서 500·500·html 이 같은 순간에 났다 —
 * 파일 셋이 동시에 사라졌다기보다 그 순간 드라이브가 흔들렸다고 보는 게 맞다.
 *
 * ⚠️ 여기에 사유를 추가할 때는 '재시도하면 결과가 달라질 수 있는가' 만 묻는다.
 *    달라질 수 없으면 영구다. 영구를 일시적으로 넣으면 잔량이 안 줄어드는
 *    꼬리가 생기고, 일시적을 영구로 넣으면 멀쩡한 원본을 잃는다. */
function isTransientReason(reason) {
  const r = String(reason || '');
  return /^storage:/.test(r)
      || /^HTTP 5\d\d/.test(r)
      || /^not an image: text\/html/.test(r)
      || /timeout/i.test(r)
      || /^fetch /.test(r);
}
/* 재시도 창 — 1시간 지난 것부터, 24시간까지만 다시 시도한다.
   하루를 매시간 두드려도 안 되면 그건 일시적이 아니다(그때는 영구로 굳는다).
   무한 재시도는 잔량이 영영 안 줄어드는 꼬리를 만든다. */
const RETRY_AFTER_MS = 3600000;      // 1시간
const RETRY_GIVE_UP_MS = 86400000;   // 24시간
/* 상한 30MB — 2026-08-11 15MB 에서 올렸다.
 *
 * wix 우선 이관 첫 회차(00:10 UTC)에서 13장이 'too large' 로 **영구 제외**됐다.
 * 실측 크기: 15.9 · 16.0 · 16.6 · 17.0 · 17.3 · 17.4 · 17.5 · 17.5 · 19.0 ·
 *            19.1 · 19.9 · 22.8 · 24.7 MB — 전부 15MB 를 조금 넘긴 원본이다.
 * 죽은 링크가 아니라 **멀쩡한 사진인데 상한에 걸린 것**이고, 실패로 기록되면
 * 이 크론이 두 번 다시 시도하지 않는다. 하필 가장 위험한 wix 에서 터졌다.
 *
 * 30MB 인 이유: (a) 걸린 13장의 최댓값이 24.7MB 라 여유를 두면 충분하고,
 * (b) media 버킷에는 file_size_limit 이 없어(null) 스토리지 쪽 제약이 없으며,
 * (c) 함수 메모리 1024MB 에 버퍼는 한 번에 한 장뿐이다.
 * 남은 구 S3 14장(58~98MB)은 이 상한으로도 못 넘는다 — 리사이즈가 답이고 별건.
 *
 * ⚠️ 더 올릴 때는 90초 예산을 같이 봐라. 큰 파일은 다운로드에 시간을 먹고,
 *    한 장이 예산을 다 쓰면 그 회차 전체가 한 편도 못 끝낸다. */
const MAX_BYTES = 30 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const TIME_BUDGET_MS = 90000;

function extFromContentType(ct) {
  const m = String(ct || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('avif')) return 'avif';
  return 'jpg';
}

// 구 S3 버킷은 이미지를 binary/octet-stream 으로 서빙한다(업로드 당시
// Content-Type 미지정 — 첫 배치 173건 전량 이 사유로 실패한 실측 교훈).
// MIME 이 무의미한 응답은 URL 확장자로 이미지 여부·타입을 판정한다.
const IMG_EXT_RE = /\.(jpe?g|png|webp|gif|avif|heic)(\?|$)/i;
function contentTypeFromUrl(url) {
  const m = String(url).toLowerCase().match(IMG_EXT_RE);
  if (!m) return null;
  const ext = m[1] === 'jpg' ? 'jpeg' : m[1];
  return 'image/' + ext;
}

async function fetchImage(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let ct = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\//i.test(ct)) {
      // octet-stream/빈 MIME 은 확장자 폴백 (구 S3 대응). html 등은 여전히 거부.
      const inferred = (/^(binary\/octet-stream|application\/octet-stream)?$/i.test(ct))
        ? contentTypeFromUrl(url) : null;
      if (!inferred) throw new Error('not an image: ' + (ct || 'no content-type').slice(0, 40));
      ct = inferred;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0) throw new Error('empty body');
    if (buf.length > MAX_BYTES) throw new Error('too large: ' + buf.length);
    return { buf, contentType: ct };
  } finally {
    clearTimeout(to);
  }
}

/* ─── 모든 종료 지점에 note 를 남긴다 (2026-08-10 신설) ────────────────
 *
 * 이 크론은 691회를 돌면서 **진전 0** 이었는데 5일간 아무도 몰랐다.
 * 원인은 두 겹이다:
 *   ① 큐 맨 앞 12건이 전부 죽은 링크라 매 회차가 통째로 skip 됐다
 *      (head-of-line blocking — 2026-08-01 마이그레이션이 고쳤다)
 *   ② **cronNote 를 한 줄도 안 남겼다.** 그래서 cron_runs 에는 note 가
 *      전부 빈칸이었고, 대시보드에서는 '성실히 돌고 있음' 으로만 보였다.
 *
 * ②가 없었으면 ①은 하루 안에 보였다. 매 실행이 '무엇을 했고 얼마나 남았는지'
 * 를 말하게 한다 — 특히 **잔량**. 잔량이 안 줄면 그게 곧 고장 신호다.
 * (틱톡이 21일, 번역이 열흘, FAQ 가 열흘 — 전부 같은 모양이었다.) */
function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

/** 남은 대상 수 — 진전 여부를 note 로 보이게 하는 핵심 숫자. 실패해도 무시. */
async function remainingCount() {
  try {
    const { data, error } = await supabaseAdmin.rpc('external_image_editorials', { lim: 100000 });
    if (error) return null;
    return Array.isArray(data) ? data.length : null;
  } catch (_) { return null; }
}

module.exports = withCronGuard('migrate-external-images', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const started = Date.now();
  const lim = Math.max(1, Math.min(30, parseInt((req.query && req.query.limit) || '12', 10) || 12));

  const { data: rows, error: selErr } = await supabaseAdmin.rpc('external_image_editorials', { lim });
  if (selErr) throw new Error('selector failed: ' + selErr.message);
  if (!rows || rows.length === 0) {
    return res.status(200).json({
      ok: true, done: true, migrated: 0,
      note: note(res, '완주 — 외부 호스트 이미지 0건 (드라이브·구 S3·wix)'),
    });
  }

  /* 우리 쪽 일시적 실패는 한 시간 뒤 자동으로 한 번 더 시도한다 (2026-08-12).
   *
   * image_migration_failures 는 '다시는 시도 안 함' 이라는 뜻인데, 여기에는
   * 성격이 다른 셋이 섞여 들어온다:
   *   (a) 진짜 영구  — HTTP 404 · 410 · not an image   (원본이 없다)
   *   (b) 우리 설정  — too large                        (상한을 올리면 된다)
   *   (c) 일시적     — storage 오류                     (다시 하면 대개 된다)
   * (b)(c) 를 영구로 굳히는 바람에 118 · 121 두 번을 손으로 치웠고,
   * 오늘 또 storage 실패 1건이 같은 자리에 박혔다. 손으로 세 번 치우지 않는다.
   *
   * 일시적 사유(isTransientReason)만, 1시간 지난 것부터 24시간까지만 지운다:
   *  · 진짜로 계속 실패하면 매시간 한 번씩 다시 걸린다 — 한 장이라 비용은 무시할 만하고
   *    알림에 계속 보이므로 조용히 묻히지 않는다.
   *  · 같은 회차 안에서 무한 재시도하지는 않는다(1시간 간격).
   * 404·too large 는 손대지 않는다 — 그건 재시도해도 결과가 같다. */
  try {
    const now = Date.now();
    const { data: old } = await supabaseAdmin.from('image_migration_failures')
      .select('url, reason')
      .lt('failed_at', new Date(now - RETRY_AFTER_MS).toISOString())
      .gt('failed_at', new Date(now - RETRY_GIVE_UP_MS).toISOString());
    const retryUrls = (old || []).filter(f => isTransientReason(f.reason)).map(f => f.url);
    if (retryUrls.length) {
      await supabaseAdmin.from('image_migration_failures').delete().in('url', retryUrls);
    }
  } catch (_) { /* 정리 실패는 무시 — 본업을 막지 않는다 */ }

  // 이전 실패 URL 은 건너뛴다 (죽은 링크 재시도 금지)
  const { data: fails } = await supabaseAdmin.from('image_migration_failures').select('url');
  const failSet = new Set((fails || []).map(f => f.url));

  let editorialsDone = 0, imagesMoved = 0;
  const newFailures = [];

  for (const row of rows) {
    if (Date.now() - started > TIME_BUDGET_MS) break;

    const urlMap = {}; // old → new
    const targets = [];
    if (EXTERNAL_RE.test(row.cover_image || '')) targets.push(row.cover_image);
    if (EXTERNAL_RE.test(row.thumbnail || '') && row.thumbnail !== row.cover_image) targets.push(row.thumbnail);
    for (const g of row.gallery || []) {
      if (EXTERNAL_RE.test(g) && !targets.includes(g)) targets.push(g);
    }

    let idx = 0;
    for (const url of targets) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      if (failSet.has(url)) continue;
      try {
        const { buf, contentType } = await fetchImage(url);
        const path = 'migrated/' + row.id + '/' + Date.now() + '_' + (idx++) + '.' + extFromContentType(contentType);
        const { error: upErr } = await supabaseAdmin.storage.from('media')
          .upload(path, buf, { contentType, upsert: true });
        if (upErr) throw new Error('storage: ' + upErr.message);
        const { data: pub } = supabaseAdmin.storage.from('media').getPublicUrl(path);
        urlMap[url] = pub.publicUrl;
        imagesMoved++;
      } catch (e) {
        const reason = (e && e.message) || 'unknown';
        newFailures.push({ url, editorial_id: row.id, reason: reason.slice(0, 200) });
        failSet.add(url);
      }
    }

    // 성공분만 치환해 저장 — 실패 URL 은 원본 유지 (부분 이관 허용, 다음 실행/수동 복구 대상)
    if (Object.keys(urlMap).length > 0) {
      const patch = {};
      if (urlMap[row.cover_image]) patch.cover_image = urlMap[row.cover_image];
      if (urlMap[row.thumbnail]) patch.thumbnail = urlMap[row.thumbnail];
      const newGallery = (row.gallery || []).map(g => urlMap[g] || g);
      if (JSON.stringify(newGallery) !== JSON.stringify(row.gallery || [])) patch.gallery = newGallery;
      if (Object.keys(patch).length > 0) {
        const { error: updErr } = await supabaseAdmin.from('editorials').update(patch).eq('id', row.id);
        if (updErr) {
          console.error('[migrate-external-images] update failed', row.slug, updErr.message);
        } else {
          editorialsDone++;
        }
      }
    }
  }

  if (newFailures.length > 0) {
    await supabaseAdmin.from('image_migration_failures')
      .upsert(newFailures, { onConflict: 'url' })
      .then(() => {}, e => console.error('[migrate-external-images] failure log', e && e.message));
    // 이관 중 발견된 죽은 링크는 즉시 알림 — 원본 재업로드가 필요한 목록
    /* 사유를 뭉뚱그리지 않는다 — 2026-08-11 교훈.
       'too large' 13건을 '죽은 링크 · 재업로드 필요' 로 알렸는데, 실제로는
       멀쩡한 원본이 상한에 걸린 것이었다. 원인이 다르면 할 일도 다르다:
         죽은 링크 → 원본이 없다. 재업로드 말고는 답이 없다
         용량 초과 → 원본은 살아 있다. 상한을 올리거나 줄여서 받으면 된다 */
    const oversize = newFailures.filter(f => /^too large/.test(f.reason));
    /* 'storage:' 는 업로드가 거절된 것 — 원본은 멀쩡하다.
       이걸 '원본이 사라졌다' 로 알리면 도메니코가 있지도 않은 원본을 찾으러 간다.
       (2026-08-12 실측: storage: Bad Request 1건을 '죽은 링크' 로 알렸다.) */
    const transient = newFailures.filter(f => isTransientReason(f.reason));
    const dead = newFailures.filter(f => !/^too large/.test(f.reason) && !isTransientReason(f.reason));
    const lines = [];
    if (dead.length) {
      lines.push('❌ 죽은 링크 ' + dead.length + '건 — 원본이 사라졌다(재업로드 외 방법 없음)');
      lines.push(...dead.slice(0, 8).map(f => '· ' + f.reason + ' — editorial ' + f.editorial_id));
    }
    if (oversize.length) {
      const mb = (n) => (Number(n) / 1048576).toFixed(1) + 'MB';
      const sizes = oversize.map(f => Number(String(f.reason).split(': ')[1]) || 0);
      lines.push('📦 용량 초과 ' + oversize.length + '건 — 원본은 멀쩡하다. 상한 '
        + Math.round(MAX_BYTES / 1048576) + 'MB 초과 (최대 ' + mb(Math.max.apply(null, sizes)) + ')');
      lines.push('   → 상한을 올리거나 리사이즈해서 받아야 한다. 재업로드 대상 아님');
    }
    if (transient.length) {
      lines.push('🔁 일시적 실패 ' + transient.length + '건 — 저쪽 서버가 잠깐 흔들렸거나 업로드가 튕겼다. 원본은 멀쩡하다');
      lines.push('   ' + transient.slice(0, 4).map(f => '· ' + f.reason).join('\n   '));
      lines.push('   → 1시간 뒤부터 자동 재시도(최대 24시간). 할 일 없음');
    }
    await sendTextToTelegramSafe(
      '🖼 이미지 이관 중 실패 ' + newFailures.length + '건\n' + lines.join('\n')
    ).catch(() => {});
  }

  console.log('[migrate-external-images]', { editorialsDone, imagesMoved, failures: newFailures.length, ms: Date.now() - started });
  /* 잔량을 함께 남긴다 — 이 숫자가 안 줄면 '돌았지만 진전 없음' 이고,
     그게 2026-07-23~28 에 5일간 안 보였던 바로 그 상태다. */
  const left = await remainingCount();
  return res.status(200).json({
    ok: true, editorialsDone, imagesMoved, failures: newFailures.length, remaining: left,
    note: note(res,
      '이관 ' + editorialsDone + '편 · 이미지 ' + imagesMoved + '장'
      + (newFailures.length ? ' · 실패 ' + newFailures.length + '건' : '')
      + (left === null ? '' : ' · 잔량 ' + left + '편')
      + (editorialsDone === 0 ? ' ⚠️ 진전 0 — 큐가 막혔는지 확인' : '')),
  });
});
