/**
 * 기사·에디토리얼 좋아요 — /api/content/react (2026-08-07 신설)
 *
 *   GET  ?target_type=article&target_id=<uuid>   → { count, mine }
 *   POST { target_type, target_id }              → 토글 후 { count, mine }
 *
 * 왜 로그인을 안 받나 ────────────────────────────────────────────────
 * 진단(2026-08-07): 회원 857명 · 최근 30일 신규 278명인데 커뮤니티
 * 좋아요·댓글·글이 **역대 0건**이었다. 기사 페이지에서 할 수 있는 온사이트
 * 액션이 스크랩 하나뿐이었기 때문이다.
 *
 * 여기서 로그인까지 요구하면 결과는 뻔하다. 좋아요는 참여의 **첫 계단**이라
 * 문턱이 0 이어야 한다. 대신 중복은 막는다:
 *     로그인   actor_key = 'u:<user_id>'
 *     비로그인 actor_key = 'ip:<ip_hash>'
 *
 * ⚠️ 비로그인 집계는 완벽하지 않다. 같은 회선의 여러 사람은 한 명으로,
 *    모바일 IP 가 바뀌면 같은 사람이 여러 번으로 잡힌다. 그래도 '정확한 0'
 *    보다 '대략 맞는 숫자'가 낫다 — 이건 지표가 아니라 사회적 증거다.
 *
 * PAP_IP_HASH_SALT 가 없으면 hashIp 가 약해진다(clickGuard 참고).
 * 그래도 동작은 시킨다 — 좋아요가 안 눌리는 것보다 낫다.
 */

'use strict';

const { supabaseAdmin } = require('../_lib/supabase');
const { verifyToken } = require('../_lib/auth');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { extractClientIp, hashIp, isLikelyBot } = require('../_lib/clickGuard');

const TYPES = new Set(['article', 'editorial', 'film', 'short']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actorKeyFor(req) {
  const user = verifyToken(req);
  if (user && user.id) return { key: 'u:' + user.id, userId: user.id };
  return { key: 'ip:' + hashIp(extractClientIp(req)), userId: null };
}

function parseTarget(src) {
  const type = String((src && src.target_type) || '').toLowerCase();
  const id = String((src && src.target_id) || '');
  if (!TYPES.has(type)) return { error: 'target_type 이 올바르지 않다' };
  if (!UUID.test(id)) return { error: 'target_id 가 uuid 가 아니다' };
  return { type, id };
}

async function readState(type, id, actorKey) {
  const [{ count }, mineRes] = await Promise.all([
    supabaseAdmin.from('content_reactions')
      .select('id', { count: 'exact', head: true })
      .eq('target_type', type).eq('target_id', id).eq('kind', 'like'),
    supabaseAdmin.from('content_reactions')
      .select('id')
      .eq('target_type', type).eq('target_id', id).eq('kind', 'like')
      .eq('actor_key', actorKey).maybeSingle(),
  ]);
  return { count: Number(count) || 0, mine: !!(mineRes && mineRes.data) };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const t = parseTarget(req.method === 'POST' ? (req.body || {}) : (req.query || {}));
  if (t.error) return res.status(400).json({ error: t.error });

  const { key: actorKey, userId } = actorKeyFor(req);

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await readState(t.type, t.id, actorKey));
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

    /* 크롤러가 누른 것은 세지 않는다. 조용히 현재 상태만 돌려준다 —
       403 을 주면 봇이 재시도하고 로그만 지저분해진다. */
    if (isLikelyBot(req.headers['user-agent'])) {
      return res.status(200).json(await readState(t.type, t.id, actorKey));
    }

    /* 토글. 먼저 넣어 보고 유니크에 걸리면 이미 누른 것이므로 지운다.
       읽고 나서 쓰면 그 사이에 두 번 눌린다 — 오늘 드라이브 경로에서
       똑같은 경합으로 영상이 두 번 올라갔다(driveClaim.js 참고). */
    const ins = await supabaseAdmin.from('content_reactions')
      .insert({ target_type: t.type, target_id: t.id, kind: 'like', user_id: userId, actor_key: actorKey });

    if (ins.error) {
      const dup = ins.error.code === '23505' || /duplicate key/i.test(String(ins.error.message || ''));
      if (!dup) {
        console.error('[content/react] insert 실패', ins.error.message);
        return res.status(500).json({ error: '기록 실패' });
      }
      const del = await supabaseAdmin.from('content_reactions').delete()
        .eq('target_type', t.type).eq('target_id', t.id).eq('kind', 'like').eq('actor_key', actorKey);
      if (del.error) {
        console.error('[content/react] delete 실패', del.error.message);
        return res.status(500).json({ error: '취소 실패' });
      }
    }

    return res.status(200).json(await readState(t.type, t.id, actorKey));
  } catch (e) {
    console.error('[content/react] 예외', (e && e.message) || e);
    return res.status(500).json({ error: 'reaction failed' });
  }
};

module.exports.TYPES = TYPES;
module.exports.actorKeyFor = actorKeyFor;
module.exports.parseTarget = parseTarget;
