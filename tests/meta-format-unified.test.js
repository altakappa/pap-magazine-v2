/**
 * 카테고리·발행일 표기 통일 — 재발 방지 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA(🚨 반복 부분 미해결): 홈·상세는 통일됐는데 아티클 목록(/article)만
 * 다른 형식으로 남아있다.
 *
 * ── 원인: 같은 표기를 만드는 코드가 여러 벌이었다 ───────────────────
 * 표준은 pap-utils.js 의 papFmtMeta = "Title,Case - DD Mon YYYY".
 * 그런데 화면마다 자기 구현을 갖고 있었다:
 *   · articles.html  자체 formatDate + _ART_MONTHS(언어별·전부 대문자)
 *                    → 한국어 UI 에서 "ARTICLE - 05 1월 2025"
 *                      (홈은 "Fashion - 05 Jan 2025")  ← QA 가 본 불일치
 *   · films.html     자체 formatDate (영문 대문자 월)
 *   · api-sync       papFmtMeta 를 쓰되, 없을 때를 대비한 폴백이
 *                    Title-case 를 안 해 조용히 다른 표기를 만들 수 있었다
 *   · seo/listing.js 자체 dateStr → ISO "2025-01-05" (봇이 보는 목록 SSR)
 *
 * 앞선 수정이 "부분만" 반영된 이유가 이것이다. 한 화면씩 고치는 한
 * 남은 구현이 다음 QA 로 돌아온다.
 *
 * ── 수정 ────────────────────────────────────────────────────────────
 * 브라우저: papFmtMeta(pap-utils.js) 하나. 각 화면의 자체 구현은 삭제.
 *           폴백도 제거 — 조용히 갈리느니 눈에 띄게 실패하는 편이 낫다.
 * 서버:     fmtDisplayDate/fmtTitleCat(seoRenderer.js) 하나.
 *           listing.js 가 이를 require 해서 쓴다(datetime 속성은 ISO 유지).
 *
 * 서버와 브라우저는 실행 환경이 달라 코드를 공유할 수 없다. 대신 아래
 * 3번에서 두 구현이 같은 입력에 같은 문자열을 내는지 직접 대조한다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 표준 포맷터가 실제로 표준 형식을 낼 것
 *  2. 각 화면이 자체 구현으로 되돌아가지 않을 것
 *  3. 서버 구현이 브라우저 구현과 계속 같은 결과를 낼 것 (드리프트 감지)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const utils = fs.readFileSync(path.join(ROOT, 'frontend/pap-utils.js'), 'utf8');
const articles = fs.readFileSync(path.join(ROOT, 'frontend/articles.html'), 'utf8');
const films = fs.readFileSync(path.join(ROOT, 'frontend/films.html'), 'utf8');
const apiSync = fs.readFileSync(path.join(ROOT, 'frontend/pap-content-api-sync.js'), 'utf8');
const edJs = fs.readFileSync(path.join(ROOT, 'frontend/pap-content-editorial.js'), 'utf8');
const filmJs = fs.readFileSync(path.join(ROOT, 'frontend/pap-content-film.js'), 'utf8');
const artJs = fs.readFileSync(path.join(ROOT, 'frontend/pap-content-article.js'), 'utf8');
const listing = fs.readFileSync(path.join(ROOT, 'api/seo/listing.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return null;
}

console.log('\n=== 1. 브라우저 표준 포맷터가 표준 형식을 내는가 ===');
const monthsDecl = (utils.match(/var _PAP_MONTHS=\[[^\]]*\];/) || [''])[0];
const browserSrc = [monthsDecl, extractFn(utils, 'papFmtDate'),
  extractFn(utils, 'papTitleCat'), extractFn(utils, 'papFmtMeta')].join('\n');
t('papFmtMeta 일가를 pap-utils.js 에서 추출했다',
  monthsDecl && browserSrc.indexOf('function papFmtMeta') > -1);

let papFmtMeta = null;
try {
  // eslint-disable-next-line no-new-func
  papFmtMeta = new Function(browserSrc + '; return papFmtMeta;')();
} catch (e) { /* 아래 단언에서 잡힌다 */ }
t('papFmtMeta 를 실행 가능한 함수로 만들었다', typeof papFmtMeta === 'function');

if (typeof papFmtMeta === 'function') {
  t('표준 형식: "Fashion - 05 Jan 2025"',
    papFmtMeta('fashion', '2025-01-05') === 'Fashion - 05 Jan 2025',
    '실제=' + papFmtMeta('fashion', '2025-01-05'));
  t('복수 카테고리도 각각 첫 글자만 대문자',
    papFmtMeta('fashion,art', '2026-02-06') === 'Fashion,Art - 06 Feb 2026',
    '실제=' + papFmtMeta('fashion,art', '2026-02-06'));
  t('날짜가 없으면 구분자도 붙지 않는다',
    papFmtMeta('fashion', '') === 'Fashion',
    '실제=' + JSON.stringify(papFmtMeta('fashion', '')));
}

console.log('\n=== 2. 각 화면이 표준 포맷터를 쓰는가 (자체 구현 부활 금지) ===');
t('아티클 목록이 papFmtMeta 를 쓴다 (QA 지적 화면)',
  /cat\.textContent\s*=\s*papFmtMeta\(/.test(articles));
t('필름 목록이 papFmtMeta 를 쓴다',
  /cat\.textContent\s*=\s*papFmtMeta\(/.test(films));
t('홈 동적 카드가 papFmtMeta 를 쓴다',
  /var meta\s*=\s*papFmtMeta\(/.test(apiSync));
/* 2026-07-21 QA(전역 통일) — 지적받은 화면만 고치는 방식을 끝내기 위해
   날짜를 표시하는 공개 표면을 전부 여기에 등록한다. 새 화면이 생기면
   이 목록에 추가하는 것이 규칙이다. */
t('에디토리얼 행 카드가 papFmtMeta 를 쓴다',
  /ed-row-card-cat">'\+papFmtMeta\(/.test(edJs),
  'e.date 를 그대로 붙이면 ISO 로 나온다 — 이번 QA 가 지적한 지점');
t('필름 카드가 papFmtMeta 를 쓴다',
  /film-all-cat">'\+papFmtMeta\(/.test(filmJs));
t('필름 상세가 papFmtMeta 를 쓴다',
  /var catStr\s*=\s*papFmtMeta\(/.test(filmJs));
t('아티클 목록·상세에 폴백 분기가 없다',
  !/typeof papFmtMeta\s*===\s*'function'/.test(artJs),
  '폴백은 Title-case 를 빠뜨려 조용히 다른 표기를 만든다');
/* 원시 날짜를 그대로 붙이는 패턴이 되살아나면 실패. */
[['pap-content-editorial.js', edJs], ['pap-content-film.js', filmJs],
 ['pap-content-article.js', artJs]].forEach(([n, src]) => {
  const raw = /\+\s*'\s*·\s*'\s*\+\s*[a-z]\.(date|d)\b|[a-z]\.(date|d)\s*\.substring\(0,\s*10\)/.test(
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
  t(n + ' 에 원시 날짜 출력이 없다', !raw,
    'ISO 문자열을 그대로 화면에 붙이면 형식이 갈린다');
});

/* 표준을 정의하는 pap-utils.js 밖에서 "월 번호 → 월 이름"으로 날짜 문자열을
   만들면 안 된다. 그 신호는 months[d.getMonth()] 꼴의 배열 인덱싱이다.
   월 이름 배열 자체를 금지하면 오탐이 난다 — api-sync 의 _normalizeIssueLabel
   은 "APR. ISSUE" → VOL.31 을 파싱하려고 월 이름표를 쓰는데, 이건 표기
   포맷과 무관하다(반대 방향 변환). 그래서 용도로 구분한다. */
const FMT_RE = /\w+\s*\[\s*\w+\.getMonth\(\)\s*\]/;
[['articles.html', articles], ['films.html', films],
 ['pap-content-api-sync.js', apiSync]].forEach(([name, src]) => {
  t(name + ' 이 자체적으로 월 이름을 찍지 않는다', !FMT_RE.test(src),
    '자체 포맷이 다시 생기면 표기가 또 갈린다');
});
t('pap-utils.js 에는 그 포맷 코드가 있다 (테스트 규칙 자체 검증)',
  FMT_RE.test(utils),
  '표준 구현조차 안 잡히면 위 3건은 무의미하게 통과한 것이다');
t('articles.html 에 자체 formatDate 가 없다', !/function formatDate\(/.test(articles));
t('films.html 에 자체 formatDate 가 없다', !/function formatDate\(/.test(films));
t('홈 카드 meta 에 폴백 분기가 없다',
  !/typeof papFmtMeta\s*===\s*'function'\s*\)?\s*\n?\s*\?/.test(apiSync),
  '폴백은 Title-case 를 빠뜨려 조용히 다른 표기를 만든다');

console.log('\n=== 3. 목록 SSR(봇이 보는 화면) ===');
t('listing.js 가 공용 포맷터를 require 한다',
  /require\(['"]\.\.\/_lib\/seoRenderer['"]\)/.test(listing));
t('보이는 날짜가 ISO 원문이 아니다',
  /<time datetime="'\s*\+\s*it\.date\s*\+\s*'">'\s*\+\s*esc\(fmtDisplayDate\(it\.date\)\)/.test(listing),
  'datetime 속성은 ISO 유지, 텍스트만 DD Mon YYYY');

console.log('\n=== 4. 서버 구현이 브라우저 구현과 같은 결과를 내는가 (드리프트 감지) ===');
/* 서버·브라우저는 코드를 공유할 수 없다. 그래서 "같은 코드인가"가 아니라
   "같은 결과인가"를 본다 — 한쪽만 고치면 여기서 잡힌다. */
let seo = null;
try { seo = require(path.join(ROOT, 'api/_lib/seoRenderer.js')); } catch (e) { /* 아래에서 잡힌다 */ }
t('seoRenderer 가 fmtDisplayDate 를 내보낸다', !!(seo && typeof seo.fmtDisplayDate === 'function'));
t('seoRenderer 가 fmtTitleCat 를 내보낸다', !!(seo && typeof seo.fmtTitleCat === 'function'));

if (seo && seo.fmtDisplayDate && seo.fmtTitleCat && typeof papFmtMeta === 'function') {
  const cases = [
    ['fashion', '2025-01-05'], ['fashion,art', '2026-02-06'],
    ['beauty', '2026-12-31'], ['culture,celeb,fashion', '2019-07-01'],
    ['', '2026-07-21'],
  ];
  let mismatch = null;
  for (const [cat, date] of cases) {
    const server = (() => {
      const c = seo.fmtTitleCat(cat || 'Article');
      const d = seo.fmtDisplayDate(date);
      return c + (c && d ? ' - ' : '') + d;
    })();
    const browser = papFmtMeta(cat || 'Article', date);
    if (server !== browser) { mismatch = { cat, date, server, browser }; break; }
  }
  t('서버·브라우저 표기가 모든 표본에서 일치한다', !mismatch,
    mismatch ? JSON.stringify(mismatch) : '');
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ meta-format-unified tests FAILED'); process.exit(1); }
console.log('✅ meta-format-unified tests passed');
