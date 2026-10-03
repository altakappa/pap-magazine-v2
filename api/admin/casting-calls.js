/**
 * /api/admin/casting-calls — 캐스팅 콜 (2026-10-02, 도메니코 "연간 혜택: 캐스팅 콜 선공개")
 *   GET            목록 (최근 20)
 *   POST {title, body, deadline?}   저장 + 연간 프리미엄 회원에게 즉시 메일(각자 언어) + 7일 뒤 공개 예약
 * 메일은 한 건당 한 번(sent_at 잠금). 수신자 0명이어도 저장은 된다(서브미션 페이지 공개 예약은 남는다).
 * 텍스트는 한국어 원문으로 저장하고 번역은 보여줄 때 캐시(translate.js)로 한다.
 */
'use strict';
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');
const { sendEmail, templates } = require('../_lib/email');
const { resolveEmailLang } = require('../_lib/emailLocale');
const translate = require('../_lib/translate');
const { sendCastingCall, EARLY_DAYS } = require('../_lib/castingCall');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const user = await requireAdmin(req, res);
  if (!user) return;
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.from('casting_calls')
      .select('id, title, body, deadline, early_at, public_at, sent_at, sent_count, created_at')
      .order('early_at', { ascending: false }).limit(20);
    if (error) return res.status(500).json({ message: error.message });
    // 2026-10-03 도메니코 "우리 키워드 + 트렌드로 후보를 주면 내가 고른다(9/24 합의)". 월간 소식 초안(creator-monthly)의
    // 테마 후보 3개(creatorTheme.js, 기본 키워드 + 트렌드 신호, 9개 언어)를 같이 내려 캐스팅 콜 칸에 한 번에 채운다.
    let candidates = [], candidatesMonth = null;
    try {
      const { data: camp } = await supabaseAdmin.from('email_campaigns').select('name, payload, created_at')
        .eq('type', 'creator-monthly').order('created_at', { ascending: false }).limit(1).maybeSingle();
      const list = camp && camp.payload && Array.isArray(camp.payload.theme_candidates) ? camp.payload.theme_candidates : [];
      candidates = list.map((c) => ({ keywords: c.keywords || [], trend: c.trend || '', source: c.source || '', ko: (c.i18n && c.i18n.ko) || null, en: (c.i18n && c.i18n.en) || null }));
      candidatesMonth = camp ? String(camp.name || '').replace('creator-monthly-', '') : null;
    } catch (_) { /* 후보 없음 */ }
    return res.status(200).json({ calls: data || [], candidates, candidatesMonth });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 120);
    const body = String(b.body || '').trim().slice(0, 2000);
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || '')) ? String(b.deadline) : null;
    if (!title || !body) return res.status(400).json({ message: 'title and body are required' });
    const now = new Date();
    const publicAt = new Date(now.getTime() + EARLY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: row, error } = await supabaseAdmin.from('casting_calls')
      .insert({ title, body, deadline, early_at: now.toISOString(), public_at: publicAt, created_by: user.id })
      .select('id, title, body, deadline, early_at, public_at').single();
    if (error) return res.status(500).json({ message: error.message });
    let mail = { sent: 0 };
    try {
      mail = await sendCastingCall(row, { db: supabaseAdmin, sendEmail, templates, resolveEmailLang, translate });
    } catch (e) {
      mail = { sent: 0, error: (e && e.message) || String(e) };
    }
    return res.status(200).json({ call: row, mail });
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
