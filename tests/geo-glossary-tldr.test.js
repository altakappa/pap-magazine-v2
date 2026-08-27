/**
 * 용어집(/glossary) + TL;DR 라벨 — 가드 테스트 (2026-08-27, 확장전략55 Ⅰ-1·Ⅰ-8)
 *
 * Ⅰ-8 용어집: 정적 페이지 + DefinedTermSet JSON-LD + 라우트/사이트맵/llms.txt 연결.
 * Ⅰ-1 TL;DR: 본문을 새로 쓰지 않고 .seo-desc-primary 위에 라벨만 명시
 *            (PAP 문체 규격 — 본문 소제목·요약형 금지 — 비침범).
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

const root = path.join(__dirname, '..');
const gl = fs.readFileSync(path.join(root, 'frontend/glossary.html'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const sitemap = fs.readFileSync(path.join(root, 'api/sitemap.js'), 'utf8');
const llms = fs.readFileSync(path.join(root, 'frontend/llms.txt'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'api/_lib/seoRenderer.js'), 'utf8');

console.log('=== 용어집 (Ⅰ-8) ===');

// JSON-LD 유효 + DefinedTermSet
const ldm = gl.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
let ld = null;
try { ld = JSON.parse(ldm && ldm[1]); } catch (_) {}
t('JSON-LD 가 유효한 JSON 이다', !!ld);
const set = ld && ld['@graph'] && ld['@graph'].find(n => n['@type'] === 'DefinedTermSet');
t('DefinedTermSet 스키마 존재', !!set);
t('DefinedTerm 30개 이상', !!set && Array.isArray(set.hasDefinedTerm) && set.hasDefinedTerm.length >= 30,
  set && set.hasDefinedTerm ? String(set.hasDefinedTerm.length) : '0');
t('용어 정의가 정의형 문장이다 (…란 …이다)',
  !!set && set.hasDefinedTerm.every(d => /(란|이란)\s/.test(d.description) || /다\.$/.test(d.description)));
t('본문 화면에도 같은 용어가 있다 (스키마-화면 정합: 발레코어·하드 플래시·풀레터)',
  /id="balletcore"/.test(gl) && /id="hard-flash"/.test(gl) && /id="pull-letter"/.test(gl));
t('canonical /glossary', /rel="canonical" href="https:\/\/www\.pap-magazine\.com\/glossary"/.test(gl));
t('연도 명시 (2026 기준 관리)', /2026/.test(gl) && /dateModified/.test(gl));

t('vercel.json 라우트 (/glossary → glossary.html)',
  (vercel.rewrites || []).some(r => r.source === '/glossary' && r.destination === '/glossary.html'));
t('사이트맵에 /glossary', /['"]\/glossary['"]/.test(sitemap));
t('llms.txt 에 용어집 링크', /pap-magazine\.com\/glossary/.test(llms));

console.log('\n=== TL;DR 라벨 (Ⅰ-1) ===');
t('TLDR_LABEL 9개 언어 맵 존재',
  /TLDR_LABEL = \{/.test(renderer) && /한눈에 · TL;DR/.test(renderer) && /Кратко/.test(renderer));
t('desc-primary 앞에 라벨 렌더 (있을 때만)',
  /seo-tldr-label/.test(renderer)
  && renderer.indexOf('seo-tldr-label') < renderer.indexOf('class="seo-desc-primary"')
  && /descDisplay \? `<div class="seo-tldr-label"/.test(renderer));
t('본문 요약문을 새로 생성하지 않는다 (라벨만 — descDisplay 재사용)',
  !/tldrText|generateTldr|TLDR_PROMPT/.test(renderer));
t('라벨 CSS 존재', /\.seo-meta \.seo-tldr-label\{/.test(renderer));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ geo-glossary-tldr tests passed');
