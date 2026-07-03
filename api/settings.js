/**
 * /api/settings — site_settings key-value 조회/저장.
 *
 * QA #321 — Business 페이지 관리자 편집을 mock → 실제 저장으로 전환하며
 * 신설. site_settings 테이블 (migration 004, key/value JSONB) 은 존재만
 * 하고 소비하는 API 가 없었다.
 *
 *   GET /api/settings?key=<key>        → { key, value }   (공개 읽기)
 *   PUT /api/settings  {key, value}    → upsert           (admin 전용)
 *
 * service-role 클라이언트는 RLS 를 우회하므로 쓰기는 requireAdmin 으로
 * 게이트. 이 엔드포인트가 임의 키 저장소로 오용되지 않게 허용 키를
 * allowlist 로 제한 — 새 페이지/설정을 붙일 때 여기에 추가.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors }    = require('./_lib/cors');
const { requireAdmin }  = require('./_lib/auth');
const { rateLimit, RATE_LIMITS } = require('./_lib/rateLimit');

const ALLOWED_KEYS = [
  'business_page',   // QA #321 — 비즈니스 페이지 콘텐츠 + 미디어킷 링크
  'contact_page',    // QA #326 — Italy/Korea 오피스 주소
];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  // ── GET (public) ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const key = String((req.query && req.query.key) || '').trim();
      if (!key || ALLOWED_KEYS.indexOf(key) === -1) {
        return res.status(400).json({ message: 'unknown settings key' });
      }
      const { data, error } = await supabaseAdmin
        .from('site_settings')
        .select('key,value,updated_at')
        .eq('key', key)
        .maybeSingle();
      if (error) {
        console.error('[settings GET] supabase error', error);
        return res.status(500).json({ message: 'Failed to load settings' });
      }
      // 공개 페이지 (business.html) 가 로드마다 조회 — 60s edge cache.
      // 관리자 저장 후 최대 1분 내 반영.
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return res.status(200).json({ key, value: (data && data.value) || null, updated_at: data && data.updated_at || null });
    } catch (err) {
      console.error('[settings GET] uncaught', err);
      return res.status(500).json({ message: 'Failed to load settings' });
    }
  }

  // ── PUT (admin) ──────────────────────────────────────────────────
  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const body = req.body || {};
      const key = String(body.key || '').trim();
      if (!key || ALLOWED_KEYS.indexOf(key) === -1) {
        return res.status(400).json({ message: 'unknown settings key' });
      }
      if (body.value == null || typeof body.value !== 'object') {
        return res.status(400).json({ message: 'value (object) is required' });
      }
      const { data, error } = await supabaseAdmin
        .from('site_settings')
        .upsert({ key, value: body.value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
        .select('key,value,updated_at')
        .single();
      if (error) {
        console.error('[settings PUT] supabase error', error);
        return res.status(500).json({ message: 'Failed to save settings' });
      }
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ data });
    } catch (err) {
      console.error('[settings PUT] uncaught', err);
      return res.status(500).json({ message: 'Failed to save settings' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
