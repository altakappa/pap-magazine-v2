/**
 * 홈 전체-카탈로그 동기화 — 언제 · 어떻게 (2026-08-22)
 * ═══════════════════════════════════════════════════════════════════
 * 필드(CrUX) 홈 지표: LCP 6.0s · INP 493ms · CLS 0.4.
 * 기사 페이지(SSR)는 같은 시점에 CLS 0.01 이었다 — 홈만 나빴다.
 *
 * 라이브 실측(warm cache · 데스크톱 · TTFB 94ms · DOMContentLoaded 351ms):
 *   /api/articles   26회  (page=1..26, limit=100)
 *   /api/editorials 24회  (page=1..24, limit=100)
 *   목록 요청 구간 716ms → 4030ms = 3,315ms
 *   DOM 노드 19,557개
 * 즉 화면에는 최신 12건만 보이는데 약 5,000건을 받아 파싱했고, 그 3.3초가
 * 통째로 LCP 창과 겹쳤다. 왕복이 느린 모바일에서는 더 길어진다.
 *
 * 원인은 둘이고 성격이 다르다.
 *   (1) 언제  — requestIdleCallback(timeout:1500) 을 DOMContentLoaded 에서
 *       걸었다. 기준이 351ms 라 실제로는 700ms 쯤, 첫 화면을 그리는 도중에
 *       터졌다. "유휴에 돌린다"는 의도였지만 유휴가 아니었다.
 *   (2) 어떻게 — fetchAll 이 1쪽 응답을 보고 2쪽을 요청하는 순차 재귀였다.
 *       왕복 26번이 직렬로 쌓였다.
 *
 * 고친 방식
 *   (1) 홈에서만 load 이벤트 이후 + 유휴(최대 3초)로 미룬다. 목록·상세
 *       화면은 전체 카탈로그가 곧 화면이라 종전대로 즉시.
 *   (2) 1쪽으로 총 쪽수를 안 뒤 나머지를 동시 6개씩. 요청 "횟수"는 그대로
 *       (Vercel 함수 호출 비용 동일), 대기만 왕복 N → N/6.
 *   + 사용자가 먼저 검색을 열거나 화면을 누르면 타이머를 안 기다린다.
 *
 * 이 테스트가 지키는 것
 *   1. fetchAll 이 실제로 병렬이고, 동시 상한을 지키고, 순서를 보존한다
 *   2. 요청 횟수가 늘지 않는다 (비용 회귀 방지)
 *   3. 한 쪽이 실패해도 나머지를 살린다 (순차판은 거기서 멈췄다)
 *   4. 홈 판정이 언어 프리픽스를 포함해 정확하다
 *   5. 미루기가 load 이후에 걸린다 — DOMContentLoaded 로 되돌아가면 실패
 *   6. 사용자 조기 개입 문(toggleSearch · pointerdown)이 남아 있다
 *   7. HTML 의 ?v= 캐시버스트가 올라갔다
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const SRC = path.join(ROOT, 'frontend/pap-content-api-sync.js');
const src = fs.readFileSync(SRC, 'utf8');

/* ── fetchAll(+_sliceWork) 블록만 떼어내 진짜로 돌려본다 ─────────────── */
const faStart = src.indexOf('  var FETCH_ALL_CONCURRENCY = ');
const faEnd = src.indexOf("        console.warn('[PAP Sync] Fetch error:', endpoint, err);");
const faBlock = src.slice(faStart, src.indexOf('  }\n', faEnd) + 4);
const faMatch = [faBlock];
const CONCURRENCY = Number((src.match(/FETCH_ALL_CONCURRENCY = (\d+)/) || [])[1] || 0);
const SLICE_MS = Number((src.match(/var SLICE_MS = (\d+)/) || [])[1] || 0);

function runFetchAll({ pages, perPage = 100, failPages = [] }) {
  return new Promise((resolve) => {
    let inflight = 0, maxInflight = 0;
    const calls = [];
    const fakeFetch = (url) => {
      const p = Number(url.match(/page=(\d+)/)[1]);
      calls.push(p);
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      return new Promise((res, rej) => setTimeout(() => {
        inflight--;
        if (failPages.indexOf(p) > -1) return rej(new Error('page ' + p));
        res({ json: () => Promise.resolve({
          data: Array.from({ length: perPage }, (_, i) => ({ id: 'p' + p + '-' + i })),
          pagination: { pages },
        }) });
      }, 5));
    };
    const boot = new Function('PAP_API_BASE', 'fetch', 'console', 'performance', 'done',
      faMatch[0] + "\nfetchAll('/x', function(it){ return it.id; }, function(all){ done(all); });");
    boot('/api', fakeFetch, { warn() {} }, { now: () => Number(process.hrtime.bigint() / 1000000n) },
      (all) => resolve({ all, calls, maxInflight }));
  });
}

(async function main() {
  console.log('\n=== 1. fetchAll 이 병렬인가 · 상한을 지키는가 ===');
  t('FETCH_ALL_CONCURRENCY 상수가 있다 (1보다 크고 10 이하)',
    CONCURRENCY > 1 && CONCURRENCY <= 10, 'got ' + CONCURRENCY);
  t('순차 재귀(fetchPage 자기호출)로 되돌아가지 않았다',
    !/function fetchPage\(\)/.test(src));
  t('1쪽 응답의 pagination.pages 로 전체 쪽수를 먼저 안다',
    /pagination && res\.pagination\.pages/.test(src));

  const r26 = await runFetchAll({ pages: 26 });
  t('26쪽 → 2,600건 전부 모은다', r26.all.length === 2600, 'got ' + r26.all.length);
  t('요청 횟수는 26회 그대로 (비용 회귀 없음)', r26.calls.length === 26, 'got ' + r26.calls.length);
  t('동시 요청이 상한을 넘지 않는다', r26.maxInflight <= CONCURRENCY, 'max ' + r26.maxInflight);
  t('실제로 병렬이다 (동시 2건 이상 관측)', r26.maxInflight >= 2, 'max ' + r26.maxInflight);
  t('쪽 순서가 보존된다 (1쪽 → 2쪽 → … → 26쪽)',
    r26.all[0] === 'p1-0' && r26.all[100] === 'p2-0' && r26.all[2500] === 'p26-0');

  console.log('\n=== 2. 실패·경계 ===');
  const rFail = await runFetchAll({ pages: 5, failPages: [3] });
  t('3쪽이 실패해도 나머지 4쪽(400건)은 살린다',
    rFail.all.length === 400, 'got ' + rFail.all.length);
  t('실패해도 남은 쪽 요청을 계속한다', rFail.calls.length === 5, 'got ' + rFail.calls.length);
  const r1 = await runFetchAll({ pages: 1, perPage: 7 });
  t('1쪽뿐이면 추가 요청을 하지 않는다', r1.calls.length === 1 && r1.all.length === 7);
  const r0 = await runFetchAll({ pages: 3, perPage: 0 });
  t('1쪽이 비면 즉시 끝낸다', r0.calls.length === 1 && r0.all.length === 0);

  console.log('\n=== 2-b. 메인 스레드를 조각내 처리한다 (2026-08-22) ===');
  /* 실측: 병렬화 뒤 홈 969ms · 기사 1,765ms 짜리 단일 롱태스크가 남았다.
     6개가 거의 동시에 응답하면 각 .then(마이크로태스크)이 한 태스크 안에서
     연달아 드레인돼 5,000건 변환이 통째로 뭉친다. 그래서 두 겹으로 끊는다. */
  t('_sliceWork 헬퍼가 있다', /function _sliceWork\(items, perItem, done\)/.test(src));
  t('조각 길이 상한이 프레임 예산 안이다 (1~50ms)', SLICE_MS > 0 && SLICE_MS <= 50, String(SLICE_MS));
  t('각 쪽 변환을 별도 태스크로 밀어낸다 (마이크로태스크 연쇄 차단)',
    /function absorb\([\s\S]{0,200}?setTimeout\(function\(\)\{/.test(src));
  t('absorb 안에서도 조각낸다', /absorb[\s\S]{0,300}?_sliceWork\(raw,/.test(src));
  t('requestAnimationFrame 으로 양보하지 않는다 (백그라운드 탭에서 멈춘다)',
    !/requestAnimationFrame\s*\(/.test(src));
  t('_sliceWork 호출은 전부 완료 콜백을 받는다 (비동기인데 렌더가 먼저 도는 것 방지)',
    (src.match(/_sliceWork\(/g) || []).length ===
    (src.match(/_sliceWork\([\s\S]*?\}, function\(\)\{/g) || []).length + 1,
    'sliceWork ' + (src.match(/_sliceWork\(/g) || []).length);
  t('artData 를 채운 뒤에만 후처리한다', /_sliceWork\(merged, function\(a\)\{ artData\.push\(a\); \}, function\(\)\{[\s\S]{0,200}?_afterArticlesFilled/.test(src));
  t('filmAllData 를 채운 뒤에만 후처리한다', /_sliceWork\(merged, function\(f\)\{ filmAllData\.push\(f\); \}, function\(\)\{[\s\S]{0,200}?_afterFilmsFilled/.test(src));
  t('edData 채우기(_populateEdDetailsFromApi)도 조각낸다',
    /_sliceWork\(merged, function\(e\)\{[\s\S]{0,120}?_populateEdDetailsFromApi/.test(src));
  t('applyToEdData 는 완료 콜백을 받는다', /function applyToEdData\(items, done\)/.test(src));
  {
    /* 조각 처리가 실제로 여러 태스크로 나뉘는가 — 동기 완료면 실패한다 */
    const sw = src.match(/function _sliceWork\(items, perItem, done\)\{[\s\S]*?\n  \}/)[0];
    const helper = src.match(/function _nowMs\(\)\{[\s\S]*?\n  \}/)[0];
    let slices = 0;
    const run = new Function('performance', 'setTimeout', 'Date', 'report',
      'var SLICE_MS = ' + SLICE_MS + ';\n' + helper + '\n' + sw + '\n' +
      'var t=0; _sliceWork(new Array(500).fill(1), function(){ t++; }, function(){ report(t); });');
    let fakeNow = 0;
    const ticks = [];
    run({ now: () => (fakeNow += 1) }, (cb) => { slices++; ticks.push(cb); },
        Date, (total) => { globalThis.__sw_total = total; });
    while (ticks.length) ticks.shift()();
    t('500건이 여러 조각으로 나뉜다 (한 태스크에 다 하지 않는다)', slices >= 5, 'slices ' + slices);
    t('나뉘어도 전부 처리된다', globalThis.__sw_total === 500, String(globalThis.__sw_total));
  }

console.log('\n=== 2-c. 홈 캐러셀이 아카이브 전량을 그리지 않는다 (2026-08-22) ===');
{
  /* 실측: #fashionTrack 카드 2,424장 · img 2,424개 · 노드 14,544
     = 홈 전체 19,558 의 74%. 롱태스크 713ms 의 몸통이었다.
     가로 캐러셀은 한 번에 4~6장을 보여준다. 2,424장은 아무도 안 넘긴다. */
  const capM = src.match(/var HOME_CAROUSEL_MAX = (\d+);/);
  t('홈 캐러셀 상한 상수가 있다', !!capM);
  const CAP = capM ? Number(capM[1]) : 0;
  t('상한이 QA #344 를 되살리지 않을 만큼 넉넉하다 (>50)', CAP > 50, String(CAP));
  t('상한이 DOM 을 다시 터뜨릴 만큼 크지 않다 (<=300)', CAP > 0 && CAP <= 300, String(CAP));
  t('candidates 에 실제로 slice 가 걸려 있다',
    /\}\)\.slice\(0, HOME_CAROUSEL_MAX\)/.test(src));
  t('상한은 dedup(정적카드 제외) 이후에 적용된다 — 정적과 겹치는 것으로 자리를 낭비하지 않는다',
    src.indexOf('existingTitles[title]') < src.indexOf('.slice(0, HOME_CAROUSEL_MAX)'));

  /* 정렬 전제: /api/articles 는 published_date DESC. 앞에서 자르는 게 '최신'이다.
     이 전제가 깨지면 상한이 엉뚱한 기사를 남긴다. */
  t('DESC 전제를 주석으로 남겨 뒀다 (전제가 바뀌면 상한이 틀어진다)',
    /published_date DESC[\s\S]{0,80}?최신|앞이 최신/.test(src));
}

console.log('\n=== 3. 홈 판정 ===');
  const hpMatch = src.match(/function _isHomePath\(\)\{[\s\S]*?\n  \}/);
  t('_isHomePath 가 존재한다', !!hpMatch);
  if (hpMatch) {
    const isHome = new Function('location', hpMatch[0] + '; return _isHomePath();');
    [['/', true], ['/index.html', true], ['/ja', true], ['/ja/', true],
     ['/en/index.html', true], ['/articles', false], ['/editorial', false],
     ['/ja/articles', false], ['/magazine', false], ['/community', false],
    ].forEach(([p, want]) => {
      t(`${p} → ${want ? '홈' : '홈 아님'}`, isHome({ pathname: p }) === want);
    });
  }

  console.log('\n=== 4. 언제 도는가 ===');
  t('홈은 load 이벤트 이후에 건다',
    /addEventListener\('load',\s*go,\s*\{\s*once:\s*true\s*\}\)/.test(src));
  t('DOMContentLoaded 에 전체 동기화를 직접 걸지 않는다 (회귀 방지)',
    !/DOMContentLoaded[\s\S]{0,400}?fetchAll\(/.test(src));
  t('syncArticles · syncFilms 는 큐를 거친다',
    /_queueFullSync\(function\(\)\{ syncArticles\(\); \}\)/.test(src) &&
    /_queueFullSync\(function\(\)\{ syncFilms\(\); \}\)/.test(src));
  t('editorials STAGE 2 도 큐를 거친다',
    /STAGE 2[\s\S]{0,400}?_queueFullSync\(/.test(src));
  t('홈이 아니면 종전대로 곧 돈다', /if\(!_isHomePath\(\)\)\{[\s\S]{0,200}?idleSoon\(_flushFullSyncs\)/.test(src));
  t('큐는 한 번만 비워진다 (_fullFired 가드)',
    /if\(_fullFired\) return;\s*_fullFired = true;/.test(src));

  console.log('\n=== 5. 사용자가 먼저 움직이면 ===');
  t('검색창을 열면 즉시 시작한다', /window\.toggleSearch = function\(\)\{[\s\S]{0,120}_flushFullSyncs/.test(src));
  t('첫 pointerdown 에도 즉시 시작한다',
    /addEventListener\('pointerdown'[\s\S]{0,200}?once:\s*true/.test(src));
  t('외부에서 부를 수 있는 문이 열려 있다', /window\.papEnsureFullCatalog = _flushFullSyncs;/.test(src));

  console.log('\n=== 6. 캐시버스트 ===');
  const htmls = fs.readdirSync(path.join(ROOT, 'frontend')).filter((f) => f.endsWith('.html'));
  const vers = new Set();
  htmls.forEach((f) => {
    const h = fs.readFileSync(path.join(ROOT, 'frontend', f), 'utf8');
    const m = h.match(/pap-content-api-sync\.js\?v=(\d+)/);
    if (m) vers.add(Number(m[1]));
  });
  t('이 파일을 싣는 HTML 이 하나 이상 있다', vers.size > 0);
  t('모든 HTML 의 ?v= 가 같다', vers.size === 1, [...vers].join(','));
  t('?v= 가 121 보다 크다 (이 수정 이후 캐시가 갈린다)',
    [...vers].every((v) => v > 121), [...vers].join(','));

  console.log(`\npassed: ${pass}   failed: ${fail}`);
  if (fail) { console.log('❌ home-catalog-defer tests FAILED'); process.exit(1); }
  console.log('✅ home-catalog-defer tests passed');
})();
