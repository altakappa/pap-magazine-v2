/**
 * SSR 기사·에디토리얼 페이지의 본문 블록 정렬 (2026-08-22)
 *
 * 왜: 도메니코 — "홈화면에서 기사를 클릭하면 제대로 뜨는데,
 *     기사를 주소로 치고 들어가면 이상하게 떠서 수정필요"
 *
 * 원인은 `.seo-tags` 하나였다. <article> 직계 자식인데 형제들과 달리
 * max-width/auto 마진이 없어 화면 왼쪽 끝까지 붙었다. 홈에서 클릭해
 * 들어오면 SPA 가 그리므로 이 클래스가 아예 안 쓰인다 — 그래서
 * '주소로 들어갈 때만' 어긋나 보였다.
 *
 * 한 곳만 고치면 다음에 또 생긴다. **본문 섹션 블록 전부**가 가운데
 * 정렬 규칙을 갖는지 여기서 못박는다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/seoRenderer.js'), 'utf8');

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

/** 인라인 CSS 에서 해당 셀렉터의 선언 블록을 뽑는다 (최상위 규칙만). */
function rule(sel) {
  const m = SRC.match(new RegExp('^\\s{2}' + sel.replace('.', '\\.') + '\\{([^}]*)\\}', 'm'));
  return m ? m[1] : null;
}

/* <article> 안에서 한 줄을 통째로 차지하는 본문 섹션들.
   새 섹션을 만들면 여기에 추가할 것 — 그래야 다음 사람이 안 빠뜨린다. */
const SECTIONS = [
  '.seo-meta', '.seo-body', '.seo-tags', '.seo-faq',
  '.seo-credits', '.seo-fashion', '.seo-related', '.seo-back', '.ig-funnel',
];

console.log('SSR 본문 블록 정렬');

t('모든 본문 섹션이 폭 상한을 갖는다', () => {
  for (const sel of SECTIONS) {
    const body = rule(sel);
    assert.ok(body, '규칙을 못 찾았다: ' + sel);
    assert.ok(/max-width:\s*\d+px/.test(body),
      sel + ' 에 max-width 가 없다 — 화면 끝까지 늘어나 본문과 어긋난다');
  }
});

t('모든 본문 섹션이 가운데로 온다 (auto 마진)', () => {
  for (const sel of SECTIONS) {
    const body = rule(sel);
    assert.ok(/margin:[^;]*auto/.test(body),
      sel + ' 의 마진에 auto 가 없다 — 왼쪽에 붙는다');
  }
});

t('태그 줄이 형제 블록과 같은 폭이다', () => {
  const tags = rule('.seo-tags');
  const body = rule('.seo-body');
  const w = (s) => (s.match(/max-width:\s*(\d+)px/) || [])[1];
  assert.strictEqual(w(tags), w(body), '태그 폭이 본문 폭과 다르다');
});

t('기사 종류에서도 좌우 여백이 형제와 같다', () => {
  // 기사(.seo-kind-article)는 형제들이 padding:0 20px 을 쓴다.
  const m = SRC.match(/\.seo-kind-article \.seo-tags\{([^}]*)\}/);
  assert.ok(m, '기사 종류용 .seo-tags 재정의가 없다');
  assert.ok(/padding:\s*0 20px/.test(m[1]), '형제(.seo-meta)와 좌우 여백이 다르다');
});

console.log(`\n${n}개 테스트 통과`);
