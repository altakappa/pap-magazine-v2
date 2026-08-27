/**
 * Ⅳ-41 게재 링크 킷 — 가드 (2026-08-27)
 * 배지(/badge.svg)·파트너 안내는 있었지만 전달 경로가 없었다 — 승인 메일이 경로.
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
const email = fs.readFileSync(path.join(root, 'api/_lib/email.js'), 'utf8');
const review = fs.readFileSync(path.join(root, 'api/submissions/[id]/review.js'), 'utf8');
const resend = fs.readFileSync(path.join(root, 'api/editorials/[id].js'), 'utf8');

console.log('=== 게재 링크 킷 (Ⅳ-41) ===');
t('킷 i18n 3키 × 9개 언어 (키 패리티)',
  (email.match(/kitTitle:/g) || []).length === 9
  && (email.match(/kitBody:/g) || []).length === 9
  && (email.match(/kitBadgeLabel:/g) || []).length === 9);
t('승인 + slug 확정일 때만 킷 블록', /_isApproved && _slug/.test(email));
t('배지 임베드 코드가 HTML 이스케이프로 실린다 (&lt;a href=...)',
  /&lt;a href="\$\{pageUrl\}"&gt;/.test(email) && /badge\.svg/.test(email));
t('review.js 가 스테이징 slug 를 주입 (신규·기존 재승인 양쪽)',
  /stagedEditorialSlug = editorial\.slug/.test(review)
  && /stagedEditorialSlug = existingEd\.slug/.test(review)
  && /editorialSlug: stagedEditorialSlug/.test(review));
t('재발송 경로([id].js)도 slug 주입', /editorialSlug: editorialRow\.slug/.test(resend));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ publication-link-kit tests passed');
