/**
 * PAP Magazine — 브리핑 마크다운 → 이메일 HTML 공용 헬퍼.
 *
 * 2026-07-21 추출. 원래 api/cron/daily-growth-feedback.js 안에만 있던
 * mdToBasicHtml 을 주간 브리핑에서도 쓰기 위해 공용화했다.
 *
 * 배경(도메니코 지시): Cowork 예약 작업(맥 앱이 켜져 있어야 도는 구조)에
 * 의존하던 브리핑을 Vercel 서버 크론으로 옮기는 중. 서버 크론은 채팅으로
 * 보고할 수 없으므로 결과 전달 경로가 이메일이다. 따라서 "브리핑 마크다운을
 * 메일 본문으로 만드는 일"이 여러 크론에서 반복된다 → 여기로 모은다.
 *
 * 의도적으로 마크다운 라이브러리를 쓰지 않는다(번들 크기·서버리스 콜드스타트).
 * 지원 문법은 브리핑 프롬프트가 실제로 생성하는 것만: # ## ### · - 불릿 ·
 * **굵게** · 빈 줄 문단.
 */

// 마크다운 → 기본 HTML. escape 후 변환하므로 XSS 안전.
function mdToBasicHtml(md) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const lines = String(md || '').split('\n');
  let html = '', inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^###\s+/.test(line)) { closeList(); html += '<h3 style="font-size:14px;margin:18px 0 6px">' + inline(line.replace(/^###\s+/, '')) + '</h3>'; }
    else if (/^##\s+/.test(line)) { closeList(); html += '<h2 style="font-size:16px;margin:22px 0 8px">' + inline(line.replace(/^##\s+/, '')) + '</h2>'; }
    else if (/^#\s+/.test(line)) { closeList(); html += '<h1 style="font-size:18px;margin:24px 0 10px">' + inline(line.replace(/^#\s+/, '')) + '</h1>'; }
    else if (/^\s*[-*]\s+/.test(line)) { if (!inList) { html += '<ul style="margin:6px 0 6px 18px;padding:0">'; inList = true; } html += '<li style="margin:3px 0">' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>'; }
    else if (line.trim() === '') { closeList(); }
    else { closeList(); html += '<p style="margin:8px 0;line-height:1.7;font-size:13px">' + inline(line) + '</p>'; }
  }
  closeList();
  return html;
}

/**
 * 브리핑 메일 한 통을 통째로 조립한다 (PAP 레터헤드 + 본문 + 푸터).
 *
 * @param {object} o
 * @param {string} o.title    큰 제목 (예: '데일리 성장 브리핑')
 * @param {string} o.dateLabel 제목 아래 날짜/기간 표기
 * @param {string} o.markdown  Claude 가 생성한 브리핑 마크다운
 * @param {string} [o.footerHtml] 푸터에 넣을 추가 안내 HTML (대시보드 링크 등)
 * @returns {string} 메일 본문 HTML
 */
function briefingEmailHtml({ title, dateLabel, markdown, footerHtml }) {
  return (
    '<div style="font-family:-apple-system,\'Apple SD Gothic Neo\',sans-serif;max-width:640px;margin:0 auto;color:#111">' +
    '<div style="border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px">' +
    '<div style="font-size:11px;letter-spacing:.2em;color:#888">PAP MAGAZINE</div>' +
    '<div style="font-size:20px;font-weight:800">' + title + '</div>' +
    '<div style="font-size:12px;color:#888">' + dateLabel + '</div></div>' +
    mdToBasicHtml(markdown) +
    '<div style="margin-top:24px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:#aaa">' +
    (footerHtml || '') + ' · 자동 발송</div></div>'
  );
}

// 브리핑 수신자. 쉼표 구분 다중 주소 지원(nodemailer 규격).
function briefingRecipients() {
  return process.env.DIGEST_TO || 'contact@pap-magazine.com';
}

module.exports = { mdToBasicHtml, briefingEmailHtml, briefingRecipients };
