'use strict';
/**
 * 관리자 목록의 인라인 onclick 에 제목을 넣는 방식 (2026-09-20 도메니코 "발행 버튼을 눌러도 발행이 안 된다").
 *
 * esc() 가 7/26 부터 따옴표를 &#39; 로 바꾼다. 그 뒤에 .replace(/'/g,"\\'") 를 해도 ' 는 이미 없으니 무의미.
 * 브라우저는 속성값의 &#39; 를 ' 로 되돌려 JS 에 넘기므로 onclick="publishEditorial('id','DIDN'T …')" 가 되어
 * SyntaxError → 버튼이 죽는다. 라이브 실측(WHAT IF MAKEUP DIDN'T HAVE TO LOOK HUMAN).
 *
 * 정규식으로 훑지 않고 pap-admin.js 에서 esc/escAttr/jsArg 를 꺼내 실행한 뒤, 브라우저처럼 엔티티를 되돌리고
 * 그 JS 를 실제로 파싱·실행해 제목이 원형 그대로 함수에 도착하는지 본다.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'frontend/pap-admin.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }

function grabFn(name) {
  const m = SRC.match(new RegExp('\\nfunction ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}\\n'));
  return m ? m[0] : '';
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(grabFn('esc') + grabFn('escAttr') + grabFn('jsArg'), ctx);
t('esc / escAttr / jsArg 를 원문에서 꺼내 실행', typeof ctx.esc === 'function' && typeof ctx.escAttr === 'function' && typeof ctx.jsArg === 'function');

/* 브라우저 HTML 파서가 속성값을 되돌리는 것과 같은 일 */
function decodeAttr(s) { return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

const TITLES = ["WHAT IF MAKEUP DIDN'T HAVE TO LOOK HUMAN", "MY YEAR OF REST AND RELAXATION", "Rock 'n' Roll \"Queen\"", "back\\slash", "두 줄\n제목", "<b>&"];
console.log('\n=== 옛 방식은 깨진다 (회귀 재현) ===');
{
  const old = ctx.esc("WHAT IF MAKEUP DIDN'T HAVE TO LOOK HUMAN").replace(/'/g, "\\'");
  let err = null; try { new Function(decodeAttr("publishEditorial('id','" + old + "')")); } catch (e) { err = e; }
  t("esc(title).replace(/'/g,\"\\\\'\") → 되돌린 onclick 이 SyntaxError", err instanceof SyntaxError);
}
console.log('\n=== jsArg: 되돌린 onclick 이 파싱되고, 제목이 원형 그대로 도착 ===');
for (const title of TITLES) {
  const attr = "publishEditorial('id','" + ctx.jsArg(title) + "')";
  t('속성값에 따옴표·꺾쇠가 날것으로 남지 않는다: ' + JSON.stringify(title), !/["'<>]/.test(attr.replace(/^publishEditorial\('id','/, '').replace(/'\)$/, '')));
  let got = null, err = null;
  try {
    const run = new Function('publishEditorial', decodeAttr(attr));
    run(function (id, tt) { got = tt; });
  } catch (e) { err = String(e); }
  t('파싱·실행 OK, 제목 원형 도착: ' + JSON.stringify(title), !err && got === title, err || ('got ' + JSON.stringify(got)));
}
console.log('\n=== 호출부가 jsArg 를 쓴다 ===');
t("옛 패턴 esc(...).replace(/'/g 가 pap-admin.js 에 없다", !/=\s*esc\([^)]*\)\.replace\(\/'\/g/.test(SRC));
t('발행·즉시 발행·삭제·이달의 에디토리얼 버튼이 safeTitle=jsArg(...) 를 쓴다', (SRC.match(/safeTitle\s*=\s*jsArg\(/g) || []).length >= 2 && /publishEditorial\(\\''\+e\.id\+'\\',\\''\+safeTitle/.test(SRC));
t('admin.html 캐시버스트 pap-admin.js?v= ≥ 161', (function(){ const m = fs.readFileSync(path.join(__dirname, '..', 'frontend/admin.html'), 'utf8').match(/pap-admin\.js\?v=(\d+)/); return m && Number(m[1]) >= 161; })());

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ admin-inline-onclick FAILED'); process.exit(1); }
console.log('✅ admin-inline-onclick passed');
