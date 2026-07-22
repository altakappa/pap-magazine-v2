/**
 * 구조개편 Phase 2 (2026-07-22) — /submission 신규 전용화 회귀 테스트.
 *
 * [배경] /submission 은 신규 등록 + 과거 제출 목록(상세 자동 펼침) + 재제출이
 * 한 페이지에 뒤섞여 있었고, 폼 위에 과거 제출 최대 5건의 상세가 자동으로
 * 펼쳐져 "신규 작성 중 과거 데이터가 나타난다"(QA)의 실체였다.
 * 관리(목록·피드백·재제출·결제)는 마이페이지 #mp-submissions 로 이관됐다.
 *
 * 이 테스트는 분리 상태가 되돌아가지 않도록 감시한다:
 *  1) /submission 로드 경로에서 과거 제출 목록을 불러오지 않는다.
 *  2) 신규 모드 방어 리셋(bfcache 포함)이 존재한다.
 *  3) 마이페이지가 전체 목록을 보여주고, /submission#mine 순환 링크가 없다.
 *  4) 마이페이지 관리 UI(인라인 상세·결제 블록·재제출 버튼)가 유지된다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const sub = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'submission.html'), 'utf8');
const mp  = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'mypage.html'), 'utf8');
const fee = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'pap-submission-fee.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== /submission 신규 전용화 (구조개편 Phase 2) ===');

// 1) 신규 페이지가 과거 제출 목록을 로드하지 않는다
//    — loadMySubmissions '정의'와 '주석'은 남아 있어도 되지만 실제 '호출문'은 없어야 한다.
const callSites = sub.split('\n').filter(function(l){
  var s = l.trim();
  if(s.startsWith('//') || s.startsWith('*')) return false;          // 주석 제외
  if(/function\s+loadMySubmissions/.test(s)) return false;            // 정의 제외
  if(/loadMySubmissions error/.test(s)) return false;                 // 자기 catch 로그 제외
  return /loadMySubmissions\(\)/.test(s);                             // 실제 호출문
}).length;
t('/submission 에서 loadMySubmissions() 호출 없음', callSites === 0,
  '호출 ' + callSites + '건 — 과거 제출 상세가 신규 폼 위에 다시 펼쳐진다');
t('과거 목록 대신 마이페이지 안내 링크(_showManageLink)', /_showManageLink\(\)/.test(sub) && /function _showManageLink/.test(sub));
t('안내 링크가 마이페이지 관리 섹션을 가리킴', /\/mypage#mp-submissions/.test(sub));

// 2) 신규 모드 방어 리셋
t('_resetReviseStateIfNew 존재', /function _resetReviseStateIfNew/.test(sub));
t('리셋이 revise 전역 3종을 비움', /REVISE_ID=null;[\s\S]*?existingLookUrls=\{\};[\s\S]*?existingAdditionalUrls=\[\]/.test(sub));
t('bfcache(pageshow persisted) 가드', /pageshow[\s\S]{0,120}persisted[\s\S]{0,40}_resetReviseStateIfNew/.test(sub));

// 3) 마이페이지 = 전체 목록, 순환 링크 없음
t('마이페이지 목록 slice(0,3) 제한 제거', !/subs\.slice\(0,\s*3\)/.test(mp));
// 주석은 허용, 실제 href 링크만 금지
t('/submission#mine 순환 링크 제거', !/href=["']\/submission#mine/.test(mp));

// 4) 마이페이지 관리 UI 유지 (Phase 1·2① 산출물)
t('건별 인라인 상세(mpToggleSubDetail) 유지', /function mpToggleSubDetail/.test(mp));
t('revision 건 재제출 버튼 유지', /status === 'revision'[\s\S]{0,400}\/submission\?revise=/.test(mp));
t('결제 블록(_baseFeeApprovalBlock) 연결 유지', /_baseFeeApprovalBlock\(/.test(mp));
t('결제 공용 모듈 로드 유지(양쪽)', /pap-submission-fee\.js/.test(mp) && /pap-submission-fee\.js/.test(sub));
t('공용 모듈에 payBaseFee 존재', /async function payBaseFee/.test(fee));

// 역검증 가드 — revise 진입 자체(마이페이지 → ?revise=)는 살아 있어야 한다
t('revise 흐름 자체는 유지(detectReviseMode)', /detectReviseMode/.test(sub) && /loadReviseSubmission/.test(sub));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ submission-new-only tests FAILED'); process.exit(1); }
console.log('✅ submission-new-only tests passed');
