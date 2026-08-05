/**
 * SHOP THE STORY 브랜드 칩 중복 회귀 (2026-08-05 신설).
 *
 * 왜 필요했나 — 실제 증상:
 *   라이브 에디토리얼의 SHOP THE STORY 줄에 `holzweiler` 칩이 두 번 찍혔다.
 *   _papRenderShopRow 는 det.fashion 배열을 trim/빈값제거 후 그대로 slice(0,12)
 *   해서 뿌렸을 뿐, 중복 제거가 한 줄도 없었다. 크레딧이 룩별로 들어오는 구조라
 *   같은 브랜드가 여러 룩에 쓰이면 그대로 반복된다.
 *
 * 여기서 지키는 것:
 *   ① 같은 브랜드는 한 번만 (대소문자·@접두어 무시 — 링크 목적지가 같으므로)
 *   ② 중복 제거가 slice(0,12) '앞'에서 — 중복이 12칸을 잡아먹으면 안 된다
 *   ③ 첫 등장 순서와 표기를 유지 (임의 정렬 금지)
 *   ④ 'constructor' 같은 Object.prototype 이름이 브랜드로 와도 삼켜지지 않는다
 *   ⑤ 기존 동작 보존 — '@brand' 플레이스홀더 제외, 빈 배열이면 섹션 숨김
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

// 실제 배포되는 소스에서 함수를 그대로 꺼내 돌린다 (문자열 검사 아님).
const src = R('frontend/pap-content-editorial.js');
const m = src.match(/\nfunction _papRenderShopRow\(fashion\)\{[\s\S]*?\n\}/);
if (!m) { console.log('  ✗ _papRenderShopRow 를 소스에서 찾지 못함'); process.exit(1); }

function render(fashion){
  const box = { innerHTML: '', style: { display: '' } };
  const doc = { getElementById: id => (id === 'edShopRow' ? box : null) };
  const fn = new Function('document', '_edL9', m[0] + '\nreturn _papRenderShopRow;')(doc, (ko, en) => en);
  fn(fashion);
  return box;
}
const chips  = box => (box.innerHTML.match(/<a href="\/go\//g) || []).length;
const links  = box => (box.innerHTML.match(/\/go\/[^"]*/g) || []);
const labels = box => (box.innerHTML.match(/">([^<]+) <span/g) || []).map(s => s.slice(2, -6).trim());

console.log('\n=== ① 중복 브랜드는 한 번만 ===');
t('같은 이름이 두 번 오면 칩은 하나',
  chips(render(['holzweiler', 'simonerocha', 'holzweiler'])) === 2,
  '라이브에서 실제로 난 증상');
t('대소문자가 달라도 같은 브랜드',
  chips(render(['Holzweiler', 'holzweiler', 'HOLZWEILER'])) === 1,
  '링크가 /go/<소문자> 라 목적지가 같다');
t('@ 접두어 유무도 같은 브랜드',
  chips(render(['@holzweiler', 'holzweiler'])) === 1);
t('앞뒤 공백만 다른 것도 같은 브랜드',
  chips(render(['  celine ', 'celine'])) === 1);
t('서로 다른 브랜드는 안 합쳐진다',
  chips(render(['celine', 'ferragamo', 'miista'])) === 3);

console.log('=== ② 중복 제거가 12칸 제한보다 먼저 ===');
(function(){
  // 앞 12칸을 중복으로 채우고 뒤에 새 브랜드를 둔다. 중복 제거가 slice 뒤였다면
  // b1 하나만 남아 칩이 3개가 된다.
  const dupes = Array(12).fill('b1');
  const box = render(dupes.concat(['b2', 'b3']));
  t('중복이 12칸을 잡아먹지 않는다', chips(box) === 3,
    '실제 칩 수: ' + chips(box));
})();
t('고유 브랜드가 12개를 넘으면 12개까지만',
  chips(render(Array.from({ length: 20 }, (_, i) => 'brand' + i))) === 12);

console.log('=== ③ 순서·표기 보존 ===');
(function(){
  const box = render(['Celine', 'ferragamo', 'celine', 'miista']);
  t('첫 등장 순서를 유지한다', labels(box).join(',') === 'Celine,ferragamo,miista',
    '실제: ' + labels(box).join(','));
  t('첫 등장의 표기(대문자)를 유지한다', labels(box)[0] === 'Celine');
  t('링크는 소문자 슬러그', links(box)[0] === '/go/celine');
})();
t('@ 는 표시에서도 링크에서도 벗겨진다',
  labels(render(['@miista']))[0] === 'miista' && links(render(['@miista']))[0] === '/go/miista');

console.log('=== ④ prototype 이름 오탐 방지 ===');
t("'constructor' 브랜드가 삼켜지지 않는다",
  chips(render(['constructor', 'celine'])) === 2,
  "seen 객체 키에 접두어가 없으면 Object.prototype.constructor 가 truthy 라 사라진다");
t("'toString' 도 마찬가지",
  chips(render(['toString', 'celine'])) === 2);
t("'constructor' 가 두 번 오면 그때는 하나로",
  chips(render(['constructor', 'constructor'])) === 1);

console.log('=== ⑤ 기존 동작 보존 ===');
t("'@brand' 플레이스홀더는 제외", chips(render(['@brand', 'celine'])) === 1);
t('빈 문자열·공백만 있는 값은 제외', chips(render(['', '   ', 'celine'])) === 1);
t('빈 배열이면 섹션 숨김', (function(){ const b = render([]); return b.style.display === 'none' && b.innerHTML === ''; })());
t('배열이 아니면 섹션 숨김', (function(){ const b = render(null); return b.style.display === 'none'; })());
t('내용이 있으면 섹션 표시', render(['celine']).style.display === '');
t('어필리에이트 rel 속성 유지',
  /rel="sponsored nofollow noopener"/.test(render(['celine']).innerHTML),
  '수수료 링크는 sponsored 표기가 있어야 한다');
t('수수료 고지 문구 유지', /commission/i.test(render(['celine']).innerHTML));
t('< 는 이스케이프된다', /&lt;/.test(render(['<script>']).innerHTML));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ shop-row-dedup tests failed'); process.exit(1); }
console.log('✅ shop-row-dedup tests passed');
