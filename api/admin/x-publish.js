/**
 * X 미디어 게시 핸들러 (2026-07-30, 도메니코 지시 — 영상·이미지 포함 X 발행).
 *
 * 흐름: 기사(article/editorial)의 미디어를 소스 기준으로 골라(영상1 또는 이미지≤4)
 * X 에 업로드한 뒤, 준비된 문안과 함께 트윗한다. 성공 시 social_repurpose 의
 * 해당 x 행을 status='posted' 로 표시(멱등성 — 이미 posted 면 재게시 안 함).
 *
 * 서버측 발행이라 샌드박스 프록시·브라우저 10MB 상한 문제가 없다(Supabase·X 직접 접근).
 *
 * 인증: requireAdmin. 실제 문안(text)은 검수된 초안에서 넘어온다(근거 없는 즉석 게시 금지).
 * 비밀값(X_*)은 Vercel env — 이 코드는 값을 다루지 않는다.
 *
 * POST body: {
 *   type: 'article' | 'editorial',
 *   target_id: string|number,
 *   text: string,                 // 게시할 문안(280 가중자 이내 권장)
 *   account?: 'pap' | 'pepperit', // 기본 pap
 *   force?: boolean               // true 면 posted 여부 무시하고 재게시(수동 복구용)
 * }
 */
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const xPost = require('../_lib/xPost');

const SOURCES = {
  article: { table: 'articles', columns: 'id,slug,title,source_media_type,gallery,videos,status' },
  editorial: { table: 'editorials', columns: 'id,slug,title,source_media_type,gallery,videos,status' },
};

function _parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed', code: 'method_not_allowed' });

  const user = await requireAdmin(req, res);
  if (!user) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  try {
    const body = _parseBody(req);
    const type = String(body.type || 'article');
    const targetId = body.target_id;
    const text = String(body.text || '').trim();
    const account = body.account === 'pepperit' ? 'pepperit' : 'pap';
    const force = !!body.force;

    const src = SOURCES[type];
    if (!src) return res.status(400).json({ message: 'Unknown type', code: 'bad_type' });
    if (!targetId) return res.status(400).json({ message: 'Missing target_id', code: 'missing_target' });
    if (!text) return res.status(400).json({ message: 'Missing text', code: 'missing_text' });

    // 인증 설정 확인(계정별)
    const configured = account === 'pepperit' ? xPost.isPepperitConfigured() : xPost.isConfigured();
    if (!configured) return res.status(503).json({ message: 'X 계정 미설정', code: 'x_not_configured' });

    // 대상 기사 로드
    const { data: row, error: loadErr } = await supabaseAdmin
      .from(src.table).select(src.columns).eq('id', targetId).single();
    if (loadErr || !row) return res.status(404).json({ message: '대상을 찾을 수 없습니다.', code: 'target_not_found' });

    // 멱등성: social_repurpose 의 x 행이 이미 posted 면 스킵
    let repurposeRow = null;
    try {
      const { data } = await supabaseAdmin
        .from('social_repurpose')
        .select('id,status')
        .eq('target_type', type).eq('target_id', String(targetId)).eq('platform', 'x')
        .maybeSingle();
      repurposeRow = data || null;
    } catch (_) { /* 테이블/행 없을 수 있음 — 멱등성 체크는 best-effort */ }
    if (!force && repurposeRow && repurposeRow.status === 'posted') {
      return res.status(200).json({ skipped: 'already_posted', repurpose_id: repurposeRow.id });
    }

    // 계정 크레덴셜
    const creds = account === 'pepperit'
      ? { token: process.env.X_PEPPERIT_ACCESS_TOKEN, tokenSecret: process.env.X_PEPPERIT_ACCESS_TOKEN_SECRET }
      : {};

    // 미디어 업로드(소스 기준: 영상1 또는 이미지≤4)
    const media = await xPost.uploadArticleMedia(row, creds);
    // 영상 업로드가 실패하면 게시를 막는다(미디어 지시 준수). 이미지 0장이면 텍스트로 진행.
    if (media.kind === 'video' && !media.ok) {
      return res.status(502).json({ message: 'X 영상 업로드 실패', code: 'media_upload_failed', detail: media.detail });
    }

    // 게시
    const result = await xPost.postTweet(text, Object.assign({}, creds, { mediaIds: media.mediaIds }));
    if (!result.ok) {
      return res.status(502).json({ message: 'X 게시 실패', code: 'post_failed', detail: result.detail, status: result.status });
    }

    // 성공 → posted 표시(best-effort)
    if (repurposeRow) {
      try {
        await supabaseAdmin.from('social_repurpose')
          .update({ status: 'posted', updated_at: new Date().toISOString() })
          .eq('id', repurposeRow.id);
      } catch (_) { /* 상태 표시 실패는 게시 성공을 무효화하지 않는다 */ }
    }

    return res.status(200).json({
      ok: true,
      tweet_id: result.id,
      account,
      media_kind: media.kind,
      media_count: (media.mediaIds || []).length,
    });
  } catch (err) {
    console.error('[x-publish]', err);
    return res.status(500).json({ message: 'X 발행 중 서버 오류 contact@pap-magazine.com', code: 'server_error' });
  }
};
