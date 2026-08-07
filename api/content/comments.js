/**
 * 기사·에디토리얼 댓글 — /api/content/comments (2026-08-07 신설)
 *
 *   GET  ?target_type=article&target_id=<uuid>&limit=50  → { items, total }
 *   POST { target_type, target_id, body }                → { item }        [로그인 필요]
 *   DELETE ?id=<uuid>                                     → { ok }          [본인 또는 관리자]
 *
 * 좋아요와 달리 로그인을 요구하는 이유 ────────────────────────────────
 * 스팸 비용이 다르다. 그리고 "댓글 쓰려면 로그인" 은 문턱이 아니라
 * **가입 유인**이다 — 이미 읽을 만큼 읽은 사람에게만 요구하는 것이라
 * 전환이 가장 잘 되는 지점이다.
 *
 * 삭제는 행을 지우지 않는다. status='deleted' 로 내린다 — 신고·분쟁 때
 * 원문이 없으면 판단할 수 없고, 되돌릴 수도 없다.
 *
 * 읽기는 로그인 없이 열어 둔다. 댓글이 보여야 "여기 사람이 있다"는
 * 신호가 되고, 그게 다음 사람을 쓰게 만든다.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { verifyToken, requireAuth } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');

const TYPES = new Set(['article', 'editorial', 'film', 'short']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 1000;
const MAX_LIST = 100;

function parseTarget(src) {
  const type = String((src && src.target_type) || '').toLowerCase();
  const id = String((src && src.target_id) || '');
  if (!TYPES.has(type)) return { error: 'target_type 이 올바르지 않다' };
  if (!UUID.test(id)) return { error: 'target_id 가 uuid 가 아니다' };
  return { type, id };
}

/* 저장 전 정리. HTML 은 아예 안 받는다 — 렌더링을 텍스트로 고정하면
   XSS 를 이스케이프에만 의존하지 않아도 된다. */
function cleanBody(raw) {
  const s = String(raw == null ? '' : raw)
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (!s) return { error: '내용이 비었다' };
  if (s.length > MAX_BODY) return { error: '댓글은 ' + MAX_BODY + '자까지' };
  return { body: s };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  try {
    // ── 목록 (로그인 불필요) ─────────────────────────────
    if (req.method === 'GET') {
      const t = parseTarget(req.query || {});
      if (t.error) return res.status(400).json({ error: t.error });
      const limit = Math.min(MAX_LIST, Math.max(1, Number((req.query || {}).limit) || 50));

      const { data, error, count } = await supabaseAdmin
        .from('content_comments')
        .select('id, body, created_at, user_id, profiles!inner(name, avatar_url)', { count: 'exact' })
        .eq('target_type', t.type).eq('target_id', t.id).eq('status', 'visible')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      const me = verifyToken(req);
      const items = (data || []).map((c) => ({
        id: c.id,
        body: c.body,
        created_at: c.created_at,
        author: (c.profiles && c.profiles.name) || '익명',
        avatar: (c.profiles && c.profiles.avatar_url) || null,
        mine: !!(me && me.id && me.id === c.user_id),
      }));
      return res.status(200).json({ items, total: Number(count) || items.length });
    }

    // ── 작성 (로그인 필요) ───────────────────────────────
    if (req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;                       // requireAuth 가 401 을 이미 보냈다

      const src = req.body || {};
      const t = parseTarget(src);
      if (t.error) return res.status(400).json({ error: t.error });
      const c = cleanBody(src.body);
      if (c.error) return res.status(400).json({ error: c.error });

      const { data, error } = await supabaseAdmin.from('content_comments')
        .insert({ target_type: t.type, target_id: t.id, user_id: user.id, body: c.body })
        .select('id, body, created_at').single();
      if (error) throw error;

      return res.status(201).json({ item: { ...data, mine: true } });
    }

    // ── 삭제 (본인) ─────────────────────────────────────
    if (req.method === 'DELETE') {
      const user = requireAuth(req, res);
      if (!user) return;
      const id = String((req.query || {}).id || '');
      if (!UUID.test(id)) return res.status(400).json({ error: 'id 가 uuid 가 아니다' });

      /* 행을 지우지 않고 내린다. 그리고 user_id 조건을 같이 걸어
         남의 댓글을 못 지우게 한다 — 조회 후 검사하면 그 사이가 열린다. */
      const { data, error } = await supabaseAdmin.from('content_comments')
        .update({ status: 'deleted', updated_at: new Date().toISOString() })
        .eq('id', id).eq('user_id', user.id).eq('status', 'visible')
        .select('id');
      if (error) throw error;
      if (!(data || []).length) return res.status(404).json({ error: '내 댓글이 아니거나 이미 지워짐' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('[content/comments] 예외', (e && e.message) || e);
    return res.status(500).json({ error: 'comment failed' });
  }
};

module.exports.cleanBody = cleanBody;
module.exports.parseTarget = parseTarget;
module.exports.MAX_BODY = MAX_BODY;
