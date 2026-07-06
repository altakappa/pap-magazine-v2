/**
 * PAP Magazine — 레거시 에디토리얼 일괄 임포트 (이전 웹사이트 정적 JSON → DB)
 * Route: POST /api/admin/legacy-import-json          (관리자 전용, 1회성)
 *        POST ?dry=1                                  → 삽입 없이 계획만 반환
 *
 * 소스: 이전 사이트(papkorea)에서 이관된 정적 데이터
 *   /data/editorials.json        — 2,371편 { title, img(S3), date, url, tags }
 *   /data/editorial-details.json — 제목 키 { issue, thumb, images, credits, fashion }
 *
 * DB의 92편(2026-04 이후 신규 시스템)과 slug·제목으로 중복 제거 후
 * legacy=true published 로 삽입 → 아카이브·사이트맵·SSR 페이지 전면 편입.
 * 이미지가 자체 S3라 IG API 의존 없음 (api/cron/legacy-import.js 대체 — 그쪽은 크론 해제).
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { requireAdmin } = require('../_lib/auth');

const SITE = 'https://www.pap-magazine.com';
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').trim();

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); return res.status(405).end(); }
  const user = await requireAdmin(req, res);
  if (!user) return;
  const dry = req.query.dry === '1';

  try {
    // 1) 정적 JSON 로드 (배포된 퍼블릭 경로에서 — 함수 번들에 미포함이므로 HTTP)
    const [edsR, detR] = await Promise.all([
      fetch(SITE + '/data/editorials.json', { signal: AbortSignal.timeout(20000) }),
      fetch(SITE + '/data/editorial-details.json', { signal: AbortSignal.timeout(30000) }),
    ]);
    if (!edsR.ok || !detR.ok) throw new Error('정적 JSON 로드 실패 ' + edsR.status + '/' + detR.status);
    const eds = await edsR.json();
    const details = await detR.json();
    if (!Array.isArray(eds) || !eds.length) throw new Error('editorials.json 형식 이상');

    // 2) 기존 DB 전량 로드 (slug + 제목 정규화 중복맵)
    const { data: existing, error: exErr } = await supabaseAdmin
      .from('editorials').select('slug, title').limit(5000);
    if (exErr) throw exErr;
    const haveSlug = new Set((existing || []).map((r) => String(r.slug || '').toLowerCase()));
    const haveTitle = new Set((existing || []).map((r) => norm(r.title)));

    // 3) 변환 + 중복 제거 (JSON 내부 중복 slug 포함)
    const seen = new Set();
    const rows = [];
    let dupDb = 0, dupSelf = 0, bad = 0;
    for (const e of eds) {
      const title = String(e.title || '').trim();
      const slug = String(e.url || '').replace(/^\/+|\/+$/g, '').toLowerCase();
      if (!title || !slug) { bad++; continue; }
      if (haveSlug.has(slug) || haveTitle.has(norm(title))) { dupDb++; continue; }
      if (seen.has(slug)) { dupSelf++; continue; }
      seen.add(slug);
      const d = details[title] || details[e.title] || {};
      rows.push({
        title,
        slug,
        status: 'published',
        legacy: true,
        published_date: /^\d{4}-\d{2}-\d{2}/.test(String(e.date || '')) ? e.date : null,
        cover_image: e.img || d.thumb || null,
        thumbnail: d.thumb || e.img || null,
        gallery: Array.isArray(d.images) && d.images.length ? d.images : null,
        credits: Array.isArray(d.credits) && d.credits.length ? d.credits : null,
        fashion: d.fashion && typeof d.fashion === 'object' ? d.fashion : null,
        issue: d.issue || null,
      });
    }

    if (dry) {
      return res.status(200).json({
        ok: true, dry: true,
        source: eds.length, to_insert: rows.length,
        skipped: { db_duplicate: dupDb, self_duplicate: dupSelf, invalid: bad },
        sample: rows.slice(0, 3).map((r) => ({ title: r.title, slug: r.slug, date: r.published_date, gallery: (r.gallery || []).length })),
      });
    }

    // 4) 400행 단위 배치 삽입
    let inserted = 0;
    const errors = [];
    for (let i = 0; i < rows.length; i += 400) {
      const batch = rows.slice(i, i + 400);
      const { error } = await supabaseAdmin.from('editorials').insert(batch);
      if (error) {
        errors.push('batch ' + i + ': ' + error.message);
        // 컬럼 불일치 등 구조 오류면 즉시 중단 (같은 오류 반복 방지)
        if (errors.length >= 2) break;
        continue;
      }
      inserted += batch.length;
    }

    return res.status(200).json({
      ok: errors.length === 0, inserted,
      source: eds.length, planned: rows.length,
      skipped: { db_duplicate: dupDb, self_duplicate: dupSelf, invalid: bad },
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    console.error('[legacy-import-json] error:', err);
    return res.status(500).json({ error: 'json import failed', detail: String(err && err.message || err).slice(0, 200) });
  }
};
