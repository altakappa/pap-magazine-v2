/**
 * 페퍼릿 스레드 다이제스트 (2026-08-05 도메니코 확정).
 *
 * PAP 다이제스트와 같은 배선을 타되, 페퍼릿은 네 가지가 다르다. 이 파일은
 * 그 네 가지가 조용히 PAP 쪽으로 되돌아가지 않는지만 지킨다.
 *
 *   1) 소재가 다른 표에서 온다 — pepperit_articles (PAP 은 articles/editorials).
 *      status='published' 만, 창은 발행 요일마다 다르다(수 4일 / 토 3일).
 *      두 창을 합치면 7일이 겹침도 구멍도 없이 딱 덮인다.
 *
 *   2) 제목만 나열한다 — 항목별 소개말이 없다. 그래서 generateNotes()(AI 호출)
 *      를 아예 건너뛴다. 쓰지도 않을 문장에 항목 수만큼 토큰을 쓰고, 자동 발행
 *      경로에 실패 지점을 하나 더 다는 셈이기 때문이다.
 *      상한 14 는 이 포맷의 실측에서 나왔다 — 고정부 82자, 제목 평균 26~28자,
 *      THREADS_MAX 480 → (480-82)/28 ≈ 14. 최종 컷은 fitDown() 이 글자 수로
 *      하므로 상한은 천장보다 조금 위 값이다. **480자를 넘으면 잘리는 게
 *      아니라 게시가 실패한다** — 그래서 길이는 계산이 아니라 실행으로 본다.
 *
 *   3) 톤과 나가는 문이 다르다 — 전체 존댓말, @pepperitmag.
 *      papVoice(호칭 '패퍼들' 치환까지 들어 있는 PAP 목소리 사전)는 안 태운다.
 *
 *   4) 스레드 계정이 다르다 — threads_auth.id 2. **기본값은 여전히 1(PAP)**
 *      이어야 한다. 이게 어긋나면 PAP 자동 게시가 통째로 페퍼릿 계정으로 샌다.
 *      계정 다중화는 순수 추가지 기존 경로 변경이 아니다.
 *
 * 그리고 X 는 만들지 않았다 — 페퍼릿은 X 계정이 없다.
 *
 * Run: node tests/pepperit-digest.test.js  (npm test 에 연결됨)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

/* ── supabase 스텁 ────────────────────────────────────────────────
   digest-buckets.test.js 와 같은 규약(체인 빌더 + then). 네트워크·키 없이
   선정 로직만 본다. 여기서는 어떤 표를 어떤 필터로 읽었는지도 함께 기록한다 —
   "pepperit_articles 를 읽었는가"가 이 갈래의 계약 중 하나이기 때문이다. */
const SUPABASE = path.join(__dirname, '..', 'api', '_lib', 'supabase.js');

let TABLES = {};
const QUERIES = [];
function builder(table) {
  const f = { table, filters: {} };
  QUERIES.push(f);
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

/* 소개말 생성은 ANTHROPIC_API_KEY 가 없으면 곧장 null 이다. 키를 지워 두면
   "AI 를 건너뛴다"를 검증할 때 '키가 없어서 안 불렸다'와 구분이 안 되므로,
   여기서는 가짜 키를 넣고 fetch 를 감시한다. 실제로 안 부르는지를 본다. */
process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
let fetchCalls = 0;
const realFetch = global.fetch;
global.fetch = function () { fetchCalls++; return Promise.reject(new Error('테스트에서 외부 호출 금지')); };

const B = require('../api/_lib/digestBuckets');
const copy = require('../api/_lib/digestCopy');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      → ' + detail : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const titles = (r) => r.items.map((i) => i.title);

/* ---------------------------------------------------------------- */
section('URL — 페퍼릿 기사는 pepperitmag.com 으로 간다');

ok('페퍼릿 기사 URL 은 pepperitmag.com/article/<slug>',
  B.pepperitArticleUrl({ id: 'uuid-1', slug: 'kiss-of-life' })
    === 'https://www.pepperitmag.com/article/kiss-of-life');
ok('slug 이 없으면 id (사이트맵과 같은 정본)',
  B.pepperitArticleUrl({ id: 'uuid-1' }) === 'https://www.pepperitmag.com/article/uuid-1');
ok('PAP 기사 URL 은 예전 그대로 pap-magazine.com',
  B.articleUrl({ id: 9, slug: 'a-slug' }) === 'https://www.pap-magazine.com/article/a-slug');
ok('두 사이트가 표로 갈려 있다',
  B.SITES.pap === 'https://www.pap-magazine.com'
    && B.SITES.pepperit === 'https://www.pepperitmag.com');

/* ---------------------------------------------------------------- */
section('창 길이 — 수 4일 / 토 3일, 합치면 7일');

ok('수요일은 지난 토·일·월·화 (4일)', B.windowDaysFor('pepperit', 3) === 4);
ok('토요일은 지난 수·목·금 (3일)', B.windowDaysFor('pepperit', 6) === 3);
ok('두 창의 합이 정확히 7일 — 겹침도 구멍도 없다',
  B.windowDaysFor('pepperit', 3) + B.windowDaysFor('pepperit', 6) === 7);
ok('발행 요일이 아닌 날은 넓은 쪽(4일)이 기본값',
  B.windowDaysFor('pepperit', 1) === 4);
ok('PAP 갈래는 요일과 무관하게 예전 값 그대로',
  [0, 1, 2, 3, 4, 5, 6].every((d) => B.windowDaysFor('celeb', d) === 4
    && B.windowDaysFor('collection', d) === 3 && B.windowDaysFor('editorial', d) === 7));

/* ---------------------------------------------------------------- */
section('소재 선정 — pepperit_articles, 발행 상태, 창, 상한 14');

function seed(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: 'p' + i, title: '페퍼릿 기사 ' + i, slug: 'p-' + i, category: 'Kpop',
      status: 'published', published_date: daysAgo(1), thumbnail_url: null,
      source_instagram_url: 'https://www.instagram.com/p/P' + i + '/',
    });
  }
  TABLES = { pepperit_articles: rows, social_digest_items: [] };
  return rows;
}

(async () => {
  seed(5);
  TABLES.pepperit_articles.push(
    { id: 'draft', title: '아직 초안', slug: 'd', status: 'draft', published_date: daysAgo(1) },
    { id: 'old', title: '창 밖 기사', slug: 'o', status: 'published', published_date: daysAgo(10) },
    { id: 'notitle', title: '', slug: 'nt', status: 'published', published_date: daysAgo(1) },
  );

  QUERIES.length = 0;
  const pep = await B.collect('pepperit');
  ok('pepperit_articles 를 읽는다 (articles 가 아니다)',
    QUERIES.some((q) => q.table === 'pepperit_articles')
      && !QUERIES.some((q) => q.table === 'articles' || q.table === 'editorials'),
    '읽은 표: ' + JSON.stringify(QUERIES.map((q) => q.table)));
  ok("status='published' 로 좁혀서 읽는다",
    QUERIES.some((q) => q.table === 'pepperit_articles' && q.filters.status === 'published'));
  ok('초안은 안 들어온다', !titles(pep).includes('아직 초안'));
  ok('창 밖(10일 전) 기사는 안 들어온다', !titles(pep).includes('창 밖 기사'));
  ok('제목 없는 행은 버린다', pep.items.every((i) => i.title));
  ok('다섯 건이 들어왔다', pep.items.length === 5, '받은 값: ' + JSON.stringify(titles(pep)));

  ok('항목 모양이 PAP 과 같다 (site_url / ig_url 둘 다 담는다)',
    pep.items.every((i) => typeof i.ig_url === 'string' && /pepperitmag\.com\/article\//.test(i.site_url)));
  ok("source 가 'pepperit' 이다 (중복 방지 키가 PAP 기사와 안 섞이게)",
    pep.items.every((i) => i.source === 'pepperit'));

  /* 상한 14 — 이 값이 사라지면 하루 3~5건 × 4일 창에서 20건 가까이가 조립부로
     밀려들어, fitDown 이 매번 절반 넘게 되돌려 자르는 일을 하게 된다. */
  seed(20);
  const capped = await B.collect('pepperit');
  ok('상한 14 에서 잘린다 (' + capped.items.length + '건)', capped.items.length === 14);
  ok('BUCKETS.pepperit.limit 이 14', B.BUCKETS.pepperit.limit === 14);

  section('정렬 — 당분간 최신순 (화제성 지표가 아직 없다)');
  seed(0);
  TABLES.pepperit_articles = [
    { id: 'a', title: '사흘 전', slug: 'a', status: 'published', published_date: daysAgo(3) },
    { id: 'b', title: '어제', slug: 'b', status: 'published', published_date: daysAgo(1) },
    { id: 'c', title: '이틀 전', slug: 'c', status: 'published', published_date: daysAgo(2) },
  ];
  const sorted = await B.collect('pepperit');
  ok('최신순으로 나온다',
    JSON.stringify(titles(sorted)) === '["어제","이틀 전","사흘 전"]',
    '받은 값: ' + JSON.stringify(titles(sorted)));
  ok('정렬이 별도 함수로 떨어져 있다 (지표가 쌓이면 여기만 교체)',
    typeof B.sortByRecency === 'function');
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'digestBuckets.js'), 'utf8');
  ok('왜 최신순인지가 주석에 남아 있다 (ig_post_metric 미수집 · 매칭 0건)',
    /ig_post_metric/.test(src) && /0건/.test(src));
  ok('교체 지점이 주석에 명시돼 있다',
    /이 함수만[\s\S]{0,20}갈아끼우면/.test(src));

  section('중복 방지 — 갈래로 갈리므로 PAP 기록과 안 섞인다');
  seed(3);
  TABLES.social_digest_items = [
    { bucket: 'pepperit', source: 'pepperit', source_id: 'p0', created_at: daysAgo(1) },
    /* 같은 id 를 PAP 셀럽 갈래가 갖고 있어도 페퍼릿 후보는 안 줄어야 한다. */
    { bucket: 'celeb', source: 'article', source_id: 'p1', created_at: daysAgo(1) },
  ];
  const deduped = await B.collect('pepperit');
  ok('이미 나간 페퍼릿 기사는 빠진다', !titles(deduped).includes('페퍼릿 기사 0'));
  ok('다른 갈래 기록은 간섭하지 않는다', titles(deduped).includes('페퍼릿 기사 1'));
  ok('skipDedupe 면 기록을 무시한다 (dry-run 미리보기)',
    (await B.collect('pepperit', { skipDedupe: true })).items.length === 3);

  /* ---------------------------------------------------------------- */
  section('문안 — 제목만 나열, AI 호출 없음');

  const many = Array.from({ length: 14 }, (_, i) => ({
    source: 'pepperit', id: 'q' + i,
    /* 실측 평균(26~28자)보다 넉넉한 제목으로 최악을 만든다. */
    title: '아이돌 그룹 컴백 무대 현장 스케치 ' + i + ' 번째 이야기와 비하인드',
  }));
  const picked = { bucket: 'pepperit', label: '페퍼릿 소식', days: 4, items: many };

  fetchCalls = 0;
  const built = await copy.build(picked, 'threads');
  ok('문안이 만들어진다', !!built);
  ok('AI 를 한 번도 안 부른다 (제목만 나열이므로)', fetchCalls === 0,
    'fetch 호출 ' + fetchCalls + '회');
  ok('제목만 나열 갈래로 표시돼 있다', copy.isTitleOnly('pepperit') === true);
  ok('PAP 갈래는 여전히 소개말 경로다',
    copy.isTitleOnly('celeb') === false && copy.isTitleOnly('collection') === false);

  ok('480자를 넘지 않는다 (' + built.text.length + '자)',
    built.text.length <= copy.THREADS_MAX, built.text);
  ok('THREADS_MAX 는 480 그대로', copy.THREADS_MAX === 480);
  ok('항목이 실제로 여러 건 실린다 (' + built.items.length + '건)', built.items.length >= 5,
    built.text);
  ok('기록되는 항목은 실제로 실린 것뿐',
    built.items.every((it) => built.text.includes(it.title)));

  const lines = built.text.split('\n');
  ok('소개말 구분자가 한 줄도 없다 (제목만)',
    !built.text.includes(copy.SEP), built.text);
  ok('목록은 번호로 센다', /^1\. /m.test(built.text) && /^2\. /m.test(built.text));

  section('문안 — 톤과 나가는 문');

  ok('머리말이 도메니코가 준 문안 그대로',
    copy.HEADLINE.pepperit.threads === '요 며칠 페퍼릿 소식 모아봤어요 🩷',
    copy.HEADLINE.pepperit.threads);
  ok('첫 줄이 그 머리말', lines[0] === copy.HEADLINE.pepperit.threads, lines[0]);
  ok('꼬리말이 도메니코가 준 문안 그대로',
    copy.PEPPERIT_CLOSING === '더 많은 소식은 인스타에서 확인해주세요 🩷');
  ok('꼬리말이 끝에서 둘째 줄', lines[lines.length - 2] === copy.PEPPERIT_CLOSING,
    lines[lines.length - 2]);
  ok('페퍼릿은 채널과 무관하게 존댓말', copy.isPoliteFor('pepperit', 'threads') === true);
  ok('PAP 스레드는 예전대로 반말', copy.isPoliteFor('celeb', 'threads') === false);
  ok('PAP X 는 예전대로 존댓말', copy.isPoliteFor('celeb', 'x') === true);
  ok('closingFor 가 갈래를 안 받으면 예전 PAP 문장',
    copy.closingFor(false) === '더 많은 현장은 PAP 인스타그램에서 확인!'
      && copy.closingFor(true) === '전체 기사는 인스타에서 보실 수 있어요');

  ok('링크는 딱 하나', (built.text.match(/https?:\/\/\S+/g) || []).length === 1);
  ok('그 링크가 @pepperitmag 프로필',
    built.text.trim().endsWith('https://www.instagram.com/pepperitmag/'), built.text);
  ok('PAP 인스타 링크가 안 섞인다', !built.text.includes('pap_magazine'));
  ok('기사별 링크가 없다 (나가는 문은 하나)', !/pepperitmag\.com\/article/.test(built.text));
  ok('igUrlFor 가 갈래별로 갈린다',
    copy.igUrlFor('pepperit') === copy.IG_URLS.pepperit
      && copy.igUrlFor('celeb') === copy.IG_URLS.pap
      && copy.IG_URL === copy.IG_URLS.pap);

  const copySrc = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'digestCopy.js'), 'utf8');
  ok('페퍼릿에는 papVoice 검수를 안 태운다 (PAP 목소리 사전이라 오탐만 쌓인다)',
    /if \(!isTitleOnly\(bucket\)\) \{[\s\S]{0,400}papVoice\.auditKoreanBody/.test(copySrc));

  /* ---------------------------------------------------------------- */
  section('스레드 계정 다중화 — 기본값은 여전히 1(PAP)');

  const th = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'threads.js'), 'utf8');
  ok('id 하드코딩이 남아 있지 않다',
    !/\.eq\('id', 1\)/.test(th) && !/^\s*id: 1,/m.test(th), 'threads.js 에 id=1 하드코딩');
  ok('기본 계정 상수가 1', /const DEFAULT_ACCOUNT_ID = 1;/.test(th));
  ok('계정 표에 PAP=1 · 페퍼릿=2',
    /1: \{ handle: '@pap_magazine'/.test(th) && /2: \{ handle: '@pepperitmag'/.test(th));
  ok('REDIRECT_URI 는 늘어나지 않았다 (Meta 앱 설정을 안 건드린다)',
    (th.match(/const REDIRECT_URI = /g) || []).length === 1
      && /const REDIRECT_URI = 'https:\/\/www\.pap-magazine\.com\/api\/threads\/callback';/.test(th));

  /* 정규화는 supabase 를 안 타므로 실제로 실행해 본다. 문자열 검사만으로는
     "기본값이 1"이 진짜인지 알 수 없다 — 이게 어긋나면 PAP 게시가 샌다. */
  const threads = require('../api/_lib/threads');
  ok('인자 없이 부르면 1', threads.normalizeAccountId() === 1);
  ok('null·빈 문자열도 1', threads.normalizeAccountId(null) === 1
    && threads.normalizeAccountId('') === 1);
  ok('모르는 값도 1 로 떨어진다 (던지지 않는다)',
    threads.normalizeAccountId(99) === 1 && threads.normalizeAccountId('pepperit') === 1);
  ok('2 는 2 로 (문자열이어도)',
    threads.normalizeAccountId(2) === 2 && threads.normalizeAccountId('2') === 2);
  ok('accountInfo 기본값이 @pap_magazine',
    threads.accountInfo().handle === '@pap_magazine'
      && threads.accountInfo(2).handle === '@pepperitmag');

  section('계정 다중화 — state 왕복 (콜백 도메인을 안 늘리는 대신)');
  ok('state 에 계정 번호가 실린다', /^acct2\./.test(threads.buildState(2)));
  ok('콜백이 그 값을 되읽는다', threads.accountIdFromState(threads.buildState(2)) === 2);
  ok('state 없으면 1', threads.accountIdFromState() === 1
    && threads.accountIdFromState('') === 1);
  ok('옛 형식 state 도 1 로 (하위 호환)', threads.accountIdFromState('pap-1754000000000') === 1);
  ok('authorizeUrl 이 state 를 그대로 싣는다',
    threads.authorizeUrl('acct2.123').includes('state=acct2.123'));

  const oauthSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'threads', 'oauth.js'), 'utf8');
  const cbSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'threads', 'callback.js'), 'utf8');
  ok('oauth 가 계정을 state 에 싣는다', /buildState\(accountId\)/.test(oauthSrc));
  ok('callback 이 state 에서 계정을 되읽어 교환한다',
    /accountIdFromState\(q\.state\)/.test(cbSrc) && /exchangeCode\(code, accountId\)/.test(cbSrc));
  ok('api/threads 는 ../_lib 경로', /require\('\.\.\/_lib\/threads'\)/.test(oauthSrc));

  /* ---------------------------------------------------------------- */
  section('크론 배선 — 페퍼릿은 스레드만, 계정 2');

  const cronSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'cron', 'social-digest.js'), 'utf8');
  const digest = require('../api/cron/social-digest');
  ok('페퍼릿 채널은 스레드 하나뿐 (X 계정이 없다)',
    JSON.stringify(digest.BUCKET_PLATFORMS.pepperit) === '["threads"]');
  ok('PAP 갈래는 채널 표에 없다 = 예전대로 두 채널',
    !digest.BUCKET_PLATFORMS.celeb && !digest.BUCKET_PLATFORMS.collection
      && !digest.BUCKET_PLATFORMS.editorial);
  ok('페퍼릿 스레드 계정은 2', digest.BUCKET_THREADS_ACCOUNT.pepperit === 2);
  ok('PAP 갈래는 계정 표에 없다 = 기본 1', !digest.BUCKET_THREADS_ACCOUNT.celeb);
  ok('게시 함수가 계정을 넘겨받는다',
    /async function publish\(platform, text, threadsAccountId\)/.test(cronSrc));
  ok('미인증 판정도 그 계정 행을 본다',
    /\.eq\('id', accountId\)\.maybeSingle\(\)/.test(cronSrc),
    "id=1 만 보면 PAP 인증만으로 페퍼릿 글이 '나갈 수 있다'고 판단된다");
  ok('창 길이를 요일에서 뽑아 넘긴다',
    /windowDaysFor\(bucket, day\)/.test(cronSrc) && /days: windowDays/.test(cronSrc));
  ok('오늘 같은 갈래 재발행 방어가 살아 있다',
    /today\.filter\(\(r\) => r\.bucket === bucket\)/.test(cronSrc));

  section('마이그레이션 099 — DB 제약을 안 풀면 코드가 맞아도 막힌다');
  const mig = fs.readFileSync(path.join(__dirname, '..', 'supabase_migrations', '099_pepperit_digest.sql'), 'utf8');
  ok("social_digests.bucket 에 'pepperit'",
    /social_digests_bucket_chk[\s\S]{0,160}'pepperit'/.test(mig));
  ok("social_digest_items.source 에 'pepperit'",
    /social_digest_items_source_chk[\s\S]{0,160}'pepperit'/.test(mig));
  ok('threads_auth 의 CHECK (id = 1) 을 푼다 (071 이 한 행으로 못 박아 뒀다)',
    /threads_auth[\s\S]{0,600}CHECK \(id IN \(1, 2\)\)/.test(mig));
  ok('데이터를 안 건드린다 (제약만 손본다)',
    !/\bDELETE\b|\bTRUNCATE\b|\bDROP TABLE\b/i.test(mig));

  /* ---------------------------------------------------------------- */
  global.fetch = realFetch;
  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.error('❌ pepperit-digest tests failed'); process.exit(1); }
  console.log('✅ pepperit-digest tests passed');
})().catch((e) => { console.error('❌ 예외:', e); process.exit(1); });
