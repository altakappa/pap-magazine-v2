/**
 * 기사 본문 화면에서 꺾쇠 제목이 사라지지 않는다 (2026-11-15)
 *
 * 실제 화면: 팀버랜드 기사가 "의 에디터가 직접 만나본 결과" 로 시작했다.
 * 원문은 "<PAP>의 에디터가 …". 본문을 HTML 로 그리니 브라우저가 <PAP> 를
 * 모르는 태그로 읽고 지웠다. 9/3 에 글자로 내보내는 곳(트윗·메타)은 고쳤지만
 * 본문 화면(SSR · SPA · RSS 풀텍스트)은 빠져 있었다.
 * 실측 3,412건: <PAP> 52건 · 영문 꺾쇠 제목 약 80건.
 *
 * 지키는 것: ① 꺾쇠 제목은 글자로 ② 진짜 태그는 그대로 ③ script·style 안쪽은 안 건드림
 *            ④ 서버와 프런트가 같은 판단 ⑤ 세 화면 모두 이 함수를 지난다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const S = require('../api/_lib/stripHtml');
const f = S.escapeAngleTitles;

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', typeof d === 'string' ? d : JSON.stringify(d)); } }

console.log('\n[1] 꺾쇠 제목은 글자로');
t('사고 재현: <PAP>', f('<PAP>의 에디터가 직접 만나본 결과') === '&lt;PAP&gt;의 에디터가 직접 만나본 결과', f('<PAP>의 에디터가'));
t('낱말이 여러 개인 제목', f('영화 <Alter Ego>와 <Hard Times Gym>') === '영화 &lt;Alter Ego&gt;와 &lt;Hard Times Gym&gt;');
t("이름에 ' 가 낀 제목 (<Woman's House>)", f("<Woman's House>") === "&lt;Woman's House&gt;");
t('이름에 : 가 낀 제목 (<JENNIE: …>)', f('<JENNIE: GLOBAL FORCE. ICONIC STYLE>') === '&lt;JENNIE: GLOBAL FORCE. ICONIC STYLE&gt;');
t('하이픈·숫자 (<I-KNOW> · <J2NNI5>)', f('<I-KNOW> <J2NNI5>') === '&lt;I-KNOW&gt; &lt;J2NNI5&gt;');
t('한자·기호가 섞인 제목', f('<V TYPE 非 : ON-SITE IN SEOUL>') === '&lt;V TYPE 非 : ON-SITE IN SEOUL&gt;');
t('HTML 원소 이름과 같은 제목: <Ruby> (닫는 짝 없음)', f('<Ruby>는 제니의 앨범') === '&lt;Ruby&gt;는 제니의 앨범');
t('HTML 원소 이름으로 시작하는 제목: <A Year in the Sink>', f('<A Year in the Sink>') === '&lt;A Year in the Sink&gt;');
t('한 글에 여러 번', (f('<PAP>가 <PAP>에게').match(/&lt;PAP&gt;/g) || []).length === 2);

console.log('[2] 진짜 태그는 그대로');
const real = '<p style="margin:0">문단</p><br><br/><strong class="x">굵게</strong><a href="https://x.y" target="_blank">링크</a><center>가운데</center><b>b</b><i>i</i><img src="a.jpg" alt="x"><hr><div class="d">d</div>';
t('본문에 실제로 쓰는 태그 전부', f(real) === real, f(real));
t('닫는 태그를 생략해도 되는 원소 (<p> · <li>)', f('<p>닫힘 없는 문단<ul><li>하나<li>둘</ul>') === '<p>닫힘 없는 문단<ul><li>하나<li>둘</ul>');
t('짝이 있는 ruby 는 태그', f('<ruby>漢<rt>kan</rt></ruby>') === '<ruby>漢<rt>kan</rt></ruby>');
t('= 없는 속성 (allowfullscreen · controls)', f('<iframe src="x" allowfullscreen></iframe><video controls></video>') === '<iframe src="x" allowfullscreen></iframe><video controls></video>');
t('대문자로 쓴 진짜 태그', f('<BR><STRONG>s</STRONG>') === '<BR><STRONG>s</STRONG>');
t('한 문서에서 짝 하나가 빠진 center (실측 108 열림 / 107 닫힘)', f('<center>a</center><center>b') === '<center>a</center><center>b');

console.log('[3] 건드리지 않는 것');
t('한글·숫자로 시작하는 꺾쇠 (브라우저가 원래 글자로 그린다)', f('<더 드라마> <2026 LACMA 갈라>') === '<더 드라마> <2026 LACMA 갈라>');
t('부등호', f('a < b 이고 c > d') === 'a < b 이고 c > d');
t('script 안쪽 코드', f('<script>if(a<b && c>d){x()}</script><Bully>') === '<script>if(a<b && c>d){x()}</script>&lt;Bully&gt;', f('<script>if(a<b && c>d){x()}</script><Bully>'));
t('style 안쪽', f('<style>a>b{color:red}</style><PAP>') === '<style>a>b{color:red}</style>&lt;PAP&gt;');
t('꺾쇠가 없으면 그대로', f('그냥 글') === '그냥 글' && f('') === '' && f(null) === '');
t('두 번 지나가도 같다 (이중 변환 없음)', f(f('<PAP>와 <br>')) === f('<PAP>와 <br>'));

console.log('[4] 프런트 거울');
const fe = R('frontend/pap-content-article.js');
const block = fe.slice(fe.indexOf('/* ANGLE-TITLES:BEGIN'), fe.indexOf('/* ANGLE-TITLES:END */'));
t('거울 블록이 있다', block.length > 500);
const ctx = {}; vm.createContext(ctx); vm.runInContext(block + '\nthis.fn=_papAngleTitles;this.T=_PAP_AT_TAGS;this.V=_PAP_AT_VOID;this.O=_PAP_AT_OPT;this.B=_PAP_AT_BOOL;', ctx);
const list = (set) => [...set].join(' ');
t('표 네 개가 서버와 같다',
  ctx.T.trim() === list(S.HTML_TAGS) && ctx.V.trim() === list(S.VOID_TAGS) && ctx.O.trim() === list(S.OPTIONAL_END_TAGS) && ctx.B.trim() === list(S.BOOLEAN_ATTRS));
const samples = ['<PAP>의 에디터가<br><br>영화 <Alter Ego>', "<Woman's House> <JENNIE: GLOBAL>", '<Ruby>', '<ruby>a</ruby>', '<A Year in the Sink> <a href="x">l</a>', real,
  '<p>p<ul><li>1<li>2</ul>', '<더 드라마> a < b', '<script>if(a<b && c>d){}</script><Bully>', '<iframe src="x" allowfullscreen></iframe>', '<center>a</center><center>b', '', '글'];
const diff = samples.filter((x) => ctx.fn(x) !== f(x));
t('같은 입력에 같은 출력 (' + samples.length + '개)', diff.length === 0, diff);
t('SPA: 한국어 본문이 함수를 지난다', /descEl\.innerHTML=_papAngleTitles\(a\.desc\);/.test(fe));
t('SPA: 번역 본문도 지난다', /descEl\.innerHTML=_papAngleTitles\(_enBody\);/.test(fe));
t('SPA: 날것 대입이 남아 있지 않다', !/descEl\.innerHTML=a\.desc;/.test(fe) && !/descEl\.innerHTML=_enBody;/.test(fe));
const refs = fs.readdirSync(path.join(ROOT, 'frontend')).filter((x) => /\.html$/.test(x)).map((x) => R('frontend/' + x)).concat([R('api/_lib/seoRenderer.js')])
  .map((s) => s.match(/pap-content-article\.js\?v=(\d+)/)).filter(Boolean);
t('캐시버스트: 참조 ' + refs.length + '곳 전부 v=54 이상', refs.length >= 10 && refs.every((m) => Number(m[1]) >= 54));

console.log('[5] 서버 화면');
const seo = R('api/_lib/seoRenderer.js');
t('SSR: 문자열 본문이 함수를 지난다', /return typeof content === 'string' \? escapeAngleTitles\(content\) : escText/.test(seo));
t('SSR: stripHtml 에서 가져온다 (규칙은 한 벌)', /escapeAngleTitles \} = require\('\.\/stripHtml'\)/.test(seo));
const rss = R('api/rss.js');
t('RSS 풀텍스트도 지난다', /s = escapeAngleTitles\(s\.trim\(\)\);/.test(rss) && /require\('\.\/_lib\/stripHtml'\)/.test(rss));
t('글자로 내보내는 쪽(stripHtml)은 그대로 — 지우지 않고 남긴다', S.stripHtml('<PAP>가 <br>왔다', '') === '<PAP>가 왔다');

console.log(`\npassed: ${pass}   failed: ${fail}`);
process.exit(fail ? 1 : 0);
