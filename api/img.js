/**
 * PAP Magazine — 원본 보존 이미지 프록시
 * Route: GET /api/img?u=<encoded URL>
 *
 * 용도: TikTok PULL_FROM_URL 등 "소유권 인증된 도메인 + 원본 포맷(JPEG)"이
 * 동시에 필요한 소비자. Vercel 이미지 최적화(_vercel/image)는 Accept 협상으로
 * AVIF/WebP 를 반환해 TikTok 의 picture_size_check 에서 거부된다 — 이 프록시는
 * 허용 호스트의 원본 바이트를 Content-Type 그대로 중계한다.
 */

const ALLOWED_HOSTS = new Set([
  'pap-korea-bucket.s3.ap-northeast-2.amazonaws.com',
  'igcazquhkwxtqsaqpznx.supabase.co',
  'www.pap-magazine.com',
]);

module.exports = async function handler(req, res) {
  try {
    const u = req.query && req.query.u;
    if (!u) return res.status(400).json({ error: 'u 파라미터 필요' });
    let url;
    try { url = new URL(String(u)); } catch (_) { return res.status(400).json({ error: '잘못된 URL' }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
      return res.status(403).json({ error: '허용되지 않은 호스트' });
    }

    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return res.status(502).json({ error: 'origin ' + r.status });
    const ct = r.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//.test(ct)) return res.status(415).json({ error: '이미지 아님: ' + ct });

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('[img-proxy] error:', err);
    return res.status(500).json({ error: 'proxy failed' });
  }
};
