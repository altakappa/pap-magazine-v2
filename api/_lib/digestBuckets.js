/**
 * PAP Magazine — 소셜 다이제스트 소재 선정 (2026-08-03, 도메니코 지시).
 *
 * X·스레드를 "인스타 유입 장치"로 쓰기 위해, 며칠에 한 번씩 그동안 올라간
 * 기사를 모아 리뷰하는 글의 *재료*를 고르는 모듈이다. 글을 쓰거나 올리지
 * 않는다 — 고르기만 한다. 문안 생성·게시는 각 채널 모듈이 맡는다.
 *
 * 갈래 (도메니코 지정):
 *   editorial   지난 7일 PAP 오리지널 에디토리얼
 *   collection  지난 3일 아트 콜렉션 (아트·패션·뷰티 등 아카이브형)
 *   celeb       지난 4일 셀럽 소식
 *   pepperit    지난 3~4일 페퍼릿 소식 (2026-08-05 추가 · 스레드 전용)
 *
 * 페퍼릿은 PAP 이 아니다. 사이트도(pepperitmag.com) 표도(pepperit_articles)
 * 인스타 계정도(@pepperitmag) 따로다. 그래서 같은 모듈 안에 있어도 URL 을
 * 만드는 자리와 소재를 읽는 자리가 갈린다 — SITES 표와 fromPepperitArticle 이
 * 그 경계다. 갈래 하나를 더한 것이지 PAP 갈래를 건드린 게 아니다.
 *
 * 분류 기준이 왜 이렇게 되나 —
 *   · 오리지널 vs 아카이브는 editorials.legacy 로 갈린다 (065_legacy_editorials).
 *     legacy=false 가 우리가 크리에이티브팀과 새로 만든 것, true 가 아카이브.
 *   · 셀럽 vs 아트는 **2026-08-07 부터 category 를 안 본다** (도메니코 지적).
 *     실재하는 카테고리는 넷뿐인데(Culture·Fashion·News·Beauty) 셀럽 기사가
 *     셋에 흩어져 있었다 — 휴닝카이는 Fashion, 정국 샤넬은 Beauty,
 *     스트레이 키즈는 Culture. 전부 아트 콜렉션으로 샜고, 반대로 셀럽 모음은
 *     News 만 받아 개수가 모자랐다(45일 54건 vs 실제 최소 121건).
 *     지금은 articles.digest_kind + 태그 마커로 가른다 → api/_lib/digestKind.js.
 *     갈래는 셋이다: celeb · collection · **none(두 모음 모두에서 뺀다)**.
 *     아래 CELEB_CATEGORIES / isCelebCategory 는 **더 이상 갈래를 정하지 않는다.**
 *     기존 테스트와 참고용으로 남겨 둔 것이니 새 코드에서 쓰지 말 것.
 *   · category 는 자유 텍스트에 쉼표 다중값이다 ('Fashion,Culture').
 *     그래서 문자열 비교가 아니라 쪼개서 소문자로 맞춰 본다.
 */

const { supabaseAdmin } = require('./supabase');
const { digestKind } = require('./digestKind');

/* 갈래마다 사이트가 다르다. 예전엔 SITE 상수 하나였는데, 그 값이 PAP 도메인
   이라 페퍼릿 기사 링크가 조용히 pap-magazine.com 으로 나갈 뻔했다.
   상수를 표로 바꿔 "어느 브랜드의 URL 인가"를 호출 지점마다 밝히게 한다. */
const SITES = {
  pap:      'https://www.pap-magazine.com',
  pepperit: 'https://www.pepperitmag.com',
};

/* 셀럽 갈래로 보내는 카테고리. IG 임포트 화이트리스트
   (sync-instagram.js ARTICLE_CATEGORIES) 중 뉴스성인 둘이다. */
const CELEB_CATEGORIES = ['news', 'celeb'];

/* limit 0 = 상한 없음.
   2026-08-03 도메니코 — "내용을 고르지 말고 셀럽 기사 전체를 다 쓸 것".

   창 길이는 발행 간격에 맞춘다(api/cron/social-digest.js 의 SLOT_BUCKET).
   셀럽 월·화·목·금 → 최대 간격 3일이라 창 4일이면 구멍이 없다.
   콜렉션은 매일 저녁 나가므로 간격 1일 — 창 3일은 크론이 하루 이틀 밀려도
   빠지는 기사가 없게 두는 여유다.

   콜렉션 상한을 8 → 12 로 올린 이유: 스레드는 480자에 아홉 건쯤 들어가는데
   상한이 8이면 조립이 자르기도 전에 후보가 먼저 잘렸다. 조립(fitDown)이
   글자 수로 자르게 두고, 상한은 그 천장보다 조금 위에 둔다. 무제한으로
   풀지 않는 건 소개말 생성에 후보 수만큼 토큰이 들기 때문이다. */
/* 페퍼릿(2026-08-05 도메니코 확정) —
   창이 요일마다 다른 유일한 갈래다. 수요일은 지난 토·일·월·화(4일), 토요일은
   지난 수·목·금(3일). 7일이 겹침 없이 정확히 둘로 나뉜다. 그래서 days 를 한
   값으로 못 적고 daysByDow(발행 요일 → 창 길이) 표를 함께 둔다. days 는
   그 둘 중 넓은 쪽으로, 요일을 모르고 부를 때(수동 미리보기)의 기본값이다.

   상한 14 의 근거(실측): 고정부(머리말+빈 줄+꼬리말+IG링크) 82자, 제목 평균
   26~28자, THREADS_MAX 480 → (480 - 82) / 28 ≈ 14. 최종 컷은 조립부의
   fitDown() 이 글자 수로 하므로, 여기 상한은 그 천장보다 조금 위에 둔다
   (PAP collection 을 8 → 12 로 올렸을 때와 같은 사고방식). */
const BUCKETS = {
  editorial:  { label: '오리지널 에디토리얼', site: 'pap',      days: 7, limit: 8 },
  collection: { label: '아트 콜렉션',        site: 'pap',      days: 3, limit: 12 },
  celeb:      { label: '셀럽 소식',          site: 'pap',      days: 4, limit: 0 },
  pepperit:   { label: '페퍼릿 소식',        site: 'pepperit', days: 4, limit: 14,
                daysByDow: { 3: 4, 6: 3 } },
};

/**
 * 갈래·발행요일(KST, 0=일)에 맞는 창 길이.
 *
 * 요일별 창을 갈래 안에 두고 크론은 요일만 넘긴다. 반대로 크론이 창 길이를
 * 직접 들고 있으면, 발행 요일을 바꿀 때 크론과 이 파일 두 군데를 같이 고쳐야
 * 하고 그중 하나를 빼먹으면 기사가 조용히 새거나 겹친다.
 *
 * 요일 표가 없는 갈래(PAP 셋)는 예전 그대로 cfg.days 다.
 */
function windowDaysFor(bucket, dow) {
  const cfg = BUCKETS[bucket];
  if (!cfg) return 0;
  const byDow = cfg.daysByDow;
  if (byDow && byDow[dow] != null) return byDow[dow];
  return cfg.days;
}

/** 'Fashion,Culture' → ['fashion','culture'] */
function splitCategories(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 하나라도 news/celeb 이면 셀럽 갈래다 (every 가 아니라 some).
 *
 * 'News,Fashion' 같은 값이 생겼을 때, 패션 태그가 붙었다고 셀럽 소식이
 * 콜렉션으로 새면 두 갈래에 같은 글이 겹쳐 나간다. 뉴스성이 한 방울이라도
 * 섞였으면 뉴스로 보내는 쪽이 두 갈래를 겹치지 않게 자른다.
 */
function isCelebCategory(raw) {
  return splitCategories(raw).some((c) => CELEB_CATEGORIES.includes(c));
}

/** 예약 발행이 아직 안 풀린 글은 '발행됨' 이 아니다. */
function isLive(row, nowIso) {
  if (row.status !== 'published') return false;
  if (!row.scheduled_publish_at) return true;
  return row.scheduled_publish_at <= nowIso;
}

function cutoffIso(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

/* 기사 URL 은 slug 우선이다. custom_url 우선으로 두면 사이트맵
   (api/sitemap-articles.js)이 내보내는 정본과 어긋나 301 이 생긴다
   — 2026 Ahrefs 감사에서 확인된 순서다. */
function articleUrl(a) {
  return SITES.pap + '/article/' + (a.slug || a.custom_url || a.id);
}
function editorialUrl(e) {
  return SITES.pap + '/editorial/' + (e.slug || e.id);
}

/* 페퍼릿 기사 URL. sitemap-pepperit.js 가 내보내는 정본과 같은 모양이어야
   한다 — 사이트맵은 slug 없으면 id 로 떨어지고 custom_url 개념이 없다. */
function pepperitArticleUrl(a) {
  return SITES.pepperit + '/article/' + (a.slug || a.id);
}

function fromArticle(a) {
  return {
    source: 'article',
    id: String(a.id),
    title: a.title || '',
    title_en: a.title_en || '',
    categories: splitCategories(a.category),
    published_date: a.published_date,
    site_url: articleUrl(a),
    ig_url: a.source_instagram_url || '',
    thumb: a.thumbnail_url || a.hero_image_url || '',
  };
}

function fromEditorial(e) {
  return {
    source: 'editorial',
    id: String(e.id),
    title: e.title || '',
    title_en: e.title_en || '',
    categories: [],
    published_date: e.published_date,
    site_url: editorialUrl(e),
    ig_url: e.source_instagram_url || '',
    thumb: e.thumbnail || e.cover_image || '',
  };
}

/**
 * 페퍼릿 기사 → 소재 항목 (2026-08-05).
 *
 * source 를 'pepperit' 으로 따로 둔다. 'article' 로 뭉뚱그리면 PAP articles 의
 * id 와 pepperit_articles 의 id 가 같은 이름 공간에 섞여, 중복 방지 키
 * ('source:id')가 서로를 오인할 수 있다. 둘 다 uuid 라 실제 충돌 확률은 낮지만
 * 중복 방지는 확률에 기대면 안 되는 자리다.
 * (social_digest_items.source CHECK 에 'pepperit' 을 넣는 건 마이그레이션 099.)
 *
 * title_en 을 빈 문자열로 두는 건 페퍼릿 표에 그 컬럼이 없어서다 — 항목 모양은
 * PAP 과 같게 맞춰 두고, 없는 값만 비운다. 조립부가 갈래마다 다른 모양을
 * 알아야 하는 상황을 만들지 않는다.
 */
function fromPepperitArticle(a) {
  return {
    source: 'pepperit',
    id: String(a.id),
    title: a.title || '',
    title_en: '',
    categories: splitCategories(a.category),
    published_date: a.published_date,
    site_url: pepperitArticleUrl(a),
    ig_url: a.source_instagram_url || '',
    thumb: a.thumbnail_url || '',
  };
}

/**
 * 이미 다이제스트에 나간 글은 다시 안 뽑는다.
 *
 * 창을 발행 간격에 맞추면 이론상 안 겹치지만, 크론이 밀리거나 수동으로 한 번
 * 더 돌리면 바로 겹친다. 같은 글이 이틀 걸러 또 올라오는 건 계정 신뢰를
 * 깎으므로, 창 계산이 아니라 발행 기록으로 막는다.
 *
 * 조회 범위를 60일로 자르는 이유: 갈래별 창이 최대 7일이라 그보다 오래된
 * 기록은 어차피 후보에 없다. 테이블이 커져도 조회는 안 커진다.
 */
async function loadPostedKeys(bucket) {
  const since = cutoffIso(60);
  const { data, error } = await supabaseAdmin
    .from('social_digest_items')
    .select('source, source_id')
    .eq('bucket', bucket)
    .gte('created_at', since)
    .limit(5000);
  if (error) {
    // 기록을 못 읽으면 중복 위험이 있으므로 조용히 넘어가지 않는다.
    console.warn('[digestBuckets] 발행 기록 조회 실패 — 중복 방지 없이 진행:', error.message);
    return new Set();
  }
  return new Set((data || []).map((r) => r.source + ':' + r.source_id));
}

async function fetchArticles(days) {
  const { data, error } = await supabaseAdmin
    .from('articles')
    .select('id, title, title_en, slug, custom_url, category, tags, digest_kind, kind_by, status, published_date, scheduled_publish_at, thumbnail_url, hero_image_url, source_instagram_url')
    .eq('status', 'published')
    .gte('published_date', cutoffIso(days))
    .order('published_date', { ascending: false })
    .limit(300);
  if (error) throw new Error('articles 조회 실패: ' + error.message);
  return data || [];
}

async function fetchEditorials(days, legacy) {
  const { data, error } = await supabaseAdmin
    .from('editorials')
    .select('id, title, title_en, slug, status, legacy, published_date, scheduled_publish_at, thumbnail, cover_image, source_instagram_url')
    .eq('status', 'published')
    .eq('legacy', legacy)
    .gte('published_date', cutoffIso(days))
    .order('published_date', { ascending: false })
    .limit(300);
  if (error) throw new Error('editorials 조회 실패: ' + error.message);
  return data || [];
}

async function fetchPepperitArticles(days) {
  /* pepperit_articles 에는 scheduled_publish_at 이 없다 (예약 발행 기능이
     페퍼릿에는 없다). 그래도 isLive() 를 그대로 태우는 이유는, 나중에 컬럼이
     생겼을 때 이 자리를 다시 찾아 고쳐야 하는 상황을 안 만들기 위해서다 —
     값이 없으면 isLive 는 status 만 본다. */
  const { data, error } = await supabaseAdmin
    .from('pepperit_articles')
    .select('id, title, slug, category, status, published_date, thumbnail_url, source_instagram_url')
    .eq('status', 'published')
    .gte('published_date', cutoffIso(days))
    .order('published_date', { ascending: false })
    .limit(300);
  if (error) throw new Error('pepperit_articles 조회 실패: ' + error.message);
  return data || [];
}

/**
 * 페퍼릿 소재 정렬 — **당분간 최신순(published_date desc)**.
 *
 * 도메니코가 원한 건 화제성 순이다. 그런데 지금은 그럴 데이터가 없다:
 * 지표 표(`ig_post_metric`)가 아직 @pepperitmag 을 수집하지 않아서,
 * `pepperit_articles.source_instagram_post_id` 150건과 매칭되는 지표 행이
 * **0건**이다(2026-08-05 실측). 없는 값으로 정렬하면 순서는 사실상 무작위가
 * 되고, 그건 최신순보다 나쁘다.
 *
 * 그래서 정렬만 이 함수 하나로 떼어 놓았다. **지표가 쌓이면 이 함수만
 * 갈아끼우면 된다** — collect() 도 조립부도 건드릴 필요가 없다. 교체할 때
 * 확인할 것은 딱 하나, ig_post_metric 이 @pepperitmag 을 수집하고 있는가다.
 */
function sortByRecency(items) {
  return items.slice().sort((a, b) =>
    String(b.published_date || '').localeCompare(String(a.published_date || '')));
}

/**
 * 한 갈래의 소재를 고른다.
 *
 * @param {'editorial'|'collection'|'celeb'|'pepperit'} bucket
 * @param {{days?:number, limit?:number, skipDedupe?:boolean}} [opts]
 *   days        창 길이 (기본값은 BUCKETS 의 갈래별 기본)
 *   limit       최대 개수 (0 이면 무제한. 기본값은 갈래별 BUCKETS.limit)
 *   skipDedupe  true 면 발행 기록을 무시한다 (dry-run 미리보기용)
 * @returns {Promise<{bucket:string, label:string, days:number, items:Array}>}
 */
async function collect(bucket, opts) {
  const cfg = BUCKETS[bucket];
  if (!cfg) throw new Error('알 수 없는 갈래: ' + bucket);
  const o = opts || {};
  const days = o.days || cfg.days;
  /* 0 이면 상한 없음. o.limit 로 호출부가 덮어쓸 수 있다. */
  const limit = o.limit != null ? o.limit : (cfg.limit != null ? cfg.limit : 8);
  const nowIso = new Date().toISOString();

  let items = [];
  if (bucket === 'editorial') {
    items = (await fetchEditorials(days, false)).filter((e) => isLive(e, nowIso)).map(fromEditorial);
  } else if (bucket === 'pepperit') {
    /* 페퍼릿은 카테고리로 가르지 않는다. 갈래가 하나뿐이라 겹칠 상대가 없다 —
       PAP 의 CELEB_CATEGORIES 블랙리스트가 여기 필요 없는 이유다. */
    items = sortByRecency((await fetchPepperitArticles(days))
      .filter((a) => isLive(a, nowIso))
      .map(fromPepperitArticle));
  } else if (bucket === 'celeb') {
    items = (await fetchArticles(days))
      .filter((a) => isLive(a, nowIso) && digestKind(a) === 'celeb')
      .map(fromArticle);
  } else {
    /* 콜렉션은 두 곳에서 온다 — 셀럽이 아닌 기사, 그리고 아카이브 에디토리얼.
       도메니코가 말한 "아트, 패션, 뷰티 등의 아카이브형" 이 정확히 이 합집합이다. */
    const [arts, legacyEds] = await Promise.all([
      fetchArticles(days),
      fetchEditorials(days, true),
    ]);
    /* 'none' 은 두 모음 어디에도 안 넣는다 — 폭염 경보처럼 아트도 셀럽도
       아닌 기사를 '셀럽이 아니니까' 라는 이유로 여기 싣지 않기 위해서다
       (도메니코 2026-08-07: "애매한건 억지로 포함시키지 말고 그냥 빼줘"). */
    items = arts.filter((a) => isLive(a, nowIso) && digestKind(a) === 'collection').map(fromArticle)
      .concat(legacyEds.filter((e) => isLive(e, nowIso)).map(fromEditorial));
    items.sort((a, b) => String(b.published_date || '').localeCompare(String(a.published_date || '')));
  }

  items = items.filter((it) => it.title);

  if (!o.skipDedupe) {
    const posted = await loadPostedKeys(bucket);
    items = items.filter((it) => !posted.has(it.source + ':' + it.id));
  }

  return { bucket, label: cfg.label, days, items: limit > 0 ? items.slice(0, limit) : items };
}

module.exports = {
  BUCKETS,
  SITES,
  CELEB_CATEGORIES,
  splitCategories,
  isCelebCategory,
  isLive,
  windowDaysFor,
  articleUrl,
  editorialUrl,
  pepperitArticleUrl,
  fromPepperitArticle,
  sortByRecency,
  collect,
};
