/**
 * 소셜 다이제스트 소재 선정 테스트 (2026-08-03 도메니코 지시).
 *
 * 지시: X·스레드를 인스타 유입 장치로 쓰되, 기존 건별 자동 포스트는 그대로
 * 두고 그 위에 "며칠에 한 번 모아서 리뷰" 를 얹는다. 갈래 셋 —
 *   ① 지난 7일 오리지널 에디토리얼  ② 지난 3일 아트 콜렉션  ③ 지난 3일 셀럽
 *
 * ── 이 파일이 지키는 것 ─────────────────────────────────────────────
 * 1) 세 갈래가 서로 겹치지 않는다.
 *    같은 기사가 콜렉션과 셀럽에 동시에 나가면, 이틀 사이에 같은 글을 두 번
 *    본 사람이 생긴다. 유입 장치로 쓰겠다는 계정에서 가장 빨리 신뢰를 깎는다.
 *    겹침을 막는 근거는 category 하나뿐이라, 그 판정이 이 파일의 중심이다.
 *
 * 2) category 는 자유 텍스트에 쉼표 다중값이다 ('Fashion,Culture').
 *    실제 값에 대문자·복수값이 섞여 있으므로 문자열 비교로는 못 가른다.
 *
 * 3) 예약 발행이 안 풀린 글은 후보가 아니다.
 *    status='published' 인데 scheduled_publish_at 이 미래인 행이 존재한다
 *    (release-due-scheduled 크론이 풀어준다). 이걸 빼먹으면 아직 사이트에
 *    안 뜬 글의 링크를 소셜에 먼저 뿌린다.
 *
 * 4) 이미 다이제스트에 나간 글은 다시 안 뽑는다.
 *    3일 주기 + 3일 창이면 이론상 안 겹치지만, 크론이 밀리거나 수동으로 한
 *    번 더 돌리면 바로 겹친다. 창 계산이 아니라 발행 기록으로 막아야 한다.
 *
 * Run: node tests/digest-buckets.test.js  (npm test 에 연결됨)
 */
'use strict';

const path = require('path');
const Module = require('module');

/* ── supabase 스텁 ────────────────────────────────────────────────
   네트워크·키 없이 선정 로직만 본다. 체인(.from().select().eq()...)이
   마지막에 await 되므로 then 을 가진 빌더로 흉내낸다. 호출 순서를 강제하지
   않는 이유: 순서는 이 모듈의 계약이 아니다. 무엇이 뽑히느냐만 계약이다. */
const SUPABASE = path.join(__dirname, '..', 'api', '_lib', 'supabase.js');

let TABLES = {};
function builder(table) {
  const f = { table, filters: {} };
  const chain = {
    select() { return chain; },
    eq(col, val) { f.filters[col] = val; return chain; },
    gte(col, val) { f.filters['gte:' + col] = val; return chain; },
    order() { return chain; },
    limit() { return chain; },
    then(resolve) {
      const rows = (TABLES[table] || []).filter((r) => {
        for (const k of Object.keys(f.filters)) {
          if (k.startsWith('gte:')) {
            const col = k.slice(4);
            if (!(String(r[col] || '') >= f.filters[k])) return false;
          } else if (r[k] !== f.filters[k]) return false;
        }
        return true;
      });
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return chain;
}
require.cache[SUPABASE] = new Module(SUPABASE);
require.cache[SUPABASE].exports = { supabaseAdmin: { from: builder } };
require.cache[SUPABASE].loaded = true;

const B = require('../api/_lib/digestBuckets');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      → ' + detail : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const inFuture = () => new Date(Date.now() + 86400000).toISOString();

/* ---------------------------------------------------------------- */
section('category 판정 — 자유 텍스트 · 쉼표 다중값');

ok("'Fashion,Culture' 를 쪼개 소문자로 맞춘다",
  JSON.stringify(B.splitCategories('Fashion,Culture')) === '["fashion","culture"]');
ok('공백과 빈 조각을 흘린다',
  JSON.stringify(B.splitCategories(' Art , , Fashion ')) === '["art","fashion"]');
ok('null 이어도 터지지 않는다', B.splitCategories(null).length === 0);

ok("'News' 는 셀럽", B.isCelebCategory('News') === true);
ok("'Celeb' 는 셀럽", B.isCelebCategory('Celeb') === true);
ok("'Fashion' 은 셀럽이 아니다", B.isCelebCategory('Fashion') === false);
ok("'Fashion,Culture' 는 셀럽이 아니다", B.isCelebCategory('Fashion,Culture') === false);
/* some 이지 every 가 아니다 — 패션 태그가 붙었다고 뉴스가 콜렉션으로 새면
   두 갈래에 같은 글이 겹쳐 나간다. 뉴스성이 한 방울이라도 섞이면 뉴스다. */
ok("'News,Fashion' 은 셀럽 (한 갈래에만 들어가야 하므로)",
  B.isCelebCategory('News,Fashion') === true);
ok('빈 카테고리는 셀럽이 아니다 → 콜렉션으로 간다', B.isCelebCategory('') === false);

/* ---------------------------------------------------------------- */
section('예약 발행 — 아직 안 풀린 글은 후보가 아니다');

const now = new Date().toISOString();
ok('published + 예약 없음 → 후보',
  B.isLive({ status: 'published', scheduled_publish_at: null }, now) === true);
ok('published + 예약 시각이 지남 → 후보',
  B.isLive({ status: 'published', scheduled_publish_at: daysAgo(1) }, now) === true);
ok('published + 예약이 미래 → 아직 후보 아님',
  B.isLive({ status: 'published', scheduled_publish_at: inFuture() }, now) === false);
ok('draft 는 후보 아님',
  B.isLive({ status: 'draft', scheduled_publish_at: null }, now) === false);

/* ---------------------------------------------------------------- */
section('URL — 사이트맵과 같은 정본을 쓴다');

/* slug 우선. custom_url 우선으로 두면 api/sitemap-articles.js 가 내보내는
   정본과 어긋나 301 이 생긴다 (Ahrefs 감사에서 확인된 순서). */
ok('기사 URL 은 slug 우선',
  B.articleUrl({ id: 9, slug: 'a-slug', custom_url: 'a-custom' })
    === 'https://www.pap-magazine.com/article/a-slug');
ok('slug 이 없으면 custom_url, 그것도 없으면 id',
  B.articleUrl({ id: 9, custom_url: 'a-custom' }).endsWith('/a-custom')
  && B.articleUrl({ id: 9 }).endsWith('/9'));
ok('에디토리얼은 /editorial/<slug>',
  B.editorialUrl({ id: 3, slug: 'e-slug' })
    === 'https://www.pap-magazine.com/editorial/e-slug');

/* ---------------------------------------------------------------- */
section('세 갈래 선정 — 겹치지 않는다');

function seed() {
  TABLES = {
    articles: [
      { id: 1, title: '패션 아카이브', category: 'Fashion', status: 'published',
        published_date: daysAgo(1), scheduled_publish_at: null, slug: 'fa' },
      { id: 2, title: '셀럽 소식', category: 'Celeb', status: 'published',
        published_date: daysAgo(1), scheduled_publish_at: null, slug: 'ce' },
      { id: 3, title: '뉴스+패션', category: 'News,Fashion', status: 'published',
        published_date: daysAgo(2), scheduled_publish_at: null, slug: 'nf' },
      { id: 4, title: '아트', category: 'Art,Culture', status: 'published',
        published_date: daysAgo(2), scheduled_publish_at: null, slug: 'ac' },
      { id: 5, title: '예약 미해제', category: 'Beauty', status: 'published',
        published_date: daysAgo(1), scheduled_publish_at: inFuture(), slug: 'sc' },
      { id: 6, title: '창 밖 기사', category: 'Fashion', status: 'published',
        published_date: daysAgo(10), scheduled_publish_at: null, slug: 'old' },
      { id: 7, title: '', category: 'Fashion', status: 'published',
        published_date: daysAgo(1), scheduled_publish_at: null, slug: 'notitle' },
    ],
    editorials: [
      { id: 11, title: '신작 에디토리얼', legacy: false, status: 'published',
        published_date: daysAgo(3), scheduled_publish_at: null, slug: 'new-ed' },
      { id: 12, title: '아카이브 스프레드', legacy: true, status: 'published',
        published_date: daysAgo(2), scheduled_publish_at: null, slug: 'old-ed' },
      { id: 13, title: '8일 전 신작', legacy: false, status: 'published',
        published_date: daysAgo(8), scheduled_publish_at: null, slug: 'too-old' },
    ],
    social_digest_items: [],
  };
}

const titles = (r) => r.items.map((i) => i.title);

(async () => {
  seed();
  const ed = await B.collect('editorial');
  ok('에디토리얼 갈래는 7일 창', ed.days === 7);
  ok('오리지널(legacy=false)만 들어온다',
    JSON.stringify(titles(ed)) === '["신작 에디토리얼"]',
    '받은 값: ' + JSON.stringify(titles(ed)));

  const co = await B.collect('collection');
  ok('콜렉션 갈래는 3일 창', co.days === 3);
  ok('셀럽이 아닌 기사 + 아카이브 에디토리얼의 합집합',
    titles(co).sort().join('|') === ['패션 아카이브', '아트', '아카이브 스프레드'].sort().join('|'),
    '받은 값: ' + JSON.stringify(titles(co)));
  ok('예약 미해제 기사는 안 들어온다', !titles(co).includes('예약 미해제'));
  ok('창 밖(10일 전) 기사는 안 들어온다', !titles(co).includes('창 밖 기사'));
  ok('제목 없는 행은 버린다', co.items.every((i) => i.title));

  const ce = await B.collect('celeb');
  ok('셀럽 갈래에 News 와 Celeb 이 모두 들어온다',
    titles(ce).sort().join('|') === ['셀럽 소식', '뉴스+패션'].sort().join('|'),
    '받은 값: ' + JSON.stringify(titles(ce)));

  /* 겹침 없음 — 이 파일의 핵심 계약 */
  const key = (i) => i.source + ':' + i.id;
  const all = [...co.items.map(key), ...ce.items.map(key)];
  ok('콜렉션과 셀럽이 한 건도 겹치지 않는다', new Set(all).size === all.length,
    '겹친 값: ' + JSON.stringify(all));

  /* ── 중복 방지 ─────────────────────────────────────────────── */
  section('중복 방지 — 창 계산이 아니라 발행 기록으로 막는다');

  TABLES.social_digest_items = [
    { bucket: 'celeb', source: 'article', source_id: '2', created_at: daysAgo(1) },
  ];
  const ce2 = await B.collect('celeb');
  ok('이미 나간 기사는 다음 다이제스트에서 빠진다',
    JSON.stringify(titles(ce2)) === '["뉴스+패션"]',
    '받은 값: ' + JSON.stringify(titles(ce2)));

  ok('갈래가 다르면 기록이 서로 간섭하지 않는다',
    (await B.collect('collection')).items.length === 3);

  ok('skipDedupe 면 기록을 무시한다 (dry-run 미리보기용)',
    (await B.collect('celeb', { skipDedupe: true })).items.length === 2);

  section('옵션');
  ok('limit 이 개수를 자른다', (await B.collect('collection', { limit: 2 })).items.length === 2);
  ok('days 로 창을 좁힐 수 있다',
    (await B.collect('editorial', { days: 1 })).items.length === 0);

  section('항목 모양 — 링크 목적지를 나중에 고를 수 있게 둘 다 담는다');
  seed();
  TABLES.articles[0].source_instagram_url = 'https://www.instagram.com/p/ABC/';
  const shaped = (await B.collect('collection')).items.find((i) => i.id === '1');
  ok('site_url 과 ig_url 을 함께 담는다',
    shaped.site_url.endsWith('/article/fa') && shaped.ig_url.includes('/p/ABC/'));
  ok('인스타 원본이 없으면 ig_url 은 빈 문자열 (null 아님)',
    (await B.collect('celeb')).items.every((i) => typeof i.ig_url === 'string'));

  /* ---------------------------------------------------------------- */
  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.error('❌ digest-buckets tests failed'); process.exit(1); }
  console.log('✅ digest-buckets tests passed');
})().catch((e) => { console.error('❌ 예외:', e); process.exit(1); });
