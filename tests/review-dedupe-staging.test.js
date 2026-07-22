/**
 * 서브미션 재승인 중복 스테이징 방지 회귀 (2026-07-22, ASIATOPIA 사고).
 *
 * [근본 원인] 승인 API 가 AI 캡션 생성(최대 28장, 느림)을 await 한 뒤
 * editorials 에 INSERT 한다. 지연 중 프론트가 실패로 보이면 운영자가
 * 재승인 → 가드가 없어 같은 서브미션에서 에디토리얼이 한 번 더 INSERT
 * → 슬러그 중복. DB 실측으로 동일 패턴 5건 확인(ASIATOPIA·ALTER EGO·
 * Synthetic Skin·HYPER VENUS·CARAMELLE — 전부 untouched draft + published 쌍).
 *
 * 3중 방어: ① 승인 API 멱등 가드(기존 스테이징 재사용) ② DB 부분 유니크
 * 인덱스 2종 ③ 프론트 오안내(임시저장 탭) 문구 정정.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const rev = R('api/submissions/[id]/review.js');
const adm = R('frontend/pap-admin.js');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 승인 API 멱등 가드 ===');
t('기존 스테이징 조회(source_submission_id) 가드 존재',
  /eq\('source_submission_id', submission\.id\)/.test(rev),
  '가드가 사라지면 재승인이 다시 중복 에디토리얼을 만든다');
t('가드는 AI 캡션 생성보다 앞에서 실행 (비용·지연 절약)',
  rev.indexOf("eq('source_submission_id', submission.id)") < rev.indexOf('_generateEditorialDescriptions({'));
t('이미 스테이징 시 INSERT 건너뜀 (coverUrl && !alreadyStaged)',
  /if \(coverUrl && !alreadyStaged\) \{/.test(rev));
t('기존 에디토리얼 id 재사용 (stagedEditorialId = existingEd.id)',
  /stagedEditorialId = existingEd\.id/.test(rev));
t('응답에 alreadyStaged 포함 (프론트 분기 가능)',
  /editorialId: stagedEditorialId, alreadyStaged/.test(rev));

console.log('--- 프론트 안내 문구 정합 (QA #197 필터와 모순 금지) ---');
t('오안내("임시저장 탭") 제거됨 — auto-staged draft 는 거기 안 보인다',
  !/승인되었습니다\. 에디토리얼 관리 → 임시저장 탭/.test(adm));
t('실제 접근 경로([에디토리얼 편집] 버튼) 안내', /에디토리얼 편집\] 버튼/.test(adm));

console.log('--- 캐시버스트 ---');
t('admin.html 이 pap-admin.js v116+ 참조', /pap-admin\.js\?v=(11[6-9]|1[2-9]\d|[2-9]\d\d)/.test(R('frontend/admin.html')));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ review-dedupe-staging tests FAILED'); process.exit(1); }
console.log('✅ review-dedupe-staging tests passed');
