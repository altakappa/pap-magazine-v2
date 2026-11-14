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
const { verifyToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { extractClientIp, hashIp, isLikelyBot } = require('../_lib/clickGuard');

const TYPES = new Set(['article', 'editorial', 'film', 'short']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 1000;
const MAX_LIST = 100;
const MAX_NICK = 20;
const MAX_BRAND = 40;
const MAX_ITEM = 80;
/* 비로그인 쓰기는 더 좁게 — 한 IP 에서 분당 5건. 사람은 그보다 느리고 스크립트는 그보다 빠르다. */
const ANON_WRITE_LIMIT = { limit: 5, windowMs: 60 * 1000 };

/* ── 2026-11-14 — 쓰기에서 로그인 요구를 뺀다 (도메니코 결정 "익명 허용") ──
   실측 3개월: 기사 조회 월 약 17만(봇 제외), 로그인 상태 조회 주 0~6건, 댓글 0건.
   "댓글 쓰려면 로그인" 은 벽 앞에 사람이 있을 때만 가입 유인이다. 아무도 없었다.
   별점(social/ratings.js 08-12)과 같은 방침·같은 방식:
     주인은 서버가 정한다 — 로그인 user_id='<uuid>' / 비로그인 anon_key='ip:<hash>'.
     클라이언트가 보낸 식별자는 절대 안 쓴다. 비로그인은 자기 IP 해시 행만 지울 수 있다.
   비로그인은 닉네임(2~20자)을 받는다. 없으면 '익명'.
   '착장 식별'(kind='outfit'): brand(필수)·item(선택). 브랜드가 기사 태그와 맞으면
   verified=true 로 표시한다 — "저거 어디 거?" 의 답이 맞았다는 신호. */
function actorFor(req) {
  const user = verifyToken(req);
  if (user && user.id) return { userId: String(user.id), anonKey: null, anon: false };
  return { userId: null, anonKey: 'ip:' + hashIp(extractClientIp(req)), anon: true };
}

function cleanShort(raw, max) {
  const s = String(raw == null ? '' : raw).replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.slice(0, max);
}

/* 브랜드가 기사 태그와 맞나 — 대소문자·공백·점·하이픈 무시. "Saint Laurent" ≈ "saintlaurent". */
function normBrand(s) { return String(s || '').toLowerCase().replace(/[\s.\-_&'’]/g, ''); }
function brandMatchesTags(brand, tags) {
  const b = normBrand(brand);
  if (!b || b.length < 2) return false;
  return (Array.isArray(tags) ? tags : []).some((t) => { const n = normBrand(t); return n && (n === b || n.includes(b) || b.includes(n)) && Math.min(n.length, b.length) >= 3; });
}

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

      /* profiles 는 left join — !inner 였을 땐 비로그인 댓글(user_id null)이 통째로 빠진다 (2026-11-14) */
      const { data, error, count } = await supabaseAdmin
        .from('content_comments')
        .select('id, body, created_at, user_id, anon_key, nickname, kind, brand, item, verified, profiles(name, avatar_url)', { count: 'exact' })
        .eq('target_type', t.type).eq('target_id', t.id).eq('status', 'visible')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      const me = actorFor(req);
      const items = (data || []).map((c) => ({
        id: c.id,
        body: c.body,
        created_at: c.created_at,
        author: (c.profiles && c.profiles.name) || c.nickname || '익명',
        avatar: (c.profiles && c.profiles.avatar_url) || null,
        kind: c.kind || 'text',
        brand: c.brand || null,
        item: c.item || null,
        verified: !!c.verified,
        mine: me.userId ? me.userId === c.user_id : (!!c.anon_key && c.anon_key === me.anonKey),
      }));
      const outfits = items.filter((i) => i.kind === 'outfit').length;
      return res.status(200).json({ items, total: Number(count) || items.length, outfits });
    }

    // ── 작성 (로그인 불필요, 2026-11-14) ─────────────────────
    if (req.method === 'POST') {
      const actor = actorFor(req);
      if (actor.anon) {
        if (isLikelyBot(req.headers && req.headers['user-agent'])) return res.status(403).json({ error: 'bot' });
        if (rateLimit(req, res, ANON_WRITE_LIMIT)) return;
      }

      const src = req.body || {};
      const t = parseTarget(src);
      if (t.error) return res.status(400).json({ error: t.error });
      const kind = String(src.kind || 'text').toLowerCase() === 'outfit' ? 'outfit' : 'text';
      const brand = kind === 'outfit' ? cleanShort(src.brand, MAX_BRAND) : '';
      const item = kind === 'outfit' ? cleanShort(src.item, MAX_ITEM) : '';
      if (kind === 'outfit' && brand.length < 2) return res.status(400).json({ error: '브랜드를 적어주세요' });
      /* 착장 식별은 본문이 비어도 된다 — 브랜드·아이템이 곧 내용이다. */
      const c = cleanBody(src.body || (kind === 'outfit' ? [brand, item].filter(Boolean).join(' · ') : ''));
      if (c.error) return res.status(400).json({ error: c.error });
      const nickname = actor.anon ? (cleanShort(src.nickname, MAX_NICK) || null) : null;

      let verified = false;
      if (kind === 'outfit' && t.type === 'article') {
        try {
          const { data: art } = await supabaseAdmin.from('articles').select('tags').eq('id', t.id).maybeSingle();
          verified = brandMatchesTags(brand, art && art.tags);
        } catch (_e) { /* 확인 실패는 '미확인' 으로 — 댓글 자체를 막지 않는다 */ }
      }

      const row = {
        target_type: t.type, target_id: t.id, body: c.body,
        user_id: actor.userId, anon_key: actor.anonKey, nickname,
        kind, brand: brand || null, item: item || null, verified,
      };
      const { data, error } = await supabaseAdmin.from('content_comments')
        .insert(row).select('id, body, created_at, kind, brand, item, verified').single();
      if (error) throw error;

      return res.status(201).json({ item: { ...data, mine: true, anon: actor.anon } });
    }

    // ── 삭제 (본인 — 로그인은 user_id, 비로그인은 anon_key) ──────
    if (req.method === 'DELETE') {
      const actor = actorFor(req);
      const id = String((req.query || {}).id || '');
      if (!UUID.test(id)) return res.status(400).json({ error: 'id 가 uuid 가 아니다' });

      /* 행을 지우지 않고 내린다. 그리고 주인 조건을 같이 걸어
         남의 댓글을 못 지우게 한다 — 조회 후 검사하면 그 사이가 열린다. */
      let q = supabaseAdmin.from('content_comments')
        .update({ status: 'deleted', updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'visible');
      q = actor.userId ? q.eq('user_id', actor.userId) : q.eq('anon_key', actor.anonKey);
      const { data, error } = await q.select('id');
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
module.exports.cleanShort = cleanShort;
module.exports.brandMatchesTags = brandMatchesTags;
module.exports.actorFor = actorFor;
module.exports.ANON_WRITE_LIMIT = ANON_WRITE_LIMIT;
