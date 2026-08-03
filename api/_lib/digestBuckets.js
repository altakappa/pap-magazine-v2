/**
 * PAP Magazine — 소셜 다이제스트 소재 선정 (2026-08-03, 도메니코 지시).
 *
 * X·스레드를 "인스타 유입 장치"로 쓰기 위해, 며칠에 한 번씩 그동안 올라간
 * 기사를 모아 리뷰하는 글의 *재료*를 고르는 모듈이다. 글을 쓰거나 올리지
 * 않는다 — 고르기만 한다. 문안 생성·게시는 각 채널 모듈이 맡는다.
 *
 * 세 갈래(도메니코 지정):
 *   editorial   지난 7일 PAP 오리지널 에디토리얼
 *   collection  지난 3일 아트 콜렉션 (아트·패션·뷰티 등 아카이브형)
 *   celeb       지난 3일 셀럽 소식
 *
 * 분류 기준이 왜 이렇게 되나 —
 *   · 오리지널 vs 아카이브는 editorials.legacy 로 갈린다 (065_legacy_editorials).
 *     legacy=false 가 우리가 크리에이티브팀과 새로 만든 것, true 가 아카이브.
 *   · 셀럽 vs 아트는 articles.category 로 갈린다. 'collection' 이라는 이름의
 *     카테고리는 DB 어디에도 없다 — 셀럽이 아닌 나머지 전부가 콜렉션이다.
 *     그래서 화이트리스트가 아니라 블랙리스트(CELEB_CATEGORIES)로 뺀다.
 *     새 카테고리가 생겨도 자동으로 콜렉션에 들어오는 게 맞는 동작이다.
 *   · category 는 자유 텍스트에 쉼표 다중값이다 ('Fashion,Culture').
 *     그래서 문자열 비교가 아니라 쪼개서 소문자로 맞춰 본다.
 */

const { supabaseAdmin } = require('./supabase');

const SITE = 'https://www.pap-magazine.com';

/* 셀럽 갈래로 보내는 카테고리. IG 임포트 화이트리스트
   (sync-instagram.js ARTICLE_CATEGORIES) 중 뉴스성인 둘이다. */
const CELEB_CATEGORIES = ['news', 'celeb'];

/* limit 0 = 상한 없음.
   2026-08-03 도메니코 — "내용을 고르지 말고 3일 동안 셀럽 기사 전체를 다 쓸 것".
   셀럽만 상한을 푼다. 에디토리얼·콜렉션은 아직 여덟 개까지다. */
const BUCKETS = {
  editorial:  { label: '오리지널 에디토리얼', days: 7, limit: 8 },
  collection: { label: '아트 콜렉션',        days: 3, limit: 8 },
  celeb:      { label: '셀럽 소식',          days: 3, limit: 0 },
};

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
  return SITE + '/article/' + (a.slug || a.custom_url || a.id);
}
function editorialUrl(e) {
  return SITE + '/editorial/' + (e.slug || e.id);
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
 * 이미 다이제스트에 나간 글은 다시 안 뽑는다.
 *
 * 3일 주기에 3일 창이면 이론상 안 겹치지만, 크론이 밀리거나 수동으로 한 번
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
    .select('id, title, title_en, slug, custom_url, category, status, published_date, scheduled_publish_at, thumbnail_url, hero_image_url, source_instagram_url')
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

/**
 * 한 갈래의 소재를 고른다.
 *
 * @param {'editorial'|'collection'|'celeb'} bucket
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
  } else if (bucket === 'celeb') {
    items = (await fetchArticles(days))
      .filter((a) => isLive(a, nowIso) && isCelebCategory(a.category))
      .map(fromArticle);
  } else {
    /* 콜렉션은 두 곳에서 온다 — 셀럽이 아닌 기사, 그리고 아카이브 에디토리얼.
       도메니코가 말한 "아트, 패션, 뷰티 등의 아카이브형" 이 정확히 이 합집합이다. */
    const [arts, legacyEds] = await Promise.all([
      fetchArticles(days),
      fetchEditorials(days, true),
    ]);
    items = arts.filter((a) => isLive(a, nowIso) && !isCelebCategory(a.category)).map(fromArticle)
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
  CELEB_CATEGORIES,
  splitCategories,
  isCelebCategory,
  isLive,
  articleUrl,
  editorialUrl,
  collect,
};
