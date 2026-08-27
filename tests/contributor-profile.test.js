/**
 * Ⅲ-30 기여자 프로필 — 가드 (2026-08-27)
 * 기준: 화보 2편 이상 + 인물 크레딧만 (실측: 3편 기준은 5계정 중 3이 브랜드였다)
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
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const lib = rd('api/_lib/contributorProfile.js');
const idx = rd('api/seo/contributors.js');
const prof = rd('api/seo/contributor/[handle].js');
const vercel = JSON.parse(rd('vercel.json'));
const sitemap = rd('api/sitemap.js');
const llms = rd('frontend/llms.txt');

console.log('=== 기여자 프로필 ===');
t('관문 상수 MIN_EDITORIALS=2', /MIN_EDITORIALS = 2/.test(lib));
t('핸들 검증 정규식 (URL 인젝션 방지)', /HANDLE_RE = \/\^\[A-Za-z0-9._\]\{2,60\}\$\//.test(lib));
t('브랜드성 역할 제외 (fashion by·brand·agency)',
  /fashion by/.test(lib) && /agency/.test(lib) && /isPersonRole/.test(prof) && /isPersonRole/.test(idx));
t('프로필 관문 — 미달·비인물이면 404 (씬페이지 방지)',
  /eds\.length < MIN_EDITORIALS \|\| !roles\.length/.test(prof) && /status\(404\)/.test(prof));
t('RPC 사용 (전량 스캔 아님)',
  /rpc\('top_contributors'/.test(idx) && /rpc\('contributor_editorials'/.test(prof));
t('Person JSON-LD + sameAs 인스타그램',
  /ProfilePage/.test(prof) && /instagram\.com\/' \+ handle/.test(prof));
t('출력 이스케이프 (escText/escAttr 사용)',
  /escText\(name/.test(prof) && /escAttr\(r\.handle\)/.test(idx));
t('캐시 헤더 (s-maxage)', /s-maxage=3600/.test(idx) && /s-maxage=3600/.test(prof));
t('라우트 2건 (/contributors · /contributor/:handle)',
  (vercel.rewrites || []).some(r => r.source === '/contributors')
  && (vercel.rewrites || []).some(r => r.source === '/contributor/:handle'));
t('사이트맵에 /contributors', /['"]\/contributors['"]/.test(sitemap));
t('llms.txt 참조', /pap-magazine\.com\/contributors/.test(llms));
t('정정 정책 연결 (크레딧 정정 경로)', /editorial-policy#corrections/.test(prof) && /editorial-policy#corrections/.test(idx));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail > 0) process.exit(1);
console.log('✓ contributor-profile tests passed');
