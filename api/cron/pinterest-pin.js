/**
 * GET /api/cron/pinterest-pin — 에디토리얼 → 핀터레스트 자동 핀 (2026-07-27 신설)
 *
 * 왜: 외부 유입 확장 (도메니코 "전부 순차적으로 진행하자" — FeedSpot 유료 등재
 * 대신 무료 채널). 패션 화보는 핀터레스트에서 수명이 길고 이미지 검색 유입이
 * 계속 쌓인다. 발행된 에디토리얼의 커버를 원문 링크와 함께 핀으로 올린다.
 *
 * 설계 (celeb-watch 네이버 연동과 동일 철학):
 * - PINTEREST_ACCESS_TOKEN / PINTEREST_BOARD_ID 없으면 조용히 스킵 —
 *   배포 순서 자유, 비밀값 입력은 도메니코 직접.
 * - 실행당 최대 PINS_PER_RUN(기본 1)개 — 신규 계정 스팸 판정 방지.
 *   최신 발행분부터, 이미 핀한 것은 pinterest_pin_log(unique slug+image)로 제외.
 * - 실패해도 던지지 않고 로그만 — 다음 실행이 재시도.
 * 수동: 관리자 토큰, ?dry=1 미리보기, ?max=N.
 */
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');

const SITE = 'https://www.pap-magazine.com';

function cleanCred(v) {
  return String(v || '').replace(/[\r\n\t]/g, '').trim().replace(/^["']+|["']+$/g, '').trim();
}

/**
 * 액세스 토큰은 30일이면 만료된다. 만료 때마다 도메니코가 OAuth 를 다시 도는 건
 * 지속 불가능하므로, 401 이 나면 리프레시 토큰으로 새 토큰을 받아 1회 재시도한다.
 * (리프레시 토큰은 60일 — 그건 만료 전에 수동 갱신 필요. 볼트에 기록.)
 * 새 토큰은 이 인스턴스 메모리에만 둔다. Vercel 환경변수는 코드가 못 바꾸고,
 * 비밀값 입력은 도메니코 직접이라는 원칙도 그대로 지킨다.
 */
let _memToken = null;

async function refreshAccessToken() {
  const appId = cleanCred(process.env.PINTEREST_APP_ID) || '1587332';
  const secret = cleanCred(process.env.PINTEREST_APP_SECRET);
  const refresh = cleanCred(process.env.PINTEREST_REFRESH_TOKEN);
  if (!secret || !refresh) return null;
  const r = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(appId + ':' + secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) {
    console.warn('[pinterest-pin] 토큰 갱신 실패:', r.status, JSON.stringify(body).slice(0, 140));
    return null;
  }
  _memToken = body.access_token;
  console.log('[pinterest-pin] 액세스 토큰 갱신 성공 (메모리)');
  return _memToken;
}

async function postPin(token, payload) {
  const r = await fetch('https://api.pinterest.com/v5/pins', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
}

async function createPin({ token, boardId, title, description, link, imageUrl }) {
  const payload = {
    board_id: boardId,
    title: String(title || '').slice(0, 100),
    description: String(description || '').slice(0, 780),
    link,
    media_source: { source_type: 'image_url', url: imageUrl },
  };
  let res = await postPin(_memToken || token, payload);
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await postPin(fresh, payload);
  }
  if (!res.ok) throw new Error('pinterest ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 140));
  return res.body && res.body.id;
}

module.exports = withCronGuard('pinterest-pin', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) { const u = await requireAdmin(req, res); if (!u) return; }

  const token = cleanCred(process.env.PINTEREST_ACCESS_TOKEN);
  const boardId = cleanCred(process.env.PINTEREST_BOARD_ID);
  if (!token || !boardId) {
    return res.status(200).json({ ok: true, note: 'PINTEREST_ACCESS_TOKEN/BOARD_ID 미설정 — 스킵' });
  }

  const dry = !!(req.query && req.query.dry === '1');
  const PINS_PER_RUN = Math.max(1, Math.min(5, parseInt((req.query && req.query.max) || '1', 10) || 1));

  try {
    /* 후보: 발행된 에디토리얼 최신순. 이미 핀한 slug 는 제외. */
    const { data: eds, error } = await supabaseAdmin.from('editorials')
      .select('slug,title,cover_image,thumbnail,issue,published_date')
      .eq('status', 'published').not('cover_image', 'is', null)
      .order('published_date', { ascending: false }).limit(120);
    if (error) throw error;

    const slugs = (eds || []).map(e => e.slug);
    const { data: logged } = await supabaseAdmin.from('pinterest_pin_log')
      .select('slug').in('slug', slugs.length ? slugs : ['-']);
    const done = new Set((logged || []).map(l => l.slug));

    const todo = (eds || []).filter(e => !done.has(e.slug) && /^https?:\/\//.test(e.cover_image || '')).slice(0, PINS_PER_RUN);
    if (!todo.length) return res.status(200).json({ ok: true, note: '핀할 신규 에디토리얼 없음' });

    if (dry) {
      return res.status(200).json({ ok: true, dry: true, todo: todo.map(e => e.slug) });
    }

    const results = [];
    for (const e of todo) {
      /* 2026-07-31: '/slug' 는 '/editorial/slug' 로 301 된다 — 핀 링크는 최종 URL 로. */
      const link = SITE + '/editorial/' + encodeURIComponent(e.slug);
      const desc = [e.title, e.issue ? 'PAP MAGAZINE · ' + e.issue : 'PAP MAGAZINE',
        'Fashion editorial — full story:', link].filter(Boolean).join('\n');
      try {
        const pinId = await createPin({
          token, boardId, title: e.title, description: desc, link, imageUrl: e.cover_image,
        });
        await supabaseAdmin.from('pinterest_pin_log').insert({
          slug: e.slug, kind: 'editorial', image_url: e.cover_image, pin_id: pinId || null,
        });
        results.push({ slug: e.slug, pin_id: pinId || null, ok: true });
      } catch (err) {
        console.warn('[pinterest-pin] 실패:', e.slug, (err && err.message) || err);
        results.push({ slug: e.slug, ok: false, error: ((err && err.message) || '').slice(0, 140) });
      }
    }
    return res.status(200).json({ ok: true, pinned: results.filter(r => r.ok).length, results });
  } catch (err) {
    console.error('[pinterest-pin] error:', err);
    throw err;
  }
});
