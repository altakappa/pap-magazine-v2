/**
 * PAP Magazine — 인스타그램 캡션 공용 빌더 (2026-07 새 형식)
 *
 * 기존 형식('TITLE' exclusive for @pap_magazine published by @kangdm ㅡ
 * link in bio ...)을 대체한다. 근거: 계정 실측에서 한국어 훅으로 시작한
 * 게시물의 공유(sends)가 영어 관리형 첫 줄 대비 20~30배. 2026 알고리즘의
 * 1순위 도달 신호가 공유이므로 첫 줄을 한국어 훅에 내준다.
 *
 * 형식:
 *
 *   {한국어 훅 한 줄}                          ← AI 생성. 없으면 생략
 *
 *   '{TITLE}' — PAP 매거진 exclusive editorial
 *
 *   {KR 단락}
 *
 *   {Role} @handle                             ← 한 줄에 하나
 *   …
 *   Starring @model @agency
 *
 *   FOR MORE EDITORIALS | @pap_magazine
 *
 *   (EN) {영어 단락}
 *
 *   (IT) {이탈리아어 단락}
 *
 *   Full Story link🔎 <Screenshot and copy-paste>   ← slug 있으면
 *   https://www.pap-magazine.com/editorial/<slug>
 *
 *   Fashion by @brand1 @brand2 …
 *
 *   #태그 × 5 (줄바꿈 구분 — 2025.12 정책상 캡션+댓글 합산 최대 5개)
 *
 * 사용처: review.js(서브미션 승인), auto-generate.js(🤖 AI 자동 생성),
 * auto-generate-bulk.js(대량 생성). 어드민의 🔄 템플릿 재조립
 * (pap-admin.js#_buildIgCaptionFromEditorial)은 이 형식을 미러링한다 —
 * 형식을 바꾸면 그쪽도 함께 갱신할 것.
 */

const HOUSE_HANDLE = '@pap_magazine';

/** 제목에서 해시태그용 토큰 생성 (예: "UnWelcome neo queen" → UNWELCOMENEOQUEEN은
 *  과하므로 공백 제거 대신 알파넘 이어붙이되 30자 초과면 생략) */
function _titleTag(title) {
  const t = String(title || '').replace(/[^A-Za-z0-9가-힣]/g, '').toUpperCase();
  return (t.length >= 2 && t.length <= 30) ? t : '';
}

/**
 * @param {object} p
 * @param {string}   p.title           에디토리얼 제목 (필수)
 * @param {string}   [p.hook]          한국어 훅 한 줄 (AI 생성 — 없으면 생략)
 * @param {string}   [p.descKo]        한국어 본문 단락
 * @param {string}   [p.descEn]        영어 단락
 * @param {string}   [p.descIt]        이탈리아어 단락
 * @param {string[]} [p.creditLines]   ['Photographer @a', 'Styling @b', …] — 줄당 하나
 * @param {string[]} [p.starring]      ['@model', '@agency', …]
 * @param {string[]} [p.brandHandles]  ['@brand1', …]
 * @param {string}   [p.moodTag]       AI가 뽑은 한국어 무드 태그 1개 (# 없이)
 * @param {string}   [p.slug]          에디토리얼 슬러그 (Full Story link URL: /editorial/<slug>)
 */
function buildPapIgCaption(p) {
  const title = String(p.title || '').trim();
  const lines = [];

  // 1) 한국어 훅 — 피드 접힘 위에 보이는 유일한 문장
  const hook = String(p.hook || '').trim();
  if (hook) { lines.push(hook); lines.push(''); }

  // 2) 타이틀 라인
  lines.push(`'${title}' — PAP 매거진 exclusive editorial`);
  lines.push('');

  // 3) KR 단락 (전체 스토리 유도는 하단 "Full Story link" 블록으로 이관)
  const descKo = String(p.descKo || '').trim();
  if (descKo) {
    lines.push(descKo);
    lines.push('');
  }

  // 4) 크레딧 — 한 줄에 하나 + Starring
  const creditLines = Array.isArray(p.creditLines) ? p.creditLines.filter(Boolean) : [];
  creditLines.forEach((l) => lines.push(l));
  const starring = Array.isArray(p.starring) ? p.starring.filter(Boolean) : [];
  if (starring.length) lines.push('Starring ' + starring.join(' '));
  if (creditLines.length || starring.length) lines.push('');

  // 5) 구분선
  lines.push(`FOR MORE EDITORIALS | ${HOUSE_HANDLE}`);
  lines.push('');

  // 6) EN / IT
  const descEn = String(p.descEn || '').trim();
  const descIt = String(p.descIt || '').trim();
  if (descEn) { lines.push('(EN) ' + descEn); lines.push(''); }
  if (descIt) { lines.push('(IT) ' + descIt); lines.push(''); }

  // 7) Full Story link — 프로필 링크 대신 에디토리얼 상세 URL 직접 노출.
  const slug = String(p.slug || '').trim();
  if (slug) {
    lines.push('Full Story link🔎 <Screenshot and copy-paste>');
    lines.push('https://www.pap-magazine.com/editorial/' + slug);
    lines.push('');
  }

  // 8) Fashion by
  const brands = Array.isArray(p.brandHandles) ? p.brandHandles.filter(Boolean) : [];
  if (brands.length) { lines.push('Fashion by ' + brands.join(' ')); lines.push(''); }

  // 9) 해시태그 — 정확히 5개, 줄바꿈 구분.
  //    고정 2(#패션화보 #에디토리얼) + 무드 1(AI) or 제목 태그 + 영문 2.
  const tags = ['패션화보', '에디토리얼'];
  const mood = String(p.moodTag || '').replace(/^#/, '').trim();
  if (mood && tags.indexOf(mood) === -1) tags.push(mood);
  const tt = _titleTag(title);
  if (tags.length < 3 && tt) tags.push(tt);
  tags.push('FASHIONEDITORIAL', 'papmagazine');
  lines.push(tags.slice(0, 5).map((t) => '#' + t).join('\n'));

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { buildPapIgCaption };
