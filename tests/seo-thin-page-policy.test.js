/**
 * 얇은 페이지 정책 (2026-08-05) — GSC 실측으로 정한 컷과, **철회한 컷 하나**.
 *
 * ── 유지되는 것 (단단한 실측 위) ────────────────────────────────────
 * ① 오래된 기사는 원문조차 클릭이 0이다.
 *    한국어 원문 기사 클릭을 발행 나이로 가르면
 *      30일 이내 81.1% · 31~90일 18.2% · 91일~1년 0.7% · 1년 초과 0.0%
 *    그런데 남은 번역 백필 8,282건은 전부 4개월 이상 된 것들이었다.
 *    → 크론에 90일 컷.
 * ② zh 성공 번역 329건의 원문 길이는 최대 2,293자, 6,000자 초과 성공 0건.
 *    9,052 / 12,963자짜리 두 건이 큐 선두에 박혀 179건을 막고 있었다.
 *    → 6,000자 상한.
 *
 * ── 철회한 것 (2026-08-05 같은 날) ──────────────────────────────────
 * 에디토리얼 번역본 noindex 는 붙였다가 뗐다. 근거가 판정에 못 미쳤다:
 *   1) 번역이 너무 어리다 — 에디토리얼 번역 최초 생성 2026-07-16,
 *      30일 넘은 행 0건. 색인이 붙기 전에 '클릭 0' 을 결론으로 썼다.
 *   2) 사이트맵 5,000행 상한 버그(f74cf1c, 08-04)로 약 11,200쪽이
 *      측정 기간 대부분 검색엔진에 알려지지도 않았다.
 *   3) 원본(한국어) 에디토리얼이 같은 증상을 더 크게 보인다 —
 *      /editorial/dark-girl 355노출 0클릭, /editorial/asdfghjkl 315노출 0클릭.
 *      번역본만 색인에서 빼는 건 원인 진단이 아니라 증상 회피다.
 * 번역 '생성' 도 같은 날 되살렸다 — 사이트 안 언어 전환이 seo_translations
 * 를 읽기 때문에, 번역이 없으면 비-ko/en 방문자가 /en 으로 302 된다.
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① 에디토리얼 번역본이 **색인 가능**할 것 (noindex 재발 방지)
 *   ② hreflang 이 번역 언어를 계속 선언할 것
 *   ③ 원본(ko/en)과 아티클 번역도 index 유지
 *   ④ 크론은 나이 컷을 걸고, 관리자 수동 경로는 안 걸 것 (에버그린 예외)
 *   ⑤ 나이 컷이 RPC 경로와 폴백 경로에서 동일하게 적용될 것
 *   ⑥ 마이그레이션 102 가 앱과 같은 인자를 정의할 것
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const RENDERER = path.join(ROOT, 'api', '_lib', 'seoRenderer.js');
const HELPER = path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js');
const SUPABASE = path.join(ROOT, 'api', '_lib', 'supabase.js');
const CRON = path.join(ROOT, 'api', 'cron', 'backfill-translations.js');
const MIG = path.join(ROOT, 'supabase_migrations', '102_seo_translate_queue_since.sql');
const MIG3 = path.join(ROOT, 'supabase_migrations', '103_seo_translate_length_cap.sql');
const MIG4 = path.join(ROOT, 'supabase_migrations', '104_translate_health_include_editorial.sql');
const MIG6 = path.join(ROOT, 'supabase_migrations', '106_translate_health_no_age_cut.sql');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); }
}
function inject(p, exports) {
  const m = new Module(p, null);
  m.filename = p; m.loaded = true; m.exports = exports;
  require.cache[p] = m;
}

/* ── ①②③ 렌더러: 실제로 HTML 을 뽑아 확인한다 (문자열 검사 아님) ── */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test';

const { renderSeoHtml } = require(RENDERER);

const REC = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'silk-cocoon',
  title: 'Silk Cocoon',
  title_en: 'Silk Cocoon',
  description: '실크 코쿤 화보',
  description_en: 'A silk cocoon editorial',
  cover_image: 'https://example.com/a.jpg',
  gallery: ['https://example.com/a.jpg'],
  published_date: '2026-07-01',
  status: 'published',
};
const LANGS = ['it', 'fr', 'es', 'ja', 'de', 'ru', 'zh'];

console.log('\n=== ① 에디토리얼 번역본은 색인 가능하다 (noindex 재발 방지) ===');
for (const l of LANGS) {
  const html = renderSeoHtml('editorial', REC, { lang: l, availableLangs: ['ko', 'en'].concat(LANGS) });
  const robots = (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1];
  const gbot = (html.match(/<meta name="googlebot" content="([^"]*)"/) || [])[1];
  t(`/${l}/editorial → index`, /^index/.test(robots || '') && /^index/.test(gbot || ''), { l, robots, gbot });
}
{
  const html = renderSeoHtml('editorial', REC, { lang: 'it', availableLangs: ['ko', 'en'].concat(LANGS) });
  t('noindex 문자열이 어디에도 없다', !/noindex/.test(html));
}

console.log('\n=== ② hreflang 은 번역 언어를 계속 선언한다 ===');
{
  const html = renderSeoHtml('editorial', REC, { lang: 'ko', availableLangs: ['ko', 'en'].concat(LANGS) });
  const tags = html.match(/hreflang="([a-z-]+)"/g) || [];
  const langs = tags.map(x => x.replace(/.*"([a-z-]+)"/, '$1'));
  t('ko/en 은 그대로 선언된다', langs.includes('ko') && langs.includes('en'), langs.join(','));
  t('번역 7개 언어가 전부 선언된다',
    LANGS.every(l => langs.includes(l)), langs.join(','));
  t('x-default 는 한국어 원본을 가리킨다', langs.includes('x-default'), langs.join(','));
}

console.log('\n=== ③ 원본과 아티클은 건드리지 않는다 ===');
for (const l of ['ko', 'en']) {
  const html = renderSeoHtml('editorial', REC, { lang: l, availableLangs: ['ko', 'en'] });
  const robots = (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1];
  t(`/${l} 에디토리얼 원본은 index 유지`, /^index/.test(robots || ''), robots);
}
for (const l of ['it', 'ja', 'ko']) {
  const html = renderSeoHtml('article', Object.assign({}, REC, { content: '<p>본문</p>' }),
    { lang: l, availableLangs: ['ko', 'en'].concat(LANGS) });
  const robots = (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1];
  t(`/${l} 아티클은 index 유지 (ja CTR 8.9% · it 순위 4.9)`, /^index/.test(robots || ''), robots);
}
{
  const html = renderSeoHtml('article', Object.assign({}, REC, { content: '<p>본문</p>' }),
    { lang: 'ko', availableLangs: ['ko', 'en', 'it', 'ja'] });
  const langs = (html.match(/hreflang="([a-z-]+)"/g) || []).map(x => x.replace(/.*"([a-z-]+)"/, '$1'));
  t('아티클 hreflang 은 번역 언어를 계속 선언한다',
    langs.includes('it') && langs.includes('ja'), langs.join(','));
}

/* ── ④⑤ 나이 컷 ── */
console.log('\n=== ④ 크론은 나이 컷, 관리자는 예외 ===');
const cronSrc = fs.readFileSync(CRON, 'utf8');
const adminSrc = fs.readFileSync(path.join(ROOT, 'api/admin/backfill-translations.js'), 'utf8');
t('크론이 sinceDate 를 계산해 넘긴다',
  /sinceDate/.test(cronSrc) && /runBackfillBatch\(\{[^}]*sinceDate/.test(cronSrc));
/* 2026-08-06 — 기본값이 90 에서 0(제한 없음)으로 바뀌었다.
   근거는 검색이 아니라 사이트 경험이다: 번역이 없으면 비-ko/en 방문자가
   /en 으로 302 되고, 중국어는 기사 10개 중 8개가 그 상태였다(커버율 22.4%).
   컷 자체는 손잡이로 남겨 둔다 — env 로 다시 걸 수 있어야 한다. */
t('기본 컷 없음 (전량 번역)', /return 0;/.test(cronSrc) && /SEO_TRANSLATE_MAX_AGE_DAYS/.test(cronSrc));
t('나이 컷 손잡이는 살아 있다 (env 로 다시 걸 수 있다)',
  /0 = 제한 없음|MAX_AGE_DAYS > 0/.test(cronSrc) && /sinceDate/.test(cronSrc));
t('관리자 수동 경로는 sinceDate 를 넘기지 않는다 (에버그린 예외)',
  !/sinceDate/.test(adminSrc), '관리자에서 나이 제한이 걸리면 오래된 에버그린을 못 번역한다');
t('note 에 어떤 컷으로 돌았는지 남는다', /컷/.test(cronSrc));

console.log('\n=== ⑤ RPC 경로와 폴백 경로가 같은 컷을 쓴다 ===');
const libSrc = fs.readFileSync(HELPER, 'utf8');
t('RPC 에 p_since 를 넘긴다', /p_since: since/.test(libSrc));
t('폴백도 published_date 로 거른다', /inAge/.test(libSrc) && /published_date/.test(libSrc));
t('폴백 조회가 published_date 를 실제로 select 한다',
  (libSrc.match(/columns: '[^']*published_date/g) || []).length === 2,
  '두 kind 모두 필요 — 안 가져오면 폴백에서 전부 걸러진다');

/* 런타임 확인: 스텁 DB 로 실제 호출해 인자가 실리는지 본다 */
const calls = [];
inject(SUPABASE, {
  supabaseAdmin: {
    rpc(name, args) {
      calls.push({ name, args });
      if (name === 'seo_translate_counts') return Promise.resolve({ data: [{ remaining: 0, no_source: 0 }], error: null });
      return Promise.resolve({ data: [], error: null });
    },
    from() {
      const q = { select: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({ data: [], error: null }) };
      return q;
    },
  },
});
delete require.cache[HELPER];
const helper = require(HELPER);
process.env.ANTHROPIC_API_KEY = 'test';

(async () => {
  await helper.runBackfillBatch({ lang: 'de', kind: 'article', batch: 1, sinceDate: '2026-05-07' });
  const q = calls.find(c => c.name === 'seo_translate_queue_article');
  const c = calls.find(c => c.name === 'seo_translate_counts');
  t('큐 RPC 에 p_since 가 실린다', q && q.args.p_since === '2026-05-07', q && q.args);
  t('카운트 RPC 에도 같은 p_since 가 실린다', c && c.args.p_since === '2026-05-07', c && c.args);

  calls.length = 0;
  await helper.runBackfillBatch({ lang: 'de', kind: 'article', batch: 1 });   // 관리자 경로
  const q2 = calls.find(x => x.name === 'seo_translate_queue_article');
  t('sinceDate 를 안 주면 p_since 는 null (관리자 = 제한 없음)',
    q2 && q2.args.p_since === null, q2 && q2.args);

  console.log('\n=== ⑥ 마이그레이션 102 가 같은 인자를 정의한다 ===');
  const sql = fs.readFileSync(MIG, 'utf8');
  t('queue_article 에 p_since 정의', /seo_translate_queue_article\([\s\S]*?p_since\s+date/.test(sql));
  t('counts 에 p_since 정의', /seo_translate_counts\([\s\S]*?p_since\s+date/.test(sql));
  t('기본값 null — 옛 4인자 호출 하위호환', (sql.match(/p_since\s+date default null/g) || []).length === 2);
  t('DROP 후 GRANT 를 다시 준다 (DROP 하면 권한이 사라진다)',
    /drop function if exists/.test(sql) && /grant execute on function[\s\S]*to service_role/.test(sql));
  t('여전히 읽기 전용(stable) 이다', (sql.match(/language sql stable/g) || []).length === 2);

  /* ── ⑦ 원문 길이 상한 (2026-08-05 zh poison pill) ────────────────── */
  console.log('\n=== ⑦ 원문 길이 상한 — 거대한 기사가 큐를 막지 못한다 ===');
  calls.length = 0;
  await helper.runBackfillBatch({ lang: 'zh', kind: 'article', batch: 1, sinceDate: '2026-05-07', maxSrcChars: 6000 });
  const q3 = calls.find(x => x.name === 'seo_translate_queue_article');
  const c3 = calls.find(x => x.name === 'seo_translate_counts');
  t('큐 RPC 에 p_max_src 가 실린다', q3 && q3.args.p_max_src === 6000, q3 && q3.args);
  t('카운트에도 같은 상한이 실린다', c3 && c3.args.p_max_src === 6000, c3 && c3.args);
  calls.length = 0;
  await helper.runBackfillBatch({ lang: 'zh', kind: 'article', batch: 1 });
  const q4 = calls.find(x => x.name === 'seo_translate_queue_article');
  t('상한을 안 주면 0 = 제한 없음 (관리자 경로)', q4 && q4.args.p_max_src === 0, q4 && q4.args);

  const cron2 = fs.readFileSync(CRON, 'utf8');
  t('크론 기본 상한은 6000자', /return 6000;/.test(cron2) && /SEO_TRANSLATE_MAX_SRC_CHARS/.test(cron2));
  t('크론이 maxSrcChars 를 넘긴다', /maxSrcChars: MAX_SRC_CHARS/.test(cron2));
  t('note 에 길이로 뺀 건수를 따로 보여준다', /긴글/.test(cron2),
    '잔여와 합치면 큐가 막힌 상태를 할 일이 남은 것으로 착각한다');
  const lib2 = fs.readFileSync(HELPER, 'utf8');
  t('폴백 경로에도 같은 상한이 걸린다', /notTooLong/.test(lib2));
  t('제외 건수를 반환한다', /skipped_too_long/.test(lib2));

  console.log('\n=== ⑧ 마이그레이션 103 · 감시 함수 정합 ===');
  const sql3 = fs.readFileSync(MIG3, 'utf8');
  t('queue_article 에 p_max_src 정의', /seo_translate_queue_article\([\s\S]*?p_max_src\s+int/.test(sql3));
  t('counts 가 too_long 을 따로 돌려준다', /too_long\s+bigint/.test(sql3));
  t('감시 함수(translate_health_stats)도 같이 고친다',
    /create or replace function public\.translate_health_stats/.test(sql3),
    '안 고치면 잔량 8,124 로 매일 오경보가 울린다');
  /* 앱과 SQL 이 같은 숫자를 써야 한다 — 어긋나면 감시가 거짓말을 한다. */
  /* 103 은 90일 컷 시절의 정합을 잡아 두었다. 2026-08-06 에 컷을 떼면서
     감시 함수의 최신판은 106 이 되었다 — 아래 ⑨에서 본다. 여기서는 103 이
     '그 시점에는 맞았다' 는 것만 확인한다(파일은 역사 기록이다). */
  t('103 은 당시 기준(90일)으로 감시 함수를 맞춰 두었다', /current_date - 90/.test(sql3));
  t('감시 함수의 6000자가 앱 기본값과 같다',
    /<= 6000/.test(sql3) && /return 6000;/.test(cron2));
  /* 함수 '본문'만 떼어 본다 — 파일 앞쪽 주석·다른 함수에도 같은 낱말이
     나오므로 통째로 grep 하면 엉뚱한 곳이 잡힌다(처음에 그렇게 짜서 헛failed). */
  /* 감시 함수의 최신판은 104 다(103 에서 아티클만 세도록 좁혔다가, 에디토리얼
     번역을 되돌리면서 다시 넓혔다). 최신 파일을 본다 — 함수 '본문'만 떼어서. */
  const sql4 = fs.readFileSync(MIG4, 'utf8');
  const healthBody = (sql4.split('create or replace function public.translate_health_stats')[1] || '').split('$$;')[0];
  t('감시 함수가 아티클과 에디토리얼을 모두 센다',
    /from public\.articles a/.test(healthBody) && /from public\.editorials e/.test(healthBody),
    '한쪽만 세면 다른 쪽이 막혀도 경보가 안 울린다');
  t('6000자 상한은 아티클에만 적용된다 (에디토리얼은 저장 전 1,200자로 잘림)',
    (healthBody.match(/<= 6000/g) || []).length === 1);

  /* ── ⑨ 마이그레이션 106 · 나이 컷 제거 후의 앱↔감시 정합 ──
     2026-08-05 에 정확히 반대 방향으로 사고가 났다 — 감시가 컷을 모른 채
     전체를 세어 '잔량 8,124' 오경보를 올렸고 실제 대상은 181건이었다.
     앱과 감시가 어긋나면 경보를 못 믿게 되고, 못 믿는 경보는 없는 것만 못하다. */
  console.log('\n=== ⑨ 마이그레이션 106 · 나이 컷 제거 정합 ===');
  const sql6 = fs.readFileSync(MIG6, 'utf8');
  const body6 = (sql6.split('create or replace function public.translate_health_stats')[1] || '').split('$$;')[0];
  t('106 이 감시 함수를 다시 정의한다',
    /create or replace function public\.translate_health_stats/.test(sql6));
  t('감시 함수에 나이 컷이 없다 — 앱 기본값(0)과 같다',
    !/current_date - 90/.test(body6) && /return 0;/.test(cron2),
    body6.slice(0, 200));
  t('감시 함수가 아티클과 에디토리얼을 모두 센다 (106)',
    /from public\.articles a/.test(body6) && /from public\.editorials e/.test(body6));
  t('6000자 상한은 유지된다 — 근거가 다르다(poison pill 방지)',
    (body6.match(/<= 6000/g) || []).length === 1 && /return 6000;/.test(cron2));

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) process.exit(1);
  console.log('✓ seo-thin-page-policy tests passed');
})().catch(e => { console.error(e); process.exit(1); });
