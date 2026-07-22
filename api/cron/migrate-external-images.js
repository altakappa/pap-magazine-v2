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

const EXTERNAL_RE = /drive\.google\.com|pap-korea-bucket\.s3/;
const MAX_BYTES = 15 * 1024 * 1024;
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
    return res.status(200).json({ ok: true, done: true, migrated: 0, note: 'no external-image editorials left' });
  }

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
    sendTextToTelegramSafe(
      '🖼 이미지 이관 중 죽은 외부 링크 ' + newFailures.length + '건 발견\n' +
      newFailures.slice(0, 10).map(f => '· ' + f.reason + ' — editorial ' + f.editorial_id).join('\n') +
      (newFailures.length > 10 ? '\n…외 ' + (newFailures.length - 10) + '건' : '') +
      '\n(원본 재업로드 필요 — 관리자에서 해당 에디토리얼 편집)'
    ).catch(() => {});
  }

  console.log('[migrate-external-images]', { editorialsDone, imagesMoved, failures: newFailures.length, ms: Date.now() - started });
  return res.status(200).json({ ok: true, editorialsDone, imagesMoved, failures: newFailures.length });
});
