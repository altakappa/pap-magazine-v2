/**
 * /editorial 목록 초기 렌더 지연 (2026-07-22 QA: 최대 1분 빈 화면).
 *
 * [실측 원인] /editorial 은 index.html 재사용 + 오버레이 자동 오픈 구조인데,
 * 오버레이 재렌더가 STAGE 2(전체 카탈로그 동기화, 2448건 페이지네이션) 완료 시점에만
 * 걸려 있었다. 게다가 정적 시드(2371건)는 renderCb=null 이라 도착해도 안 그렸고,
 * STAGE 1(최신 12건)이 플래그를 먼저 세우면 시드가 통째로 버려졌다.
 * → 라이브 실측: HTML 49KB·오버레이 1.2s 오픈, 그러나 카드 0개가 20초+ 지속.
 *
 * [수정] 빠른 데이터가 도착하는 즉시 오버레이를 그린다:
 *  1. STAGE 1(최신 12) 후 오버레이 재렌더 (열려 있으면)
 *  2. 정적 시드 도착 시 API 아래로 병합(제목 중복 제거) + 오버레이 재렌더
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'pap-content-api-sync.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== /editorial 목록 fast-path ===');

// STAGE 1 블록 안에 오버레이 재렌더가 있는가
const stage1 = (src.match(/STAGE 1: fast-path[\s\S]*?\.finally\(/) || [''])[0];
t('STAGE 1 이 홈 행들을 그린다 (기존 동작 유지)', /_renderLatestRow\(\)/.test(stage1));
t('STAGE 1 이 목록 오버레이도 즉시 재렌더한다', /_renderEdAllPage/.test(stage1),
  'STAGE 2 완료까지 목록이 빈 화면으로 대기하는 회귀');

// 정적 시드 경로
t('정적 editorials.json 로더가 renderCb 없이 버려지지 않는다 (전용 fetch 존재)',
  /fetch\('data\/editorials\.json'\)/.test(src));
const seed = (src.match(/fetch\('data\/editorials\.json'\)[\s\S]*?\.catch/) || [''])[0];
t('시드 도착 시 오버레이 재렌더', /_renderEdAllPage/.test(seed));
t('API 선착 시 시드를 버리지 않고 병합(제목 dedupe)', /seen\[k\]=true/.test(seed) && /_apiSynced\.editorials/.test(seed));
t('API 미도착 시 시드가 그대로 채움 (기존 동작 유지)', /edData\.length = 0/.test(seed));

// STAGE 2 완료 재렌더도 유지 (authoritative 정리)
const stage2 = (src.match(/STAGE 2: full catalog[\s\S]*?\}\);\n\s*\}\);/) || [''])[0];
t('STAGE 2 완료 재렌더 유지', /_renderEdAllPage/.test(stage2));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ editorial-list-fastpath tests FAILED'); process.exit(1); }
console.log('✅ editorial-list-fastpath tests passed');
