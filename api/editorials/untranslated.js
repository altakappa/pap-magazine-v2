/**
 * GET /api/editorials/untranslated?lang=de
 *   → { lang, count, slugs: [...], ids: [...] }
 *
 * 무엇: 해당 언어의 번역이 **없는** 발행 에디토리얼 목록(예외 목록).
 *
 * 왜: 프론트가 만드는 카드 앵커 <a href="/editorial/<slug>"> 가 /en·/ja 등
 * 비한국어 페이지에서도 언어 접두어를 잃어, 크롤러가 JS 실행 후 보는 내부
 * 링크 그래프가 통째로 한국어 정본으로 되돌아갔다(2026-08-05 라이브 확인).
 * 그렇다고 무조건 접두어를 붙이면 안 된다 — api/seo/editorial/[slug].js 는
 * `lang !== ko && lang !== en && !translation` 일 때 /en/ 으로 302 를 내므로,
 * 번역 없는 항목에 접두어를 붙이면 "리디렉션이 포함된 페이지"가 다시 늘어난다.
 *
 * 왜 '있는 목록'이 아니라 '없는 목록'인가: 실측(2026-08-05) 발행 2,293편 중
 * 번역 누락은 de/ru/zh 16편, es/fr/ja 2편, it 0편뿐이다. 예외 목록이 압도적으로
 * 작아 응답이 수십 바이트 수준이고, 새 언어를 붙일 때도 기본값이 '접두어 있음'
 * 이라 안전한 쪽으로 수렴한다.
 *
 * ko|en 은 항상 원본 필드가 존재하므로 빈 목록을 돌려준다(프론트도 호출 안 함).
 *
 * 캐시: 1시간 엣지 + 1일 SWR. 번역 백필이 돌아도 한 시간 안에 반영된다.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { rateLimit, RATE_LIMITS } = require('../_lib/rateLimit');
const { fetchAllRows } = require('../_lib/fetchAllRows');

const TRANSLATED_LANGS = ['it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  if (rateLimit(req, res, RATE_LIMITS.api)) return;

  const lang = String(req.query.lang || '');

  // ko/en 은 번역 테이블이 필요 없다 — 언제나 전량 보유.
  if (!TRANSLATED_LANGS.includes(lang)) {
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    return res.status(200).json({ lang: lang || 'ko', count: 0, slugs: [], ids: [] });
  }

  try {
    const nowIso = new Date().toISOString();

    // ⚠️ 반드시 fetchAllRows — 단일 조회는 5,000행에서 조용히 잘린다.
    const [eds, trs] = await Promise.all([
      fetchAllRows(() => supabaseAdmin
        .from('editorials')
        .select('id, slug')
        .eq('status', 'published')
        .or('scheduled_publish_at.is.null,scheduled_publish_at.lte.' + nowIso)
        .order('id', { ascending: true }), { pageSize: 1000 }),
      fetchAllRows(() => supabaseAdmin
        .from('seo_translations')
        .select('content_id')
        .eq('kind', 'editorial')
        .eq('lang', lang)
        .order('id', { ascending: true }), { pageSize: 1000 }),
    ]);

    const have = new Set((trs || []).map(t => t.content_id));
    const slugs = [];
    const ids = [];
    for (const e of eds || []) {
      if (have.has(e.id)) continue;
      ids.push(e.id);
      if (e.slug) slugs.push(e.slug);
    }

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ lang, count: ids.length, slugs, ids });
  } catch (err) {
    console.error('[editorials/untranslated] failed', err);
    // 실패 시엔 '예외 없음'이 아니라 명시적 에러 — 프론트는 목록 미도착으로
    // 간주해 접두어를 붙이지 않는다(안전측: 기존 동작 유지).
    return res.status(500).json({ message: 'Untranslated lookup failed' });
  }
};
