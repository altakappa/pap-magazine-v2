/**
 * UI 런타임 번역 커버리지 (2026-09-09, 도메니코 "모두 9개 언어 전부 적용")
 *
 * pap-ui-i18n.js 는 /i18n/ui/<page>.<lang>.json 사전으로 data-i18n 표시가 없는
 * 한글 텍스트를 바꾼다. 이 테스트가 지키는 것:
 *  1) 사전이 있는 페이지마다 8개 언어 파일이 있고 키 집합이 같다
 *  2) 값은 비어 있지 않고 한글이 남아 있지 않다
 *  3) 그 페이지 HTML 에 meta[pap-ui-i18n] + 스크립트(캐시버스트)가 배선돼 있다
 *  4) 페이지의 한글 텍스트 노드(스크립트·스타일·주석·data-i18n 제외)가 전부 사전 키에 있다
 *     → 새 한글 문구를 추가하면 사전에도 넣어야 통과한다(누락 재발 방지)
 *  5) 법률 페이지 5개는 data-legal="1" (한국어 원문 구속력 안내)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LANGS = ['en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];
const LEGAL = ['terms', 'privacy', 'refund', 'data-deletion', 'editorial-policy'];
// 서버 렌더(SSR) 페이지의 사전 — HTML 파일이 아니라 api 템플릿에 배선한다
const SSR_PAGES = {
  contributors: ['api/_lib/contributorProfile.js'],
  partners: ['api/seo/partners.js'],
  brand: ['api/seo/brand/[id].js'],
  archive: ['api/seo/archive.js'],
};
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', String(d).slice(0, 400)); } }

const dir = path.join(ROOT, 'frontend/i18n/ui');
const pages = [...new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.split('.')[0]))].sort();
t('사전 페이지 20개 이상', pages.length >= 20, pages.length);

function unescape(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&lsquo;/g, '\u2018').replace(/&rsquo;/g, '\u2019').replace(/&ldquo;/g, '\u201c').replace(/&rdquo;/g, '\u201d').replace(/&hellip;/g, '\u2026').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)); }
function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
// 런타임(pap-ui-i18n.js)의 skip() 과 같은 규칙으로 텍스트 노드를 뽑는다:
// script/style/code/pre/textarea 안, data-i18n / data-i18n-html / translate="no" / data-ui-i18n-skip 요소 아래는 제외.
function koreanTexts(html) {
  let s = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const out = new Set();
  const stack = []; // {tag, skip}
  let skipDepth = 0;
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|([^<]+)/g; let m;
  while ((m = re.exec(s))) {
    if (m[3] !== undefined) {
      if (skipDepth === 0) { const v = norm(unescape(m[3])); if (v && HANGUL.test(v)) out.add(v); }
      continue;
    }
    const raw = m[0], tag = m[1].toLowerCase(), attrs = m[2] || '';
    if (raw.startsWith('</')) {
      // pop to matching tag
      for (let i = stack.length - 1; i >= 0; i--) { const e = stack.pop(); if (e.skip) skipDepth--; if (e.tag === tag) break; }
      continue;
    }
    const selfClose = /\/\s*$/.test(attrs) || VOID.has(tag);
    if (skipDepth === 0) {
      const ra = /\s(placeholder|title|alt|aria-label)="([^"]*)"/g; let a;
      while ((a = ra.exec(attrs))) { if (tag === 'input' && a[1] === 'placeholder' && /data-i18n-ph/.test(attrs)) continue; const v = norm(unescape(a[2])); if (v && HANGUL.test(v)) out.add(v); }
    }
    if (selfClose) continue;
    const skip = ['script','style','code','pre','textarea','noscript'].includes(tag) || /\sdata-i18n(-html)?=/.test(attrs) || /\stranslate="no"/.test(attrs) || /\sdata-ui-i18n-skip/.test(attrs);
    stack.push({ tag, skip });
    if (skip) skipDepth++;
  }
  return out;
}

for (const page of pages) {
  console.log('\n=== ' + page + ' ===');
  const maps = {};
  for (const l of LANGS) {
    const p = path.join(dir, page + '.' + l + '.json');
    t(l + ' 파일 존재', fs.existsSync(p));
    if (!fs.existsSync(p)) continue;
    try { maps[l] = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { t(l + ' JSON 파싱', false, e.message); }
  }
  const keys = maps.en ? Object.keys(maps.en) : [];
  t('키 1개 이상', keys.length > 0, keys.length);
  t('8개 언어 키 집합 동일', LANGS.every((l) => maps[l] && Object.keys(maps[l]).length === keys.length && keys.every((k) => k in maps[l])));
  t('값 비어있지 않음', LANGS.every((l) => maps[l] && keys.every((k) => typeof maps[l][k] === 'string' && maps[l][k].trim())));
  const leftover = [];
  LANGS.forEach((l) => { if (!maps[l]) return; keys.forEach((k) => { if (HANGUL.test(maps[l][k])) leftover.push(l + ':' + k.slice(0, 30)); }); });
  t('번역값에 한글 없음', leftover.length === 0, leftover.slice(0, 5).join(' | '));
  if (page === '_shared') continue;                       // 공용 사전 — 모든 페이지가 읽는다(아래 런타임 절에서 검사)
  if (SSR_PAGES[page]) {                                   // 서버 렌더 페이지 — 셸 템플릿에 meta+스크립트
    for (const rel of SSR_PAGES[page]) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      t(rel + ' meta pap-ui-i18n 배선', new RegExp('<meta name=\\"?pap-ui-i18n\\"? content=\\"?' + page + '\\"?').test(src.replace(/\\"/g, '"')));
      t(rel + ' pap-ui-i18n.js 스크립트', /pap-ui-i18n\.js\?v=\d+/.test(src));
    }
    continue;
  }
  const htmlPath = path.join(ROOT, 'frontend', page + '.html');
  t('HTML 존재', fs.existsSync(htmlPath));
  if (!fs.existsSync(htmlPath)) continue;
  const html = fs.readFileSync(htmlPath, 'utf8');
  t('meta pap-ui-i18n 배선', new RegExp('<meta name="pap-ui-i18n" content="' + page + '"').test(html));
  t('pap-ui-i18n.js 스크립트(캐시버스트)', /<script src="\/pap-ui-i18n\.js\?v=\d+" defer><\/script>/.test(html));
  if (LEGAL.includes(page)) t('법률 페이지 data-legal="1"', new RegExp('content="' + page + '"[^>]*data-legal="1"').test(html));
  const texts = koreanTexts(html);
  const missing = [...texts].filter((v) => !(v in maps.en));
  t('한글 텍스트 노드 전부 사전에 있음 (' + texts.size + '개)', missing.length === 0, missing.slice(0, 6).join(' | '));
}

console.log('\n=== 런타임 파일 ===');
const rt = fs.readFileSync(path.join(ROOT, 'frontend/pap-ui-i18n.js'), 'utf8');
t('pap-ui-i18n.js 존재·핵심 훅', /pap:langchange/.test(rt) && /MutationObserver/.test(rt) && /data-ui-i18n-skip/.test(rt));
t('ko 면 사전 요청 없음(LANGS 밖이면 복원만)', /LANGS\.indexOf\(lang\) === -1\) \{ restoreKo\(\); return; \}/.test(rt));
// 법률 페이지 h1 "이용약관 <span.subtitle>Terms of Service</span>" — 영어로 바꾸면 같은 줄이 두 번 보인다.
// 번역 결과가 부제와 같으면 부제를 숨기고(ko 복원 때 원래 display 로 되돌린다).
t('h1 부제 중복 숨김(dedupeSubtitle) — 적용·복원 양쪽에 배선', /dedupeSubtitle\(true\)/.test(rt) && /dedupeSubtitle\(false\)/.test(rt) && /_papOrigDisplay/.test(rt));
const legalH1 = ['terms', 'privacy', 'data-deletion'].filter((pg) => /<h1>[^<]*<span class="subtitle"/.test(fs.readFileSync(path.join(ROOT, 'frontend', pg + '.html'), 'utf8')));
t('부제 h1 을 가진 법률 페이지 3곳 확인 (' + legalH1.join(',') + ')', legalH1.length === 3);
// 캐시버스트: 런타임을 고치면 ?v= 를 올려야 한다. 24페이지가 같은 버전을 가리킨다.
const vers = new Set(); const htmlPages = pages.filter((pg) => pg !== '_shared' && !SSR_PAGES[pg]);
for (const pg of htmlPages) { const m = fs.readFileSync(path.join(ROOT, 'frontend', pg + '.html'), 'utf8').match(/pap-ui-i18n\.js\?v=(\d+)/); if (m) vers.add(m[1]); }
for (const rels of Object.values(SSR_PAGES)) for (const rel of rels) { const m = fs.readFileSync(path.join(ROOT, rel), 'utf8').match(/pap-ui-i18n\.js\?v=(\d+)/); if (m) vers.add(m[1]); }
{ const m = fs.readFileSync(path.join(ROOT, 'api/_lib/seoRenderer.js'), 'utf8').match(/pap-ui-i18n\.js\?v=(\d+)/); if (m) vers.add(m[1]); }
t(htmlPages.length + '개 HTML + SSR 셸이 같은 pap-ui-i18n.js 버전을 가리킨다 (v=' + [...vers].join('/') + ')', vers.size === 1);

// ── v3 (2026-09-10 도메니코 "JS 가 동적으로 만드는 한글도 9개 언어, 단 하나도 남김 없이") ──
console.log('\n=== 동적 문자열(JS·인라인·SSR·API 메시지) 커버리지 ===');
t('_shared 사전 8개 언어 존재', LANGS.every((l) => fs.existsSync(path.join(dir, '_shared.' + l + '.json'))));
t('런타임: 공용 사전 로드', /_shared\.' \+ lang/.test(rt));
t('런타임: 자리표시자 패턴 · 부분 일치', /patterns/.test(rt) && /subRes/.test(rt) && /function substitute/.test(rt));
t('런타임: _papUIL 교체 · alert/confirm 래핑 · 속성 관찰', /window\._papUIL = uil/.test(rt) && /\['alert', 'confirm', 'prompt'\]/.test(rt) && /attributeFilter: ATTRS/.test(rt));
t('런타임: 내가 쓴 값은 옵저버가 무시(무한루프 방지)', /function isOwnWrite/.test(rt) && /WRITTEN\.get/.test(rt));
t('seoRenderer 셸: meta _shared + 스크립트', /<meta name="pap-ui-i18n" content="_shared"/.test(fs.readFileSync(path.join(ROOT, 'api/_lib/seoRenderer.js'), 'utf8')) && /pap-ui-i18n\.js\?v=\d+/.test(fs.readFileSync(path.join(ROOT, 'api/_lib/seoRenderer.js'), 'utf8')));
t('seoRenderer: 구매 칩·Shop the Story·니치 주제어 9개 언어', (() => { const s = fs.readFileSync(path.join(ROOT, 'api/_lib/seoRenderer.js'), 'utf8'); return /BUY_CHIP_T\[lang\]/.test(s) && /SHOP_T = \{/.test(s) && /NICHE_TOPIC_T/.test(s) && !/'구매 →' : 'Shop →'/.test(s); })());

// 모든 사전 키(페이지 + 공용) 집합
const ALL_KEYS = new Set();
for (const pg of pages) { const m = JSON.parse(fs.readFileSync(path.join(dir, pg + '.en.json'), 'utf8')); Object.keys(m).forEach((k) => ALL_KEYS.add(k)); }
const STRIPPED = [...ALL_KEYS].map((k) => k.replace(/\{\d+\}/g, ''));
function known(piece) { if (ALL_KEYS.has(piece)) return true; const ps = piece.replace(/\{\d+\}/g, ''); return STRIPPED.some((s) => s.includes(ps)); }
const { koreanLiterals, pieces } = require('./_lib/jsKoreanLiterals');
const EXCLUDE_JS = /^(pap-admin.*|pap-ui-i18n|pap-logos-data|pap-content-api-sync|pap-push-sw)\.js$/;
const EXCLUDE_HTML = /^(admin|studio-admin|ops-dashboard|site-analysis|pap-repurpose|.*-diagnose|pepperit|404)\.html$/;
const dynMissing = []; let dynTotal = 0;
function scanJs(code, label, off) {
  for (const it of koreanLiterals(code)) for (const p of pieces(it.text)) { dynTotal++; if (!known(p)) dynMissing.push(label + ':' + (it.line + (off || 0)) + ' ' + p.slice(0, 60)); }
}
const fdir = path.join(ROOT, 'frontend');
for (const f of fs.readdirSync(fdir)) {
  if (f.endsWith('.js') && !EXCLUDE_JS.test(f)) scanJs(fs.readFileSync(path.join(fdir, f), 'utf8'), f);
  if (f.endsWith('.html') && !EXCLUDE_HTML.test(f)) {
    const html = fs.readFileSync(path.join(fdir, f), 'utf8');
    const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi; let m;
    while ((m = re.exec(html))) {
      if (/type\s*=\s*["'](application|speculation|importmap|text\/template)/i.test(m[1] || '')) continue;
      const off = html.slice(0, m.index + m[0].indexOf(m[2])).split('\n').length - 1;
      scanJs(m[2], f, off);
    }
  }
}
// SSR 템플릿은 인라인 <script> 안의 한글 주석(렌더되지 않음)이 섞여 있어 주석을 걷어낸 뒤 훑는다
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }
for (const rel of ['api/_lib/seoRenderer.js', 'api/_lib/contributorProfile.js', 'api/seo/contributors.js', 'api/seo/contributor/[handle].js', 'api/seo/partners.js', 'api/seo/brand/[id].js', 'api/seo/archive.js']) scanJs(stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8')), rel);
t('프론트 JS·인라인·SSR 의 한글 리터럴 조각이 전부 사전에 있음 (' + dynTotal + '개)', dynMissing.length === 0, dynMissing.slice(0, 8).join(' | '));
// api 응답 메시지 (res.json({ error: '…' }))
const apiMissing = []; let apiTotal = 0;
(function walkApi(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!/^(cron|admin|ops)$/.test(f)) walkApi(p); } else if (f.endsWith('.js')) {
  const rel = path.relative(ROOT, p); if (/^api\/_lib\/(notify|telegram|mail)/.test(rel)) continue;
  const src = stripComments(fs.readFileSync(p, 'utf8')); const re = /\b(error|message|msg|detail|reason|hint|note)\s*:\s*(['"`])((?:\\.|(?!\2)[^\n])*)\2/g; let m;
  while ((m = re.exec(src))) { const v = m[3].replace(/\$\{[^}]*\}/g, '{0}'); if (!HANGUL.test(v)) continue; const line = src.slice(0, m.index).split('\n').length; const ctx = src.slice(Math.max(0, m.index - 200), m.index); if (!/\.json\s*\(\s*\{[^)]*$/.test(ctx)) continue; for (const pc of pieces(v)) { apiTotal++; if (!known(pc)) apiMissing.push(rel + ':' + line + ' ' + pc.slice(0, 50)); } }
} } })(path.join(ROOT, 'api'));
t('API 응답 메시지(한글)가 전부 사전에 있음 (' + apiTotal + '개)', apiMissing.length === 0, apiMissing.slice(0, 8).join(' | '));
// 한 줄짜리 미니 사전 {ko:'…', en:'…', …} 은 8개 언어를 다 가져야 한다 (de 누락이 영어로 떨어지던 사고)
// 값 안의 {date}·{max} 같은 중괄호 때문에 정규식으로는 끝을 못 찾는다 → 따옴표를 아는 작은 파서로 읽는다
function readMiniDict(src, start) {
  // start: '{' 위치. 반환: { keys:[], end } 또는 null (문자열/식별자 값만 허용, 중첩 객체면 null)
  let i = start + 1; const keys = [];
  while (i < src.length) {
    while (/[\s,]/.test(src[i])) i++;
    if (src[i] === '}') return { keys, end: i };
    const km = /^([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*:/.exec(src.slice(i, i + 40)); if (!km) return null;
    keys.push(km[1].replace(/^['"]|['"]$/g, '')); i += km[0].length; while (/\s/.test(src[i])) i++;
    const q = src[i];
    if (q === "'" || q === '"' || q === '`') { i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n' && q !== '`') return null; i++; } i++; }
    else if (src[i] === '{' || src[i] === '[') return null;
    else { while (i < src.length && !/[,}\n]/.test(src[i])) i++; }
  }
  return null;
}
const partial = [];
for (const f of fs.readdirSync(fdir)) {
  if (!((f.endsWith('.js') && !EXCLUDE_JS.test(f)) || (f.endsWith('.html') && !EXCLUDE_HTML.test(f)))) continue;
  const src = fs.readFileSync(path.join(fdir, f), 'utf8'); const re = /\{\s*ko\s*:\s*['"`]/g; let m;
  while ((m = re.exec(src))) {
    const d = readMiniDict(src, m.index); if (!d) continue;
    const seg = src.slice(m.index, d.end + 1); if (!/[가-힣]/.test(seg)) continue;
    const miss = LANGS.filter((l) => !d.keys.includes(l));
    if (miss.length && miss.length < LANGS.length) partial.push(f + ':' + src.slice(0, m.index).split('\n').length + ' missing ' + miss.join(','));
  }
}
t('한 줄 미니 사전 {ko,en,…} 에 빠진 언어 없음', partial.length === 0, partial.slice(0, 6).join(' | '));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ui-i18n-coverage tests FAILED'); process.exit(1); }
console.log('✅ ui-i18n-coverage tests passed');
