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

/* ── 엔티티 클러스터 링크 (2026-08-22) ────────────────────────────────
 * [왜] 8월 실측에서 한국어 노출의 **88%가 4~10위**에 갇혀 있었다
 * (1~3위 4,772 노출 / 4~10위 86,674 / 11위+ 7,382).
 * 그리고 막혀 있는 질의는 거의 전부 **엔티티**다:
 *   윤채 1,936(5.9위) · 휴먼메이드 1,346(7.6위) · 셩셩 1,018(3.6위)
 *   조나단 앤더슨 708(6.4위) · 소피아 596(5.7위)
 *
 * 원인 후보를 하나씩 재 봤다.
 *   · 제목/CTR  — 아니다. 위치별 CTR 1위 40.5% · 3위 21.4% 로 업계의 1.5~2배다.
 *   · 본문 길이 — 아니다. 1~3위 평균 497자 < 4~10위 568자 (오히려 짧다).
 *   · 이미지·태그 수 — 아니다. 두 구간이 사실상 같다(5.5 vs 5.2 / 8.0 vs 8.1).
 *   · 내부 링크  — **여기다.** 홈이 내부링크 10,001개를 받는 동안
 *     기사는 2~13개다(최다가 54). 사이트 DR 62 가 기사로 흘러가지 않는다.
 *
 * 기존 related 는 임베딩 유사도(또는 카테고리+날짜 인접)다. 둘 다
 * '내용이 닮음'이지 '같은 대상을 다룸'이 아니다. 그래서 윤채 기사 여러 편이
 * 서로 연결되지 않았고, 구글에게 "이 사이트가 윤채를 다루는 곳"이라는
 * 신호가 없었다. 낱장만 있었다.
 *
 * [왜 인물 허브 페이지가 아니라 이것인가]
 * 브랜드 허브 881개를 이미 만들어 뒀는데 8월 실측이 평균 22.4위·총 클릭 45다.
 * 얇은 새 페이지를 더 만드는 건 같은 실패를 반복하는 것이다. 이 방식은
 * **새 페이지를 0개 만들고**, 이미 순위를 가진 페이지끼리 묶는다.
 *
 * [왜 geoEntities 사전을 안 쓰나]
 * 막혀 있는 엔티티(katseye·yoonchae·휴먼메이드·셩셩·hanroro)가 그 사전에
 * 하나도 없다. 사전은 위키피디아 sameAs 가 확실한 것만 담는 설계라 옳고,
 * 여기서 필요한 건 사전 없이도 도는 규칙이다. 그래서 **태그 겹침**을 쓴다.
 *
 * [일반 태그를 걷어내는 이유 — 실측으로 한 번 틀린 뒤 고쳤다]
 * 처음엔 '겹침 2개 이상'만 걸었다. 윤채 기사로 돌려 보니 1위가
 * '그래미 CEO, BTS 불참'이었다. 겹친 태그가 kpop·bts·music industry 였고,
 * 정작 캣츠아이 기사들이 아래로 밀렸다.
 *
 * 태그 분포를 재 보니 이유가 분명했다 (발행 기사 기준):
 *   1편에만 붙은 태그  6,157개  ← 클러스터가 없다. 링크 상대가 없다
 *   2~5편              1,546개  ← **여기가 진짜 엔티티 클러스터다**
 *   6~20편               343개  ← 여기까지 쓸 만하다
 *   21편+                 99개  ← kpop(89)·bts(33) 같은 일반 태그
 *
 * 그래서 (a) 후보군 안에서 흔한 태그는 점수에서 뺀다 (b) 남은 희소 태그가
 * 1개 이상 겹쳐야 인정한다 (c) 점수는 1/빈도 합 — 드문 태그일수록 무겁다.
 * 후보군 안에서 세므로 **추가 질의가 없다.**
 *
 * 실패하면 조용히 빈 배열을 돌려준다 — 기존 related 가 그대로 채운다.
 * 이 함수가 죽어도 페이지는 종전과 똑같이 나온다. */
const CLUSTER_SLOTS = 2;        // related 4칸 중 엔티티 클러스터에 내주는 칸 수
const CLUSTER_POOL = 40;       // 후보군 크기 (여기 안에서 태그 빈도를 센다)
/* 후보군의 20% 넘게 나타나는 태그는 '일반 태그'로 보고 점수에서 뺀다.
   40건 기준 8건 초과. 0.25 로 먼저 잡았다가 bts(10/40)가 딱 경계에서
   살아남아 캣츠아이 기사를 밀어내는 걸 보고 0.20 으로 내렸다.
   실측(윤채 기사 기준): kpop(32)·bts(10) 제외, katseye(2)·music industry(2) 인정. */
const GENERIC_RATIO = 0.20;

function _cleanTags(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((t) => String(t == null ? '' : t).trim())
    .filter((t) => t.length >= 2 && t.length <= 40)
    /* PostgREST 의 or() 는 콤마로 조건을 가른다. 콤마·따옴표·괄호가 든 태그는
       표현식을 깨뜨리므로 아예 뺀다(그 태그 하나를 포기하는 게 안전하다). */
    .filter((t) => !/[,"'()\\]/.test(t))
    .slice(0, 6);
}

async function _entityCluster(data) {
  try {
    const tags = _cleanTags(data && data.tags);
    if (!tags.length) return [];
    const orExpr = tags.map((t) => 'tags.cs.["' + t + '"]').join(',');
    const { data: cand, error } = await supabaseAdmin
      .from('articles')
      .select('title, slug, id, thumbnail_url, hero_image_url, tags, published_date')
      .eq('status', 'published').neq('id', data.id).or(orExpr)
      .order('published_date', { ascending: false }).limit(CLUSTER_POOL);
    if (error || !Array.isArray(cand) || !cand.length) return [];
    const mine = new Set(tags.map((t) => t.toLowerCase()));
    const tagsOf = (a) => Array.from(new Set(
      (Array.isArray(a.tags) ? a.tags : []).map((x) => String(x || '').toLowerCase())
    )).filter((t) => mine.has(t));

    // 후보군 안에서 각 공유 태그가 몇 번 나오는지 — 흔할수록 일반 태그다.
    const df = new Map();
    for (const a of cand) for (const t of tagsOf(a)) df.set(t, (df.get(t) || 0) + 1);
    const genericAt = Math.max(2, Math.floor(cand.length * GENERIC_RATIO));

    return cand
      .map((a) => {
        let score = 0, rare = 0;
        for (const t of tagsOf(a)) {
          const n = df.get(t) || 1;
          if (n > genericAt) continue;            // kpop 류는 없는 셈 친다
          rare++; score += 1 / n;                 // 드문 태그일수록 무겁다
        }
        return { a, score, rare };
      })
      .filter((x) => x.rare >= 1)
      .sort((x, y) => (y.score - x.score)
        || String(y.a.published_date || '').localeCompare(String(x.a.published_date || '')))
      .slice(0, CLUSTER_SLOTS)
      .map((x) => x.a);
  } catch (_e) {
    return [];   // 링크 하나 못 붙이는 것보다 페이지가 죽는 게 훨씬 나쁘다
  }
}

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

  /* 엔티티 클러스터를 related 앞자리에 끼운다 (2026-08-22).
     앞자리인 이유: 4칸 중 뒤에 두면 잘려 나갈 수 있고, 내부링크는 위에 있을수록
     따라가질 확률이 높다. 중복은 id 로 거른다. 클러스터가 비면 종전과 동일하다. */
  const cluster = await _entityCluster(data);
  const merged = [];
  const seenIds = new Set([data.id]);
  for (const a of cluster) {
    if (!a || seenIds.has(a.id)) continue;
    seenIds.add(a.id); merged.push(_norm(a));
  }
  for (const a of related) {
    if (!a || seenIds.has(a.id)) continue;
    seenIds.add(a.id); merged.push(a);
  }

  return {
    prev: _norm(prevR.data && prevR.data[0]) || null,
    next: _norm(nextR.data && nextR.data[0]) || null,
    related: merged.slice(0, 4),
  };
}

module.exports = { buildMoreArticles };
