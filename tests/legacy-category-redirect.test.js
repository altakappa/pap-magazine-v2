/**
 * 옛 사이트 주소 /category/<이름>/<번호> → 해당 에디토리얼로 (2026-10-02 신설).
 *
 * ── 실제 상태 ────────────────────────────────────────────────────────
 * Ahrefs 실측(2026-10-02): 살아 있는 백링크 중 78개 주소가 옛 형식
 *   /category/Fashion/435, /en/category/belladonna/702/ …
 * 을 가리킨다. 대부분 models.com(DR79) 크레딧 페이지다.
 * 그런데 vercel.json 은 `/category/:cat*` 를 통째로 `/articles`(목록)로 보냈다.
 * → 링크를 눌러도 화보가 아니라 기사 목록이 뜨고, 링크 점수도 목록으로 샌다.
 *
 * ── 번호 → 슬러그 ────────────────────────────────────────────────────
 * DB 에 옛 번호가 남아 있지 않다(editorials.legacy 는 boolean).
 * 백링크 출처 페이지 제목(models.com "Heimweh (PAP Magazine)" 등)과
 * 주소 속 이름(/category/belladonna/702)으로 짝을 지었고, DB 에서 발행 상태를 확인했다.
 * 같은 번호가 다른 이름으로도 나온다(/category/DREAMCORE/217 = /category/Editorial/217,
 * /category/IN VITRO HYSTERIA/344 = /en/category/Fashion/344) → 번호는 사이트 전체에서 하나다.
 * 그래서 규칙은 이름이 아니라 **번호**로 잡는다.
 * 확신 못 한 번호(158·202·299·413 등)는 넣지 않았다. 틀린 화보로 보내는 게
 * 목록으로 보내는 것보다 나쁘다. 이 중 Editorial 번호는 화보 목록(/editorial)으로 간다.
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① 번호 규칙이 통째 규칙(`/category/:cat*` → /articles)보다 **앞에** 있을 것 (먼저 맞는 게 이긴다)
 *   ② 슬래시 유무, /news 꼬리, 언어 프리픽스(en·ko·기타) 모두 맞을 것
 *   ③ ko·무프리픽스 → /editorial/<slug>, 그 외 언어 → /en/editorial/<slug>
 *   ④ 기사 번호(1000 이상, /news) 는 건드리지 않을 것
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const redirects = cfg.redirects || [];

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 240)); }
}

/* vercel.json 에 실제로 쓰인 패턴만 다루는 최소 매처.
   :name (한 칸), :lang(a|b) (한 칸, 목록 중 하나), :x* (0칸 이상, 앞 / 포함 생략 가능) */
function compile(src) {
  let re = '^';
  const parts = src.split('/').slice(1);
  for (const p of parts) {
    let m;
    if ((m = p.match(/^:(\w+)\*$/))) re += '(?:/(.*))?';
    else if ((m = p.match(/^:(\w+)\(([^)]+)\)$/))) re += '/(' + m[2] + ')';
    else if ((m = p.match(/^:(\w+)$/))) re += '/([^/]+)';
    else re += '/' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '/?$');
}
function resolve(url) {
  for (let i = 0; i < redirects.length; i++) {
    const r = redirects[i];
    if (r.has) continue; /* 호스트 통합 규칙은 이 테스트 범위 밖 */
    const m = url.match(compile(r.source));
    if (!m) continue;
    let dest = r.destination;
    const names = (r.source.match(/:(\w+)/g) || []).map(x => x.slice(1));
    names.forEach((n, k) => { dest = dest.replace(':' + n + '*', m[k + 1] || '').replace(':' + n, m[k + 1] || ''); });
    return { i, dest, r };
  }
  return null;
}

const CASES = [
  ['/category/Fashion/435', '/editorial/no-time-to-shower'],
  ['/en/category/Editorial/205/', '/en/editorial/shapes-and-forms'],
  ['/category/Editorial/348', '/editorial/perfect-duo'],
  ['/en/category/belladonna/702/', '/en/editorial/belladonna'],
  ["/en/category/2000'S%20LOVE/204/", '/en/editorial/2000-s-love'],
  ['/en/category/Stages%20of%20adjustments/508/', '/en/editorial/stages-of-adjustments'],
  ['/en/category/Editorial/312/', '/en/editorial/heimweh'],
  ['/category/AS%20DUSK%20FALLS/244', '/editorial/as-dusk-falls'],
  ['/category/Aqin/184', '/editorial/aqin'],
  ['/category/DREAMCORE/217', '/editorial/dreamcore'],
  ['/category/Editorial/217', '/editorial/dreamcore'],
  ['/en/category/Fashion/344/', '/en/editorial/in-vitro-hysteria'],
  ['/ko/category/Fashion/249/', '/editorial/cosmos'],
  ['/en/category/LE%20M%C3%89TRO/720/', '/en/editorial/le-metro'],
  ['/en/category/Editorial/436/', '/en/editorial/juliette-doesn-t-have-a-gum'],
  ['/ja/category/SHEEPIE/810', '/en/editorial/sheepie'],
];
console.log('\n=== ②③ 옛 번호 → 해당 화보 ===');
for (const [from, to] of CASES) {
  const got = resolve(from);
  t(`${from} → ${to}`, got && got.dest === to && got.r.permanent === true, got ? got.dest + ' (#' + got.i + ')' : 'no match');
}

console.log('\n=== ① 번호 규칙이 통째 규칙보다 앞 ===');
const blanket = redirects.findIndex(r => !r.has && /\/category\/:cat\*$/.test(r.source));
const lastLegacy = redirects.map((r, i) => (/\/category\/:name\/\d+\//.test(r.source) ? i : -1)).filter(i => i >= 0).pop();
t('통째 규칙이 아직 있다(모르는 주소의 안전망)', blanket >= 0, blanket);
t('번호 규칙이 모두 그보다 앞', lastLegacy !== undefined && lastLegacy < blanket, lastLegacy + ' vs ' + blanket);

console.log('\n=== 모르는 Editorial 번호 → 화보 목록 ===');
for (const u of ['/category/Editorial/158', '/en/category/Editorial/299/', '/category/Editorial/26']) {
  const got = resolve(u);
  t(`${u} → /editorial`, got && got.dest === '/editorial', got && got.dest);
}

console.log('\n=== ④ 기사(news)·카테고리 목록은 그대로 /articles ===');
for (const u of ['/en/category/Fashion/2755/news/', '/en/category/Life/3414/news/', '/category/Fashion', '/en/category/Art']) {
  const got = resolve(u);
  t(`${u} → /articles`, got && got.dest === '/articles', got && got.dest);
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ legacy-category-redirect tests passed');
