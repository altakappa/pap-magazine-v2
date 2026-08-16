/**
 * JSON 블록 본문의 <br> 이스케이프 회귀 (2026-08-17 신설)
 *
 * 사건: 기사 본문에는 두 형식이 섞여 있다. 대부분은 HTML 문자열이지만
 * 10편은 [{"type":"text","content":"..."}] 형태의 JSON 블록이다.
 * 그중 7편은 JSON 안의 content 에 <br><br> 가 '문자로' 들어 있었고,
 * 렌더러가 escText 로 이스케이프해 화면에 &lt;br&gt; 가 그대로 찍혔다.
 *
 * 피해가 컸던 이유 — 그 7편에 워터밤 서울 2026 라인업 기사가 있었다.
 * GSC 월 노출 6,300 으로 우리 기사 페이지 중 1위다. 그 페이지가 한 덩어리
 * 문단에 태그 글자가 박힌 채로 나가고 있었다. 2026-08-14 발행분에도 있어
 * 데이터만 고치면 재발한다. 그래서 렌더러를 고쳤다.
 *
 * 지키는 것:
 *   ① JSON 블록 본문에서 <br> 두 개 이상은 단락 경계가 된다
 *   ② 남은 홑 <br> 은 줄바꿈으로 살아난다
 *   ③ **그래도 다른 태그는 여전히 이스케이프된다** (되돌리는 건 <br> 하나뿐)
 *   ④ 일반 HTML 본문 경로는 영향받지 않는다
 */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { renderSeoHtml } = require(path.join(ROOT, 'api', '_lib', 'seoRenderer.js'));

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

function render(content) {
  return renderSeoHtml('article', {
    id: 'test-id', title: '테스트 기사', slug: 'test-article', status: 'published',
    published_date: '2026-07-08', content, gallery: [], tags: [],
  }, { lang: 'ko', availableLangs: ['ko', 'en'] });
}

console.log('\n=== ① <br><br> 가 단락 경계가 된다 ===');
{
  const h = render('[{"type":"text","content":"첫 단락이다.<br><br>둘째 단락이다."}]');
  t('이스케이프된 &lt;br&gt; 가 남지 않는다', !/&lt;br&gt;/.test(h), '화면에 태그 글자가 보인다');
  t('첫 단락이 닫힌다', /첫 단락이다\.<\/p>/.test(h));
  t('둘째 단락이 열린다', /<p[^>]*>둘째 단락이다\./.test(h));
  t('본문 텍스트가 유실되지 않았다', /첫 단락이다/.test(h) && /둘째 단락이다/.test(h));
}

console.log('\n=== ② 홑 <br> 은 줄바꿈으로 살아난다 ===');
{
  const h = render('[{"type":"text","content":"윗줄이다.<br>아랫줄이다."}]');
  t('이스케이프되지 않는다', !/&lt;br&gt;/.test(h));
  t('실제 <br> 로 렌더된다', /윗줄이다\.<br>아랫줄이다/.test(h), h.match(/윗줄이다[\s\S]{0,40}/));
}

console.log('\n=== ③ 다른 태그는 여전히 이스케이프된다 (XSS) ===');
{
  const h = render('[{"type":"text","content":"본문이다.<script>alert(1)</script><img src=x onerror=alert(2)>"}]');
  t('script 태그가 살아나지 않는다', !/<script>alert\(1\)<\/script>/.test(h), 'XSS 통과');
  t('script 가 이스케이프돼 있다', /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(h));
  t('img onerror 가 살아나지 않는다', !/<img src=x onerror/.test(h));
  t('본문 텍스트는 정상 렌더', /본문이다/.test(h));
}

console.log('\n=== ④ 일반 HTML 본문 경로는 그대로 ===');
{
  const h = render('<p>평범한 HTML 본문이다.</p><p>둘째 문단.</p>');
  t('HTML 본문이 그대로 렌더된다', /평범한 HTML 본문이다/.test(h));
  t('HTML 태그가 이스케이프되지 않는다', !/&lt;p&gt;평범한/.test(h));
}

console.log('\n=== ⑤ 빈 값·비정상 입력에서 안 터진다 ===');
{
  t('빈 배열', typeof render('[]') === 'string');
  t('깨진 JSON 은 문자열로 처리', /그냥 문자열/.test(render('[{깨짐 그냥 문자열')));
  t('빈 문자열', typeof render('') === 'string');
}

console.log('\n' + (fail ? '✗' : '✓') + ' article-json-block-br: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
