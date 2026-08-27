/**
 * auto-generate-bulk 페이지네이션 — 가드 (2026-08-27)
 * '자른 뒤 거른다' 안티패턴 재발 방지 (faqBackfill 2026-08-04 교훈과 동일 규약)
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

const src = fs.readFileSync(
  path.join(__dirname, '..', 'api/admin/editorials/auto-generate-bulk.js'), 'utf8');

console.log('=== auto-generate-bulk 페이지네이션 ===');
t('range 페이지네이션 사용 (limit 단독 SELECT 금지)',
  /\.range\(from, from \+ SPAN - 1\)/.test(src) && !/\.limit\(limit\);/.test(src));
t('거른 뒤 자른다 — 페이지 안에서 wanted 필터 후 limit 채움',
  /wanted\(r\)/.test(src) && /candidates\.length >= limit/.test(src));
t('마지막 페이지에서 멈춘다 (무한 스캔 방지)',
  /rows\.length < SPAN/.test(src) && /MAX_PAGES/.test(src));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ bulk-pagination tests passed');
