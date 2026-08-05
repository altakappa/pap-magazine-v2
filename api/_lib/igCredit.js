/**
 * PAP Magazine — 인스타 캡션 크레딧 판정 (유튜브 재업로드 게이트)
 *
 * 2026-08-05 도메니코:
 *   "이제부터는 캡션크레딧이 PAP일 경우에만 유튜브에 업로드하자."
 *
 * 왜 필요했나:
 *   릴스 중에는 우리가 직접 찍은 것(🎥 PAP)과 외부 소스를 인용한 것
 *   (🎥 Youtube / AESPA, 🎥 @egorkondrasov)이 섞여 있다. 인스타 피드
 *   안에서의 인용과 유튜브 채널로의 재업로드는 권리 성격이 다르다 —
 *   후자는 우리 채널의 오리지널 콘텐츠로 배포하는 행위다. 그래서
 *   업로드 직전에 "이 영상의 촬영 크레딧이 우리인가"를 기계로 확인한다.
 *
 * 어디서 읽나:
 *   크레딧은 DB 어디에도 저장돼 있지 않다 (articles 30개 컬럼에 caption
 *   없음, credits jsonb 는 최근 VIDEO 기사 15/15 전부 []). 실측 결과
 *   Graph API 는 media_url 을 막은 뒤에도 caption 은 여전히 준다
 *   (2026-08-05 instagram-diagnose scan=1&days=6 → 52건 전부 caption 존재).
 *   따라서 업로드 시점에 source_instagram_post_id 로 캡션을 재조회한다.
 *
 * 판정 원칙 — **fail closed**:
 *   크레딧 표기가 없거나, 파싱이 애매하거나, 조회에 실패하면 '아니오'.
 *   권리가 애매한 영상을 올리는 쪽이 안 올리는 쪽보다 훨씬 비싸다.
 */
'use strict';

/* 영상 크레딧 표기자. 실측된 것은 🎥 하나뿐이지만 표기 흔들림에 대비한다.
   📸/📷(사진 크레딧)는 일부러 제외 — 쇼츠에서 문제되는 권리는 영상이다. */
const VIDEO_MARKERS = ['🎥', '📹', '🎬'];

/* PAP 소유로 인정하는 계정/표기. normalizeParty() 를 통과한 형태로 적는다
   (소문자 + 영숫자/한글만 남김). 새 서브 계정이 생기면 여기에 추가할 것. */
const PAP_TOKENS = new Set([
  'pap',
  'papmagazine',
  'pap매거진',
  'papceleb',
  'papfashion',
  'papbeauty',
  'papobject',
  'papstudio',
]);

/** '@PAP_Magazine ' → 'papmagazine' — 구분자·기호·공백을 모두 버린다. */
function normalizeParty(raw) {
  return String(raw || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
}

/**
 * 캡션에서 영상 크레딧 문자열들을 뽑는다.
 * 표기자 뒤 ~ 줄 끝(또는 첫 '#') 까지가 크레딧이다.
 * 해시태그를 잘라내는 이유: '🎥 PAP #papmagazine' 같은 줄이 실제로 있다.
 */
function extractCredits(caption) {
  const out = [];
  const lines = String(caption || '').split(/\r?\n/);
  for (const line of lines) {
    let idx = -1;
    for (const mk of VIDEO_MARKERS) {
      const i = line.indexOf(mk);
      if (i !== -1 && (idx === -1 || i < idx)) idx = i + mk.length;
    }
    if (idx === -1) continue;
    let val = line.slice(idx);
    const hash = val.indexOf('#');
    if (hash !== -1) val = val.slice(0, hash);
    val = val.trim();
    if (val) out.push(val);
  }
  return out;
}

/** 'Youtube / AESPA' → ['Youtube', 'AESPA'] — 공동 크레딧을 쪼갠다. */
function splitParties(credit) {
  return String(credit || '')
    .split(/[\/|,&·・+]|\s+x\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 캡션 하나에 대한 판정.
 * @returns {{owned:boolean, credits:string[], outsiders:string[], reason:string}}
 */
function creditVerdict(caption) {
  const credits = extractCredits(caption);
  if (!String(caption || '').trim()) {
    return { owned: false, credits: [], outsiders: [], reason: '캡션 없음' };
  }
  if (!credits.length) {
    return { owned: false, credits: [], outsiders: [], reason: '영상 크레딧(🎥) 표기 없음' };
  }
  const outsiders = [];
  for (const c of credits) {
    const parties = splitParties(c);
    if (!parties.length) { outsiders.push(c); continue; }
    for (const p of parties) {
      const n = normalizeParty(p);
      if (!n || !PAP_TOKENS.has(n)) outsiders.push(p);
    }
  }
  if (outsiders.length) {
    return {
      owned: false, credits, outsiders,
      reason: '외부 크레딧 — ' + outsiders.join(', '),
    };
  }
  return { owned: true, credits, outsiders: [], reason: 'PAP 크레딧 (' + credits.join(', ') + ')' };
}

/** 편의 래퍼. */
function isPapOwned(caption) {
  return creditVerdict(caption).owned;
}

/**
 * Graph API 로 캡션을 재조회해 판정한다. 조회 실패도 owned:false (fail closed).
 * @param {string} mediaId articles.source_instagram_post_id
 */
async function verdictForMedia(mediaId, opts) {
  if (!mediaId) {
    return { owned: false, credits: [], outsiders: [], reason: 'source_instagram_post_id 없음 — 크레딧 확인 불가' };
  }
  let caption = '';
  try {
    // 지연 require: 이 모듈을 순수 판정용으로 단독 테스트할 수 있게 둔다.
    const { fetchMediaById } = require('./instagramImport');
    const m = await fetchMediaById(mediaId, opts);
    caption = (m && m.caption) || '';
  } catch (err) {
    return {
      owned: false, credits: [], outsiders: [],
      reason: '캡션 조회 실패 — ' + String((err && err.message) || err).slice(0, 160),
    };
  }
  return creditVerdict(caption);
}

module.exports = {
  VIDEO_MARKERS, PAP_TOKENS,
  normalizeParty, extractCredits, splitParties,
  creditVerdict, isPapOwned, verdictForMedia,
};
