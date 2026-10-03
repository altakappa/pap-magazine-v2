'use strict';
/**
 * 캐스팅 콜 — 연간 프리미엄 7일 선공개 (2026-10-02, 도메니코 "매달 돌아올 이유").
 *
 * 흐름: 도메니코가 관리자에서 한국어로 제목·본문(+마감)을 적고 '보내기' →
 *   1) casting_calls 에 저장 (early_at=지금, public_at=7일 뒤)
 *   2) 활성 연간 프리미엄 회원 전원에게 각자 언어로 메일 (한 번만: sent_at 로 잠금)
 *   3) 7일 뒤부터 서브미션 페이지에서 모두에게 보인다 (연간 프리미엄은 바로)
 * 번역: translate.getOrTranslate 캐시(targetType 'casting_call'). 실패하면 한국어 원문.
 * 정직: "선공개"다. 숨기는 게 아니라 7일 먼저 보는 것. 누구나 결국 본다.
 */
const SITE = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';
const { isYearlyPremiumRow } = require('./premiumFeeWaiver');
const EARLY_DAYS = 7;
/* 2026-10-03 사다리: 연간 7일 먼저(메일+페이지) → 월간 유료(스탠다드·프리미엄) 3일 먼저(페이지) → 무료 공개 때. */
const PAID_EARLY_DAYS = 3;

function submitUrl(lang, id) {
  const pre = !lang || lang === 'ko' ? '' : '/' + lang;
  return SITE + pre + '/submission?utm_source=casting_call&utm_medium=email&utm_campaign=cc-' + String(id || '').slice(0, 8);
}

/** 캐스팅 콜 한 건을 lang 으로. 실패해도 원문(ko)을 돌려준다. */
async function localize(row, lang, translate) {
  const out = { id: row.id, title: row.title, body: row.body, deadline: row.deadline || null, early_at: row.early_at, public_at: row.public_at };
  if (!lang || lang === 'ko' || !translate) return out;
  try {
    out.title = await translate.getOrTranslate('casting_call', row.id, 'title', row.title, lang);
    out.body = await translate.getOrTranslate('casting_call', row.id, 'body', row.body, lang);
  } catch (_) { /* 원문 유지 */ }
  return out;
}

/** 활성 연간 프리미엄 회원의 user_id 목록 (admin/staff 포함 — 자기 메일도 받아보게). */
async function yearlyPremiumUserIds(db) {
  const { data } = await db.from('subscriptions')
    .select('user_id, plan, status, billing_cycle, current_period_start')
    .in('status', ['active', 'trialing']);
  const ids = new Set();
  for (const r of (data || [])) if (isYearlyPremiumRow(r) && r.user_id) ids.add(r.user_id);
  return Array.from(ids);
}

/**
 * 지금 보여줄 캐스팅 콜. viewerYearly=true 면 early_at 기준, 아니면 public_at 기준.
 * 둘 다 없으면 null. 'teaser' 는 "연간은 벌써 보고 있다"를 알리기 위한 다음 공개 시각.
 */
async function currentCastingCall(db, { lang, viewerYearly, viewerPaid, translate }) {
  const nowIso = new Date().toISOString();
  // 월간 유료는 public_at 3일 전부터 본다 (연간은 early_at 부터).
  const paidFrom = (r) => new Date(Date.parse(r.public_at) - PAID_EARLY_DAYS * 86400000).toISOString();
  const { data: rows } = await db.from('casting_calls')
    .select('id, title, body, deadline, early_at, public_at')
    .lte('early_at', nowIso)
    .order('early_at', { ascending: false })
    .limit(3);
  const list = rows || [];
  const visible = list.find((r) => viewerYearly || String(r.public_at) <= nowIso || (viewerPaid && paidFrom(r) <= nowIso));
  if (visible) {
    const loc = await localize(visible, lang, translate);
    loc.early = String(visible.public_at) > nowIso;   // 공개 전에 보고 있다(연간 또는 월간 유료)
    loc.earlyTier = loc.early ? (viewerYearly ? 'yearly' : 'paid') : null;
    return loc;
  }
  const upcoming = list[0];
  if (upcoming) return { teaser: true, public_at: upcoming.public_at };
  return null;
}

/** 메일 발송 (한 번만). deps: db, sendEmail, templates, resolveEmailLang, translate */
async function sendCastingCall(row, deps) {
  const { db, sendEmail, templates, resolveEmailLang, translate } = deps;
  if (!row || !row.id) return { sent: 0, skipped: 'no_row' };
  const stamp = new Date().toISOString();
  const { data: claimed, error: cErr } = await db.from('casting_calls')
    .update({ sent_at: stamp }).eq('id', row.id).is('sent_at', null).select('id');
  if (cErr) throw cErr;
  if (!claimed || !claimed.length) return { sent: 0, skipped: 'already_sent' };
  const ids = await yearlyPremiumUserIds(db);
  if (!ids.length) {
    await db.from('casting_calls').update({ sent_count: 0 }).eq('id', row.id);
    return { sent: 0, recipients: 0 };
  }
  const { data: profiles } = await db.from('profiles')
    .select('id, email, display_name, name, language, email_language, country').in('id', ids);
  let sent = 0; const errors = [];
  for (const p of (profiles || [])) {
    if (!p || !p.email) continue;
    try {
      const lang = resolveEmailLang(p);
      const loc = await localize(row, lang, translate);
      const tpl = templates.castingCall({ name: p.display_name || p.name || '' },
        { title: loc.title, body: loc.body, deadline: loc.deadline, publicAt: String(row.public_at).slice(0, 10), url: submitUrl(lang, row.id) }, lang);
      const r = await sendEmail(p.email, tpl);
      if (r && r.sent) sent += 1; else errors.push({ id: p.id, error: r && r.error });
    } catch (e) { errors.push({ id: p.id, error: (e && e.message) || String(e) }); }
  }
  await db.from('casting_calls').update({ sent_count: sent }).eq('id', row.id);
  return { sent, recipients: (profiles || []).length, errors };
}

/** 2026-10-03 연간 혜택(PAP Picks 후보 우선 · 이달의 에디토리얼 후보 표시): 제출자가 활성 연간 프리미엄인 화보 id 집합 */
async function yearlySubmitterEditorialIds(db, editorialRows) {
  const out = new Set();
  const subIds = (editorialRows || []).map((e) => e && e.source_submission_id).filter(Boolean);
  if (!subIds.length) return out;
  const ids = await yearlyPremiumUserIds(db);
  if (!ids.length) return out;
  const yearly = new Set(ids);
  const { data: subs } = await db.from('submissions').select('id, user_id').in('id', subIds);
  const subOwner = {}; for (const s of (subs || [])) subOwner[s.id] = s.user_id;
  for (const e of editorialRows) if (e && e.source_submission_id && yearly.has(subOwner[e.source_submission_id])) out.add(e.id);
  return out;
}

module.exports = { EARLY_DAYS, PAID_EARLY_DAYS, localize, yearlySubmitterEditorialIds, yearlyPremiumUserIds, currentCastingCall, sendCastingCall, submitUrl };
