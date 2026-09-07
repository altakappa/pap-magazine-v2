/**
 * 사진 화보 FAQ — 2026-09-07 실제로 남아 있던 26건 기반.
 *
 * 이 테스트가 지키는 것:
 *   ① 26건 전부에서 FAQ 가 나온다 (하나도 못 만들면 만든 의미가 없다)
 *   ② 지어낸 문장이 없다 — 답에 쓰인 값이 전부 입력에 있던 값이다
 *   ③ 사실이 모자라면 만들지 않는다 (억지로 채우지 않는다)
 *   ④ 같은 브랜드가 글마다 다르게 찍히지 않는다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildGalleryFaq, parseSeason, parseCity, parseKind, parseShooter, parseBrand } =
  require('../api/_lib/galleryFaq');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/gallery-26.json'), 'utf8'));
const asRow = (r) => ({ title: r.title, tags: r.tags, content: r.content, gallery: new Array(r.n).fill(1) });

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

console.log('사진 화보 FAQ');

t('실제 26건에서 전부 FAQ 가 나온다', () => {
  assert.strictEqual(FIX.length, 26, '표본 수가 바뀌었다');
  for (const r of FIX) {
    const faq = buildGalleryFaq(asRow(r));
    assert.ok(faq && faq.length >= 2, '못 만듦: ' + r.title);
    assert.ok(faq.length <= 3, '3개를 넘겼다: ' + r.title);
  }
});

t('사진 수는 갤러리의 실제 길이와 같다', () => {
  for (const r of FIX) {
    const faq = buildGalleryFaq(asRow(r));
    const cnt = faq.find((f) => /몇 장/.test(f.q));
    if (!cnt) continue;
    assert.ok(cnt.a.startsWith(String(r.n) + '장'), `사진 수 불일치: ${r.title} → ${cnt.a} (실제 ${r.n})`);
  }
});

t('촬영자는 본문에 그 이름이 있을 때만 적는다', () => {
  for (const r of FIX) {
    const faq = buildGalleryFaq(asRow(r));
    const who = faq.find((f) => /누가 촬영/.test(f.q));
    if (!who) continue;
    const name = who.a.replace(/가 촬영했습니다\.$/, '');
    assert.ok(r.content.includes(name), `본문에 없는 촬영자: ${r.title} → ${name}`);
  }
});

t('시즌 코드는 제목이나 태그에 실제로 있는 것만 쓴다', () => {
  for (const r of FIX) {
    const faq = buildGalleryFaq(asRow(r));
    const m = /\(([A-Z]{2}\d{2,4})\)/.exec(faq[0].a);
    if (!m) continue;
    const hay = (r.title + ' ' + r.tags.join(' ')).toLowerCase();
    assert.ok(hay.includes(m[1].toLowerCase()), `없는 시즌 코드: ${r.title} → ${m[1]}`);
  }
});

/* 2026-09-07 1차 판이 실제로 낸 오류.
 * "PAP x VIPERRR 애프터파티" 를 "밀란 패션 위크의 포토월" 이라고 적었다.
 * 우리 파티지 패션위크 공식 행사가 아니다. 기간만 말하고 주최를 단정하지 않는다. */
t('애프터파티·포토월을 패션위크 공식 행사라고 말하지 않는다', () => {
  for (const r of FIX) {
    if (!/애프터파티|포토월/.test(r.title)) continue;
    const a = buildGalleryFaq(asRow(r))[0].a;
    assert.ok(!/패션 위크의 (애프터파티|포토월)/.test(a), '주최를 단정한다: ' + a);
    assert.ok(/기간에/.test(a), '기간 표현이 없다: ' + a);
  }
});

/* 태그에 AVAVAV 와 avavav 가 섞여 있다. 소문자 태그를 공식 표기인 양
 * 괄호에 넣으면 같은 브랜드가 글마다 다르게 찍힌다. 모르면 비운다. */
t('브랜드 영문 표기는 대문자가 있는 것만 쓴다', () => {
  for (const r of FIX) {
    const a = buildGalleryFaq(asRow(r))[0].a;
    const m = /\(([^)]+)\)/.exec(a.split('의 ')[0] || '');
    if (!m) continue;
    if (/^[A-Z]{2}\d{2,4}$/.test(m[1])) continue;   // 시즌 코드는 대상 아님
    assert.ok(/[A-ZÀ-ÞĀ-Ž]/.test(m[1]), '소문자 표기를 썼다: ' + a);
  }
});

t('사실이 모자라면 만들지 않는다', () => {
  assert.strictEqual(buildGalleryFaq({ title: '제목만 있는 글', tags: [], content: '', gallery: [] }), null);
  assert.strictEqual(buildGalleryFaq({ title: '', tags: ['FW26'], content: '', gallery: [1, 2, 3] }), null);
  assert.strictEqual(buildGalleryFaq(null), null);
  // 사진만 많고 시즌·종류를 모르면 사실이 1개뿐이라 만들지 않는다
  assert.strictEqual(buildGalleryFaq({ title: '무제', tags: [], content: '', gallery: new Array(20).fill(1) }), null);
});

t('조각 해석기: 시즌·도시·종류·촬영자', () => {
  assert.strictEqual(parseSeason('FW26').ko, '2026 가을겨울');
  assert.strictEqual(parseSeason('SS25').ko, '2025 봄여름');
  assert.strictEqual(parseSeason('AW25').ko, '2025 가을겨울');
  assert.strictEqual(parseSeason('그냥 글'), null);
  assert.strictEqual(parseCity('밀란 패션 위크').ko, '밀란');
  assert.strictEqual(parseCity('pfw').ko, '파리');
  assert.strictEqual(parseKind('백스테이지 화보'), '백스테이지');
  assert.strictEqual(parseShooter('Photographer. CLAUDIO K'), 'CLAUDIO K');
  assert.strictEqual(parseShooter('Photographer: NATASHA'), 'NATASHA');
  // 이름 자리에 문장이 오면 이름이 아니다
  assert.strictEqual(parseShooter('사진을 담았다'), null);
});

t('"밀란 패션 위크 FW26" 은 브랜드가 아니다', () => {
  assert.strictEqual(parseBrand('밀란 패션 위크 FW26 스트릿 스타일 Part.2', []), null);
  assert.strictEqual(parseBrand('루이사 베카리아 FW26 백스테이지', ['Luisa Beccaria']).ko, '루이사 베카리아');
});

/* 이 FAQ 는 JSON-LD 뿐 아니라 페이지에 그대로 보인다(seo-faq 섹션).
 * 독자가 읽는 글이므로 빈 값이나 깨진 괄호가 나가면 안 된다. */
t('화면에 그대로 나가도 되는 문장이다', () => {
  for (const r of FIX) {
    for (const f of buildGalleryFaq(asRow(r))) {
      assert.ok(f.q && f.a, '빈 항목: ' + r.title);
      assert.ok(!/undefined|null|NaN/.test(f.q + f.a), '값이 빠졌다: ' + f.a);
      assert.ok(!/\(\)|\(\s*\)/.test(f.a), '빈 괄호: ' + f.a);
      assert.ok(!/ {2,}/.test(f.a), '공백이 겹쳤다: ' + f.a);
      assert.ok(f.a.trim() === f.a, '앞뒤 공백: ' + f.a);
      assert.ok(f.a.length <= 120, '너무 길다: ' + f.a);
    }
  }
});

console.log(`\n${n}개 테스트 통과`);
