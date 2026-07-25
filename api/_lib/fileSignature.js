/**
 * 파일 시그니처(매직바이트) 검증 — 2026-07-26 감사 A-5
 * ═══════════════════════════════════════════════════════════════════
 * 지금까지 업로드 형식 검증은 "클라이언트가 선언한 MIME + 버킷의
 * allowed_mime_types" 두 가지뿐이었다. 둘 다 '선언값'만 보므로, 확장자와
 * Content-Type 을 위장한 파일은 그대로 통과한다.
 *
 * ── 어디에 효과가 있나 ──────────────────────────────────────────────
 * · 서버 경유 업로드(media/upload · community/scrap-upload · 관리자 발급
 *   PDF · 풀레터 레거시 multipart)는 서버가 바이트를 쥐고 있으므로 여기서
 *   실제 내용을 확인할 수 있다 — 이 모듈의 주 사용처다.
 * · 서브미션·풀레터의 2단계 직접 업로드는 바이트가 서버를 거치지 않는다.
 *   그쪽은 버킷 allowed_mime_types 가 선언 Content-Type 을 강제하고,
 *   저장된 객체도 그 Content-Type 으로 서빙되므로 (예: HTML 페이로드를
 *   image/jpeg 로 올려도 image/jpeg 로 내려가 실행되지 않는다) 잔여
 *   위험이 낮다. 이 모듈은 그 경로엔 적용되지 않는다.
 *
 * ── 판정 원칙 ───────────────────────────────────────────────────────
 * 모르는 형식은 막지 않는다. 시그니처를 '알아본 경우에만' 선언값과
 * 대조해 어긋나면 거부한다. 정상 업로드를 깨뜨리지 않는 것이 우선이고,
 * 이 검사는 하드닝(선택 항목)이다.
 * 예외: 이미지/PDF 로 선언했는데 내용이 HTML·스크립트로 보이면 —
 * 시그니처가 없는 텍스트 계열이라 '알아본 경우'에 해당하지 않지만 —
 * 명시적으로 거부한다. 공개 버킷에 올라가는 값이라 위험이 크다.
 */

'use strict';

// 검사에 필요한 선두 바이트 수 (ftyp 박스가 offset 4~11 에 온다)
const SNIFF_BYTES = 32;

function _ascii(buf, start, len) {
  return buf.slice(start, start + len).toString('latin1');
}

/**
 * 매직바이트로 실제 MIME 을 추정한다. 모르면 null.
 * @param {Buffer} buf 파일 선두 바이트
 * @returns {string|null}
 */
function sniffMime(buf) {
  if (!buf || buf.length < 4) return null;

  // ── 이미지 ──
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && _ascii(buf, 1, 3) === 'PNG'
      && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'image/png';
  if (_ascii(buf, 0, 6) === 'GIF87a' || _ascii(buf, 0, 6) === 'GIF89a') return 'image/gif';
  if (buf.length >= 12 && _ascii(buf, 0, 4) === 'RIFF' && _ascii(buf, 8, 4) === 'WEBP') return 'image/webp';
  // TIFF — little/big endian 두 형태
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2A && buf[3] === 0x00)
      || (buf[0] === 0x4D && buf[1] === 0x4D && buf[2] === 0x00 && buf[3] === 0x2A)) return 'image/tiff';

  // ── ISO-BMFF (HEIC/HEIF/AVIF/MP4) — offset 4 의 'ftyp' + 브랜드 ──
  if (buf.length >= 12 && _ascii(buf, 4, 4) === 'ftyp') {
    const brand = _ascii(buf, 8, 4).toLowerCase();
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx') return 'image/heic';
    if (brand === 'mif1' || brand === 'msf1') return 'image/heif';
    return 'video/mp4';   // isom·mp41·mp42·qt 등
  }

  // ── 문서 ──
  if (_ascii(buf, 0, 5) === '%PDF-') return 'application/pdf';
  // OLE2 복합문서 — 구형 .ppt/.doc/.xls 공용 시그니처. 세부 구분은 안 한다.
  if (buf.length >= 8 && buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0
      && buf[4] === 0xA1 && buf[5] === 0xB1 && buf[6] === 0x1A && buf[7] === 0xE1) return 'application/x-ole2';
  // ZIP 계열 — .pptx/.docx/.xlsx 는 전부 ZIP. 세부 구분은 안 한다.
  if (buf[0] === 0x50 && buf[1] === 0x4B
      && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) return 'application/zip';

  return null;
}

// 시그니처가 없는(텍스트) 위험 콘텐츠 탐지 — 공개 버킷에 HTML/SVG 가
// 이미지로 위장해 올라가면 저장 Content-Type 에 따라 실행될 여지가 있다.
function looksLikeMarkup(buf) {
  if (!buf || !buf.length) return false;
  // BOM 과 선행 공백을 건너뛴 뒤 앞부분만 본다.
  let s = buf.toString('utf8').replace(/^﻿/, '').trimStart().slice(0, 256).toLowerCase();
  return s.startsWith('<!doctype html')
      || s.startsWith('<html')
      || s.startsWith('<svg')
      || s.startsWith('<?xml') && s.indexOf('<svg') !== -1
      || s.startsWith('<script');
}

// 선언 MIME 을 '군'으로 묶어 비교한다. image/jpg 같은 비표준 별칭과
// pptx→zip, ppt→ole2 처럼 시그니처가 컨테이너 단위인 경우를 흡수한다.
function _group(mime) {
  const t = String(mime || '').toLowerCase();
  if (t === 'image/jpg') return 'image/jpeg';
  if (t === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      || t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || t === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'application/zip';
  if (t === 'application/vnd.ms-powerpoint'
      || t === 'application/msword'
      || t === 'application/vnd.ms-excel') return 'application/x-ole2';
  if (t === 'image/heif') return 'image/heic';   // 브랜드가 섞여 나온다
  if (t.startsWith('video/')) return 'video/mp4';
  return t;
}

/**
 * 선언 MIME 과 실제 내용이 어긋나는지 검사한다.
 * @param {Buffer} buf 파일 선두 바이트 (최소 32바이트 권장)
 * @param {string} declaredMime 클라이언트가 선언한 MIME
 * @returns {{ok:boolean, detected:string|null, reason:string|null}}
 */
function verifySignature(buf, declaredMime) {
  const declared = String(declaredMime || '').toLowerCase();

  // 이미지·PDF 로 선언했는데 내용이 마크업이면 즉시 거부.
  if ((declared.startsWith('image/') || declared === 'application/pdf') && looksLikeMarkup(buf)) {
    return { ok: false, detected: 'text/html', reason: 'content looks like markup (HTML/SVG), not ' + declared };
  }

  const detected = sniffMime(buf);
  if (!detected) return { ok: true, detected: null, reason: null };   // 모르는 형식은 통과

  const dg = _group(detected);
  const cg = _group(declared);
  if (dg !== cg) {
    return { ok: false, detected, reason: 'declared ' + declared + ' but content is ' + detected };
  }
  return { ok: true, detected, reason: null };
}

/** 디스크의 파일 선두를 읽어 verifySignature 를 돌린다. */
function verifyFileOnDisk(fs, filepath, declaredMime) {
  let fd;
  try {
    fd = fs.openSync(filepath, 'r');
    const buf = Buffer.alloc(SNIFF_BYTES);
    const read = fs.readSync(fd, buf, 0, SNIFF_BYTES, 0);
    return verifySignature(buf.slice(0, read), declaredMime);
  } catch (e) {
    // 읽기 실패는 검사 불가 — 업로드를 막지 않는다 (하드닝 항목).
    return { ok: true, detected: null, reason: null };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

module.exports = { sniffMime, looksLikeMarkup, verifySignature, verifyFileOnDisk, SNIFF_BYTES };
