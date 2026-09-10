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
// 2026-09-10 도메니코: 악센트 라틴은 이름 칸에서도 허용
t('악센트 라틴 이름 통과 (Hermès·Niño·KIMHĒKIM·Müller)', name("Hermès")&&name("Niño")&&name("KIMHĒKIM")&&name("Jürgen Müller"));
t('중국어·키릴은 이름 칸에서 여전히 불가', name("张三")===false && name("Иван")===false);
t('경고 문구가 "알파벳/영어로만" 을 말한다(ko·en)', (function(){ const src=require('fs').readFileSync(require('path').join(__dirname,'..','frontend/pap-name-validator.js'),'utf8'); return /ko: '알파벳\(영어\)으로만 입력할 수 있습니다/.test(src) && /en: 'English \(Latin alphabet\) only/.test(src); })());

console.log('\n=== 입력 즉시 제거 (2026-09-10 도메니코 "중국어로 쓸 수 없게") ===');
const _src = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend/pap-name-validator.js'), 'utf8');
t('input 이벤트에서 비라틴 글자를 그 자리에서 지운다(_stripNonLatin)', /function _stripNonLatin\(el\)/.test(_src) && /if\(_stripNonLatin\(el\)\) return;/.test(_src));
t('IME 조합 중에는 손대지 않고 compositionend 뒤에 지운다', /e\.isComposing\) return;/.test(_src) && /addEventListener\('compositionend'/.test(_src));
t('붙여넣기도 같은 규칙', /addEventListener\('paste'/.test(_src));
t('공개 함수 _papStripNonLatin: 중국어·한글·키릴 제거, 악센트 라틴 유지', (function(){ const m = _src.match(/var NON_LATIN_RE = (\/\[[^\n]*?\]\/);/); const re = new RegExp(eval(m[1]).source, 'g'); const out = 'Hermès 优衣库 김 Иван'.replace(re, ''); return out === 'Hermès   '; })());
t('세 페이지가 v=5 를 가리킨다(캐시버스트)', ['submission','pullletter','mypage'].every((pg) => /pap-name-validator\.js\?v=5/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', pg + '.html'), 'utf8'))));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ name-validator-english tests FAILED'); process.exit(1); }
console.log('✅ name-validator-english tests passed');
