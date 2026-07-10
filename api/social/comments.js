/**
 * POST   /api/social/comments — 댓글 작성 (에디토리얼/기사)
 * DELETE /api/social/comments — 본인 댓글 삭제 (관리자는 모든 댓글)
 *
 * 배경(2026-07 보안 감사 A-2): comments 테이블의 "Anyone can delete" RLS가
 * anon 키만으로 전체 댓글 삭제를 허용했다. 프론트는 Supabase Auth 세션 없이
 * anon 키로 붙기 때문에(auth.uid() 없음) RLS로는 본인 검증이 불가능하다.
 * 그래서 쓰기 경로를 PAP JWT를 검증하는 이 엔드포인트로 옮기고
 * anon의 DELETE 정책은 회수했다. INSERT는 구버전 캐시 호환을 위해
 * WITH CHECK 강화 상태로 열어두되, 신버전 프론트는 여기로만 쓴다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const TARGET_TYPES = new Set(['editorial', 'article', 'film', 'short']);

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  // ── POST: 댓글 작성 ──
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const targetType = String(body.target_type || '');
      const targetId = String(body.target_id || '').slice(0, 300);
      const text = String(body.text || '').trim();
      const parentId = body.parent_id ? String(body.parent_id) : null;

      if (!TARGET_TYPES.has(targetType)) {
        return res.status(400).json({ message: 'Invalid target_type' });
      }
      if (!targetId) return res.status(400).json({ message: 'Missing target_id' });
      if (!text || text.length > 2000) {
        return res.status(400).json({ message: 'Comment must be 1-2000 characters' });
      }
      if (parentId && !/^[0-9a-f-]{36}$/i.test(parentId)) {
        return res.status(400).json({ message: 'Invalid parent_id' });
      }

      // 표시 이름은 DB 프로필 우선, 없으면 클라이언트 값(표시 전용) 폴백
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .single();

      const payload = {
        target_type: targetType,
        target_id: targetId,
        user_id: String(user.id),
        user_name: (profile && profile.display_name) || String(body.user_name || 'User').slice(0, 80),
        user_handle: body.user_handle ? String(body.user_handle).slice(0, 80) : null,
        text: text,
      };
      if (parentId) payload.parent_id = parentId;

      const { data, error } = await supabaseAdmin
        .from('comments')
        .insert([payload])
        .select()
        .single();
      if (error) throw error;

      return res.status(200).json({ comment: data });
    } catch (error) {
      console.error('[social/comments] insert error:', error);
      return res.status(500).json({ message: 'Failed to add comment' });
    }
  }

  // ── DELETE: 본인 댓글 삭제 (admin/staff는 전체) ──
  if (req.method === 'DELETE') {
    try {
      const id = String((req.body && req.body.id) || req.query.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return res.status(400).json({ message: 'Invalid comment id' });
      }

      const { data: existing } = await supabaseAdmin
        .from('comments')
        .select('id, user_id')
        .eq('id', id)
        .single();
      if (!existing) return res.status(404).json({ message: 'Comment not found' });

      let isAdmin = false;
      if (existing.user_id !== String(user.id)) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        isAdmin = !!profile && (profile.role === 'admin' || profile.role === 'staff');
        if (!isAdmin) return res.status(403).json({ message: 'Not your comment' });
      }

      const { error } = await supabaseAdmin.from('comments').delete().eq('id', id);
      if (error) throw error;

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('[social/comments] delete error:', error);
      return res.status(500).json({ message: 'Failed to delete comment' });
    }
  }

  return res.status(405).json({ message: 'Method not allowed' });
};
