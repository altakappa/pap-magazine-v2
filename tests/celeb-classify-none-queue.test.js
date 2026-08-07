/*
 * celeb-classify-none-queue.test.js  (2026-08-07)
 *
 * 실측에서 나온 두 가지를 못박는다.
 *
 * ① 'none' 은 파괴적 판정이다 — 두 모음 모두에서 빠지고 되돌리려면 사람이 손대야 한다.
 *    첫 100건 중 none 13건을 전수 확인했더니 최소 7건이 오답이었다
 *    (지코 워터밤 · 마르지엘라 향수 행사 2건 · 맨시티 팝업 2건 ·
 *     메종 드 윤 공예 · 스포츠 사진가 Geoff Lowe).
 *    celeb·collection 은 멀쩡했다 — 문제는 none 하나다.
 *    → none 은 바로 저장하지 않고 사람 확인 대기열로 보낸다.
 *
 * ② 태그 마커가 단어 안에 묻힌 글자까지 잡았다.
 *    'brandenburg gate' 안의 'brand' 를 패션 신호로 읽었다.
 *    이 판정은 celeb 마커 전체와 다이제스트 즉석 판정에도 쓰인다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { markerKind, wordHit } = require(path.join(ROOT, 'api/_lib/digestKind'));
const src = fs.readFileSync(path.join(ROOT, 'api/cron/celeb-classify.js'), 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

console.log('\n=== 1. 단어 경계 — 묻힌 글자를 신호로 읽지 않는다 ===');
ok(wordHit('brandenburg gate', 'brand') === false, "'brandenburg' 안의 'brand' 를 잡지 않는다");
ok(markerKind({ tags: ['berlin pride', 'brandenburg gate', 'rainbow flag'] }).kind === 'none',
   '브란덴부르크 문 기사가 패션 콘텐츠로 분류되지 않는다');

console.log('\n=== 2. 정상 변형은 그대로 잡는다 (과잉 교정 방지) ===');
const yes = [
  ['fragrances', 'fragrance'], ['photography', 'photograph'], ['photographer', 'photograph'],
  ['seoul popup', 'popup'], ['pop-up', 'popup'], ['sculptural fashion', 'sculpt'],
  ['jewelry', 'jewel'], ['paintings', 'paint'], ['패션위크', '패션'],
  ['korean craftsmanship', 'craftsmanship'], ['cultural exchange', 'cultural'],
  ['sneakers', 'sneaker'], ['cosmetics', 'cosmetic'], ['retailer', 'retail'],
];
const missed = yes.filter(([t, k]) => !wordHit(t, k)).map(([t, k]) => t + '/' + k);
ok(missed.length === 0, missed.length ? `놓친 정상 변형: ${missed.join(', ')}` : `정상 변형 ${yes.length}종을 그대로 잡는다`);

console.log('\n=== 3. 실측 오분류 기사가 이제 collection 신호를 낸다 ===');
const real = [
  ['맨시티 성수 팝업', ['manchester city', 'man city house', 'puma', 'seoul popup', 'sports fashion']],
  ['메종 드 윤 공예', ['christopher nolan', 'maison de yoon', 'korean craftsmanship', 'film premiere']],
  ['마르지엘라 향수의 밤', ['maison margiela', 'fragrances', 'replica', 'zion.t', 'code kunst']],
  ['Geoff Lowe 스포츠 사진', ['geoff lowe', 'sports photography', 'photography', 'athlete']],
  ['지코 워터밤', ['zico', 'waterbomb', 'festival fashion', 'streetwear']],
];
for (const [name, tags] of real) {
  ok(markerKind({ tags }).kind !== 'none', `${name} → 마커가 none 이 아니다 (${markerKind({ tags }).kind})`);
}
ok(markerKind({ tags: ['heat wave', 'seoul', 'weather alert', 'climate', 'public health'] }).kind === 'none',
   "폭염경보는 여전히 none 이다 (필요한 none 까지 없애지 않았다)");

console.log('\n=== 4. none 은 사람 확인 대기열로 간다 ===');
ok(/PENDING_BY\s*=\s*'ai_none_pending'/.test(src), "대기열 표식이 kind_by='ai_none_pending' 이다");
ok(/PENDING_KIND\s*=\s*'collection'/.test(src),
   "확인 전까지는 digest_kind='collection' — 글이 사라지지 않는다 (안전 쪽 실패)");
ok(/v\.kind === 'none' \? PENDING_BY : 'ai'/.test(src), "AI 가 none 이라 해도 kind_by 를 대기열로 바꾼다");
ok(!/applyKind\([^)]*'none'/.test(src), "none 을 그대로 저장하는 경로가 남아있지 않다");
ok(/pendingNone/.test(src), '대기열 건수를 세어 로그에 남긴다');

console.log('\n=== 5. 옛 none 판정을 되살리는 길이 있다 ===');
ok(/recheck/.test(src), 'recheck 모드가 있다');
ok(/\.eq\('kind_by', 'ai'\)\.eq\('digest_kind', 'none'\)/.test(src),
   "recheck 는 kind_by='ai' 인 옛 none 만 비운다");
ok(!/eq\('kind_by', 'manual'\)/.test(src) && /manual/.test(src),
   "manual(사람이 정한 값)은 건드리지 않는다 — 주석으로도 명시돼 있다");

console.log('\n=== 6. 남은 대기 수가 거짓말하지 않는다 ===');
ok(/count: 'exact', head: true/.test(src), '남은 대기를 DB 에 직접 센다');
ok(/is\('digest_kind', null\)/.test(src), '미판정(digest_kind is null) 기준으로 센다');

console.log('\n=== 7. 프롬프트가 실측 오답을 예시로 담고 있다 ===');
ok(/none 은 마지막 수단이다/.test(src), 'none 을 마지막 수단으로 못박는다');
ok(/워터밤/.test(src) && /팝업은 collection/.test(src), '실제 오답 사례가 프롬프트에 들어 있다');
ok(/컬처 콘텐츠를 none 으로 버리라는 뜻이 아니다/.test(src),
   "도메니코 지시의 뜻을 프롬프트가 바로잡는다");

console.log(`\npassed: ${pass} failed: ${fail}`);
if (fail) process.exit(1);
console.log('✅ celeb-classify-none-queue tests passed');
