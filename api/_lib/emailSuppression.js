'use strict';
/**
 * 메일 발송 금지 목록 (2026-09-25, Amazon SES 전환 준비).
 *
 * 왜: SES 는 되돌아온 메일(반송)과 스팸 신고 비율을 본다. 반송 5%, 신고 0.1% 를
 * 넘기면 계정 검토·정지다. 그래서 "한 번 영구 반송된 주소, 스팸 신고한 주소" 에는
 * 다시 보내지 않는다. 정식 발송 신청서에도 이 처리가 있다고 적었다.
 *
 * 규칙 (reason):
 *   bounce      영구 반송(주소 없음 등)   → 모든 메일 금지 (인증번호 포함, 어차피 안 닿는다)
 *   complaint   스팸 신고               → 홍보·소식 메일 금지. 인증번호·결제 확인(transactional)은 보낸다
 *   soft_bounce 일시 반송(메일함 가득 등) → 3번 쌓이면 bounce 처럼 금지. 그 전엔 보낸다
 *
 * 조회 실패는 발송을 막지 않는다(fail open). 금지 목록이 잠깐 안 읽힌다고
 * 회원가입 인증번호가 안 가면 더 큰 사고다. 대신 로그를 남긴다.
 */

const TABLE = 'email_suppressions';
const SOFT_LIMIT = 3;            // 일시 반송이 이만큼 쌓이면 금지
const CACHE_MS = 60 * 1000;      // 함수 인스턴스 안에서 1분 캐시 (주간 발송 1,400통이 1,400번 조회하지 않게)
const PAGE = 1000;               // PostgREST 기본 상한

let cache = null;                // { at, map: Map<email, {reason, count}> }

function normEmail(v) {
  let s = String(v == null ? '' : v).trim();
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/);    // "이름 <a@b.com>" 꼴
  if (m) s = m[1];
  s = s.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

function getDb() {
  // 늦게 불러온다. 이 파일은 email.js 가 부르는데, 테스트들이 supabase 없이 email.js 를 쓴다.
  return require('./supabase').supabaseAdmin;
}

async function loadAll(db) {
  const map = new Map();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(TABLE)
      .select('email, reason, event_count')
      .order('email', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    (data || []).forEach((r) => {
      const e = normEmail(r.email);
      if (e) map.set(e, { reason: r.reason, count: Number(r.event_count) || 1 });
    });
    if (!data || data.length < PAGE) break;
  }
  return map;
}

/** 금지 목록 전체 (Map). 실패하면 빈 Map + 로그. */
async function getSuppressionMap(opts) {
  const o = opts || {};
  if (!o.force && cache && Date.now() - cache.at < CACHE_MS) return cache.map;
  try {
    const map = await loadAll(o.db || getDb());
    cache = { at: Date.now(), map };
    return map;
  } catch (e) {
    console.error('[emailSuppression] 금지 목록 조회 실패 — 이번엔 막지 않고 보낸다:', (e && e.message) || e);
    return cache ? cache.map : new Map();
  }
}

/** 이 항목이 이번 메일을 막는가. 막으면 이유 문자열, 아니면 null. */
function blockReason(entry, transactional) {
  if (!entry) return null;
  if (entry.reason === 'bounce') return 'bounce';
  if (entry.reason === 'soft_bounce') return entry.count >= SOFT_LIMIT ? 'soft_bounce' : null;
  if (entry.reason === 'complaint') return transactional ? null : 'complaint';
  return null;
}

async function suppressionFor(to, opts) {
  const o = opts || {};
  const e = normEmail(to);
  if (!e) return null;
  const map = await getSuppressionMap(o);
  return blockReason(map.get(e), !!o.transactional);
}

/* 우선순위: bounce 가 제일 세다(모든 메일 금지) > complaint > soft_bounce.
 * 이미 더 센 이유로 들어가 있으면 이유는 그대로 두고 횟수·시각만 올린다. */
const RANK = { soft_bounce: 1, complaint: 2, bounce: 3 };

async function recordSuppression(input, opts) {
  const o = opts || {};
  const db = o.db || getDb();
  const email = normEmail(input && input.email);
  const reason = input && input.reason;
  if (!email || !RANK[reason]) return { ok: false, skipped: true };
  const now = new Date().toISOString();
  const detail = {
    bounce_type: input.bounceType || null,
    bounce_sub_type: input.bounceSubType || null,
    diagnostic: input.diagnostic ? String(input.diagnostic).slice(0, 500) : null,
    feedback_id: input.feedbackId || null,
    source: input.source || 'ses',
  };
  const { data: cur, error: selErr } = await db.from(TABLE)
    .select('email, reason, event_count').eq('email', email).maybeSingle();
  if (selErr) throw selErr;
  let res;
  if (!cur) {
    res = await db.from(TABLE).insert(Object.assign({ email, reason, event_count: 1, created_at: now, updated_at: now }, detail));
  } else {
    const keep = (RANK[cur.reason] || 0) >= RANK[reason];
    const patch = Object.assign({ event_count: (Number(cur.event_count) || 1) + 1, updated_at: now },
      keep ? {} : Object.assign({ reason }, detail));
    res = await db.from(TABLE).update(patch).eq('email', email);
  }
  if (res && res.error) throw res.error;
  cache = null;   // 다음 발송이 새 목록을 보게
  return { ok: true, email };
}

function _resetCache() { cache = null; }

module.exports = {
  normEmail, getSuppressionMap, suppressionFor, recordSuppression, blockReason,
  SOFT_LIMIT, TABLE, _resetCache,
};
