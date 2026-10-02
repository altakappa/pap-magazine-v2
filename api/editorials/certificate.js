/**
 * /api/editorials/certificate — 게재 인증서 (2026-10-02, 도메니코 "연간 혜택: 게재 인증서 PDF")
 *
 *   GET ?id=<editorial id>                 (로그인 + 연간 프리미엄 활성) → 인증서 데이터 JSON.
 *                                          마이페이지가 이걸로 인쇄용 페이지를 열고, 회원이 PDF 로 저장한다.
 *   GET ?id=<editorial id>&verify=<code>   (공개) → 검증 결과 HTML. 에이전시·학교가 코드로 진위를 본다.
 *
 * 소유: editorials.source_submission_id → submissions.user_id == 회원. 게재(published) 된 것만.
 * 코드: HMAC-SHA256(JWT_SECRET, 'cert:'+editorial.id+':'+user.id) 앞 12자. 서버만 만들 수 있고, 같은 입력엔 늘 같은 코드.
 * 등급: 연간 프리미엄이 활성일 때만 발급. 이미 받은 인증서의 검증은 등급과 무관하게 영원히 된다(종이에 적힌 사실은 안 변한다).
 */
'use strict';
const crypto = require('crypto');
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAuth } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { findYearlyPremiumSubscription } = require('../_lib/premiumFeeWaiver');

const SITE = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';
const UUID = /^[0-9a-f-]{32,36}$/i;

function certCode(editorialId, userId) {
  const secret = process.env.JWT_SECRET || '';
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update('cert:' + editorialId + ':' + userId).digest('base64')
    .replace(/[^A-Z2-9]/g, '').slice(0, 12);
}

function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

async function loadOwned(editorialId) {
  const { data: ed } = await supabaseAdmin.from('editorials')
    .select('id, title, title_en, slug, issue, published_date, status, credits, source_submission_id')
    .eq('id', editorialId).maybeSingle();
  if (!ed || ed.status !== 'published' || !ed.source_submission_id) return null;
  const { data: sub } = await supabaseAdmin.from('submissions').select('user_id').eq('id', ed.source_submission_id).maybeSingle();
  if (!sub || !sub.user_id) return null;
  return { ed, ownerId: sub.user_id };
}

function verifyPage(ok, ed, creator, code) {
  const body = ok
    ? '<h1 style="color:#2ecc71">VALID</h1><p>This certificate was issued by PAP Magazine.</p>'
      + '<table style="border-collapse:collapse;margin-top:16px">'
      + '<tr><td style="padding:4px 12px 4px 0;color:#888">Editorial</td><td>' + esc(ed.title_en || ed.title) + '</td></tr>'
      + '<tr><td style="padding:4px 12px 4px 0;color:#888">Creator</td><td>' + esc(creator) + '</td></tr>'
      + (ed.issue ? '<tr><td style="padding:4px 12px 4px 0;color:#888">Issue</td><td>' + esc(ed.issue) + '</td></tr>' : '')
      + '<tr><td style="padding:4px 12px 4px 0;color:#888">Published</td><td>' + esc(String(ed.published_date || '').slice(0, 10)) + '</td></tr>'
      + '<tr><td style="padding:4px 12px 4px 0;color:#888">Code</td><td>' + esc(code) + '</td></tr>'
      + '<tr><td style="padding:4px 12px 4px 0;color:#888">Link</td><td><a href="' + esc(SITE + '/editorial/' + encodeURIComponent(ed.slug)) + '" style="color:#fff">' + esc(SITE + '/editorial/' + ed.slug) + '</a></td></tr>'
      + '</table>'
    : '<h1 style="color:#e74c3c">NOT VALID</h1><p>No PAP Magazine certificate matches this code.</p>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>PAP Magazine — Certificate verification</title></head>'
    + '<body style="margin:0;background:#000;color:#fff;font-family:Helvetica,Arial,sans-serif;padding:48px 24px"><div style="max-width:640px;margin:0 auto">'
    + '<div style="font-size:11px;letter-spacing:.3em;color:#888;margin-bottom:24px">PAP MAGAZINE · CERTIFICATE VERIFICATION</div>' + body + '</div></body></html>';
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  const id = String(req.query.id || '').trim();
  if (!UUID.test(id)) return res.status(400).json({ message: 'id required' });
  res.setHeader('Cache-Control', 'no-store');

  // ── 공개 검증 ──
  if (req.query.verify !== undefined) {
    const code = String(req.query.verify || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 12);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    try {
      const owned = await loadOwned(id);
      const expected = owned ? certCode(owned.ed.id, owned.ownerId) : null;
      const ok = !!(owned && expected && code.length === 12 && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected)));
      let creator = '';
      if (ok) {
        const { data: p } = await supabaseAdmin.from('profiles').select('display_name, name').eq('id', owned.ownerId).maybeSingle();
        creator = (p && (p.display_name || p.name)) || '';
      }
      return res.status(200).send(verifyPage(ok, owned && owned.ed, creator, code));
    } catch (e) {
      console.error('[certificate/verify]', e && e.message);
      return res.status(200).send(verifyPage(false));
    }
  }

  // ── 발급 (본인 + 연간 프리미엄) ──
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    const owned = await loadOwned(id);
    if (!owned || owned.ownerId !== user.id) return res.status(404).json({ message: 'Editorial not found' });
    const yearly = await findYearlyPremiumSubscription(supabaseAdmin, user.id);
    if (!yearly) return res.status(403).json({ code: 'not_yearly_premium', message: 'Publication certificates are a Yearly Premium benefit.' });
    const code = certCode(owned.ed.id, user.id);
    if (!code) return res.status(500).json({ message: 'certificate signing not configured' });
    const { data: p } = await supabaseAdmin.from('profiles').select('display_name, name, instagram').eq('id', user.id).maybeSingle();
    const ed = owned.ed;
    const credits = Array.isArray(ed.credits) ? ed.credits.slice(0, 40).map((c) => ({
      name: String((c && c.name) || '').slice(0, 80),
      roles: Array.isArray(c && c.roles) ? c.roles.map(String).slice(0, 5) : (c && c.roles ? [String(c.roles)] : []),
      instagram: String((c && c.instagram) || '').slice(0, 60),
    })) : [];
    return res.status(200).json({
      certificate: {
        code,
        editorialId: ed.id,
        title: ed.title_en || ed.title || '',
        titleOriginal: ed.title || '',
        issue: ed.issue || '',
        publishedDate: String(ed.published_date || '').slice(0, 10),
        url: SITE + '/editorial/' + encodeURIComponent(ed.slug),
        verifyUrl: SITE + '/api/editorials/certificate?id=' + encodeURIComponent(ed.id) + '&verify=' + code,
        creator: (p && (p.display_name || p.name)) || '',
        creatorInstagram: (p && p.instagram) || '',
        credits,
        issuedAt: new Date().toISOString().slice(0, 10),
      },
    });
  } catch (e) {
    console.error('[certificate]', e && e.message);
    return res.status(500).json({ message: 'Failed to issue certificate' });
  }
};
