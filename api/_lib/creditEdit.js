'use strict';
/**
 * 크레딧 수정(프리미엄) 공용 계산기 — 2026-08-26 스펙
 * 원본: PAP-Vault/45_Business/스펙-에디토리얼-크레딧-수정-프리미엄-2026-08-26.md
 *
 * 이 파일이 존재하는 이유
 *   목록 API(api/editorials/mine.js), 수정 API(api/editorials/[id]/credits.js),
 *   테스트가 같은 상수와 같은 계산을 써야 한다. 세 곳에 따로 적으면 화면에
 *   보이는 남은 횟수와 서버 판정이 갈린다(이 저장소에서 반복된 사고 유형).
 *
 * 브랜드 종류 수는 반드시 submissionType.js 의 normBrand / isGenericCredit /
 * isSpaBrand 를 재사용한다. 여기서 새로 세면 무료 게재 자격 판정과 어긋난다.
 */

const { HTML_TAG_RE, dropKnownTags } = require('./stripHtml');
const { normBrand, isGenericCredit, isSpaBrand } = require('./submissionType');

// 누적 수정 한도 (일일이 아니라 에디토리얼 1건당 누적). 도메니코 결정 0-3.
const MAX_CREDIT_EDITS = 3;

// 결제 게이트는 화이트리스트다. 블랙리스트로 짜면 payment_status 값이
// 하나 늘어날 때 조용히 구멍이 생긴다. 도메니코 결정 0-2-c.
const PAYMENT_EDITABLE = ['none', 'paid'];

// 입력 상한. 폼이 아니라 API 를 직접 두드리는 경우를 막는다.
const MAX_CREDIT_ROWS = 40;
const MAX_BRAND_ROWS = 40;
const MAX_ROLES_PER_ROW = 6;
const LIMITS = { name: 120, role: 60, instagram: 80, website: 200 };

/** HTML 태그와 제어문자 제거 + 공백 정리. 저장 전 모든 문자열에 적용한다. */
function stripTags(v) {
  return String(v == null ? '' : v)
    .replace(HTML_TAG_RE, dropKnownTags(''))
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 인스타 핸들 정규화: 태그 제거 → @ 정리 → 공백 제거. 빈 값은 빈 문자열. */
function cleanHandle(v) {
  const h = stripTags(v).replace(/^@+/, '').replace(/\s+/g, '');
  return h ? '@' + h : '';
}

/** 웹사이트: javascript: 스킴만 잘라낸다(크레딧은 화면에 링크로 나간다). */
function cleanWebsite(v) {
  const s = stripTags(v);
  if (!s) return '';
  if (/^\s*javascript:/i.test(s)) return '';
  return s;
}

/**
 * 팀 크레딧(사람) 정규화.
 * 사람 크레딧에는 브랜드 가드와 라틴 전용 규칙을 적용하지 않는다(스펙 C-11).
 * @returns {{rows: Array|null, error: string|null}}
 */
function sanitizeCredits(input) {
  if (!Array.isArray(input)) return { rows: null, error: 'credits must be an array' };
  if (input.length > MAX_CREDIT_ROWS) return { rows: null, error: 'credits rows exceed ' + MAX_CREDIT_ROWS };

  const rows = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { rows: null, error: 'credits[' + i + '] must be an object' };
    }
    const name = stripTags(raw.name);
    if (!name) return { rows: null, error: 'credits[' + i + '].name is required' };
    if (name.length > LIMITS.name) return { rows: null, error: 'credits[' + i + '].name too long' };

    let rolesIn = raw.roles;
    if (typeof rolesIn === 'string') rolesIn = [rolesIn];
    if (!Array.isArray(rolesIn)) rolesIn = [];
    const roles = [];
    for (const r of rolesIn) {
      const role = stripTags(r);
      if (!role) continue;
      if (role.length > LIMITS.role) return { rows: null, error: 'credits[' + i + '].roles entry too long' };
      roles.push(role);
    }
    if (!roles.length) return { rows: null, error: 'credits[' + i + '].roles is required' };
    if (roles.length > MAX_ROLES_PER_ROW) return { rows: null, error: 'credits[' + i + '].roles exceed ' + MAX_ROLES_PER_ROW };

    const instagram = cleanHandle(raw.instagram);
    if (instagram.length > LIMITS.instagram) return { rows: null, error: 'credits[' + i + '].instagram too long' };
    const website = cleanWebsite(raw.website);
    if (website.length > LIMITS.website) return { rows: null, error: 'credits[' + i + '].website too long' };

    rows.push({ name: name, roles: roles, instagram: instagram, website: website });
  }
  return { rows: rows, error: null };
}

/**
 * 의상 브랜드 정규화. 저장 형태는 기존 실데이터와 동일하게
 * { name, instagram } 두 키만 남긴다.
 */
function sanitizeBrands(input) {
  if (!Array.isArray(input)) return { rows: null, error: 'brands must be an array' };
  if (input.length > MAX_BRAND_ROWS) return { rows: null, error: 'brands rows exceed ' + MAX_BRAND_ROWS };

  const rows = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { rows: null, error: 'brands[' + i + '] must be an object' };
    }
    const name = stripTags(raw.name);
    if (!name) return { rows: null, error: 'brands[' + i + '].name is required' };
    if (name.length > LIMITS.name) return { rows: null, error: 'brands[' + i + '].name too long' };
    const instagram = cleanHandle(raw.instagram);
    if (instagram.length > LIMITS.instagram) return { rows: null, error: 'brands[' + i + '].instagram too long' };
    rows.push({ name: name, instagram: instagram });
  }
  return { rows: rows, error: null };
}

/**
 * "실제 의상 브랜드 종류" 키 집합.
 * 관용 표기(Stylist's Own, Vintage ...)와 SPA 브랜드는 세지 않는다.
 * @param {Array} brands  [{name, instagram}]
 * @param {{excludeSpa?: boolean}} opts  SPA 제외 규칙 적용 여부(제출 시각 기준)
 */
function realBrandKeys(brands, opts) {
  const excludeSpa = !opts || opts.excludeSpa !== false;
  const set = new Set();
  const list = Array.isArray(brands) ? brands : [];
  for (const b of list) {
    const name = b && typeof b === 'object' ? b.name : b;
    const key = normBrand(name);
    if (!key) continue;
    if (isGenericCredit(name)) continue;
    if (excludeSpa && isSpaBrand(name)) continue;
    set.add(key);
  }
  return set;
}

/** 실제 의상 브랜드 종류 수. 감소 가드(스펙 0-2)의 판정값. */
function countRealBrands(brands, opts) {
  return realBrandKeys(brands, opts).size;
}

// ── 의심 표시용 보조 (차단이 아니라 분류에만 쓴다, 스펙 0-2-b) ──────────────

/** 편집거리. 짧은 문자열만 비교하므로 단순 DP 로 충분하다. */
function editDistance(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[t.length];
}

/**
 * 오타 수준의 변경인가. **저장을 막는 용도로 쓰지 말 것.**
 * 도메니코 결정 0-2-b: 브랜드명 전면 교체는 허용하고, 알림에 표시만 한다.
 */
function looksLikeTypo(a, b) {
  const x = normBrand(a);
  const y = normBrand(b);
  if (x === y) return true;
  const maxDist = Math.min(2, Math.floor(Math.min(x.length, y.length) / 2));
  return editDistance(x, y) <= maxDist;
}

/** 수정 전후 브랜드를 같은 자리끼리 짝지어 대조표를 만든다. */
function pairBrands(before, after) {
  const a = Array.isArray(before) ? before : [];
  const b = Array.isArray(after) ? after : [];
  const n = Math.max(a.length, b.length);
  const pairs = [];
  for (let i = 0; i < n; i++) {
    const from = a[i] ? String(a[i].name || '') : null;
    const to = b[i] ? String(b[i].name || '') : null;
    const fromHandle = a[i] ? String(a[i].instagram || '') : null;
    const toHandle = b[i] ? String(b[i].instagram || '') : null;
    const changed = normBrand(from) !== normBrand(to) || String(fromHandle || '') !== String(toHandle || '');
    pairs.push({ from: from, to: to, fromHandle: fromHandle, toHandle: toHandle, changed: changed });
  }
  return pairs;
}

/**
 * 자동 의심 표시 판정 (스펙 3-D).
 * 저장은 막지 않는다. 도메니코가 알림만 보고 알아챌 수 있게 사유를 만든다.
 */
function suspicionFlags(opts) {
  const o = opts || {};
  const before = Array.isArray(o.before) ? o.before : [];
  const after = Array.isArray(o.after) ? o.after : [];
  const excludeSpa = o.excludeSpa !== false;
  const reasons = [];

  // 1) 위장 개명: 수정 후 브랜드 2종 이상이 첫 토큰을 공유
  const firstTokens = {};
  for (const b of after) {
    const name = b && b.name;
    if (!name || isGenericCredit(name)) continue;
    if (excludeSpa && isSpaBrand(name)) continue;
    const key = normBrand(name);
    if (!key) continue;
    const tok = key.split(' ')[0];
    if (!tok) continue;
    if (!firstTokens[tok]) firstTokens[tok] = new Set();
    firstTokens[tok].add(key);
  }
  const shared = Object.keys(firstTokens).filter(function (t) { return firstTokens[t].size >= 2; });
  if (shared.length) {
    // 사유 문구에는 그룹 수가 아니라 걸린 브랜드 종류 수를 적는다.
    let sharedBrands = 0;
    for (const t of shared) sharedBrands += firstTokens[t].size;
    reasons.push('브랜드 ' + sharedBrands + '종이 같은 이름으로 시작합니다 (' + shared.join(', ') + ')');
  }

  // 2) 대량 교체: 오타 수준을 넘는 교체가 2건 이상
  let replaced = 0;
  for (const p of pairBrands(before, after)) {
    if (!p.from || !p.to) continue;          // 추가와 삭제는 여기서 보지 않는다
    if (normBrand(p.from) === normBrand(p.to)) continue;
    if (!looksLikeTypo(p.from, p.to)) replaced += 1;
  }
  if (replaced >= 2) {
    reasons.push('브랜드 ' + replaced + '건이 오타 수준을 넘어 교체되었습니다');
  }

  // 3) 무료 게재 건이면 사유에 그 점을 밝힌다 (브랜드 구성이 곧 무료 자격의 근거)
  const flagged = reasons.length > 0;
  if (flagged && o.paymentStatus === 'none') {
    reasons.unshift('무료 게재 건입니다 (브랜드 구성이 무료 자격의 근거)');
  }
  return { flagged: flagged, reasons: reasons };
}

/** KST 시각 문자열 (서버 TZ 에 의존하지 않는다). */
function kstStamp(date) {
  const d = date instanceof Date ? date : new Date();
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = function (n) { return String(n).padStart(2, '0'); };
  return kst.getUTCFullYear() + '-' + p(kst.getUTCMonth() + 1) + '-' + p(kst.getUTCDate())
    + ' ' + p(kst.getUTCHours()) + ':' + p(kst.getUTCMinutes()) + ' KST';
}

/** 사람 크레딧 요약 한 줄 (이름, 역할, 핸들). 대조에 쓴다. */
function creditLine(row) {
  if (!row) return '';
  const roles = Array.isArray(row.roles) ? row.roles.join('/') : '';
  const ig = row.instagram ? ' ' + row.instagram : '';
  return String(row.name || '') + (roles ? ' (' + roles + ')' : '') + ig;
}

/**
 * 텔레그램 알림 본문. 제목, 수정자, 시각, 회차, 변경 대조, 링크를 모두 넣는다.
 * "크레딧이 수정되었습니다"만 보내면 확인하러 들어가야 한다(스펙 3-D).
 */
function buildEditAlert(o) {
  const opts = o || {};
  const susp = opts.suspicion || { flagged: false, reasons: [] };
  const lines = [];

  if (susp.flagged) {
    lines.push('⚠️ 확인 필요 · ' + susp.reasons.join(' · '));
    lines.push('');
  }

  lines.push('[크레딧 수정] "' + (opts.title || '(제목 없음)') + '"');
  const who = [opts.userName || '(이름 없음)', opts.userEmail ? '(' + opts.userEmail + ')' : ''].filter(Boolean).join(' ');
  lines.push('회원: ' + who + ' · 프리미엄');
  lines.push('시각: ' + kstStamp(opts.at) + ' · 수정 ' + opts.editIndex + '/' + MAX_CREDIT_EDITS + '회차');
  lines.push('원본 서브미션: ' + (opts.paymentStatus === 'none' ? '무료 게재' : '유료 게재')
    + ' (payment_status=' + opts.paymentStatus + ')');
  lines.push('');

  lines.push('의상 브랜드 (' + opts.beforeBrandCount + '종 → ' + opts.afterBrandCount + '종)');
  const pairs = pairBrands(opts.beforeBrands, opts.afterBrands);
  if (!pairs.length) {
    lines.push('  (없음)');
  } else {
    for (const p of pairs) {
      const from = p.from == null ? '(없음)' : p.from;
      const to = p.to == null ? '(삭제됨)' : p.to;
      lines.push('  ' + from + ' → ' + (p.changed ? to : '(변경 없음)'));
    }
  }
  lines.push('');

  const bc = Array.isArray(opts.beforeCredits) ? opts.beforeCredits : [];
  const ac = Array.isArray(opts.afterCredits) ? opts.afterCredits : [];
  if (JSON.stringify(bc) === JSON.stringify(ac)) {
    lines.push('팀 크레딧: 변경 없음');
  } else {
    lines.push('팀 크레딧 (' + bc.length + '행 → ' + ac.length + '행)');
    const n = Math.max(bc.length, ac.length);
    for (let i = 0; i < n; i++) {
      const from = creditLine(bc[i]) || '(없음)';
      const to = creditLine(ac[i]) || '(삭제됨)';
      if (from === to) continue;
      lines.push('  ' + from + ' → ' + to);
    }
  }

  if (opts.link) {
    lines.push('');
    lines.push('링크: ' + opts.link);
  }
  return lines.join('\n');
}

/**
 * fashion.imageCredits 안의 브랜드 토큰.
 * 실데이터 확인 결과 이미지 크레딧 문자열은 "@핸들 Type" 형태이고,
 * 핸들은 brands[].instagram 이 있으면 그것을, 없으면 브랜드명을 소문자로
 * 붙여 쓴 값이다. 두 경우를 모두 만들어 둔다(둘 중 무엇이 쓰였는지
 * 행마다 다르기 때문이다).
 */
function brandTokens(brand) {
  if (!brand) return [];
  const out = [];
  const ig = String(brand.instagram || '').trim();
  if (ig) out.push(ig.replace(/^@+/, ''));
  const fromName = String(brand.name || '').toLowerCase().replace(/\s+/g, '');
  if (fromName) out.push(fromName);
  return out.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
}

/**
 * 브랜드명·핸들이 바뀌면 imageCredits 의 @토큰도 같이 바꾼다.
 * 안 바꾸면 브랜드 목록은 고쳐졌는데 이미지 밑 크레딧은 옛 이름으로 남는다.
 * 자리 짝짓기가 성립할 때(길이가 같을 때)만 수행한다. 행이 추가·삭제되면
 * 무엇이 무엇으로 바뀐 것인지 확정할 수 없으므로 손대지 않는다.
 */
function remapImageCredits(imageCredits, before, after) {
  const src = imageCredits && typeof imageCredits === 'object' && !Array.isArray(imageCredits) ? imageCredits : null;
  if (!src) return { imageCredits: imageCredits, remapped: 0, skipped: 'no_image_credits' };
  const a = Array.isArray(before) ? before : [];
  const b = Array.isArray(after) ? after : [];
  if (!a.length || a.length !== b.length) {
    return { imageCredits: src, remapped: 0, skipped: 'row_count_changed' };
  }

  const rules = [];
  for (let i = 0; i < a.length; i++) {
    const oldToks = brandTokens(a[i]);
    const newTok = brandTokens(b[i])[0];
    if (!newTok) continue;
    for (const ot of oldToks) {
      if (ot === newTok) continue;
      rules.push({ from: ot, to: newTok });
    }
  }
  if (!rules.length) return { imageCredits: src, remapped: 0, skipped: null };

  // 긴 토큰부터 바꿔야 "@gucci" 가 "@guccimilano" 를 갉아먹지 않는다.
  rules.sort(function (x, y) { return y.from.length - x.from.length; });

  const out = {};
  let remapped = 0;
  for (const key of Object.keys(src)) {
    let val = String(src[key] == null ? '' : src[key]);
    for (const r of rules) {
      const re = new RegExp('@' + r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9._-])', 'g');
      if (re.test(val)) {
        val = val.replace(re, '@' + r.to);
        remapped += 1;
      }
    }
    out[key] = val;
  }
  return { imageCredits: out, remapped: remapped, skipped: null };
}

module.exports = {
  MAX_CREDIT_EDITS,
  PAYMENT_EDITABLE,
  MAX_CREDIT_ROWS,
  MAX_BRAND_ROWS,
  MAX_ROLES_PER_ROW,
  LIMITS,
  stripTags,
  cleanHandle,
  cleanWebsite,
  sanitizeCredits,
  sanitizeBrands,
  realBrandKeys,
  countRealBrands,
  editDistance,
  looksLikeTypo,
  pairBrands,
  suspicionFlags,
  kstStamp,
  creditLine,
  buildEditAlert,
  brandTokens,
  remapImageCredits,
};
