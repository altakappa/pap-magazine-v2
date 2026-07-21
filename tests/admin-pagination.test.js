/**
 * 관리자 게시글 목록 페이지네이션 + 집계 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA(🚨 결함): 관리자 게시글 관리(에디토리얼/필름/뉴스/숏츠) 전 목록에서
 * 페이지네이션이 사라졌다. "100건 초과 집계 누락" 건과 원인이 같아 보인다.
 * → QA 추정이 맞았다. 세 증상이 한 뿌리다.
 *
 * ── 원인 ────────────────────────────────────────────────────────────
 * (1) 페이지네이션은 "사라진" 게 아니라 호출부만 끊겨 있었다.
 *     loadEditorialsPage()/renderPagination() 이 파일에 살아 있었지만
 *     어디서도 호출되지 않았다. QA #196(예약 게시물 노출) 때 목록 로더가
 *     상태 3종을 각각 limit=100 으로 받아 합치는 방식으로 바뀌며 페이지
 *     개념이 빠졌고, 옛 함수만 남았다.
 * (2) 카운트는 API 가 주는 pagination.total 을 무시하고 "받아온 배열
 *     길이"를 셌다. API limit 상한이 100 이라 100 에서 멈춘다.
 * (3) 검색·정렬·기간필터도 메모리 배열 기준이라 100건 안에서만 돌았다.
 *
 * 실측 규모: 에디토리얼 2,454건 중 관리자에 106건만 노출(2,348건 접근 불가).
 *            뉴스 646→200, 필름 165→100.
 *
 * ── 왜 "전량 로드 + 클라이언트 페이지네이션" 인가 ──────────────────
 * 서버 페이지네이션으로 가면 검색·정렬·기간필터가 "현재 페이지 안에서만"
 * 도는 지금 문제가 그대로 남는다(관리자 UI 의 필터가 전부 메모리 기준).
 * 그래서 전량을 받아 필터·정렬을 태운 뒤 마지막에 자른다.
 * 전량 로드가 가능하려면 응답이 가벼워야 해서 API 에 관리자용 슬림 컬럼
 * (?fields=admin)을 추가했다 — 에디토리얼 기존 행당 6.7KB(100행 668KB,
 * 3.8초; 전량이면 16MB·95초라 불가능).
 *
 * ⚠ 필름은 일부러 슬림하지 않는다: openFilmModal 이 목록 캐시에서
 *   credits/description/instagram_caption 을 읽어 편집 폼을 채운다.
 *   필름은 165행(129KB)뿐이라 경량화 실익도 없다. 에디토리얼·뉴스는
 *   편집 진입 시 단건 재조회를 하므로(editEditorial/editArticle) 안전하다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 목록 로더가 다시 "한 페이지만" 받는 방식으로 돌아가지 않을 것
 *  2. 4개 목록 모두 페이지네이션을 붙일 것
 *  3. 자르는 시점이 "필터·정렬 뒤"일 것 (앞에서 자르면 검색이 거짓말)
 *  4. 슬림 컬럼이 편집 폼이 필요로 하는 필드를 빼앗지 않을 것
 *  5. 공개 API 응답(SPA 소비)은 건드리지 않을 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const admin = fs.readFileSync(path.join(ROOT, 'frontend/pap-admin.js'), 'utf8');
const edApi = fs.readFileSync(path.join(ROOT, 'api/editorials/index.js'), 'utf8');
const arApi = fs.readFileSync(path.join(ROOT, 'api/articles/index.js'), 'utf8');
const flApi = fs.readFileSync(path.join(ROOT, 'api/films/index.js'), 'utf8');

/** 함수 본문만 잘라낸다(최상위 함수는 열 0 의 } 로 끝난다). */
function fnBody(src, name) {
  const re = new RegExp('^(?:async )?function ' + name + '\\(', 'm');
  const m = src.match(re);
  if (!m) return null;
  const start = m.index;
  const end = src.indexOf('\n}', start);
  return end === -1 ? src.slice(start) : src.slice(start, end + 2);
}

console.log('\n=== 1. 목록 로더가 전량을 받는가 (한 페이지만 받던 원인) ===');
const loaders = {
  loadEditorials: '/editorials',
  loadNews: '/articles',
  loadFilmsFromAPI: '/films',
  loadShortsFromAPI: '/shorts',
};
Object.keys(loaders).forEach((fn) => {
  const body = fnBody(admin, fn);
  t(`${fn} 를 찾았다`, !!body);
  if (!body) return;
  t(`  ${fn} — papFetchAllPages 로 전량 로드`, /papFetchAllPages\(/.test(body));
  t(`  ${fn} — limit=100 단일 요청이 남아있지 않다`,
    !/apiGet\('[^']*limit=100[^']*'\)/.test(body),
    '한 페이지만 받으면 100건 상한 문제가 그대로 재발한다');
});

console.log('\n=== 2. 전량 로더가 pagination.total 을 근거로 남은 페이지를 받는가 ===');
const fetchAll = fnBody(admin, 'papFetchAllPages');
t('papFetchAllPages 존재', !!fetchAll);
t('  pagination.total 을 읽는다', /pagination[\s\S]{0,80}total/.test(fetchAll || ''));
t('  pages 만큼 반복해 이어붙인다', /pages/.test(fetchAll || '') && /concat\(/.test(fetchAll || ''));
t('  병렬 배치로 받는다 (25페이지 순차면 너무 느리다)', /Promise\.all\(/.test(fetchAll || ''));
t('  폭주 방어 상한이 있다', /maxPages|MAX_PAGES/.test(fetchAll || ''));

console.log('\n=== 3. 4개 목록에 페이지네이션이 붙었는가 ===');
const renderers = {
  renderEditorialList: 'editorial',
  renderNews: 'news',
  renderFilms: 'film',
  renderShortsFromAPI: 'shorts',
};
Object.keys(renderers).forEach((fn) => {
  const key = renderers[fn];
  const body = fnBody(admin, fn) || '';
  t(`${fn} — papPaginate('${key}') 호출`, new RegExp("papPaginate\\('" + key + "'").test(body));
  t(`  ${fn} — 페이저 UI 렌더`, new RegExp("papRenderPager\\('" + key + "'").test(body));
  t(`  ${fn} — 재렌더 함수 등록 (페이지 이동용)`,
    new RegExp('PAP_LIST_RERENDER\\.' + key + '\\s*=').test(body));
  t(`  ${fn} — 전체가 아니라 현재 페이지 조각(_pg.slice)을 그린다`,
    /_pg\.slice\.forEach\(/.test(body),
    '전량을 그리면 페이지네이션이 무의미하다');
});

console.log('\n=== 4. 자르는 시점이 필터·정렬 "뒤" 인가 (순서 역전 방지) ===');
Object.keys(renderers).forEach((fn) => {
  const key = renderers[fn];
  const body = fnBody(admin, fn) || '';
  const sortIx = body.search(/_papApplySort\(|\.sort\(function/);
  const pageIx = body.indexOf("papPaginate('" + key + "'");
  t(`${fn} — 정렬(${sortIx}) 이 페이지 자르기(${pageIx}) 보다 앞선다`,
    sortIx > -1 && pageIx > -1 && sortIx < pageIx,
    '먼저 자르면 검색·정렬이 현재 페이지 안에서만 돈다 — 원래 버그와 같은 증상');
});

console.log('\n=== 5. 죽은 페이지네이션 코드가 정리됐는가 ===');
t('loadEditorialsPage 정의가 없다', !/^async function loadEditorialsPage\(/m.test(admin));
t('옛 renderPagination 정의가 없다', !/^function renderPagination\(/m.test(admin));

console.log('\n=== 6. API — 관리자 슬림 컬럼 ===');
t('editorials 에 ADMIN_LIST_COLUMNS 가 있다', /ADMIN_LIST_COLUMNS/.test(edApi));
t('editorials — ?fields=admin 로 분기', /req\.query\.fields === 'admin'/.test(edApi));
const edAdminCols = (edApi.match(/const ADMIN_LIST_COLUMNS = \[([\s\S]*?)\]\.join/) || ['', ''])[1];
['gallery', 'credits', 'fashion', 'instagram_caption', 'description', 'seo_title', 'og_image']
  .forEach((f) => {
    t(`  슬림 컬럼에서 ${f} 제외됨`, !new RegExp("'" + f + "'").test(edAdminCols));
  });
['id', 'title', 'status', 'tags', 'published_date', 'scheduled_publish_at',
 'view_count', 'created_at', 'updated_at', 'admin_edited_at'].forEach((f) => {
  t(`  목록이 실제 쓰는 ${f} 는 유지됨`, new RegExp("'" + f + "'").test(edAdminCols),
    '렌더러/정렬/기간필터가 읽는 필드를 빼면 목록이 깨진다');
});
t('editorials — 슬림 모드에선 related_films 조인을 하지 않는다',
  /isAdminList[\s\S]{0,120}related_films/.test(edApi));
t('articles 에 ADMIN_LIST_COLUMNS 가 있다', /ADMIN_LIST_COLUMNS/.test(arApi));

console.log('\n=== 7. 기존 소비자를 깨뜨리지 않는가 ===');
t('articles 기본 LIST_COLUMNS 는 content 를 계속 내려준다 (SPA 상세가 소비)',
  /const LIST_COLUMNS = \[[\s\S]*?'content'[\s\S]*?\]\.join/.test(arApi));
t('articles 기본 LIST_COLUMNS 는 gallery 를 계속 내려준다',
  /const LIST_COLUMNS = \[[\s\S]*?'gallery'[\s\S]*?\]\.join/.test(arApi));
t('editorials 공개 슬림(?public=1) 경로가 남아있다', /req\.query\.public === '1'/.test(edApi));
t('films 목록은 credits/description 을 계속 내려준다 (openFilmModal 이 캐시에서 읽음)',
  /'credits'/.test(flApi) && /'description'/.test(flApi));
t('films 로더는 fields=admin 을 쓰지 않는다 (위 이유로 슬림 금지)',
  !/papFetchAllPages\('\/films\?fields=admin/.test(admin),
  '필름을 슬림하면 편집 모달이 빈 폼으로 열린다');
const openFilm = fnBody(admin, 'openFilmModal') || '';
t('openFilmModal 이 여전히 목록 캐시에서 하이드레이트한다 (위 제약의 근거)',
  /films\[idx\]/.test(openFilm));

console.log('\n=== 8. 페이지 이동 UI ===');
t('전체 건수를 페이저에 표시한다 (QA 집계 누락 건)',
  /전체 <b[^>]*>'\s*\n?\s*\+ info\.total|info\.total\.toLocaleString\(\)/.test(admin));
t('페이지 크기 선택이 있다', /PAP_PAGE_SIZES/.test(admin) && /papSetPageSize/.test(admin));
t('페이지 크기를 기억한다', /localStorage\.setItem\('pap-admin-pagesize-/.test(admin));
t('필터로 목록이 줄면 페이지를 되돌린다 (빈 화면 방지)',
  /if \(st\.page > pages\) st\.page = pages/.test(admin));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ admin-pagination tests FAILED'); process.exit(1); }
console.log('✅ admin-pagination tests passed');
