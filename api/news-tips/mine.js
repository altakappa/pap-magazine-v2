/**
 * GET /api/news-tips/mine — 내가 보낸 제보 (회원)
 *
 * 제보자는 보내고 나면 아무것도 볼 수 없었다. 보상이 걸려 있는 트랙이라
 * (채택 시 기사 크레딧 + 프리미엄 1개월) 최소한 어디까지 왔는지는 보여야 한다.
 *
 * ■ 내려주지 않는 것
 *   · media / media_archived — 비공개 버킷이고, 제보자에게 다시 보여줄 이유가
 *     없다. 본인이 올린 파일이지만 서명 URL 을 다시 발급하면 확인 전 영상의
 *     링크가 하나 더 떠돌게 된다.
 *   · admin_notes — 내부 판단 메모다. 제보자에게 보일 글이 아니다.
 *   · body / location / happened_at — 본인이 쓴 내용이라 보여줘도 되지만,
 *     목록에 필요하지 않고 통째로 실으면 응답만 무거워진다. 제목으로 식별된다.
 *
 * ■ 보여주는 것
 *   상태 · 보상 처리 여부 · 미디어가 삭제됐는지(7일 규칙) · 접수 시각.
 *   "내 영상 어디 갔냐" 는 문의를 미리 막는 것이 media_purged_at 의 용도다.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const T = require('../_lib/newsTip');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('news_tips')
      .select('id, title, status, rewarded_at, media_purged_at, created_at, reviewed_at, media')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    /* media 는 **개수만** 세어서 내려준다. 경로를 그대로 내려주면 쓸 데도 없이
       비공개 버킷의 내부 구조가 밖으로 나간다. */
    const tips = (rows || []).map((r) => {
      const media = Array.isArray(r.media) ? r.media : [];
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        rewarded: !!r.rewarded_at,
        mediaPurged: !!r.media_purged_at,
        mediaPurgedAt: r.media_purged_at || null,
        mediaCount: media.length,
        videoCount: media.filter((m) => m && m.kind === 'video').length,
        created_at: r.created_at,
        reviewed_at: r.reviewed_at || null,
      };
    });

    return res.status(200).json({ tips, purgeAfterDays: T.PURGE_AFTER_DAYS });
  } catch (error) {
    console.error('[news-tips/mine] error:', error);
    return res.status(500).json({ message: 'Failed to load your tips.', code: 'fetch_failed' });
  }
};
