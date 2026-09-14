/**
 * PAP Magazine — 이미지를 저장 전에 줄인다 (2026-09-14 전송량 초과 후속)
 *
 * 왜 이 파일이 생겼나
 * ─────────────────────────────────────────────────────────────
 * 2026-09-14 Supabase 전송량 초과로 사이트가 3시간 40분 멈췄다. 알림에는
 * `exceed_egress_quota`(DB 쪽)와 `exceed_cached_egress_quota`(Storage 쪽)가
 * 같이 떴다. DB 쪽은 embedding 열을 빼서 고쳤고(12d2fff), 이 파일은 Storage 쪽이다.
 *
 * 무엇이 문제였나 (2026-09-14 실측):
 *   media 버킷 48,904개 · 35GB · 평균 758KB
 *     jpg 38,689개 21GB(평균 562KB) · png 8,212개 6.7GB(평균 839KB) · mp4 1,993개 8.1GB
 *   1MB 넘는 파일 6,818개가 전체 용량의 54.9%
 *
 * 독자가 실제로 받는 건 작다(기사 한 장 54KB). Vercel 이 화면 크기에 맞게 줄여서 준다.
 * 문제는 **그 54KB 를 만들려고 Vercel 이 원본 758KB 를 Supabase 에서 통째로 끌어간다**는 것.
 * `/_vercel/image` 가 하루 16,000회. 758KB × 16,000 = 하루 약 12GB = 한 달 360GB.
 * 250GB 쿼터를 이것만으로 넘긴다.
 *
 * 그래서 저장하는 순간에 줄인다. 독자 화면은 그대로고, Vercel 이 가지러 가는 길만 얇아진다.
 *
 * 얼마나 줄어드나 (2026-09-14 실측 4장, 긴 변 2000px · JPEG q82):
 *   1,250,893 → 218,020   (5.7배)
 *   2,153,546 → 302,607   (7.1배, PNG 원본)
 *     953,029 → 581,700   (1.6배, 이미 잘 압축된 원본)
 *   2,198,974 → 251,019   (8.8배)
 *   합계 6,556,442 → 1,353,346 = 평균 **4.8배**
 *
 * 왜 2000px 인가: 매거진 화보를 크게 봐도 2000px 이면 충분하다. 그보다 크게 저장해도
 * 화면에서 보이지 않고 전송량만 먹는다.
 *
 * 안전 규칙 (이 파일은 절대 실패하면 안 된다)
 *   - 어떤 이유로든 줄이기에 실패하면 **원본을 그대로 돌려준다.** 업로드를 막지 않는다.
 *   - 줄인 결과가 원본보다 크면 원본을 쓴다 (작은 이미지에서 종종 그렇다).
 *   - GIF 는 건드리지 않는다 (애니메이션이 깨진다).
 *   - 투명(alpha)이 있는 PNG 는 PNG 로 남긴다 (로고가 검게 변한다). 크기만 줄인다.
 *   - sharp 는 쓸 때만 불러온다 (네이티브 모듈이라 미리 부르면 sharp 없는 경로까지 죽는다).
 */

'use strict';

/* 긴 변 상한. 2000px 이면 매거진 화보를 크게 봐도 충분하다. */
const MAX_DIM = Number(process.env.IMAGE_SHRINK_MAX_DIM || 2000);
/* JPEG 품질. 82 는 눈으로 차이를 못 느끼는 하한선 근처다. */
const QUALITY = Number(process.env.IMAGE_SHRINK_QUALITY || 82);
/* 이보다 작으면 손대지 않는다. 이미 충분히 작다. */
const SKIP_UNDER_BYTES = Number(process.env.IMAGE_SHRINK_SKIP_UNDER || 120 * 1024);

function isShrinkable(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (/gif/.test(ct)) return false;        // 애니메이션이 깨진다
  if (/svg/.test(ct)) return false;        // 벡터라 줄일 게 없다
  return /^image\/(jpe?g|png|webp|avif|tiff?|heic|heif)/.test(ct);
}

/**
 * 이미지 버퍼를 줄인다. 실패하면 원본을 그대로 돌려준다 — 절대 throw 하지 않는다.
 *
 * @returns {Promise<{buf: Buffer, contentType: string, shrunk: boolean,
 *                    from: number, to: number, reason: string}>}
 */
async function shrinkImageBuffer(buf, contentType, opts) {
  opts = opts || {};
  const maxDim = Number(opts.maxDim || MAX_DIM);
  const quality = Number(opts.quality || QUALITY);
  const skipUnder = opts.skipUnder === undefined ? SKIP_UNDER_BYTES : Number(opts.skipUnder);
  const out = { buf, contentType, shrunk: false, from: buf ? buf.length : 0, to: buf ? buf.length : 0, reason: '' };

  if (!buf || !buf.length) { out.reason = '빈 버퍼'; return out; }
  if (!isShrinkable(contentType)) { out.reason = '대상 아님: ' + contentType; return out; }
  if (buf.length < skipUnder) { out.reason = '이미 작다'; return out; }

  try {
    const sharp = require('sharp');
    const img = sharp(buf, { limitInputPixels: false, failOn: 'none' });
    const meta = await img.metadata();
    const hasAlpha = !!(meta && meta.hasAlpha);
    const needResize = !!(meta && (meta.width > maxDim || meta.height > maxDim));

    let pipeline = sharp(buf, { limitInputPixels: false, failOn: 'none' }).rotate();
    if (needResize) {
      pipeline = pipeline.resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true });
    }

    let nextType;
    if (hasAlpha) {
      /* 투명이 있으면 PNG 로 남긴다. JPEG 로 바꾸면 투명한 곳이 검게 된다. */
      pipeline = pipeline.png({ compressionLevel: 9, palette: true });
      nextType = 'image/png';
    } else {
      pipeline = pipeline.jpeg({ quality: quality, mozjpeg: true });
      nextType = 'image/jpeg';
    }

    const next = await pipeline.toBuffer();
    if (!next || !next.length) { out.reason = '결과가 비었다'; return out; }
    if (next.length >= buf.length) { out.reason = '줄여도 안 작아진다'; return out; }

    out.buf = next;
    out.contentType = nextType;
    out.shrunk = true;
    out.to = next.length;
    out.reason = (needResize ? maxDim + 'px' : '재압축') + (hasAlpha ? ' png' : ' jpeg q' + quality);
    return out;
  } catch (e) {
    /* 줄이기 실패가 업로드 실패가 되면 안 된다. 원본 그대로 올린다. */
    out.reason = 'sharp 실패: ' + ((e && e.message) || e);
    return out;
  }
}

/* 저장 경로의 확장자를 바뀐 형식에 맞춘다 (png → jpg 로 바뀌는 경우) */
function pathForContentType(path, contentType) {
  const ct = String(contentType || '').toLowerCase();
  const ext = /png/.test(ct) ? 'png' : (/webp/.test(ct) ? 'webp' : 'jpg');
  return String(path || '').replace(/\.[a-z0-9]{2,5}$/i, '') + '.' + ext;
}

/* 로그 한 줄 (크론 note 에 그대로 넣는다) */
function shrinkNote(r) {
  if (!r) return '';
  if (!r.shrunk) return '원본 유지 (' + r.reason + ')';
  const pct = r.from ? Math.round(100 - (r.to * 100 / r.from)) : 0;
  return Math.round(r.from / 1024) + 'KB → ' + Math.round(r.to / 1024) + 'KB (' + pct + '% 절감, ' + r.reason + ')';
}

module.exports = {
  shrinkImageBuffer, isShrinkable, pathForContentType, shrinkNote,
  MAX_DIM, QUALITY, SKIP_UNDER_BYTES
};
