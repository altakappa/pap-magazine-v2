/**
 * /api/articles/:id/outfit — "이 착장 어디 거?" (2026-11-14 신설)
 *
 *   GET                                  → { items: [...] }            로그인 불필요
 *   POST { action:'vote', item_id, vote:1|-1 }   맞아요/아니에요        로그인 불필요 (1인 1표: 회원 id 또는 ip 해시)
 *   POST { action:'propose', brand, product?, url? }  알려주기          로그인 필요 (댓글과 같은 규칙 = 가입 유인)
 *   POST { action:'set', item_id, status }       관리자 확정/숨김       admin/staff
 *
 * 투표가 로그인 불필요인 이유: 참여 문턱이 0 이어야 첫 100표가 쌓인다. ip 해시는
 * content/react(좋아요)와 같은 규칙이라 같은 사람이 같은 창구로 센다.
 * 봇은 세지 않는다(isLikelyBot). 실패는 500 한 줄 — 화면은 조용히 넘어간다.
 */
'use strict';

const { supabaseAdmin } = require('../../_lib/supabase');
const { verifyToken, requireAuth, requireAdmin } = require('../../_lib/auth');
const { handleCors } = require('../../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../../_lib/rateLimit');
const { extractClientIp, hashIp, isLikelyBot } = require('../../_lib/clickGuard');
const outfit = require('../../_lib/outfitItems');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actorKeyFor(req) {
  const user = verifyToken(req);
  if (user && user.id) return 'u:' + user.id;
  return 'ip:' + hashIp(extractClientIp(req));
}

/* brands 사전은 함수 인스턴스 안에서 재사용 (콜드스타트마다 1회, 5,500행) */
let _brandIdx = null;
async function brandIndex() {
  if (!_brandIdx) _brandIdx = await outfit.loadBrandIndex();
  return _brandIdx;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;
  const articleId = String((req.query && req.query.id) || '');
  if (!UUID.test(articleId)) return res.status(400).json({ error: 'id 가 uuid 가 아니다' });

  try {
    if (req.method === 'GET') {
      const items = await outfit.listForArticle(articleId, actorKeyFor(req));
      return res.status(200).json({ items, confirm_yes: outfit.CONFIRM_YES });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

    const body = req.body || {};
    const action = String(body.action || '');

    if (action === 'vote') {
      if (isLikelyBot(req.headers && req.headers['user-agent'])) return res.status(204).end();
      const itemId = String(body.item_id || '');
      if (!UUID.test(itemId)) return res.status(400).json({ error: 'item_id' });
      const v = Number(body.vote) > 0 ? 1 : -1;
      /* 항목이 이 기사 것인지 확인 — 남의 기사 항목에 투표하는 경로를 막는다 */
      const { data: own } = await supabaseAdmin.from('article_outfit_items').select('id').eq('id', itemId).eq('article_id', articleId).maybeSingle();
      if (!own) return res.status(404).json({ error: '항목 없음' });
      const r = await outfit.vote(itemId, actorKeyFor(req), v);
      return res.status(200).json({ item: r });
    }

    if (action === 'propose') {
      const user = requireAuth(req, res);
      if (!user) return;
      const r = await outfit.propose(articleId, user, body, await brandIndex());
      if (r.error) return res.status(400).json({ error: r.error });
      return res.status(r.existed ? 200 : 201).json({ item: r.item, existed: !!r.existed });
    }

    if (action === 'set') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const itemId = String(body.item_id || '');
      if (!UUID.test(itemId)) return res.status(400).json({ error: 'item_id' });
      const r = await outfit.setStatus(itemId, String(body.status || ''));
      if (r.error) return res.status(400).json({ error: r.error });
      return res.status(200).json({ item: r });
    }

    return res.status(400).json({ error: 'action' });
  } catch (e) {
    console.error('[articles/outfit] 예외', (e && e.message) || e);
    return res.status(500).json({ error: 'outfit failed' });
  }
};
