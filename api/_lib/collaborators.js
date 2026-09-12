'use strict';
/**
 * 인스타그램 공동작업자(Collaborator) 지정 — 도메니코 정책 변경 2026-09-12.
 *
 * 종전: 공동작업자 태그는 유료 추가 옵션(€110/피드, PayPal 애드온 ig_collab).
 * 이제: 제출자가 서브미션 폼에서 공동작업자를 인스타그램 아이디로 직접 고른다.
 *   · 지정받는 사람은 **PAP 프리미엄 회원**이어야 한다(profiles.subscription_plan='premium' AND
 *     subscription_status='active', 그리고 마이페이지에 인스타그램 아이디를 등록해 둔 상태).
 *   · 프리미엄이 아닌 아이디는 등록되지 않고 "프리미엄 회원만 지정할 수 있다"는 경고가 뜬다.
 *   · 아무도 고르지 않으면 공동작업자는 임의로 정해지거나 없을 수 있다(안내 문구).
 *
 * 한 곳에서만 규칙을 만든다 — 폼의 실시간 확인(GET /api/submissions/collaborator-check),
 * 제출(POST /api/submissions), 재제출(PUT /api/submissions/[id]), 마이페이지 아이디 등록
 * (PUT /api/auth/me)이 전부 여기 함수를 쓴다. 두 벌이 되면 화면은 통과인데 서버가
 * 거부하는 일이 생긴다.
 */

const { countryName } = require('./countries');

const MAX_COLLABORATORS = 3;   // 인스타그램 공동 게시 초대 상한과 맞춘 값

/**
 * 인스타그램 아이디 정규화. '@', 앞뒤 공백, 프로필 URL(instagram.com/xxx/) 을 벗기고 소문자로.
 * 인스타그램 규칙(영숫자·마침표·밑줄, 30자)에 안 맞으면 '' 를 돌려준다.
 */
function normalizeHandle(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
  s = s.replace(/[/?#].*$/, '');
  s = s.replace(/^@+/, '').trim().toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : '';
}

/** 프리미엄 회원인가 — profiles 행 기준. plan 은 'premium' 또는 'premium_*'(구 표기) 를 받는다. */
function isPremiumProfile(p) {
  if (!p) return false;
  const plan = String(p.subscription_plan || '').toLowerCase();
  return /^premium/.test(plan) && String(p.subscription_status || '').toLowerCase() === 'active';
}

/**
 * 폼에서 온 공동작업자 입력(문자열 배열 또는 {handle} 배열)을 정규화·중복 제거·상한 적용.
 * @returns {{ handles:string[], invalid:string[] }}
 */
function parseCollaboratorInput(list) {
  const out = [];
  const invalid = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((x) => {
    const raw = (x && typeof x === 'object') ? (x.handle || x.instagram || '') : x;
    if (raw == null || String(raw).trim() === '') return;
    const h = normalizeHandle(raw);
    if (!h) { invalid.push(String(raw).trim()); return; }
    if (seen.has(h)) return;
    seen.add(h);
    if (out.length < MAX_COLLABORATORS) out.push(h);
  });
  return { handles: out, invalid };
}

/**
 * 아이디 목록 → { handle: { userId, premium } }. 등록된 회원이 없으면 그 아이디는 결과에 없다.
 * profiles.instagram 은 PUT /api/auth/me 가 정규화해 저장하므로 소문자 정확 일치로 찾는다.
 */
async function lookupHandles(supabaseAdmin, handles) {
  const map = {};
  const hs = Array.from(new Set((handles || []).map(normalizeHandle).filter(Boolean)));
  if (!hs.length) return map;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, instagram, subscription_plan, subscription_status, activity_country, activity_city')
    .in('instagram', hs);
  if (error) throw error;
  (data || []).forEach((p) => {
    const h = normalizeHandle(p.instagram);
    if (!h) return;
    map[h] = { userId: p.id, premium: isPremiumProfile(p), location: [p.activity_city, countryName(p.activity_country) || p.activity_country].filter(Boolean).join(', ') };
  });
  return map;
}

/**
 * 제출 데이터의 공동작업자를 검증한다.
 * @returns {{ ok:true, collaborators:[{handle,userId}] } | { ok:false, code, message, handles:string[] }}
 */
async function validateCollaborators(supabaseAdmin, list) {
  const { handles, invalid } = parseCollaboratorInput(list);
  if (invalid.length) {
    return { ok: false, code: 'COLLAB_HANDLE_INVALID',
      message: 'Invalid Instagram handle: ' + invalid.join(', '), handles: invalid };
  }
  if (!handles.length) return { ok: true, collaborators: [] };
  const found = await lookupHandles(supabaseAdmin, handles);
  const notPremium = handles.filter((h) => !(found[h] && found[h].premium));
  if (notPremium.length) {
    return { ok: false, code: 'COLLAB_NOT_PREMIUM',
      message: 'Only PAP Premium members can be selected as Instagram collaborators: @' + notPremium.join(', @'),
      handles: notPremium };
  }
  return { ok: true, collaborators: handles.map((h) => ({ handle: h, userId: found[h].userId })) };
}

module.exports = { MAX_COLLABORATORS, normalizeHandle, isPremiumProfile, parseCollaboratorInput, lookupHandles, validateCollaborators };
