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


// ── 클라 미러 · 약관 · 적용 지점 (2026-08-27 추가) ──────────────────────
const SUB_HTML = fs.readFileSync(path.join(ROOT, 'frontend/submission.html'), 'utf8');

t('클라 SPA 미러가 서버 목록과 완전히 일치한다', () => {
  const m = SUB_HTML.match(/var _PAP_SPA_BRANDS=\[([^\]]*)\];/);
  assert.ok(m, 'submission.html 에서 _PAP_SPA_BRANDS 를 찾지 못했다');
  const front = m[1].split(',').map((v) => v.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
  const server = Array.from(st.SPA_BRANDS).sort();
  assert.deepStrictEqual(front, server,
    '어긋나면 제출 화면 안내와 서버 판정이 다른 말을 한다');
});

t('클라 발효일이 서버 상수와 같다', () => {
  const m = SUB_HTML.match(/var _PAP_SPA_EFFECTIVE_AT='([^']+)';/);
  assert.ok(m, '_PAP_SPA_EFFECTIVE_AT 를 찾지 못했다');
  assert.strictEqual(m[1], st.SPA_RULE_EFFECTIVE_AT,
    '발효일이 다르면 유예 기간에 화면과 서버가 다른 금액을 말한다');
});

t('클라가 SPA 를 핸들로 되살리지 않는다 (@zara 우회 차단)', () => {
  assert.ok(/!\(applySpa && _papIsSpaBrand\(h0\)\)/.test(SUB_HTML),
    '핸들 폴백에 SPA 필터가 없다');
});

t('제출 화면이 왜 4종이 안 되는지 이유를 보여준다', () => {
  assert.ok(/submissionTypeSpaNote/.test(SUB_HTML), 'SPA 제외 안내 키가 없다');
  assert.ok((SUB_HTML.match(/submissionTypeSpaNote/g) || []).length >= 10,
    '9개 언어 + 사용처를 모두 채우지 않았다');
});

t('크레딧 수정 안내가 9개 언어로 있고 3개 제약을 함께 말한다', () => {
  assert.ok((SUB_HTML.match(/creditEditNotice/g) || []).length >= 10, '9개 언어 키가 없다');
  const ko = SUB_HTML.match(/creditEditNotice:'((?:[^'\\]|\\.)*)'/);
  assert.ok(ko, 'ko 문구를 찾지 못했다');
  const txt = ko[1];
  assert.ok(/3회/.test(txt), '횟수 제약이 없다');
  assert.ok(/줄일 수는 없/.test(txt), '브랜드 종류 수 제약이 없다');
  assert.ok(/결제/.test(txt), '결제 조건이 없다');
});

// ── 약관 (9개 언어) ────────────────────────────────────────────────────
const TERMS_SRC = fs.readFileSync(path.join(ROOT, 'frontend/submission-terms.js'), 'utf8');
const TERMS = (function () {
  const w = {};
  new Function('window', TERMS_SRC)(w);
  return w._PAPTerms;
})();
const LANGS = ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];

t('약관이 9개 언어 모두 12개 조항을 유지한다', () => {
  LANGS.forEach((lg) => {
    assert.ok(TERMS[lg], lg + ' 약관이 없다');
    const n = (TERMS[lg].match(/<li>/g) || []).length;
    assert.strictEqual(n, 12, lg + ' 조항 수가 ' + n + ' 이다 (12 여야 한다)');
  });
});

t('제7조 SPA·빈티지 제외 조항이 9개 언어 전부에 있다', () => {
  LANGS.forEach((lg) => {
    const a7 = TERMS[lg].split('<li>')[7];
    assert.ok(/⑤/.test(a7), lg + ' 제7조에 ⑤ 항이 없다');
    assert.ok(/SPA/.test(a7), lg + ' 제7조 ⑤ 에 SPA 언급이 없다');
  });
});

t('제3조②가 크레딧 수정 무료 횟수와 같은 값을 말한다', () => {
  const { MAX_CREDIT_EDITS } = require(path.join(ROOT, 'api/_lib/creditEdit.js'));
  const NUM = { ko: '3회', en: '3 times', de: 'dreimal', it: '3 volte', fr: '3 fois',
                es: '3 veces', ja: '3回', zh: '3 次', ru: '3 раз' };
  assert.strictEqual(MAX_CREDIT_EDITS, 3, '코드 한도가 3이 아니면 약관 문구도 같이 고쳐야 한다');
  LANGS.forEach((lg) => {
    const a3 = TERMS[lg].split('<li>')[3];
    assert.ok(a3.indexOf(NUM[lg]) !== -1, lg + ' 제3조에 무료 3회 문구가 없다');
    assert.ok(/100|€/.test(a3), lg + ' 제3조에서 유료 정정 수수료가 사라졌다');
  });
});

t('제8조①이 크레딧 정정은 제3조에 따른다고 예외를 둔다', () => {
  const REF = { ko: '제3조', en: 'Article 3', de: 'Artikel 3', it: 'Articolo 3',
                fr: "l'Article 3", es: 'Artículo 3', ja: '第3条', zh: '第3条', ru: 'Статьёй 3' };
  LANGS.forEach((lg) => {
    const a8 = TERMS[lg].split('<li>')[8];
    assert.ok(a8.indexOf(REF[lg]) !== -1,
      lg + ' 제8조가 여전히 "게재 후 수정 불가"만 말한다 — 약관과 기능이 서로 다른 말을 한다');
  });
});

t('약관 최종 수정일이 9개 언어 전부에서 갱신됐다', () => {
  const hits = SUB_HTML.match(/termsEffective:'((?:[^'\\]|\\.)*)'/g) || [];
  assert.strictEqual(hits.length, 9, 'termsEffective 키가 9개가 아니다: ' + hits.length);
  hits.forEach((h) => {
    assert.ok(/2026/.test(h) && !/(March 1|3월 1일|1\. März|1° marzo|1er mars|1 de marzo|3月1日|1 марта)/.test(h),
      '옛 최종 수정일이 남아 있다: ' + h.slice(0, 80));
  });
});

// ── 서버 적용 지점 ─────────────────────────────────────────────────────
t('제출 API 가 비라틴 브랜드명을 서버에서 막는다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/submissions/index.js'), 'utf8');
  assert.ok(/require\('\.\.\/_lib\/latinOnly'\)/.test(src), 'latinOnly 를 쓰지 않는다');
  assert.ok(/BRAND_LATIN_ONLY/.test(src), '거부 코드가 없다');
  assert.ok(/it\.brand/.test(src) && /it\.instagram/.test(src),
    '룩 크레딧의 브랜드명과 핸들 둘 다 검사해야 한다');
});

t('크레딧 수정 API 도 같은 검증을 건다 (제출은 영어, 수정으로 한글 우회 차단)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/editorials/[id]/credits.js'), 'utf8');
  assert.ok(/findNonLatin/.test(src), '수정 API 에 라틴 검증이 없다');
});


console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
