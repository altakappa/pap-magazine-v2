/**
 * 홈 캐러셀 — "넘기다 보면 일부 기사만 뜬다" (2026-10-31)
 * ═══════════════════════════════════════════════════════════════════
 * [무엇이었나] 홈의 최신기사 캐러셀(#fashionTrack)은 두 덩어리였다.
 *   · index.html 에 하드코딩된 정적 카드 42장 — 2026-03-02 에서 멈춰 있다
 *   · API 에서 받아 앞에 끼우는 최신 N편 — 상한 HOME_CAROUSEL_MAX = 100
 *   그래서 넘기면 10/22~10/30 이 나오다가 곧장 3월 이전으로 건너뛰고 끝났다.
 *   실측(2026-10-30): 발행 3,250편 중 그 사이 **1,628편**이 홈에서 안 보였다.
 *
 * [상한을 푸는 건 답이 아니다] 2026-08-22 에 이미 해봤고 되돌렸다.
 *   상한 없이 그리자 캐러셀 카드 2,424장 · 그 안의 DOM 노드가 페이지 전체의 74%,
 *   롱태스크 713ms. 가로로 2,424장을 넘기는 사람은 없다. 그 기록이
 *   pap-content-api-sync.js 주석에 그대로 남아 있다.
 *
 * [고침] 첫 100장은 그대로 두고, **오른쪽 끝에 닿으면 다음 100장을 이어 붙인다.**
 *   · 첫 페인트 비용은 0 — 넘기지 않으면 종전과 똑같다
 *   · 전량 카탈로그는 그때 papEnsureFullCatalog() 로 연다(홈은 그전까지 요청 0)
 *   · 첫 배치가 붙으면 3월에서 멈춘 정적 카드를 걷는다(날짜 순서가 끊기던 자리)
 *
 * [고착 방지] API 가 아무것도 주지 못하면 정적 카드를 걷지 않는다 — 빈 캐러셀보다 낫다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'frontend/pap-content-api-sync.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

/* ── 1) 지켜야 할 모양 ─────────────────────────────────────────── */
t('첫 배치 상한 100 은 그대로다 (2026-08-22 성능 실측의 핀)',
  /var HOME_CAROUSEL_MAX = 100;/.test(SRC));
t('이어붙이기 묶음도 100 이다',
  /var HOME_CAROUSEL_MORE = 100;/.test(SRC));
t('카드 만들기는 한 곳(_makeFashionCard)뿐 — 두 경로가 갈리지 않는다',
  (SRC.match(/function _makeFashionCard\(/g) || []).length === 1 &&
  (SRC.match(/card\.className = 'fashion-card';/g) || []).length === 1);
t('첫 배치도 같은 헬퍼를 쓴다',
  /var card = _makeFashionCard\(a, isTop\);/.test(SRC));
t('렌더 끝에서 스크롤 배선을 건다',
  /_wireHomeCarouselMore\(track\);\s*\n\s*\}/.test(SRC));
t('오른쪽 끝 가까이에서만 더 불러온다 (되돌아올 땐 아무 일 없음)',
  /if\(track\.scrollLeft \+ track\.clientWidth < track\.scrollWidth - 600\) return;/.test(SRC));
t('스크롤 청취는 passive — 넘기는 손을 막지 않는다',
  /track\.addEventListener\('scroll', function\(\)\{[\s\S]{0,600}\{ passive: true \}\)/.test(SRC));
t('더 받기 전에 전량 카탈로그를 연다 (홈은 그전까지 요청 0건)',
  /papEnsureFullCatalog[\s\S]{0,120}_homeCarouselMore\(track\)/.test(SRC));
t('이어붙이기는 전량(artData)을 보고, 최신 12건(apiArticles)을 보지 않는다',
  /function _homeCarouselMore\(track\)\{[\s\S]{0,400}typeof artData !== 'undefined'/.test(SRC));
t('정적 카드는 동적 카드가 하나라도 붙었을 때만 걷는다',
  /if\(track\.querySelector\('\.fashion-card\[data-dyn="1"\]'\)\)\{[\s\S]{0,320}fashion-card:not\(\[data-dyn="1"\]\)/.test(SRC));
t('배선은 한 번만 (data-more-wired)',
  /data-more-wired/.test(SRC) && /track\.setAttribute\('data-more-wired', '1'\)/.test(SRC));

/* ── 2) 실제로 돌려 본다 ────────────────────────────────────────
   _homeCarouselMore 는 IIFE 안이라 require 로 꺼낼 수 없다. 소스에서 그 구간을
   그대로 떼어 new Function 으로 세우고, 가짜 트랙·가짜 카탈로그를 물려 돌린다.
   정규식만으로는 "이미 있는 걸 또 붙이지 않는다" 를 잴 수 없다. */
const from = SRC.indexOf('  var HOME_CAROUSEL_MORE = 100;');
const to = SRC.indexOf('  function _wireHomeCarouselMore(track)');
t('이어붙이기 구간을 소스에서 떼어낼 수 있다', from > 0 && to > from);
const slice = SRC.slice(from, to);
const build = new Function('artData', '_makeFashionCard', slice + '\n return _homeCarouselMore;');

function fakeTrack(seed) {
  const kids = seed.slice();
  return {
    kids,
    querySelectorAll() {
      return kids.map((k) => ({
        getAttribute: (n) => (n === 'data-slug' ? (k.slug || null) : null),
        querySelector: () => ({ textContent: k.title || '' }),
      }));
    },
    appendChild(c) { kids.push(c); },
  };
}
const mk = (a) => ({ slug: a.slug, title: a.t });
const many = (n, off) => Array.from({ length: n }, (_, i) => ({ slug: 's' + (i + (off || 0)), t: 'T' + (i + (off || 0)) }));

{
  const more = build([], mk);
  const tr = fakeTrack([]);
  t('전량 카탈로그가 아직이면 0장 — 다음 스크롤에 다시 온다', more(tr) === 0 && tr.kids.length === 0);
}
{
  const more = build(many(5), mk);
  const tr = fakeTrack([{ slug: 's2', title: 'T2' }]);
  const n = more(tr);
  t('이미 붙어 있는 slug 는 건너뛴다', n === 4 && tr.kids.length === 5);
  t('건너뛴 것이 중복으로 들어가지 않는다', tr.kids.filter((k) => k.slug === 's2').length === 1);
}
{
  const more = build([{ slug: 'other', t: '같은 제목' }], mk);
  const tr = fakeTrack([{ slug: null, title: '같은 제목' }]);   // 정적 카드엔 slug 가 없을 수 있다
  t('slug 가 달라도 제목이 같으면 건너뛴다 (정적 카드 대비)', more(tr) === 0);
}
{
  const more = build(many(250), mk);
  const tr = fakeTrack([]);
  const first = more(tr);
  t('한 번에 100장까지만 붙인다', first === 100 && tr.kids.length === 100);
  const second = more(tr);
  t('다시 부르면 다음 100장이 겹치지 않고 이어진다', second === 100 && tr.kids.length === 200);
  const slugs = new Set(tr.kids.map((k) => k.slug));
  t('두 묶음 사이에 중복이 없다', slugs.size === 200);
  const third = more(tr);
  t('남은 50장을 마저 붙이고 멈춘다', third === 50 && tr.kids.length === 250 && more(tr) === 0);
}

t('테스트 스크립트 등록', /home-carousel-lazy-more\.test\.js/.test(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')));

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
