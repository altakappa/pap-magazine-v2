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
      // 2026-10-03 도메니코 "무드보드도 같이": 후보마다 PAP 아카이브(최근 18개월 게재작) 6컷. 키워드별 정규식으로 제목·설명·태그를 훑는다.
      // 바깥 이미지가 아니라 우리가 실은 화보만 쓴다 — 크리에이터가 보는 건 "PAP 에서 이 주제가 어떻게 보였나" 다.
      if (candidates.length) {
        const since = new Date(Date.now() - 540 * 86400000).toISOString().slice(0, 10);
        const { data: eds } = await supabaseAdmin.from('editorials')
          .select('id, slug, title, cover_image, thumbnail, description, description_en, tags, published_date')
          .eq('status', 'published').not('cover_image', 'is', null).gte('published_date', since)
          .order('published_date', { ascending: false }).limit(400);
        const KW = {
          DREAMY: /dream|ethereal|haze|soft|몽환|꿈/i, SURREALISM: /surreal|uncanny|strange|fantasy|familiar|초현실|낯/i,
          STORYTELLING: /story|narrative|film|cinema|scene|memory|chapter|이야기|영화|기억/i, CREATIVITY: /colou?r|bold|art|experimental|vivid|saturat|채도|색|실험/i,
        };
        const used = new Set();
        for (const c of candidates) {
          const res = (c.keywords && c.keywords.length ? c.keywords : Object.keys(KW)).map((k) => KW[String(k).toUpperCase()]).filter(Boolean);
          const pick = [];
          for (const e of (eds || [])) {
            if (used.has(e.id)) continue;
            const txt = [e.title, e.description_en, e.description, (e.tags || []).join(' ')].join(' ');
            if (res.some((r) => r.test(txt))) { pick.push({ slug: e.slug, title: e.title, image: e.thumbnail || e.cover_image }); used.add(e.id); }
            if (pick.length === 6) break;
          }
          c.moodboard = pick;
        }
      }
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
