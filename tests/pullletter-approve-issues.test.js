/*
 * pullletter-approve-issues.test.js  (2026-09-25, 도메니코)
 *
 * "풀레터 발급 승인을 눌렀는데 신청자들이 풀레터를 받지 못했다"
 * 원인: 어드민 '승인' 버튼은 status=approved 만 저장하고 PDF 를 만들지 않았다.
 * PDF 자동 생성은 status=issued 에서만 돈다. 승인과 발급을 한 버튼으로 합쳤다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

const ADMIN = fs.readFileSync(path.join(ROOT, 'frontend/pap-admin.js'), 'utf8');
const REV = fs.readFileSync(path.join(ROOT, 'api/pullletters/[id]/review.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend/admin.html'), 'utf8');

ok(!/doPullLetterReview\(\\'approved\\'/.test(ADMIN), "PDF 없이 끝나는 '승인만' 버튼이 없다");
ok(/doPullLetterReview\(\\'issued\\',null\)">승인 · 발급/.test(ADMIN), "승인 버튼이 곧 발급(issued, PDF 자동 생성)이다");
ok(/generatePullLetterPdf/.test(REV) && REV.indexOf("if (status === 'issued')") < REV.indexOf('generatePullLetterPdf'), '서버는 issued 에서 PDF 를 만든다');
ok(/approved' \|\| pl\.status === 'accepted'\) && !pl\.pull_letter_url\) s = \{ cls:'b-declined', label:'⚠ 승인만 됨 · PDF 미발급' \}/.test(ADMIN), '승인만 되고 PDF 없는 옛 건은 목록에서 경고로 보인다');
ok(!/pap-admin\.js\?v=161"/.test(HTML), 'pap-admin.js 캐시버스트가 올라갔다');

console.log('pullletter-approve-issues: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
