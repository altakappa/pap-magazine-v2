'use strict';
/**
 * 인스타그램 공동작업자(Collaborator) 지정 — 도메니코 정책 변경 2026-09-12 → 2026-09-24 재변경.
 *
 * 종전(9/12): 제출자는 누구나 최대 4명을 고르되, 지정받는 사람은 프리미엄 회원이어야 했다.
 *   → 실측: 이것 때문에 프리미엄에 드는 사람이 없었다.
 * 이제(9/24, 도메니코): 권력의 방향을 뒤집는다.
 *   · **지정하는 쪽(제출자)이 연간 프리미엄 회원**이어야 한다(subscriptions 활성 + billing_cycle yearly,
 *     판정은 premiumFeeWaiver.findYearlyPremiumSubscription 과 같은 것). 관리자는 예외.
 *   · **지정받는 쪽은 PAP 회원이면 된다** — 무료 회원 포함. 마이페이지에 인스타그램 아이디를 등록해 둔 상태면 끝.
 *     (한 명이 연간 프리미엄이면 스태프 5명을 회원으로 끌어온다 — 회원 DB 확보가 목적이다.)
 *   · 최대 5명(인스타그램 공동작업자 상한).
 *   · 아무도 고르지 않으면 공동작업자는 임의로 정해지거나 없을 수 있다(안내 문구).
 *   · 승인 시점 재판정(review.js): 제출자의 연간 프리미엄이 끊겼으면 전부 제외, 아이디를 지운 회원은 제외.
 *
 * 한 곳에서만 규칙을 만든다 — 폼의 실시간 확인(GET /api/submissions/collaborator-check),
 * 제출(POST /api/submissions), 재제출(PUT /api/submissions/[id]), 마이페이지 아이디 등록
 * (PUT /api/auth/me)이 전부 여기 함수를 쓴다. 두 벌이 되면 화면은 통과인데 서버가
 * 거부하는 일이 생긴다.
 */

const { countryName } = require('./countries');
const { findYearlyPremiumSubscription } = require('./premiumFeeWaiver');

const MAX_COLLABORATORS = 5;   // 도메니코 2026-09-24: 3 → 4 → 5명 (인스타그램 공동작업자 상한)

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
 * 아이디 목록 → { handle: { userId, premium, location } }. 등록된 회원이 없으면 그 아이디는 결과에 없다.
 * (location 은 관리자 참고용. 인스타그램 아이디는 유일하므로 회원 구분에는 쓰지 않는다 — 도메니코 2026-09-12.)
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
 * 이 회원이 공동작업자를 고를 자격이 있는가 — 활성 연간 프리미엄(관리자는 항상).
 * 판정은 premiumFeeWaiver.findYearlyPremiumSubscription 하나를 같이 쓴다(€380 면제와 같은 자격).
 */
async function canPickCollaborators(supabaseAdmin, picker) {
  if (!picker) return false;
  if (picker.isAdmin) return true;
  if (!picker.userId) return false;
  const row = await findYearlyPremiumSubscription(supabaseAdmin, picker.userId);
  return !!row;
}

/**
 * 제출 데이터의 공동작업자를 검증한다.
 * @param picker {userId, isAdmin} — 지정하는 쪽. 아이디가 하나라도 있으면 연간 프리미엄이어야 한다.
 * @returns {{ ok:true, collaborators:[{handle,userId}] } | { ok:false, code, message, handles:string[] }}
 */
async function validateCollaborators(supabaseAdmin, list, picker) {
  const { handles, invalid } = parseCollaboratorInput(list);
  if (invalid.length) {
    return { ok: false, code: 'COLLAB_HANDLE_INVALID',
      message: 'Invalid Instagram handle: ' + invalid.join(', '), handles: invalid };
  }
  if (!handles.length) return { ok: true, collaborators: [] };
  if (!(await canPickCollaborators(supabaseAdmin, picker))) {
    return { ok: false, code: 'COLLAB_YEARLY_PREMIUM_ONLY',
      message: 'Only Yearly Premium members can choose Instagram collaborators', handles };
  }
  const found = await lookupHandles(supabaseAdmin, handles);
  const notMember = handles.filter((h) => !found[h]);
  if (notMember.length) {
    return { ok: false, code: 'COLLAB_NOT_MEMBER',
      message: 'Instagram collaborators must be PAP members with a registered Instagram handle: @' + notMember.join(', @'),
      handles: notMember };
  }
  return { ok: true, collaborators: handles.map((h) => ({ handle: h, userId: found[h].userId })) };
}

/** 텔레그램 알림 본문 — 제출·재제출에서 공동작업자가 지정됐을 때 (도메니코 2026-09-12: "지정되면 텔레그램으로 알려줘"). */
function collaboratorAlertText(kind, sub, collaborators, submitter) {
  const hs = (collaborators || []).map((c) => '@' + ((c && c.handle) || c)).filter((h) => h !== '@');
  if (!hs.length) return '';
  return '🤝 인스타그램 공동작업자 지정 (' + (kind === 'resubmit' ? '재제출' : '신규 제출') + ')\n'
    + '제목: ' + String((sub && sub.title) || '').slice(0, 80) + '\n'
    + '제출자: ' + String(submitter || '').slice(0, 80) + '\n'
    + '공동작업자(' + hs.length + '/' + MAX_COLLABORATORS + '): ' + hs.join(' ') + '\n'
    + '※ 게재 승인 시 다시 판정: 제출자의 연간 프리미엄이 끊겼으면 전부, 아이디를 지운 회원은 그 사람만 자동 제외.'
    + (sub && sub.id ? '\nsubmission=' + sub.id : '');
}

module.exports = { canPickCollaborators, collaboratorAlertText, MAX_COLLABORATORS, normalizeHandle, isPremiumProfile, parseCollaboratorInput, lookupHandles, validateCollaborators };
