/**
 * SPA 브랜드 집계 제외 + 서버 라틴 전용 검증 (2026-08-26 도메니코 지시)
 *
 * ① "브랜드 갯수를 세아릴 때 SPA 브랜드나 빈티지 브랜드는 카운트하지 않는다"
 * ② "브랜드명은 전부 영어로만 쓸 수 있게 통일"
 *
 * 지키는 것
 *  - SPA 목록과 관용 표기(GENERIC_CREDIT_TERMS)는 별도로 유지된다
 *    (합치면 "브랜드가 아님"과 "브랜드지만 집계 제외"의 구분이 사라진다)
 *  - 부분 일치 금지 ("Zara Home" 은 SPA 가 아니다)
 *  - 발효일 이전 제출 건은 소급 적용되지 않는다 (판정 기준 = 제출 시각)
 *  - 서버 라틴 규칙이 프론트(pap-name-validator.js)와 문자 대 문자로 같다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const st = require(path.join(ROOT, 'api/_lib/submissionType.js'));
const { isLatinOnly, NON_LATIN_RE } = require(path.join(ROOT, 'api/_lib/latinOnly.js'));

let pass = 0, fail = 0;
function t(n, fn) {
  try { fn(); pass++; console.log('  ✓', n); }
  catch (e) { fail++; console.log('  ✗', n, '—', e.message); }
}

console.log('spa-brand-latin');

const FUTURE = '2099-01-01T00:00:00Z';   // 발효일 이후 = SPA 규칙 적용
const PAST = '2020-01-01T00:00:00Z';     // 발효일 이전 = 유예

t('SPA 판정: 표기 흔들림이 같은 키로 접힌다', () => {
  for (const v of ['Zara', 'ZARA', 'zara ', 'H&M', 'H and M', 'HM',
                   'Pull & Bear', 'Pull and Bear', '& Other Stories', 'COS',
                   'Massimo Dutti', 'Uniqlo', 'Calzedonia', 'Intimissimi']) {
    assert.ok(st.isSpaBrand(v), v + ' 가 SPA 로 안 잡힌다');
  }
});

t('부분 일치 금지 — 이름이 겹쳐도 다른 브랜드는 통과', () => {
  for (const v of ['Zara Home', 'Rick Owens', 'Diesel', 'Gucci', 'Maison Margiela']) {
    assert.ok(!st.isSpaBrand(v), v + ' 가 잘못 SPA 로 잡힌다');
  }
});

t('SPA 목록과 관용 표기 목록은 별도로 유지된다', () => {
  assert.ok(st.SPA_BRANDS instanceof Set && st.GENERIC_CREDIT_TERMS instanceof Set, '두 Set 이 모두 export 되어야 한다');
  assert.ok(st.SPA_BRANDS !== st.GENERIC_CREDIT_TERMS, '같은 객체를 가리키면 안 된다');
  // 교집합이 있으면 한쪽을 지웠을 때 다른 쪽이 조용히 바뀐다
  const overlap = [...st.SPA_BRANDS].filter((k) => st.GENERIC_CREDIT_TERMS.has(k));
  assert.deepStrictEqual(overlap, [], '두 목록이 겹친다: ' + overlap.join(','));
});

t('SPA 브랜드는 한글·비라틴 키를 담지 않는다 (브랜드명은 라틴 전용)', () => {
  const bad = [...st.SPA_BRANDS].filter((k) => !isLatinOnly(k));
  assert.deepStrictEqual(bad, [], '비라틴 키: ' + bad.join(','));
});

t('집계: SPA 2개 + 독립 브랜드 4개 → 무료 자격(4종 유지)', () => {
  const looks = [
    { n: 1, items: [{ brand: 'Zara', type: 'Jacket' }, { brand: 'Rick Owens', type: 'Coat' }] },
    { n: 2, items: [{ brand: 'Mango', type: 'Top' }, { brand: 'Diesel', type: 'Pants' }] },
    { n: 3, items: [{ brand: 'Gucci', type: 'Dress' }] },
    { n: 4, items: [{ brand: 'Prada', type: 'Shirt' }] },
  ];
  const map = [{ lookN: 1 }, { lookN: 2 }, { lookN: 3 }, { lookN: 4 }];
  const r = st.classifySubmissionType(looks, map, { submittedAt: FUTURE });
  assert.strictEqual(r.submissionType, 'free', '실제: ' + r.submissionType);
});

t('집계: 독립 브랜드 3개 + SPA 2개 → 유료 (SPA 를 빼면 4종 미만)', () => {
  const looks = [
    { n: 1, items: [{ brand: 'Zara', type: 'Jacket' }, { brand: 'Rick Owens', type: 'Coat' }] },
    { n: 2, items: [{ brand: 'Mango', type: 'Top' }, { brand: 'Diesel', type: 'Pants' }] },
    { n: 3, items: [{ brand: 'Gucci', type: 'Dress' }] },
    { n: 4, items: [{ brand: 'Rick Owens', type: 'Coat' }] },
  ];
  const map = [{ lookN: 1 }, { lookN: 2 }, { lookN: 3 }, { lookN: 4 }];
  const r = st.classifySubmissionType(looks, map, { submittedAt: FUTURE });
  assert.notStrictEqual(r.submissionType, 'free', 'SPA 제외가 집계에 반영되지 않았다');
});

t('유예: 발효일 이전 제출 건은 SPA 제외가 적용되지 않는다', () => {
  const looks = [
    { n: 1, items: [{ brand: 'Zara', type: 'Jacket' }, { brand: 'Rick Owens', type: 'Coat' }] },
    { n: 2, items: [{ brand: 'Mango', type: 'Top' }, { brand: 'Diesel', type: 'Pants' }] },
    { n: 3, items: [{ brand: 'Gucci', type: 'Dress' }] },
    { n: 4, items: [{ brand: 'Rick Owens', type: 'Coat' }] },
  ];
  const map = [{ lookN: 1 }, { lookN: 2 }, { lookN: 3 }, { lookN: 4 }];
  const older = st.classifySubmissionType(looks, map, { submittedAt: PAST });
  assert.strictEqual(older.submissionType, 'free', '구 제출 건이 소급 재분류되었다');
  assert.strictEqual(st.spaRuleApplies(PAST), false);
  assert.strictEqual(st.spaRuleApplies(FUTURE), true);
});

t('발효일이 상수 한 곳에만 정의되어 있다', () => {
  assert.ok(typeof st.SPA_RULE_EFFECTIVE_AT === 'string' && st.SPA_RULE_EFFECTIVE_AT.length >= 10);
  const src = fs.readFileSync(path.join(ROOT, 'api/_lib/submissionType.js'), 'utf8');
  const defs = (src.match(/SPA_RULE_EFFECTIVE_AT\s*=/g) || []).length;
  assert.strictEqual(defs, 1, '발효일 정의가 ' + defs + '곳 — 한 곳이어야 한다');
});

t('서버 라틴 검증: 악센트 라틴 허용, 비라틴 차단', () => {
  for (const v of ['Zara', 'Hermès', 'Comme des Garçons', 'Niño', '@zara', 'A.P.C.', '']) {
    assert.ok(isLatinOnly(v), v + ' 는 통과해야 한다');
  }
  for (const v of ['자라', 'ザラ', '飒拉', 'Привет', 'Jacket 자켓']) {
    assert.ok(!isLatinOnly(v), v + ' 는 차단해야 한다');
  }
});

t('서버 라틴 규칙이 프론트 pap-name-validator 와 동일하다', () => {
  const front = fs.readFileSync(path.join(ROOT, 'frontend/pap-name-validator.js'), 'utf8');
  const m = front.match(/var NON_LATIN_RE = (\/\[[^\n]*?\]\/);/);
  assert.ok(m, '프론트에서 NON_LATIN_RE 를 찾지 못했다');
  assert.strictEqual(m[1], NON_LATIN_RE.toString(),
    '두 정규식이 다르다. 프론트=' + m[1] + ' 서버=' + NON_LATIN_RE.toString());
});

console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
