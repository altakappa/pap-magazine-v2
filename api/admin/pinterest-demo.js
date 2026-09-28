/**
 * /api/admin/pinterest-demo — 핀터레스트 승급 재심사 데모 (관리자 전용, 2026-09-28)
 *
 * 화면: frontend/pinterest-demo.html (/pinterest-demo). 규칙과 이유는 api/_lib/pinterestDemo.js 머리말.
 *
 *   GET  ?step=status     → 준비 상태(비밀값은 있다/없다만), 등록해야 할 redirect URI
 *   GET  ?step=authorize  → 핀터레스트 OAuth 승인 URL (서명된 state 포함)
 *   POST ?step=exchange   {code,state} → 토큰 교환 + user_account 조회. 토큰은 돌려주지 않는다.
 *   GET  ?step=preview    → 데모에 쓸 최신 에디토리얼 1건
 *   POST ?step=pin        → 샌드박스 보드 확보 + POST /v5/pins. 요청(이미지 제외)·응답·핀 URL 반환
 *
 * 실서비스 발행과 무관하다. 샌드박스 토큰(PINTEREST_SANDBOX_TOKEN)만 핀 생성에 쓴다.
 */
'use strict';
const { requireAdmin } = require('../_lib/auth');
const { supabaseAdmin } = require('../_lib/supabase');
const D = require('../_lib/pinterestDemo');

async function pinFetch(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(20000) }, opts || {}));
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
}

async function latestEditorial() {
  const { data, error } = await supabaseAdmin.from('editorials')
    .select('slug,title,cover_image,thumbnail,issue,published_date')
    .eq('status', 'published').not('cover_image', 'is', null)
    .order('published_date', { ascending: false }).limit(10);
  if (error) throw error;
  return (data || []).find((e) => /^https?:\/\//.test(e.cover_image || '')) || null;
}

/* 샌드박스는 외부 이미지 URL 을 못 가져온다(2787, 8/14 실측). 서버가 받아 base64 로 싣는다. */
async function loadImage(ed) {
  const cands = [ed.cover_image, ed.thumbnail].filter((u) => /^https?:\/\//.test(u || ''));
  for (const u of cands) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const type = String(r.headers.get('content-type') || '').split(';')[0].trim();
      if (!/^image\/(jpeg|png)$/.test(type)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 10 * 1024 * 1024) continue;
      return { contentType: type, base64: buf.toString('base64') };
    } catch (_e) { /* 다음 후보 */ }
  }
  return null;
}

async function ensureSandboxBoard(token) {
  const auth = { Authorization: 'Bearer ' + token };
  const list = await pinFetch(D.SANDBOX_API + '/boards?page_size=100', { headers: auth });
  if (!list.ok) return { error: 'boards ' + list.status + ' ' + JSON.stringify(list.body).slice(0, 160) };
  const found = (list.body.items || []).find((b) => b && b.name === D.DEMO_BOARD_NAME);
  if (found) return { board: found };
  const made = await pinFetch(D.SANDBOX_API + '/boards', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
    body: JSON.stringify({ name: D.DEMO_BOARD_NAME, description: 'Editorials from pap-magazine.com', privacy: 'PUBLIC' }),
  });
  if (!made.ok) return { error: 'create board ' + made.status + ' ' + JSON.stringify(made.body).slice(0, 160) };
  return { board: made.body };
}

module.exports = async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  res.setHeader('Cache-Control', 'no-store');

  const q = req.query || {};
  const step = String(q.step || '');
  const secret = D.cleanCred(process.env.PINTEREST_APP_SECRET);
  const sandboxToken = D.cleanCred(process.env.PINTEREST_SANDBOX_TOKEN);

  try {
    if (step === 'status') {
      return res.status(200).json({
        app_id: D.appId(),
        has_app_secret: !!secret,
        has_sandbox_token: !!sandboxToken,
        redirect_uri: D.REDIRECT_URI,
        scopes: D.SCOPES,
      });
    }

    if (step === 'authorize') {
      if (!secret) return res.status(503).json({ error: 'PINTEREST_APP_SECRET is not set' });
      return res.status(200).json({ url: D.authorizeUrl(D.signState(secret)) });
    }

    if (step === 'exchange') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      const b = req.body || {};
      if (!secret) return res.status(503).json({ error: 'PINTEREST_APP_SECRET is not set' });
      if (!b.code || !D.verifyState(b.state, secret)) {
        return res.status(400).json({ error: 'Invalid or expired state. Press "Connect Pinterest" again.' });
      }
      const tok = await pinFetch(D.PROD_API + '/oauth/token', {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(D.appId() + ':' + secret).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: String(b.code), redirect_uri: D.REDIRECT_URI }).toString(),
      });
      if (!tok.ok || !tok.body.access_token) {
        return res.status(502).json({ error: 'Token exchange failed (' + tok.status + ')', detail: JSON.stringify(tok.body).slice(0, 200) });
      }
      const me = await pinFetch(D.PROD_API + '/user_account', { headers: { Authorization: 'Bearer ' + tok.body.access_token } });
      return res.status(200).json({
        connected: true,
        token_type: tok.body.token_type || 'bearer',
        scope: tok.body.scope || '',
        expires_in: tok.body.expires_in || null,
        username: (me.ok && me.body && me.body.username) || null,
        account_type: (me.ok && me.body && me.body.account_type) || null,
      });
    }

    if (step === 'preview') {
      const ed = await latestEditorial();
      if (!ed) return res.status(404).json({ error: 'No published editorial found' });
      return res.status(200).json({ editorial: { slug: ed.slug, title: ed.title, issue: ed.issue || null, image: ed.thumbnail || ed.cover_image, url: D.SITE + '/editorial/' + encodeURIComponent(ed.slug) } });
    }

    if (step === 'pin') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      if (!sandboxToken) return res.status(503).json({ error: 'PINTEREST_SANDBOX_TOKEN is not set' });
      const ed = await latestEditorial();
      if (!ed) return res.status(404).json({ error: 'No published editorial found' });
      const img = await loadImage(ed);
      if (!img) return res.status(502).json({ error: 'Cover image could not be loaded (JPEG/PNG only)' });
      const bd = await ensureSandboxBoard(sandboxToken);
      if (bd.error) return res.status(502).json({ error: bd.error });
      const payload = D.buildPinPayload(ed, bd.board.id, img);
      const endpoint = D.SANDBOX_API + '/pins';
      const r = await pinFetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + sandboxToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const pin = r.body || {};
      return res.status(r.ok ? 200 : 502).json({
        request: { method: 'POST', url: endpoint, body: D.redactPayload(payload) },
        response: { status: r.status, body: { id: pin.id, board_id: pin.board_id, title: pin.title, link: pin.link, created_at: pin.created_at, code: pin.code, message: pin.message } },
        board: { id: bd.board.id, name: bd.board.name },
        pin_url: pin.id ? D.pinUrl(pin.id) : null,
      });
    }

    return res.status(400).json({ error: 'step=status|authorize|exchange|preview|pin' });
  } catch (e) {
    console.error('[pinterest-demo]', step, (e && e.message) || e);
    return res.status(500).json({ error: String((e && e.message) || e).slice(0, 200) });
  }
};
