/**
 * PAP Magazine — 유튜브 영상을 어느 재생목록(카테고리)에 넣을지 정한다 (2026-09-23)
 *
 * 도메니코: "밀란패션위크에서 올라간 영상은 Fashion Week 카테고리에 넣어줘.
 *            너가 올리는 영상들이 각각 카테고리안에 배치가 잘되어있어야해"
 *
 * 순서:
 *   1. 사람이 정해 둔 값(youtube_posts.playlist_hint)이 있으면 그게 이긴다.
 *   2. 패션위크 신호(태그·제목·파일명에 fashion week / 패션위크 / MFW·PFW)가 있으면 FASHION_WEEK.
 *   3. 아니면 제목 접두사 규칙(youtubeMeta.classify)과 같은 판정을 쓴다.
 *      제목에 [ CELEBRITY ] 가 붙은 영상은 CELEBRITY 재생목록으로 간다 — 두 규칙이 어긋나면
 *      시청자가 보는 제목과 재생목록이 서로 다른 말을 한다.
 *
 * 재생목록은 **만들지 않는다.** 이름이 맞는 재생목록이 채널에 없으면 null 을 돌려주고,
 * 호출부는 '재생목록 없음' 으로 알린다. 공개 재생목록을 새로 만드는 건 발행이다.
 *
 * 네트워크·DB 를 건드리지 않는다 (순수 함수). tests/youtube-playlist.test.js
 */
'use strict';

const { classify, PREFIX } = require('./youtubeMeta');

const KEYS = ['FASHION_WEEK', 'CELEBRITY', 'EVENT', 'FASHION', 'BACKSTAGE', 'PRESENTATION', 'BEAUTY', 'CULTURE', 'NEWS'];

const FASHION_WEEK_RE = /(fashion[\s_-]*week|패션\s*위크|\bmfw\b|\bpfw\b)/i;

/* 접두사 → 재생목록 키. 밀라노·파리 패션위크는 둘 다 FASHION_WEEK 하나로 모은다. */
const FROM_PREFIX = {
  [PREFIX.MILAN]: 'FASHION_WEEK',
  [PREFIX.PARIS]: 'FASHION_WEEK',
  [PREFIX.CELEBRITY]: 'CELEBRITY',
  [PREFIX.EVENT]: 'EVENT',
  [PREFIX.FASHION]: 'FASHION',
  [PREFIX.BACKSTAGE]: 'BACKSTAGE',
  [PREFIX.PRESENTATION]: 'PRESENTATION',
  [PREFIX.BEAUTY]: 'BEAUTY',
  [PREFIX.CULTURE]: 'CULTURE',
  [PREFIX.NEWS]: 'NEWS',
};

/* 재생목록 제목 매칭. FASHION 은 'Fashion Week' 를 잡으면 안 된다. */
const MATCH = {
  FASHION_WEEK: (t) => FASHION_WEEK_RE.test(t),
  CELEBRITY: (t) => /(celeb|셀럽|셀러브리티)/i.test(t),
  EVENT: (t) => /(event|이벤트|행사)/i.test(t),
  FASHION: (t) => /(fashion|패션)/i.test(t) && !FASHION_WEEK_RE.test(t),
  BACKSTAGE: (t) => /(backstage|백스테이지|behind)/i.test(t),
  PRESENTATION: (t) => /(presentation|프레젠테이션)/i.test(t),
  BEAUTY: (t) => /(beauty|뷰티)/i.test(t),
  CULTURE: (t) => /(culture|컬처|컬쳐)/i.test(t),
  NEWS: (t) => /(news|뉴스)/i.test(t),
};

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);

/**
 * @param {{title?:string, tags?:string[], category?:string}} art 기사(없으면 파일명만 담은 가짜 기사)
 * @param {string} [hint] 사람이 정한 키 (playlist_hint)
 * @param {string} [fileName] 드라이브 파일명 — 기사 태그가 틀렸을 때의 보조 신호
 */
function pickCategory(art, hint, fileName) {
  const h = String(hint || '').trim().toUpperCase();
  if (h && KEYS.includes(h)) return h;
  const a = art || {};
  const hay = [a.title || '', arr(a.tags).join(' '), fileName || ''].join(' ');
  if (FASHION_WEEK_RE.test(hay)) return 'FASHION_WEEK';
  return FROM_PREFIX[classify(a)] || 'NEWS';
}

/** 채널 재생목록 중 키에 맞는 것. 여러 개면 제목이 가장 짧은(가장 일반적인) 것. 없으면 null. */
function matchPlaylist(key, playlists) {
  const test = MATCH[key];
  if (!test) return null;
  const hits = (playlists || []).filter((p) => p && p.id && test(String(p.title || '')));
  if (!hits.length) return null;
  return hits.sort((x, y) => String(x.title).length - String(y.title).length)[0];
}

/** youtube_posts.detail 에서 드라이브 파일명을 꺼낸다 ('drive:이름 · …' / 'story:이름 · …'). */
function fileNameFromDetail(detail) {
  const m = /(?:^|\s)(?:drive|story):([^·]+)/.exec(String(detail || ''));
  return m ? m[1].trim() : '';
}

/**
 * 기존 제목의 접두사는 두고 본문만 새 기사 제목으로 바꾼다.
 * 기사 태그가 틀린 경우(예: 밀라노 쇼에 paris-fashion-week 태그) 접두사를 다시 계산하면
 * 멀쩡한 [ Milan Fashion Week ] 가 [ Paris Fashion Week ] 로 바뀐다. 접두사는 이미 사람이
 * 본 값이므로 건드리지 않는다.
 */
function retitle(oldTitle, newBody, fallbackPrefix) {
  const m = /^\s*(\[[^\]]{1,30}\])\s*/.exec(String(oldTitle || ''));
  const prefix = m ? m[1] : (fallbackPrefix || '');
  const suffix = ' | PAP MAGAZINE';
  const body = String(newBody || '').replace(/[<>]/g, '').replace(/\s*[|]\s*pap\s?magazine\s*$/i, '').trim();
  const room = 100 - (prefix ? prefix.length + 1 : 0) - suffix.length;
  const cut = body.length > room ? body.slice(0, Math.max(0, room - 1)).trim() + '…' : body;
  return ((prefix ? prefix + ' ' : '') + cut + suffix).trim();
}

module.exports = { KEYS, FASHION_WEEK_RE, pickCategory, matchPlaylist, fileNameFromDetail, retitle };
