/**
 * GET /api/submissions/collaborator-check?handle=@xxx
 *
 * 서브미션 폼의 공동작업자 칸이 아이디를 적을 때마다 묻는다: "이 인스타그램 아이디,
 * PAP 회원인가?" (도메니코 정책 2026-09-24 — 지정받는 쪽은 무료 회원이어도 된다.
 * 지정하는 쪽(로그인한 제출자)은 연간 프리미엄이어야 한다 → canPick.)
 *
 * 응답: { handle, registered, member, canPick, max }
 *   · registered=member=false → 그 아이디를 마이페이지에 등록한 회원이 없다
 *   · canPick=false → 지금 로그인한 사람은 연간 프리미엄이 아니라 고를 수 없다
 * 이름·이메일·등급 등 다른 정보는 절대 내려주지 않는다 — 회원 여부 하나만.
 * 로그인한 사용자만(제출자가 폼 안에서 쓰는 용도), 일반 레이트리밋.
 * 최종 판정은 POST/PUT 이 같은 lib 로 다시 한다 — 이 응답은 안내용이다.
 */
'use strict';
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAuth } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { normalizeHandle, lookupHandles, canPickCollaborators, MAX_COLLABORATORS } = require('../_lib/collaborators');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const raw = (req.query && req.query.handle) || '';
  const handle = normalizeHandle(raw);
  if (!handle) {
    return res.status(400).json({ code: 'COLLAB_HANDLE_INVALID', message: 'Invalid Instagram handle', handle: String(raw).slice(0, 60) });
  }
  try {
    const [found, canPick] = await Promise.all([
      lookupHandles(supabaseAdmin, [handle]),
      canPickCollaborators(supabaseAdmin, { userId: user.id, isAdmin: user.role === 'admin' }),
    ]);
    const hit = found[handle];
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      handle,
      registered: !!hit,
      member: !!hit,
      canPick: !!canPick,
      max: MAX_COLLABORATORS,
    });
  } catch (err) {
    console.error('[collaborator-check] error', err);
    return res.status(500).json({ message: 'Failed to check collaborator' });
  }
};
