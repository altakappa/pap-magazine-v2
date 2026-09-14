/**
 * 룩 크레딧 필수 (2026-07-21 도메니코 지시).
 * 모든 룩은 최소 1개 크레딧(브랜드 또는 인스타)이 있어야 제출/재제출 가능.
 * looksMissingCredit(looks) 가 크레딧 없는 룩 번호를 정확히 집어내는지 검증.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { looksMissingCredit, lookItemsMissingInstagram, validHandle, classifySubmissionType, INSTAGRAM_HANDLE_RE } = require('../api/_lib/submissionType');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
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

/* 2026-09-14 도메니코 — "인스타그램 핸들은 필수. 올바른 아이디여야 하고, 인스타그램 아이디가 없으면 없는 브랜드로 간주한다."
   실사례 Fantasy World(10b072fc): 브랜드 6개 중 인스타 3개, 그마저 "333 studio". */
console.log('\n=== 브랜드 크레딧의 인스타 핸들 필수 (validHandle · lookItemsMissingInstagram) ===');
t('validHandle: @·URL 벗기고 소문자', validHandle('@Humanhu')==='humanhu' && validHandle('https://www.instagram.com/tigoficial/')==='tigoficial');
t('validHandle: 띄어쓰기·기호·31자 → 무효', validHandle('333 studio')==='' && validHandle('a b')==='' && validHandle('hey!')==='' && validHandle('a'.repeat(31))==='' && validHandle('')==='');
t('INSTAGRAM_HANDLE_RE 는 영숫자·마침표·밑줄 1~30자', String(INSTAGRAM_HANDLE_RE)==='/^[a-z0-9._]{1,30}$/');
const fw=[{n:1,items:[{type:'Top',brand:'mincrisot',instagram:''},{type:'Dress',brand:'Nancy',instagram:''}]},{n:2,items:[{type:'Top',brand:'humanhu',instagram:'humanhu'},{type:'Other',brand:'333 studio',instagram:'333 studio'}]}];
const miss=lookItemsMissingInstagram(fw);
t('Fantasy World: 빈 핸들 2 + 잘못된 핸들 1 = 3건, 이유 missing/invalid', miss.length===3 && miss.filter(x=>x.reason==='missing').length===2 && miss.find(x=>x.brand==='333 studio').reason==='invalid');
t('humanhu 처럼 올바른 핸들은 대상 아님', !miss.some(x=>x.brand==='humanhu'));
t("관용 표기(Stylist's Own·Selfmade)는 브랜드가 아니라 인스타를 요구하지 않는다", lookItemsMissingInstagram([{n:1,items:[{type:'Top',brand:"Stylist's Own",instagram:''},{type:'Costume',brand:'Selfmade',instagram:''}]}]).length===0);
t('브랜드 없이 핸들만 적으면 문법만 본다', lookItemsMissingInstagram([{n:1,items:[{type:'Top',brand:'',instagram:'@ok_handle'}]}]).length===0 && lookItemsMissingInstagram([{n:1,items:[{type:'Top',brand:'',instagram:'bad handle'}]}])[0].reason==='invalid');
t('빈 항목·null 방어', lookItemsMissingInstagram([{n:1,items:[{type:'',brand:'',instagram:''}]}]).length===0 && lookItemsMissingInstagram(null).length===0);
// ③ 판정: strictHandles 일 때 인스타 없는 의상 브랜드는 무료 자격(3종)에 안 센다. 기본(픽스처·미리보기)은 종전과 같다.
const looks3=[{n:1,items:[{type:'Top',brand:'A',instagram:'a'}]},{n:2,items:[{type:'Dress',brand:'B',instagram:''}]},{n:3,items:[{type:'Skirt',brand:'C',instagram:'c'}]}];
const map3=[{lookN:1,imgIdxInLook:0},{lookN:2,imgIdxInLook:0},{lookN:3,imgIdxInLook:0}];
t('strictHandles: 인스타 없는 브랜드 B 를 빼고 세어 2종 → €380', classifySubmissionType(looks3,map3,{genres:['FASHION'],strictHandles:true}).submissionType==='paid_few_looks');
t('기본 판정(플래그 없음)은 종전대로 3종 → free', classifySubmissionType(looks3,map3,{genres:['FASHION']}).submissionType==='free');
t('발효일(2026-09-14) 이전 제출은 strictHandles 여도 종전 규칙', classifySubmissionType(looks3,map3,{genres:['FASHION'],strictHandles:true,submittedAt:'2026-09-01T00:00:00Z'}).submissionType==='free');
t('브랜디드(€790) 판정은 핸들과 무관 — 핸들을 빼서 €790 을 피할 수 없다', classifySubmissionType([{n:1,items:[{type:'Dress',brand:'Solo',instagram:''}]},{n:2,items:[{type:'Top',brand:'Solo',instagram:''}]},{n:3,items:[{type:'Skirt',brand:'Solo',instagram:''}]}],map3,{genres:['FASHION'],strictHandles:true}).submissionType==='branded');
for (const f of ['api/submissions/index.js','api/submissions/[id].js']) {
  const src=read(f);
  t(f+': 분류 전에 lookItemsMissingInstagram → 400 LOOK_INSTAGRAM_REQUIRED (items 동봉)', /const _noInsta = lookItemsMissingInstagram\(looks\);[\s\S]{0,400}LOOK_INSTAGRAM_REQUIRED[\s\S]{0,300}items: _noInsta/.test(src) && src.indexOf('lookItemsMissingInstagram(looks)') < src.indexOf('classifySubmissionType(looks, lookImageMap'));
  t(f+': 분류기에 strictHandles: true', /classifySubmissionType\(looks, lookImageMap, \{ genres: normalizedGenres, strictHandles: true \}\)/.test(src));
}
const html=read('frontend/submission.html');
t('폼: _papValidHandle 미러 + _lookInstaAudit + 4단계 검증 + 서버 코드 매핑', /function _papValidHandle\(raw\)/.test(html) && /function _lookInstaAudit\(\)/.test(html) && /var _ci=_lookInstaAudit\(\);/.test(html) && /code==='LOOK_INSTAGRAM_REQUIRED'/.test(html));
t('폼 미러의 핸들 정규식이 서버와 같다', /\/\^\[a-z0-9\._\]\{1,30\}\$\/\.test\(s\)/.test(html));
t('문구 lookNeedsInstagram · lookInstagram 9개 언어', (html.match(/lookNeedsInstagram:'/g)||[]).length===9 && /lookInstagram:\{ko:'[^']+',en:'[^']+',de:'[^']+',it:'[^']+',fr:'[^']+',es:'[^']+',ja:'[^']+',zh:'[^']+',ru:'[^']+'\}/.test(html));
t('가이드라인 필수 자료: 브랜드마다 인스타 필수·없으면 브랜드 아님 (9개 언어)', (html.match(/glReqBody:'(?:\\.|[^'])*?(인스타그램이 없는 브랜드는 브랜드로 세지 않습니다|does not count as a brand|zählt nicht als Marke|non conta come brand|ne compte pas comme marque|no cuenta como marca|ブランドとして数えません|不计为品牌|не считается брендом)/g)||[]).length===9);
t('인스타 입력칸 placeholder 에 required', (html.match(/placeholder="@instagram \(required\)"/g)||[]).length===2);

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ submission-look-credit tests FAILED'); process.exit(1); }
console.log('✅ submission-look-credit tests passed');
