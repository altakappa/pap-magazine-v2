/**
 * 히어로 배너 → 에디토리얼 공백 (2026-07-22 QA).
 *
 * [실측 원인 — 대소문자 아님] 커버 에디토리얼 'Masquerade'(slug: masquerade,
 * published, DB 존재)가 클라이언트 카탈로그에 없었다: 발행일(7/1)이 최신12 밖이고
 * 4월 정적 시드에도 없음. 흐름: 배너 클릭 → edData 에서 slug 미발견 → SSR 풀 이동
 * → SSR 이 실제 브라우저를 /?ed=masquerade 로 리다이렉트 → ?ed= 딥링크가 4초
 * 폴링에도 해석 실패 → 미해석 slug 로 openEditorial → edDetails 미스 → 빈 오버레이
 * + /editorial/masquerade URL. (openEditorial 에는 대소문자 무시 폴백이 이미 있었다.)
 *
 * [수정] slug 직조회 경로 신설:
 *  1. 서버: GET /api/editorials/:id 가 UUID 아니면 slug 조회 허용(published 한정)
 *  2. api-sync: window._papFetchEditorialBySlug 훅 — 1건 조회→로컬 카탈로그 주입
 *  3. ?ed= 딥링크: 폴링 실패 시 훅으로 복구 후 오픈
 *  4. 배너 클릭: 매칭 실패 시 훅으로 리로드 없이 오픈, 실패 시에만 SSR 풀 이동
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const server = R('api/editorials/[id].js');
const sync = R('frontend/pap-content-api-sync.js');
const seo = R('frontend/pap-content-seo.js');
const boot = R('frontend/pap-shell-bootstrap.js');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 에디토리얼 slug 딥링크 복구 경로 ===');

// 1) 서버
t('서버: UUID 판별 정규식 존재', /_isUuid = \/\^\[0-9a-f\]\{8\}/.test(server));
t('서버: 비UUID 는 slug 로 조회', /q\.eq\('slug', String\(id \|\| ''\)\.toLowerCase\(\)\)/.test(server));
t('서버: slug 조회는 published 한정 (드래프트 유출 방지)', /\.eq\('slug'[\s\S]{0,60}\.eq\('status', 'published'\)/.test(server));
// UUID 정규식 동작 확인 (실행)
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
t('  정규식: UUID 매치', uuidRe.test('47849aef-b5f6-40ce-a161-44a7252230ca'));
t('  정규식: slug 비매치', !uuidRe.test('masquerade'));

// 2) 훅
const hook = (sync.match(/window\._papFetchEditorialBySlug = function[\s\S]*?\n  \};/) || [''])[0];
t('훅: _papFetchEditorialBySlug 노출', hook.length > 0);
t('훅: 단일 매핑(apiEditorialToLocal) 재사용 (드리프트 방지)', /apiEditorialToLocal\(row\)/.test(hook));
t('훅: edDetails 주입(_populateEdDetailsFromApi)', /_populateEdDetailsFromApi\(local\)/.test(hook));
t('훅: 중복 주입 방지', /_api_id === row\.id/.test(hook));

// 3) ?ed= 딥링크 폴백
t('?ed=: 폴링 실패 시 훅 호출', /if\(!foundMatch && typeof window\._papFetchEditorialBySlug === 'function'\)/.test(seo));
t('?ed=: 성공 시 bounce 가드 해제 유지', /_papFetchEditorialBySlug\(edName[\s\S]*?_pap_ssr_bounce/.test(seo));

// 4) 배너 클릭 폴백
t('배너: 매칭 실패 시 훅으로 리로드 없이 오픈', /_papFetchEditorialBySlug\(slug, function\(local\)/.test(boot));
t('배너: 훅 실패 시 SSR 풀 이동 유지', /_papFetchEditorialBySlug\(slug[\s\S]{0,220}window\.location\.href = url/.test(boot));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ editorial-slug-deeplink tests FAILED'); process.exit(1); }
console.log('✅ editorial-slug-deeplink tests passed');
