/**
 * POST /api/downloads/log — 에디토리얼 이미지 다운로드 이력 기록.
 *
 * QA #277. 로그인 사용자가 에디토리얼 페이지에서 다운로드 버튼 클릭 시
 * 클라이언트가 호출. 약관 동의 + 누가/언제/무엇을 받았는지 audit trail.
 *
 * Body:
 *   content_type : 'cover' | 'gallery' | 'editorial-zip' | 'article-thumb'
 *   content_id   : editorial / article id (optional)
 *   content_slug : (optional)
 *   image_url    : (optional) 실제 다운로드한 이미지 URL
 *   file_name    : 회원 식별자 포함된 파일명
 *   consented    : 약관 동의 여부 (true)
 *
 * 응답:  { ok: true, log_id: ... }
 *
 * 정책: best-effort logging. logging 실패해도 다운로드 자체는 진행되어야
 *       하므로 클라이언트는 응답 안 기다리고 진행.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const ALLOWED_TYPES = ['cover', 'gallery', 'editorial-zip', 'article-thumb'];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const user = requireAuth(req, res);
  if (!user) return;

  const body = req.body || {};
  const contentType = String(body.content_type || '').trim();
  if (!ALLOWED_TYPES.includes(contentType)){
    return res.status(400).json({ message: 'Invalid content_type' });
  }

  const ipAddr = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0].trim() || null;
  const userAgent = (req.headers['user-agent'] || '').slice(0, 500) || null;

  try {
    const row = {
      user_id:       user.id || null,
      user_email:    user.email || null,
      content_type:  contentType,
      content_id:    body.content_id ? String(body.content_id).slice(0, 100) : null,
      content_slug:  body.content_slug ? String(body.content_slug).slice(0, 200) : null,
      image_url:     body.image_url ? String(body.image_url).slice(0, 1000) : null,
      file_name:     body.file_name ? String(body.file_name).slice(0, 200) : null,
      ip_address:    ipAddr,
      user_agent:    userAgent,
      consented:     body.consented === true || body.consented === 'true',
    };
    const { data, error } = await supabaseAdmin
      .from('download_logs').insert(row).select('id').single();
    if (error){
      console.error('[downloads/log] insert error:', error.message || error);
      return res.status(500).json({ ok: false, error: error.message });
    }
    return res.status(200).json({ ok: true, log_id: data && data.id });
  } catch (err) {
    console.error('[downloads/log] error:', err && err.message || err);
    return res.status(500).json({ ok: false, error: 'log failed' });
  }
};
