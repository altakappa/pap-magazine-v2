/**
 * PAP Magazine — Supabase 전량 조회 헬퍼 (2026-08-04)
 *
 * [왜 필요한가]
 * Supabase(PostgREST)는 한 응답에 프로젝트 설정상의 최대 행수(현재 5,000행)까지만
 * 돌려준다. `.limit(20000)` 을 걸어도 조용히 5,000행에서 잘리고 **에러가 나지 않는다**.
 *
 * 그래서 사이트맵의 seo_translations 조회(에디토리얼 16,809행)가 5,000행만 받아
 * 언어별 URL 이 2,29x편 중 67x편만 광고되고 있었다(약 11,200페이지 미광고).
 * 라이브 실측 2026-08-04: sitemap-editorials.xml 의 de/ru/zh 항목이 각 67x개.
 *
 * [사용법] 쿼리 빌더는 1회용이므로 "빌더를 만드는 함수"를 넘긴다.
 *
 *   const rows = await fetchAllRows(() =>
 *     supabaseAdmin.from('seo_translations').select('content_id, lang')
 *       .eq('kind', 'editorial').order('id', { ascending: true })
 *   );
 *
 * 정렬(.order)은 반드시 유니크 컬럼으로 걸 것 — 정렬이 불안정하면 페이지 경계에서
 * 행이 중복되거나 누락된다.
 */

const DEFAULT_PAGE = 1000;   // Supabase max-rows(5,000) 보다 넉넉히 아래
const DEFAULT_CAP = 200000;  // 폭주 방지 상한

async function fetchAllRows(buildQuery, opts) {
  const o = opts || {};
  const pageSize = Math.max(1, Math.min(o.pageSize || DEFAULT_PAGE, 5000));
  const maxRows = o.maxRows || DEFAULT_CAP;
  const out = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) out.push(r);
    if (rows.length < pageSize) break;   // 마지막 페이지
  }

  return out;
}

module.exports = { fetchAllRows };
