/**
 * 아티클 상세 공백 페이지 — 재발 방지 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA(🚨 반복 미해결): "런던패션위크 FW25 스트릿 스타일" 상세가 대표이미지·본문
 * 없이 빈 페이지. 제목·카테고리·해시태그·댓글·추천목록은 정상 표시.
 *
 * ── 원인 (실측) ─────────────────────────────────────────────────────
 * 목록과 상세의 데이터 출처가 달랐다.
 *   · 목록 카드 → frontend/pap-article-db.json (정적 시드 61건)
 *   · 상세 본문 → /api/articles (DB)
 * pap-content-api-sync.js 의 mergeData 마지막 블록이 "API 가 안 돌려준 시드
 * 항목"을 목록에 그대로 밀어넣고 있었다. 그런데 API 가 안 돌려주는 이유는
 * 대개 "그 기사가 공개 상태가 아니어서"다.
 * → 카드는 시드에서 생기고(제목·날짜·태그 보유), 상세는 DB 에 공개 본문이
 *   없어 이미지·본문만 빈 페이지가 됐다. QA 가 본 증상과 정확히 일치한다.
 *
 * 실측 대조(시드 61건 ↔ DB):
 *   DB 에 없음 0 / draft 19 / published 지만 본문 없음 0 / 정상 42
 *   → 공백이 되는 건 draft 19건. QA 가 집은 런던패션위크가 그중 하나.
 *   (본문 86자짜리 luisa-beccaria-backstage-fw26 은 갤러리 33장 있는 정상
 *    기사라 제외했다 — 짧다고 자동으로 지우면 멀쩡한 기사가 사라진다.)
 *
 * 앞선 수정(#10 "홈 시드 기사 링크 → DB 슬러그 재연결")이 왜 안 통했나:
 * 링크가 DB 슬러그를 가리키게만 했지, 그 DB 행이 공개 상태인지는 보지 않았다.
 * 링크는 고쳐졌고 페이지는 열렸지만 내용이 없었다 — 증상만 이동한 셈.
 *
 * ── 수정 (2단) ──────────────────────────────────────────────────────
 * 구조: mergeData 에 authoritative 플래그. 전량 동기화(syncArticles)에서는
 *       API 에 없는 시드를 목록에 넣지 않는다. 시드는 번역 사전 역할만.
 * 데이터: 공백 19건을 시드 json + index.html 정적 카드에서 제거(61→42).
 *
 * 왜 둘 다 하나:
 *  · 구조만 → 최신 12건만 받는 fast path 구간에서 잠깐 유령 카드가 보인다
 *  · 데이터만 → 나중에 다른 기사가 draft 로 바뀌면 그대로 재발한다
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. mergeData 가 실제로 그렇게 동작할 것 (문자열 검사 아닌 실행 검증)
 *  2. 전량 동기화만 authoritative 일 것 (fast path 가 목록을 깎으면 안 됨)
 *  3. 확인된 공백 19건이 시드·홈 카드에 되살아나지 않을 것
 *  4. 홈 정적 카드와 시드 json 이 서로 어긋나지 않을 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const syncSrc = fs.readFileSync(path.join(ROOT, 'frontend/pap-content-api-sync.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/pap-article-db.json'), 'utf8'));

/* 공백으로 확인된 19건. 되살아나면 즉시 실패한다. */
const GHOSTS = [
  'copenhagen-fashion-week-ss26', 'discovering-margins-of-life-a-closets-new-beginning',
  'everlane-x-designer-peter-do', 'givenchys-new-creative-director-sarah-burton',
  'haider-ackermanns-tom-ford', 'how-did-lemaire-become-a-brand-loved-by-parisians',
  'kenzo-nigos-third-collection', 'london-fashion-week-fw25-street-style',
  'milan-design-week-2025-highlights', 'milan-fashion-week-fw26-preview',
  'new-york-fashion-week-fw25-street-style', 'paris-fashion-week-fw26-preview',
  'paris-haute-couture-fw25-highlights', 'paris-pitti-immagine-garden-party-2025',
  'pitti-uomo-fw26-day-1', 'pitti-uomo-fw26-day-2-3',
  'seoul-fashion-week-fw25-street-fashion', 'why-bottega-veneta-is-beloved',
  'why-our-neighborhood-select-shops-disappeared',
];

/* ── mergeData 를 소스에서 떼어내 실제로 돌린다 ──────────────────────
   정규식으로 "그렇게 쓰여 있는지"만 보면, 호출부가 안 바뀌었거나 조건이
   뒤집혀도 통과한다. 함수를 꺼내 실행해 동작 자체를 확인한다. */
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return null;
}

console.log('\n=== 1. mergeData 실행 검증 (동작 확인) ===');
const fnSrc = extractFn(syncSrc, 'mergeData');
t('mergeData 를 소스에서 추출했다', !!fnSrc);

let mergeData = null;
if (fnSrc) {
  // eslint-disable-next-line no-new-func
  mergeData = new Function(fnSrc + '; return mergeData;')();
}
t('mergeData 를 실행 가능한 함수로 만들었다', typeof mergeData === 'function');

if (typeof mergeData === 'function') {
  const apiItem = { t: '진짜 공개 기사', slug: 'real-one' };
  const seedOnly = { t: '유령 기사', slug: 'ghost-one', ti18n: { en: 'Ghost' } };
  const seedDup  = { t: '진짜 공개 기사', slug: 'real-one', ti18n: { en: 'Real One' } };

  const auth = mergeData([Object.assign({}, apiItem)], [seedDup, seedOnly], true);
  t('전량 동기화: API 에 없는 시드는 목록에서 빠진다',
    auth.length === 1 && auth[0].slug === 'real-one',
    '이게 공백 페이지의 직접 원인이었다. 실제=' + JSON.stringify(auth.map(x => x.slug)));
  t('전량 동기화: 시드의 번역(ti18n)은 여전히 보강된다',
    auth[0] && auth[0].ti18n && auth[0].ti18n.en === 'Real One',
    '시드를 목록에서 빼되 번역 사전 역할은 유지해야 한다');

  const fast = mergeData([Object.assign({}, apiItem)], [seedDup, seedOnly], false);
  t('fast path(최신 일부만 수신): 시드를 유지한다',
    fast.length === 2,
    '여기서 시드를 빼면 전량 동기화 전까지 목록이 12건으로 쪼그라든다');

  const apiDown = mergeData([], [seedDup, seedOnly], true);
  t('API 가 0건(장애)이면 시드로 폴백한다 (화면이 비지 않게)',
    apiDown.length === 2);
}

console.log('\n=== 2. 호출부가 올바른 플래그를 넘기는가 ===');
const syncAll = extractFn(syncSrc, 'syncArticles') || '';
const syncFast = extractFn(syncSrc, 'syncArticlesFast') || '';
t('syncArticles(전량) 는 authoritative=true 로 부른다',
  /mergeData\(\s*apiArticles\s*,\s*artData\s*,\s*true\s*\)/.test(syncAll),
  'true 를 안 넘기면 유령 카드가 그대로 남는다');
t('syncArticlesFast 는 authoritative 를 넘기지 않는다',
  /mergeData\(\s*quick\s*,\s*artData\s*\)/.test(syncFast),
  'fast path 에서 true 를 넘기면 목록이 최신 12건으로 줄어든다');

console.log('\n=== 3. 공백 19건이 되살아나지 않았는가 ===');
const seedSlugs = new Set(seed.map(x => x.slug).filter(Boolean));
const backInSeed = GHOSTS.filter(s => seedSlugs.has(s));
t('시드 json 에 공백 기사가 없다 (' + backInSeed.length + '건 발견)', backInSeed.length === 0,
  backInSeed.join(', '));
const backInHome = GHOSTS.filter(s => indexHtml.includes('data-slug="' + s + '"'));
t('홈 정적 카드에 공백 기사가 없다 (' + backInHome.length + '건 발견)', backInHome.length === 0,
  backInHome.join(', '));

console.log('\n=== 4. 홈 정적 카드 ↔ 시드 json 정합 ===');
/* 개수를 숫자로 박아두면 기사 추가 때마다 깨진다. 두 파일을 서로 대조한다. */
const homeSlugs = [...indexHtml.matchAll(/class="fashion-card"[^>]*data-slug="([^"]+)"/g)].map(m => m[1]);
t('홈에 정적 카드가 남아있다 (' + homeSlugs.length + '장)', homeSlugs.length > 0);
const orphans = homeSlugs.filter(s => !seedSlugs.has(s));
t('홈 카드가 전부 시드 json 에 존재한다 (고아 ' + orphans.length + '건)', orphans.length === 0,
  '한쪽만 지우면 목록·상세가 다시 어긋난다: ' + orphans.slice(0, 5).join(', '));

console.log('\n=== 5. 캐시버스트 ===');
const htmlDir = path.join(ROOT, 'frontend');
const htmls = fs.readdirSync(htmlDir).filter(f => f.endsWith('.html'));
const refs = htmls
  .map(f => (fs.readFileSync(path.join(htmlDir, f), 'utf8').match(/pap-content-api-sync\.js\?v=(\d+)/) || [])[1])
  .filter(Boolean);
t('api-sync 를 참조하는 HTML 이 있다 (' + refs.length + '개)', refs.length > 0);
t('모든 HTML 의 ?v= 가 동일하다 (발견: ' + [...new Set(refs)].join(', ') + ')',
  new Set(refs).size === 1,
  '버전이 갈리면 일부 페이지에 옛 코드가 서빙된다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ article-empty-page tests FAILED'); process.exit(1); }
console.log('✅ article-empty-page tests passed');
