/**
 * GET /api/submissions/collaborator-check?handle=@xxx
 *
 * 서브미션 폼의 공동작업자 칸이 아이디를 적을 때마다 묻는다: "이 인스타그램 아이디,
 * PAP 프리미엄 회원인가?" (도메니코 정책 2026-09-12 — 공동작업자는 프리미엄 회원만.)
 *
 * 응답: { handle, registered, premium }
 *   · registered=false → 그 아이디를 마이페이지에 등록한 회원이 없다
 *   · premium=false    → 등록은 돼 있지만 프리미엄이 아니다(또는 만료)
 * 이름·이메일 등 다른 정보는 절대 내려주지 않는다 — 프리미엄 여부 하나만.
 * 로그인한 사용자만(제출자가 폼 안에서 쓰는 용도), 일반 레이트리밋.
 * 최종 판정은 POST/PUT 이 같은 lib 로 다시 한다 — 이 응답은 안내용이다.
 */
'use strict';
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAuth } = require('../_lib/auth');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { normalizeHandle, lookupHandles, MAX_COLLABORATORS } = require('../_lib/collaborators');

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
    const found = await lookupHandles(supabaseAdmin, [handle]);
    const hit = found[handle];
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      handle,
      registered: !!hit,
      premium: !!(hit && hit.premium),
      // 주요 활동 도시·국가 — 프리미엄 회원이 공동작업자 지정용으로 직접 등록한 값. 같은 이름의 다른 사람이 아닌지 확인하라고 보여준다.
      location: (hit && hit.premium && hit.location) ? hit.location : '',
      max: MAX_COLLABORATORS,
    });
  } catch (err) {
    console.error('[collaborator-check] error', err);
    return res.status(500).json({ message: 'Failed to check collaborator' });
  }
};
