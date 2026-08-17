/**
 * RSS 신디케이션 구분 측정 (2026-08-17, 플립보드 버스에서 신설)
 *
 * /rss*.xml?src=<처> 로 등록하면 아이템 <link> 에만 utm_source=<처>&
 * utm_medium=rss 를 붙인다. <guid> 는 절대 건드리지 않는다 — guid 가
 * 흔들리면 피드 소비자(플립보드·네이버 봇 등)가 같은 글을 새 글로 오인해
 * 중복 발행된다. src 미지정이면 출력은 기존과 바이트 단위로 동일해야 한다
 * (네이버 서치어드바이저·구글에 제출된 기본 피드 보호).
 *
 * rss.js 와 rss-editorials.js 가 공유한다 (도메니코 결정 2026-08-17:
 * 핀터레스트·플립보드에는 기사 제외, 에디토리얼만 — 그래서 플립보드
 * 등록 주소는 /rss-editorials.xml?src=flipboard 다).
 */

/** ?src= 화이트리스트: 소문자 영문 시작, 2~20자, [a-z0-9_-] */
function srcParam(req) {
  const v = String((req.query && req.query.src) || '').toLowerCase();
  return /^[a-z][a-z0-9_-]{1,19}$/.test(v) ? v : '';
}

/** 링크에 utm 부착. src 없으면 원본 그대로. */
function withRssUtm(link, src) {
  if (!src) return link;
  return link + (link.includes('?') ? '&' : '?') +
    'utm_source=' + encodeURIComponent(src) + '&utm_medium=rss';
}

module.exports = { srcParam, withRssUtm };
