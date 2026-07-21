/**
 * 룩 크레딧 필수 (2026-07-21 도메니코 지시).
 * 모든 룩은 최소 1개 크레딧(브랜드 또는 인스타)이 있어야 제출/재제출 가능.
 * looksMissingCredit(looks) 가 크레딧 없는 룩 번호를 정확히 집어내는지 검증.
 */
'use strict';
const { looksMissingCredit } = require('../api/_lib/submissionType');
let pass=0, fail=0;
function t(n,c,d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 룩 크레딧 필수 (looksMissingCredit) ===');
t('모든 룩 빈 items → 전부 누락', JSON.stringify(looksMissingCredit([{n:1,items:[]},{n:2,items:[]}]))==='[1,2]');
t('브랜드만 있어도 통과', looksMissingCredit([{n:1,items:[{type:'Jacket',brand:'Gianna Basile',instagram:''}]}]).length===0);
t('인스타만 있어도 통과', looksMissingCredit([{n:1,items:[{type:'',brand:'',instagram:'@x'}]}]).length===0);
t('type만 있고 브랜드/인스타 공백 → 누락', JSON.stringify(looksMissingCredit([{n:3,items:[{type:'Jacket',brand:'   ',instagram:''}]}]))==='[3]');
t('일부만 누락', JSON.stringify(looksMissingCredit([{n:1,items:[{brand:'A'}]},{n:2,items:[]},{n:3,items:[{instagram:'@y'}]}]))==='[2]');
t('빈 배열 → 누락 없음', looksMissingCredit([]).length===0);
t('null 방어', looksMissingCredit(null).length===0);

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ submission-look-credit tests FAILED'); process.exit(1); }
console.log('✅ submission-look-credit tests passed');
