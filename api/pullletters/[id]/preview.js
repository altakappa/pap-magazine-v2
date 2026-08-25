/**
 * GET /api/pullletters/:id/preview — 발급 전 공문 미리보기 (관리자 전용)
 *
 * 2026-08-25 도메니코: "승인 전에 발급될 풀레터가 제대로 나온 건지 확인하고 싶다."
 * 발급 경로(review.js의 자동 발급)와 **같은 렌더러**(letterSvg)를 쓴다 —
 * 미리보기와 실물이 다른 그림이면 미리보기는 거짓말이 된다.
 * PDF 가 아니라 PNG 로 응답하는 이유: 어드민 모달 <img> 에 바로 뜬다.
 */
const { supabaseAdmin } = require('../../_lib/supabase');
const { requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const { id } = req.query;
    const { data: row, error } = await supabaseAdmin
      .from('pullletters').select('id, title, team_info').eq('id', id).single();
    if (error || !row) return res.status(404).json({ message: 'Not found' });

    const team = row.team_info || {};
    const phName = team.photographer && team.photographer.name;
    const stName = team.stylist && team.stylist.name;
    if (!phName || !stName) {
      return res.status(400).json({
        message: '신청서에 포토그래퍼/스타일리스트 이름이 없어 미리보기를 만들 수 없습니다.',
        code: 'preview_missing_names',
      });
    }

    const { letterSvg, docNoFor, issueDateTextFor, validUntilTextFor } = require('../../_lib/pullLetterPdf');
    const now = new Date();
    const svg = letterSvg({
      photographer: phName,
      stylist: stName,
      project: row.title || '',
      docNo: docNoFor(row.id, now),
      issueDateText: issueDateTextFor(now),
      validUntilText: validUntilTextFor(now),
    });
    const sharp = require('sharp');   // 지연 로드
    const png = await sharp(Buffer.from(svg)).resize({ width: 900 }).png().toBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');   // 이름·날짜가 실시간이라 캐시 금지
    return res.status(200).send(png);
  } catch (e) {
    console.error('[pullletter] preview 실패:', (e && e.message) || e);
    return res.status(500).json({ message: 'preview failed: ' + String((e && e.message) || e).slice(0, 150) });
  }
};
