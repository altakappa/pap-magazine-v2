/**
 * realImage.js — "진짜 이미지인가" 한 곳에서 판정 (2026-08-27 신설)
 *
 * 왜: 2026-08-27 실사에서 발행 화보 2,304편 중 14편이 **사진이 없는 껍데기**로
 * 드러났다.
 *   · 10편 — cover/gallery 가 data:image/svg 플레이스홀더(제목만 적힌 그라데이션)
 *   · 4편  — 죽은 구글 드라이브 썸네일 링크
 * 크레딧도 더미였다: {"n":"Photographer","id":"@photographer"} — 사람 이름 자리에
 * 'Photographer' 라는 단어가 들어 있다. 설명문도 태그도 없다.
 *
 * 이 판정을 한 곳에 두는 이유: 오늘 만든 Web Story 가 "커버가 있으면 만든다"라
 * 이 껍데기로 스토리를 만들 뻔했다(구글에 플레이스홀더 그라데이션을 광고하는 꼴).
 * 표면이 늘 때마다 같은 실수를 반복하지 않도록 조건을 한 벌만 둔다.
 *
 * ⚠ 이 판정은 **노출 억제**에만 쓴다. 발행 상태(status)는 절대 건드리지 않는다 —
 * 발행·비발행 판단은 도메니코의 몫이다(CLAUDE.md 절대 규칙).
 */

'use strict';

/** 죽었거나 가짜인 이미지 URL 패턴 */
function isRealImage(url) {
  const u = String(url == null ? '' : url).trim();
  if (!u) return false;
  if (u.startsWith('data:')) return false;                 // 플레이스홀더 SVG
  if (u.indexOf('drive.google.com') >= 0) return false;     // 2026-08 전수 500/403
  if (u.indexOf('wixstatic.com') >= 0) return false;        // 구 호스팅 — 403
  return /^https?:\/\//.test(u);
}

/** 화보 행에 실제로 보여줄 수 있는 이미지가 하나라도 있는가 */
function hasRealImagery(row) {
  if (!row) return false;
  if (isRealImage(row.cover_image) || isRealImage(row.thumbnail)) return true;
  const g = Array.isArray(row.gallery) ? row.gallery : [];
  return g.some(isRealImage);
}

module.exports = { isRealImage, hasRealImagery };
