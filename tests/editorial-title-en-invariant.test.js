// PAP Magazine — 화보 title_en 불변식 회귀 테스트 (2026-09-15)
//
// [왜] editorials 2,537건 중 22건의 title_en 이 비어 있었다(발행 7 · 초안 15).
// 화면 글자는 한 글자도 안 바뀌었다. 읽는 쪽 폴백이 이미 전부 깔려 있었기
// 때문이다. 진짜 구멍은 쓰기 쪽이 네 군데라는 것이었다. 규칙을 DB 트리거
// 한 곳(supabase_migrations/162)에 두고, 이 테스트가 그 한 곳을 지킨다.
//
// Run with `node tests/editorial-title-en-invariant.test.js` (npm test 에 연결).

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

const MIG = 'supabase_migrations/162_editorials_title_en_invariant.sql';

console.log('\n=== 162 마이그레이션: 규칙이 DB 한 곳에 있는가 ===');
{
  const exists = fs.existsSync(path.join(ROOT, MIG));
  ok(`${MIG} 가 저장소에 있다`, exists);
  if (exists) {
    const sql = R(MIG);
    ok('editorials 에 BEFORE 트리거를 건다',
      /before\s+insert\s+or\s+update[\s\S]{0,80}on\s+public\.editorials/i.test(sql));
    ok('빈 값일 때만 채운다 (비어있지 않은 title_en 은 안 건드린다)',
      /new\.title_en\s+is\s+null\s+or\s+btrim\(new\.title_en\)\s*=\s*''/i.test(sql));
    ok('채우는 값은 title 이다', /new\.title_en\s*:=\s*nullif\(btrim\(new\.title\)/i.test(sql));
    ok('title 도 공백이면 null 로 둔다 (빈 문자열을 만들지 않는다)',
      /nullif\(btrim\(new\.title\),\s*''\)/i.test(sql));
    ok('되돌리는 방법이 적혀 있다', /drop\s+trigger\s+if\s+exists\s+editorials_fill_title_en_trg/i.test(sql));
    ok('articles 에는 걸지 말라는 경고가 있다', /articles/.test(sql) && /한글/.test(sql));
    ok('articles 테이블에 같은 트리거를 걸지 않는다',
      !/on\s+public\.articles/i.test(sql));
  }
}

// 이 로직은 SQL 안에 있어 require 로 못 부른다. 같은 규칙을 JS 로 한 번 더
// 적어 두면 그게 바로 "규칙 두 벌"이다. 그래서 여기서는 규칙을 베끼지 않고,
// 읽는 쪽 폴백이 아직 살아 있는지만 본다. 트리거가 언젠가 사라져도
// 화면이 안 깨지는 마지막 방어선이기 때문이다.
console.log('\n=== 읽는 쪽 폴백이 아직 살아 있는가 (마지막 방어선) ===');
{
  ok('seoRenderer: title_en 이 비면 원제로 떨어진다',
    /record\.title_en\s*\|\|\s*titleKo/.test(R('api/_lib/seoRenderer.js')));
  ok('seoTranslateBackfill: title_en 이 비면 원제로 떨어진다',
    /e\.title_en\s*\|\|\s*e\.title/.test(R('api/_lib/seoTranslateBackfill.js')));
  ok('editorialFaqBackfill: title_en 이 비어도 undefined 로 흘린다',
    /title_en:\s*e\.title_en\s*\|\|\s*undefined/.test(R('api/_lib/editorialFaqBackfill.js')));

  const { overlayRelatedTitles } = require(path.join(ROOT, 'api', '_lib', 'relatedI18n'));
  const items = [{ id: 1, title: 'The Night Hag', title_en: '' }];
  overlayRelatedTitles(items, 'en', null);
  ok('relatedI18n: title_en 이 비면 원제를 지운 채로 두지 않는다',
    items[0].title === 'The Night Hag');
}

console.log(`\n${failed === 0 ? '✅ 전부 통과' : '❌ 실패 있음'} — 통과 ${passed} · 실패 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
