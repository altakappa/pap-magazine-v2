/**
 * pullLetterPdf — 풀레터 공문 PDF 자동 생성 (2026-08-24, 도메니코 지시)
 *
 * "어드민에서 발급을 누르면 포토그래퍼·스타일리스트 이름과 발급일이 자동으로
 *  들어간 풀레터가 PDF 로 만들어져 신청자가 다운받을 수 있게."
 *
 * 왜 이 방식인가 (JPEG-in-PDF):
 *   Vercel 서버리스에는 헤드리스 브라우저가 없고, pdf-lib 같은 새 의존성은
 *   이 저장소의 no-eager-npm-deps 원칙과 로컬 검증 가능성을 해친다.
 *   셀럽 썸네일이 이미 검증한 스택(opentype.js 글자→벡터 path + sharp 래스터)으로
 *   A4 300dpi 공문 이미지를 그리고, 그 JPEG 한 장을 최소 규격의 PDF 로 감싼다.
 *   텍스트 선택은 안 되지만 공문의 용도(표시·인쇄·전달)에는 300dpi 로 충분하다.
 *
 * 폰트: celebThumb 의 로더를 그대로 쓴다(Pretendard-SemiBold — 한글·라틴 겸용).
 *   Inter 는 이탤릭뿐이라 공문에는 쓰지 않는다.
 *   ⚠️ 글자 단위로 재고 글자 단위로 그린다 — celebThumb 주석의 GSUB 크래시와
 *   같은 이유. 재는 방식과 그리는 방식이 다르면 줄바꿈이 실물과 어긋난다.
 */
'use strict';

const { _fonts, measureWith } = require('./celebThumb');

// A4 세로. 300dpi 픽셀 캔버스와 PDF 포인트 규격.
const W = 2480, H = 3508;              // px @300dpi
const PDF_W = 595.28, PDF_H = 841.89;  // pt
const MARGIN = 260;
const BODY_W = W - MARGIN * 2;
const BRAND = '#891717';               // PAP 브랜드 컬러 (가이드북)
const INK = '#111111';
const GRAY = '#666666';

/* 한 줄을 path d 로. celebThumb.lineToPath 는 비공개라 같은 방식으로 다시 쓴다
   (글자 단위 — 재기와 그리기가 같아야 한다). */
function linePath(font, text, x, baseline, size, trackPx) {
  let cx = x;
  const out = [];
  for (const ch of String(text)) {
    out.push(font.getPath(ch, cx, baseline, size).toPathData(2));
    cx += font.getAdvanceWidth(ch, size) + trackPx;
  }
  return out.join(' ');
}

/* 단어 단위 줄바꿈 (영문 공문 본문용). 한글 이름 등 긴 토큰은 그대로 둔다. */
function wrap(font, size, trackPx, text, maxW) {
  const meas = measureWith(font, size, trackPx);
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w0 of words) {
    const cand = cur ? cur + ' ' + w0 : w0;
    if (meas(cand) <= maxW || !cur) cur = cand;
    else { lines.push(cur); cur = w0; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function esc(s) { return String(s == null ? '' : s); }

/**
 * 공문 SVG. 값은 전부 인자로 — 여기엔 임의 정책(유효기간 등)을 넣지 않는다.
 * 문구를 바꿀 땐 이 한 곳만 바꾸면 된다.
 */
function letterSvg(data) {
  const f = _fonts().ko;                 // Pretendard — 한글·라틴 겸용
  const P = [];                          // [d, color] 쌍
  const add = (d, color) => { if (d) P.push([d, color || INK]); };
  const center = (text, size, track, baseline, color) => {
    const w = measureWith(f, size, track)(text);
    add(linePath(f, text, (W - w) / 2, baseline, size, track), color);
  };

  let y = 420;
  // ── 마스트헤드 ──
  center('PAP MAGAZINE', 120, 34, y);
  y += 70;
  // 브랜드 룰
  const ruleY = y;
  y += 210;
  center('OFFICIAL PULL LETTER', 72, 26, y, BRAND);
  y += 96;
  center('Document No. ' + esc(data.docNo) + '   ·   Date of issue: ' + esc(data.issueDateText), 40, 2, y, GRAY);

  // ── 본문 ──
  y += 220;
  add(linePath(f, 'TO WHOM IT MAY CONCERN', MARGIN, y, 46, 6));
  y += 110;
  const paras = [
    'This letter confirms that the creative team listed below has been reviewed and approved by PAP Magazine to produce an editorial project intended for publication consideration in PAP Magazine.',
    'We kindly ask for your cooperation regarding sample loans, including garments and accessories, requested by this team for the shoot. All borrowed samples remain the responsibility of the team and are to be returned in their original condition after the shoot.',
  ];
  for (const p of paras) {
    for (const line of wrap(f, 44, 1, p, BODY_W)) {
      add(linePath(f, line, MARGIN, y, 44, 1));
      y += 74;
    }
    y += 48;
  }

  // ── 팀 블록 ──
  y += 40;
  const teamTop = y - 88;
  const row = (label, value) => {
    add(linePath(f, label, MARGIN + 60, y, 34, 8), GRAY);
    add(linePath(f, esc(value), MARGIN + 560, y, 52, 1));
    y += 118;
  };
  row('PHOTOGRAPHER', data.photographer);
  row('STYLIST', data.stylist);
  if (data.project) row('PROJECT', data.project);
  const teamBottom = y - 40;

  y += 90;
  for (const line of wrap(f, 34, 1,
    'To verify this letter, please contact contact@pap-magazine.com quoting the document number above.', BODY_W)) {
    add(linePath(f, line, MARGIN, y, 34, 1), GRAY);
    y += 56;
  }

  // ── 푸터 ──
  const fy = H - 420;
  center('PAP MAGAZINE', 52, 16, fy);
  center('ALTAKAPPA Co., Ltd. · 1F, 18, Nonhyeon-ro 146-gil, Gangnam-gu, Seoul, Korea', 32, 1, fy + 76, GRAY);
  center('www.pap-magazine.com · contact@pap-magazine.com', 32, 1, fy + 130, GRAY);

  const paths = P.map(([d, c]) => '<path d="' + d + '" fill="' + c + '"/>').join('\n');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'
    + '<rect width="' + W + '" height="' + H + '" fill="#ffffff"/>'
    + '<rect x="' + MARGIN + '" y="' + ruleY + '" width="' + BODY_W + '" height="6" fill="' + BRAND + '"/>'
    + '<rect x="' + (MARGIN + 20) + '" y="' + teamTop + '" width="' + (BODY_W - 40) + '" height="' + (teamBottom - teamTop) + '" fill="none" stroke="#d9d9d9" stroke-width="3"/>'
    + '<rect x="' + MARGIN + '" y="' + (H - 500) + '" width="' + BODY_W + '" height="4" fill="#e5e5e5"/>'
    + paths
    + '</svg>';
}

/**
 * JPEG 한 장을 A4 단면 PDF 로 감싼다. 순수 JS — 의존성 없음.
 * PDF 1.4 / DCTDecode. xref 오프셋은 바이트 기준으로 정확히 계산한다.
 */
function jpegToPdf(jpeg, pxW, pxH) {
  const objs = [];
  const head = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');
  objs.push(Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));
  objs.push(Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'));
  objs.push(Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '
    + PDF_W + ' ' + PDF_H + '] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n'));
  const content = 'q ' + PDF_W + ' 0 0 ' + PDF_H + ' 0 0 cm /Im0 Do Q';
  objs.push(Buffer.from('4 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n'));
  const imgHead = Buffer.from('5 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + pxW
    + ' /Height ' + pxH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '
    + jpeg.length + ' >>\nstream\n');
  const imgTail = Buffer.from('\nendstream\nendobj\n');

  const parts = [head];
  const offsets = [0];               // obj 1..5 시작 오프셋
  let pos = head.length;
  for (const o of objs) { offsets.push(pos); parts.push(o); pos += o.length; }
  offsets.push(pos);                 // obj 5
  parts.push(imgHead, jpeg, imgTail);
  pos += imgHead.length + jpeg.length + imgTail.length;

  const pad = (n) => String(n).padStart(10, '0');
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) xref += pad(offsets[i]) + ' 00000 n \n';
  const trailer = 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + pos + '\n%%EOF\n';
  parts.push(Buffer.from(xref + trailer));
  return Buffer.concat(parts);
}

/**
 * @param {{photographer:string, stylist:string, project?:string, docNo:string, issueDateText:string}} data
 * @returns {Promise<Buffer>} PDF
 */
async function generatePullLetterPdf(data) {
  const sharp = require('sharp');   // 지연 로드 (no-eager-npm-deps)
  if (!data || !String(data.photographer || '').trim() || !String(data.stylist || '').trim()) {
    throw new Error('pull letter needs photographer and stylist names');
  }
  const svg = letterSvg(data);
  const jpeg = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' })
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
  return jpegToPdf(jpeg, W, H);
}

/* 문서번호 — 발급일 + 신청 id 앞 8자. 사람이 조회로 진위 확인하는 용도라
   난수보다 재현 가능한 식별자가 낫다. */
function docNoFor(id, when) {
  const d = when || new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  return 'PL-' + ymd + '-' + String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

function issueDateTextFor(when) {
  const d = when || new Date();
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getUTCDate()).padStart(2, '0') + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

module.exports = { generatePullLetterPdf, docNoFor, issueDateTextFor, letterSvg, jpegToPdf };
