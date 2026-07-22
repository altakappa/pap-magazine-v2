/**
 * 마이페이지 서브미션 세부 상태 + 상태별 액션 버튼 (QA 2026-07-22).
 *
 * 요구: 관리자 수준 세분 상태(대기중/보완요청/보완완료/최종승인/업로드완료/거절)
 * + 사용자 관점 '게재료 결제 대기'(강조) + 상태별 액션(수정/결제/게시물 보기/사유).
 *
 * 검증 방식: mypage.html 에서 _mpDeriveStatus 를 추출해 '실제 실행'으로 관리자
 * _deriveDisplayStatus(api/submissions/index.js)와 규칙 동치 + payment_required
 * 확장을 검사한다. 마크업/버튼/서버 hydration 은 소스 검사로 고정한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const mp   = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'mypage.html'), 'utf8');
const mine = fs.readFileSync(path.join(__dirname, '..', 'api', 'submissions', 'mine.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 마이페이지 서브미션 세부 상태 · 액션 버튼 ===');

// ── 1) _mpDeriveStatus 를 추출해 실제 실행 ─────────────────────────────────
const fnMatch = mp.match(/function _mpDeriveStatus\(s\)\{[\s\S]*?\n\}/);
t('_mpDeriveStatus 정의 존재', !!fnMatch);
let derive = null;
try { derive = new Function('return ' + fnMatch[0])(); } catch(e){}
t('_mpDeriveStatus 실행 가능', typeof derive === 'function');

if (derive) {
  const paidDesc = JSON.stringify({ submissionType: 'paid_few_looks' });
  const brandedDesc = JSON.stringify({ submissionType: 'branded' });
  const cases = [
    // [입력, 기대 상태] — 관리자 _deriveDisplayStatus 와 동치인 6종
    [{status:'pending'},                                              'pending'],
    [{status:'pending', resubmitted_at:'2026-07-01'},                 'resubmitted'],
    [{status:'revision'},                                             'revision'],
    [{status:'rejected'},                                             'rejected'],
    [{status:'approved'},                                             'final_approved'],
    [{status:'approved', linked_editorial:{status:'published'}},      'uploaded'],
    // draft 에디토리얼은 published 아님 → 최종 승인 유지 (QA #290 정합)
    [{status:'approved', linked_editorial:{status:'draft'}},          'final_approved'],
    // 사용자 관점 확장 — 유료 유형 + 미결제 = 결제 대기
    [{status:'approved', description: paidDesc},                      'payment_required'],
    [{status:'approved', description: brandedDesc, payment_status:''},'payment_required'],
    // 결제 완료면 최종 승인으로
    [{status:'approved', description: paidDesc, payment_status:'paid'},'final_approved'],
    // 업로드 완료가 결제 대기보다 우선 (이미 게시됐으면 링크가 더 중요)
    [{status:'approved', description: paidDesc, linked_editorial:{status:'published'}}, 'uploaded'],
  ];
  cases.forEach(function(c, i){
    const got = derive(c[0]);
    t('도출 #' + (i+1) + ' → ' + c[1], got === c[1], 'got: ' + got);
  });
}

// ── 2) 배지 메타: 7개 상태 전부 + 결제 대기 강조(솔리드 골드) ────────────
['pending','resubmitted','revision','payment_required','final_approved','uploaded','rejected']
  .forEach(function(k){ t('배지 메타: ' + k, new RegExp(k + '\\s*:\\s*\\{[^}]*ko:').test(mp)); });
t('결제 대기 = 관리자와 구분되는 문구(게재료 결제 대기)', /게재료 결제 대기/.test(mp));
t('결제 대기 강조(골드 #c9a86a 솔리드)', /payment_required[^}]*#c9a86a/.test(mp.replace(/\n/g,' ')));

// ── 3) 상태별 액션 버튼 + 이동 경로 ─────────────────────────────────────
t('revision → 수정하러 가기(/submission?revise=)', /수정하러 가기[\s\S]{0,200}\/submission\?revise=/.test(mp));
t('payment_required → 결제하기(payBaseFee 직행)', /결제하기[\s\S]{0,300}payBaseFee\(/.test(mp) || /payBaseFee\('[\s\S]{0,200}결제하기/.test(mp.replace(/\n/g,' ')) || (/_mpActionBtn/.test(mp) && /payBaseFee\('" \+ id/.test(mp)));
t('uploaded → 게시물 보러가기(/editorial/slug)', /게시물 보러가기[\s\S]{0,250}\/editorial\//.test(mp));
t('rejected → 사유 확인(상세 토글)', /사유 확인[\s\S]{0,150}mpToggleSubDetail/.test(mp));
t('버튼이 행 클릭(상세 토글)과 분리(stopPropagation)', /_mpActionBtn[\s\S]{0,700}stopPropagation/.test(mp));
t('목록 행이 세부 배지+액션 사용(_statusBadge 아님)', /_mpDetailBadge\(_ds\) \+ _mpActionBtn\(_ds, s\)/.test(mp));
t('상세도 세부 배지 사용', /_mpDetailBadge\(_mpDeriveStatus\(s\)\)/.test(mp));

// ── 4) 서버: mine.js 가 linked_editorial 을 hydrate ─────────────────────
t('mine.js: editorials 를 source_submission_id 로 조회', /source_submission_id/.test(mine));
t('mine.js: published 우선 매칭(QA #290 정합)', /status === 'published' && existing\.status !== 'published'/.test(mine));
t('mine.js: 응답에 linked_editorial 포함', /linked_editorial:\s*linkedBySubId\[s\.id\]/.test(mine));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ mypage-sub-status tests FAILED'); process.exit(1); }
console.log('✅ mypage-sub-status tests passed');
