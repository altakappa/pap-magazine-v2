/**
 * editorials.insta_logo_settings 위생 검증 (2026-07-28)
 *
 * 관리자 인스타 편집 모달에서 조정한 로고/프레이밍 값을 DB(jsonb)에
 * 영구 저장하고, 회원 다운로드(_papDownloadLogoZip)가 같은 값으로
 * 합성하도록 하기 위한 컬럼. 값이 **클라이언트에서 온 JSON** 이므로
 * 저장 전에 반드시 이 헬퍼를 통과시킨다.
 *
 * 저장 형태:
 *   {
 *     "global":   { logoPct, padPct, aspect },
 *     "perImage": { "<이미지 URL>": { logoPct,padPct,imgScale,offsetX,offsetY,logoAlpha,logoEnabled } }
 *   }
 *
 * 규칙
 *  - 객체가 아니면 null (컬럼을 비운다 = 기존 기본값 동작).
 *  - 화이트리스트 키만 통과. 숫자는 typeof 'number' + 유한값만 인정하고 범위 클램프.
 *  - aspect 는 '4:5' | '1:1' 만.
 *  - perImage 키는 http/https URL 만 (data:/blob:/javascript: 및 __proto__ 류 차단).
 *    키는 관리자 화면에서 href 로 렌더되지 않지만, 스킴 검증은 저장 단계에서 건다
 *    (.claude/rules/api.md 업로드 검증 규칙과 같은 취지). 부수 효과로 수 MB 짜리
 *    data: URL 이 jsonb 를 부풀리는 것도 막는다.
 *  - perImage 항목 수 상한 200 (초과분 버림).
 */

'use strict';

const NUM_RANGES = {
  logoPct:   { min: 0,    max: 50  },
  padPct:    { min: -20,  max: 50  },
  imgScale:  { min: 50,   max: 400 },
  offsetX:   { min: -100, max: 100 },
  offsetY:   { min: -100, max: 100 },
  logoAlpha: { min: 0,    max: 100 },
};

const GLOBAL_NUM_KEYS  = ['logoPct', 'padPct'];
const PER_IMAGE_NUM_KEYS = ['logoPct', 'padPct', 'imgScale', 'offsetX', 'offsetY', 'logoAlpha'];
const ALLOWED_ASPECTS  = ['4:5', '1:1'];
const MAX_PER_IMAGE    = 200;
const MAX_KEY_LENGTH   = 2048;
const FORBIDDEN_KEYS   = ['__proto__', 'constructor', 'prototype'];

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// 숫자만 인정. '15' 같은 문자열·NaN·Infinity·null 은 undefined 로 떨궈서
// 호출부가 "이 키는 없음" 으로 다루게 한다 (= 기본값 폴백).
function clampNumber(value, key) {
  const range = NUM_RANGES[key];
  if (!range) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(range.max, Math.max(range.min, value));
}

// 정상적인 이미지 URL 에는 절대 나타나지 않는 문자들. new URL() 은
// `https://ok.com/a.jpg" onerror="alert(1)` 같은 문자열도 파싱에 성공하므로
// (경로에 들어간 것으로 취급) 따옴표·꺾쇠·공백을 별도로 막는다. 키가 지금은
// 어디에서도 마크업으로 렌더되지 않지만, 나중에 렌더되더라도 안전하도록.
const UNSAFE_KEY_CHARS = /["'<>`\s\\]/;

function isSafeImageKey(key) {
  if (typeof key !== 'string') return false;
  const s = key.trim();
  if (!s || s.length > MAX_KEY_LENGTH) return false;
  if (FORBIDDEN_KEYS.indexOf(s) !== -1) return false;
  if (UNSAFE_KEY_CHARS.test(s)) return false;
  let u;
  try { u = new URL(s); } catch (_) { return false; }
  return u.protocol === 'http:' || u.protocol === 'https:';
}

/**
 * @param {*} input 클라이언트가 보낸 raw 값
 * @returns {object|null} 정제된 설정 객체, 또는 저장할 것이 없으면 null
 */
function sanitizeInstaLogoSettings(input) {
  if (!isPlainObject(input)) return null;

  const out = {};

  // ── global ────────────────────────────────────────────────
  if (isPlainObject(input.global)) {
    const g = {};
    for (const k of GLOBAL_NUM_KEYS) {
      const n = clampNumber(input.global[k], k);
      if (n !== undefined) g[k] = n;
    }
    if (ALLOWED_ASPECTS.indexOf(input.global.aspect) !== -1) {
      g.aspect = input.global.aspect;
    }
    if (Object.keys(g).length) out.global = g;
  }

  // ── perImage ──────────────────────────────────────────────
  if (isPlainObject(input.perImage)) {
    const per = {};
    let kept = 0;
    for (const rawKey of Object.keys(input.perImage)) {
      if (kept >= MAX_PER_IMAGE) break;          // 상한 초과분은 조용히 버린다
      if (!isSafeImageKey(rawKey)) continue;
      const src = input.perImage[rawKey];
      if (!isPlainObject(src)) continue;

      const row = {};
      for (const k of PER_IMAGE_NUM_KEYS) {
        const n = clampNumber(src[k], k);
        if (n !== undefined) row[k] = n;
      }
      // logoEnabled 는 boolean 만 (문자열 'false' 는 인정하지 않음).
      if (typeof src.logoEnabled === 'boolean') row.logoEnabled = src.logoEnabled;

      if (!Object.keys(row).length) continue;    // 통과한 키가 하나도 없으면 버림
      per[rawKey.trim()] = row;
      kept++;
    }
    if (kept) out.perImage = per;
  }

  if (!out.global && !out.perImage) return null;
  if (!out.perImage) out.perImage = {};
  return out;
}

module.exports = { sanitizeInstaLogoSettings };
