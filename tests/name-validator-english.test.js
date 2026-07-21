/**
 * 서브미션·풀레터 영어(라틴) 전용 검증 (2026-07-21 도메니코 지시).
 * 이름 필드는 엄격 규칙, 인스타·산문은 라틴 전용(비라틴 차단, 문장부호 허용).
 */
'use strict';
global.window = global;
global.document = { addEventListener: function(){} };
global.localStorage = { getItem: function(){ return 'en'; } };
require('../frontend/pap-name-validator.js');

const latin = global._papValidateLatinOnly;
const name  = global._papValidateNameOnly;
let pass=0, fail=0;
function t(n,c,d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 라틴 전용(산문·인스타) ===');
t('영어 산문 통과(문장부호 포함)', latin("Marooned is exploring subject & space (2 elements), slowly."));
t('인스타 핸들 통과(@ _ .)', latin("@gianna_p.basile"));
t('악센트 라틴 허용(é ñ ü)', latin("Café Niño über"));
t('한글 차단', latin("칼로리는 빠져도")===false);
t('일본어(가나) 차단', latin("カロリー")===false);
t('중국어 차단', latin("单一品牌")===false);
t('키릴 차단', latin("Привет")===false);
t('영어+한글 혼합 차단', latin("Jacket 자켓")===false);
t('빈값 통과', latin("")===true && latin(null)===true);

console.log('\n=== 이름 전용(엄격) 회귀 ===');
t('영문 이름 통과', name("Gianna Basile"));
t('이름에 @ 불가', name("@user")===false);
t('이름에 한글 불가', name("김수정")===false);

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ name-validator-english tests FAILED'); process.exit(1); }
console.log('✅ name-validator-english tests passed');
