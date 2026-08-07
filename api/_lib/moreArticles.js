/**
 * MORE ARTICLES 빌더 — api/_lib/moreArticles.js (2026-08-08 추출)
 *
 * 왜 파일로 뺐나 ────────────────────────────────────────────────────
 * 이 로직은 원래 api/seo/article/[slug].js (SSR) 안에만 있었다. 그래서
 * "MORE ARTICLES" 는 주소로 직접 들어온 사람만 봤고, 사이트 안에서 클릭해
 * 들어온 사람(SPA)에게는 존재하지 않았다 — 도메니코가 계속 지적한
 * "화면이 두 벌" 문제의 한 조각. 이제 SSR([slug].js)과 SPA 상세 API
 * (api/articles/[id].js)가 같은 빌더를 쓴다. 규칙이 두 벌이면 한쪽만
 * 고쳐진다.
 *
 * 2026-08-07 — related 를 '임베딩 유사도' 로 바꿨다.
 *   그전 규칙은 '같은 카테고리 + 발행일 인접' 이었다. 카테고리가 같다는 것
 *   말고는 내용이 닮았다는 근거가 없어서, 2019년 기사를 읽던 사람에게
 *   2019년 기사가 붙었다. 에디토리얼은 이미 벡터 유사도(related_editorials)
 *   로 추천하는데, 정작 **사이트→IG 아웃클릭의 94%가 나오는 SSR 기사
 *   페이지**에 제일 약한 추천이 달려 있었다.
 *   임베딩이 없거나 RPC 가 실패하면 예전 인접 규칙으로 그대로 내려간다 —
 *   추천이 비는 것보다 약한 추천이라도 있는 편이 낫다.
 *
 * 규칙 (2026-07-27 확정 — 내부링크 그래프 개선):
 *   prev/next  = 발행일 체인 (같은 날짜는 created_at 으로 타이브레이크)
 *   related    = 임베딩 코사인 유사도 상위 4건 (실패 시 옛 규칙으로 폴백)
 * 최신 4건 고정이 아니라 인접인 이유: 오래된 기사끼리도 상호 연결돼야
 * 토픽 클러스터 밀도가 오르고 미색인이 줄기 때문(서치콘솔 실측).
 */

'use strict';

const { supabaseAdmin } = require('./supabase');

/**
 * @param data articles 행 (id, published_date, created_at, category 필요)
 * @returns {prev, next, related[]} — 각 항목 {title, slug, id, thumbnail}
 */
async function buildMoreArticles(data) {
  const pd = data.published_date || '1970-01-01';
  const ca = data.created_at || '1970-01-01T00:00:00Z';
  const sel = 'title, slug, id, published_date, thumbnail_url, hero_image_url, category';
  const catFilter = (q) => data.category ? q.eq('category', data.category) : q;
  const [prevR, nextR, relPrevR, relNextR] = await Promise.all([
    supabaseAdmin.from('articles').select(sel).eq('status', 'published')
      .or(`published_date.lt.${pd},and(published_date.eq.${pd},created_at.lt.${ca})`)
      .order('published_date', { ascending: false }).order('created_at', { ascending: false }).limit(1),
    supabaseAdmin.from('articles').select(sel).eq('status', 'published')
      .or(`published_date.gt.${pd},and(published_date.eq.${pd},created_at.gt.${ca})`)
      .order('published_date', { ascending: true }).order('created_at', { ascending: true }).limit(1),
    // 같은 카테고리, 발행일이 이 기사보다 앞선 최근 2건
    catFilter(supabaseAdmin.from('articles').select(sel).eq('status', 'published')
      .neq('id', data.id).lt('published_date', pd))
      .order('published_date', { ascending: false }).limit(2),
    // 같은 카테고리, 발행일이 이 기사보다 뒤인 가까운 2건
    catFilter(supabaseAdmin.from('articles').select(sel).eq('status', 'published')
      .neq('id', data.id).gt('published_date', pd))
      .order('published_date', { ascending: true }).limit(2),
  ]);
  const _norm = a => a && ({ title: a.title, slug: a.slug, id: a.id,
    thumbnail: a.thumbnail_url || a.hero_image_url || '' });
  // 인접(앞2+뒤2)을 합쳐 4건. 카테고리가 희소해 4건 미만이면 있는 만큼
  // (prev/next 체인이 최소 연결을 보장하므로 고아는 발생하지 않는다).
  let relAdj = [...(relPrevR.data || []), ...(relNextR.data || [])];
  if (relAdj.length < 4) {
    const fill = await catFilter(supabaseAdmin.from('articles').select(sel)
      .eq('status', 'published').neq('id', data.id))
      .order('published_date', { ascending: false }).limit(6);
    const seen = new Set(relAdj.map(a => a.id));
    for (const a of (fill.data || [])) { if (!seen.has(a.id)) { relAdj.push(a); seen.add(a.id); } }
  }
  // 1순위: 임베딩 유사도. 2순위(폴백): 위에서 구해 둔 발행일 인접.
  let related = null;
  try {
    const { data: sim, error: simErr } = await supabaseAdmin
      .rpc('related_articles', { target_id: data.id, match_count: 4 });
    if (!simErr && Array.isArray(sim) && sim.length) {
      related = sim
        .filter(r => r && r.id && r.id !== data.id)
        .map(r => ({ title: r.title, slug: r.slug, id: r.id, thumbnail: r.thumbnail || '' }));
    }
  } catch (_e) { /* 폴백으로 내려간다 */ }
  if (!related || !related.length) {
    related = relAdj.filter(a => a && a.id !== data.id).slice(0, 4).map(_norm);
  }

  return {
    prev: _norm(prevR.data && prevR.data[0]) || null,
    next: _norm(nextR.data && nextR.data[0]) || null,
    related: related.slice(0, 4),
  };
}

module.exports = { buildMoreArticles };
