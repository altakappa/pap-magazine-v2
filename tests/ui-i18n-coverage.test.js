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

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ui-i18n-coverage tests FAILED'); process.exit(1); }
console.log('✅ ui-i18n-coverage tests passed');
