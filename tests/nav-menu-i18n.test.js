/**
 * 햄버거 메뉴 우측 항목 다국어 테스트 (2026-07-21)
 * ═══════════════════════════════════════════════════════════════════
 * QA: 우측 메뉴(커뮤니티/매거진/에디토리얼/아티클/필름)의 언어가 페이지마다
 * 다르고, 커뮤니티는 다른 페이지를 거쳐 재방문하면 영문으로 고정된다.
 *
 * ── 실측 (Chrome, 라이브) ───────────────────────────────────────────
 *  · 우측 5개는 #papNavRightCol 안에 있고, 이 컬럼은 /api/nav-menu 응답으로
 *    통째로 교체된다. API 가 주는 label_default 는 전부 영문이다.
 *  · 교체 직후 window.applyI18n() 을 부르고 있었는데 → typeof 결과 undefined.
 *    이 코드베이스 어디에도 정의가 없다(전 페이지 grep 0건). typeof 가드가
 *    조용히 건너뛰어 아무 일도 일어나지 않았다.
 *  · window._papApplyHeaderI18n('ko') 를 직접 부르면 즉시 한글로 바뀐다.
 *    즉 사전(_hdrT)에 5개 키가 다 있고 함수도 멀쩡했다. 부르는 이름만 틀렸다.
 *
 * ── 왜 페이지마다 달라 보였나 (경쟁 조건) ──────────────────────────
 * 헤더 주입 직후 _papApplyHeaderI18n(saved) 가 "하드코딩 폴백 마크업"을 번역해
 * 둔다. 그 뒤 fetch 가 도착하면 그 자리를 영문으로 갈아끼운다.
 *   · API 가 느리거나 실패 → 번역된 폴백이 살아남아 한글
 *   · API 가 캐시에서 즉시 도착 → 영문으로 교체된 뒤 그대로
 * "커뮤니티가 처음엔 한글인데 다른 페이지 갔다 오면 영문 고정"이 정확히 이
 * 순서 차이다(재방문 시 응답이 캐시에서 즉시 온다).
 *
 * ── 폰트 굵기에 대하여 ──────────────────────────────────────────────
 * QA 가 "굵은 폰트"라고 본 것은 결함이 아니다. .nav-right-col a 는
 * font-weight:900 / font-size clamp(40px,7vw,90px) 인 대형 메뉴로 의도된
 * 디자인이다. 영문일 때 Montserrat 900 이 유난히 두꺼워 보였을 뿐이고,
 * 한글로 정상 표시되면 인상이 달라진다. 굵기 자체는 건드리지 않았다.
 *
 * ── 이 테스트가 지키는 것 ──────────────────────────────────────────
 *  1. 동적 메뉴 교체 후 "헤더 자신의" 번역기를 부를 것
 *  2. 존재하지 않는 함수에 기대지 말 것 (조용히 건너뛰는 코드 금지)
 *  3. 헤더 사전이 우측 5개 키를 계속 가질 것
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); if (detail) console.log('      ', detail); }
}

const hdr = fs.readFileSync(path.join(ROOT, 'frontend/pap-header.js'), 'utf8');

function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  return '';
}

console.log('\n=== 1. 동적 메뉴 교체 후 헤더 번역기를 부르는가 ===');
const loader = extractFn(hdr, '_papLoadDynamicNavMenu');
t('_papLoadDynamicNavMenu 를 찾았다', loader.length > 0);
t('우측 컬럼을 교체한다 (동작 전제 확인)', /col\.innerHTML\s*=\s*html/.test(loader));
t('교체 직후 _papApplyHeaderI18n 을 부른다',
  /col\.innerHTML\s*=\s*html;[\s\S]{0,1200}window\._papApplyHeaderI18n\(/.test(loader),
  'API 가 주는 label_default 는 영문이라, 안 부르면 그대로 영문으로 남는다');
t('현재 언어를 _papCurrentLang 에서 가져온다',
  /window\._papCurrentLang\(\)/.test(loader),
  '언어를 하드코딩하면 사용자의 선택을 무시한다');

console.log('\n=== 2. 존재하지 않는 함수에 기대지 않는가 ===');
/* 이번 버그의 본질: typeof 가드가 없는 함수를 조용히 건너뛰어, 코드가 있는데도
   아무 일도 안 일어났다. 같은 이름이 되살아나면 즉시 실패시킨다. */
/* 주석을 걷어내고 본다. 수정 경위를 적은 주석에 그 이름이 등장하는데,
   그걸 살아있는 호출로 오인해 실패했다(이 테스트를 처음 돌렸을 때 실제로 그랬다). */
const hdrCode = hdr.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
t('applyI18n 호출이 코드에 남아있지 않다', !/window\.applyI18n\s*\(/.test(hdrCode),
  '이 코드베이스에 applyI18n 정의는 없다(전 페이지 grep 0건)');
const defined = ['frontend/index.html', 'frontend/community.html', 'frontend/magazine.html',
  'frontend/articles.html', 'frontend/films.html', 'frontend/pap-i18n.js']
  .filter((f) => fs.existsSync(path.join(ROOT, f)))
  .filter((f) => /function applyI18n|window\.applyI18n\s*=/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
t('applyI18n 을 정의한 파일이 실제로 없다 (' + (defined.length || 0) + '개)',
  defined.length === 0,
  '정의가 생겼다면 위 1번 검사의 전제를 다시 볼 것: ' + defined.join(', '));

console.log('\n=== 3. 헤더 사전이 우측 5개 키를 갖는가 ===');
/* 키 목록은 마크업에서 읽는다 — 테스트에 박아두면 메뉴가 바뀔 때 함께 깨지지
   않고 옛 사실만 지킨다. */
const navKeys = [...hdr.matchAll(/data-i18n="(nav(?:Community|Magazine|Editorial|Article|Film))"/g)]
  .map((m) => m[1]);
const uniqKeys = [...new Set(navKeys)];
t('우측 메뉴 키를 마크업에서 읽었다 (' + uniqKeys.length + '개)', uniqKeys.length >= 5,
  uniqKeys.join(', '));
const hdrT = (hdr.match(/var _hdrT = \{[\s\S]*?\n {4}\};/) || [''])[0];
t('_hdrT 사전을 찾았다', hdrT.length > 0);
['ko', 'en'].forEach((lang) => {
  const dict = (hdrT.match(new RegExp(lang + ':\\s*\\{[^}]*\\}')) || [''])[0];
  const missing = uniqKeys.filter((k) => !new RegExp(k + '\\s*:').test(dict));
  t(lang + ' 사전에 우측 5개 키가 모두 있다', missing.length === 0,
    '빠진 키: ' + missing.join(', ') + ' → 그 항목만 영문으로 남는다');
});

console.log('\n=== 4. 캐시버스트 ===');
const htmlDir = path.join(ROOT, 'frontend');
const vers = fs.readdirSync(htmlDir).filter((f) => f.endsWith('.html'))
  .map((f) => (fs.readFileSync(path.join(htmlDir, f), 'utf8').match(/pap-header\.js\?v=(\d+)/) || [])[1])
  .filter(Boolean);
t('pap-header.js 를 참조하는 HTML 이 있다 (' + vers.length + '개)', vers.length > 0);
t('모든 HTML 의 ?v= 가 동일하다 (' + [...new Set(vers)].join(', ') + ')',
  new Set(vers).size === 1,
  '버전이 갈리면 일부 페이지에 옛 헤더가 서빙돼 이 버그가 그 페이지에만 남는다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ nav-menu-i18n tests FAILED'); process.exit(1); }
console.log('✅ nav-menu-i18n tests passed');
