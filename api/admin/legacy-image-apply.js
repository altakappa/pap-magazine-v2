/**
 * GET /api/admin/legacy-image-apply   (관리자 또는 CRON_SECRET)
 *
 * 레거시 화보 이미지 회수를 **수동으로** 한 배치 돌린다.
 * 로직은 _lib/legacyImageApply.js — 크론(api/cron/legacy-image-recover)과 공용이다.
 * 평시 진행은 크론이 알아서 하고, 이 엔드포인트는 확인·개입용으로 남긴다.
 *
 * 사용법:
 *   GET ?dry=1        — 무엇을 바꿀지만 보고, 쓰지 않는다 (먼저 이걸로 확인)
 *   GET ?limit=8      — 이번 호출에서 처리할 화보 수 (1~20, 기본 8)
 */
'use strict';

const { requireAdmin } = require('../_lib/auth');
const { applyLegacyImages } = require('../_lib/legacyImageApply');

module.exports = async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  res.setHeader('Cache-Control', 'no-store');

  try {
    const out = await applyLegacyImages({
      limit: (req.query && req.query.limit) || 8,
      dry: !!(req.query && req.query.dry === '1'),
    });
    return res.status(200).json({
      ...out,
      hint: out.done
        ? '모두 적용 완료.'
        : '크론(legacy-image-recover)이 10분마다 이어서 처리합니다.',
    });
  } catch (e) {
    const code = e && e.statusCode ? e.statusCode : 500;
    console.error('[admin/legacy-image-apply]', (e && e.message) || e);
    // 원문 에러를 응답에 싣지 않는다 (감사 A-3) — 분류용 code 만.
    return res.status(code).json({
      message: 'Failed to apply legacy images. contact@pap-magazine.com',
      code: (e && e.code) || 'apply_failed',
    });
  }
};
