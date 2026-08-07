/**
 * 발행 실패 안내 (2026-08-07 신설).
 *
 * ── 실제 사고 ────────────────────────────────────────────────────────
 * 2026-08-07 21:35~22:18 KST, 도메니코가 에디토리얼 'BOYS' 발행을 **8번**
 * 눌렀고 8번 다 실패했다. 화면에는 이것만 떴다:
 *
 *     발행 실패: Failed to update editorial
 *
 * 서버 로그에는 원인이 처음부터 있었다:
 *     code '23505' · 'Key (slug)=(boys) already exists.'
 *     constraint 'editorials_published_slug_uniq'
 *
 * 2024-10-09 발행분 'Boys' 가 이미 slug `boys` 를 쓰고 있었다. 이 제약은
 * **published 끼리만** 유니크한 부분 인덱스라 draft 저장은 통과하고 발행
 * 순간에만 막힌다 — "등록은 됐는데 발행만 안 된다" 로 보인 이유다.
 *
 * 고칠 방법(슬러그 변경)이 명확한 오류인데 화면이 그걸 말하지 않았다.
 * `.claude/rules/api.md` 의 "원문 에러를 응답에 싣지 않는다" 를 지키면서
 * **분류용 code 를 붙이는 나머지 절반을 안 했기 때문**이다.
 *
 * ── 같이 발견한 더 나쁜 것 ───────────────────────────────────────────
 * `apiPut` 은 HTTP 상태와 무관하게 본문을 돌려주고 예외를 던지지 않는다.
 * 그래서 결과를 안 보는 호출부는 **실패를 성공으로 표시**한다.
 * 에디토리얼 편집 저장(pap-admin.js)이 정확히 그 상태였다 — 저장이 실패해도
 * "에디토리얼이 수정되었습니다." 가 떴다. 일괄 발행도 같았다.
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① 알려진 유니크 제약 위반은 409 + code + 한국어 안내로 나갈 것
 *   ② 제약 이름·테이블 구조가 응답에 **새지 않을** 것
 *   ③ 모르는 오류는 기존 500 경로를 그대로 탈 것 (새 실패 모드 금지)
 *   ④ 실제 사고 페이로드(slug=boys)에서 값이 뽑힐 것
 *   ⑤ 서버가 이 헬퍼를 실제로 물고 있을 것 (editorials·articles)
 *   ⑥ 프론트가 결과를 확인할 것 — 실패가 '성공' 으로 뜨지 않게
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { describePgError, conflictValue, UNIQUE_RULES } = require(path.join(ROOT, 'api/_lib/pgError'));

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); }
}

/* 2026-08-07 사고 당시 서버가 실제로 받은 오류 객체 그대로. */
const REAL = {
  code: '23505',
  details: 'Key (slug)=(boys) already exists.',
  hint: null,
  message: 'duplicate key value violates unique constraint "editorials_published_slug_uniq"',
};

console.log('\n=== ①④ 실제 사고 페이로드 ===');
const r = describePgError(REAL);
t('알려진 제약으로 인식한다', !!r);
t('409 Conflict 로 나간다 (재시도해도 그대로다)', r && r.status === 409);
t('code 는 slug_conflict', r && r.body.code === 'slug_conflict');
t('충돌한 값 boys 를 뽑아낸다', r && r.body.conflict_value === 'boys', r && r.body);
t('안내에 무엇을 고쳐야 하는지 들어 있다',
  r && /주소/.test(r.body.error) && /바꾼/.test(r.body.error), r && r.body.error);
t('안내에 충돌한 값이 보인다', r && r.body.error.includes('boys'), r && r.body.error);

console.log('\n=== ② 내부 구조가 새지 않는다 ===');
const asText = JSON.stringify(r.body);
t('제약 이름이 응답에 없다', !asText.includes('editorials_published_slug_uniq'), asText);
t('테이블 이름이 응답에 없다', !/editorials|articles|films/.test(asText), asText);
t('원문 Postgres 문구가 없다', !/duplicate key|violates|unique constraint/i.test(asText), asText);
t('SQLSTATE 코드가 없다', !asText.includes('23505'), asText);

console.log('\n=== ③ 모르는 오류는 건드리지 않는다 ===');
t('23505 가 아니면 null', describePgError({ code: '23503', message: 'foreign key' }) === null);
t('모르는 제약이면 null',
  describePgError({ code: '23505', message: 'duplicate key ... "some_new_uniq"' }) === null);
t('null/undefined 도 안전', describePgError(null) === null && describePgError(undefined) === null);
t('빈 객체도 안전', describePgError({}) === null);

console.log('\n=== 값 추출기 ===');
t('표준 형식에서 값을 뽑는다', conflictValue('Key (slug)=(boys) already exists.') === 'boys');
t('괄호가 값에 들어가도 뽑는다',
  conflictValue('Key (slug)=(a(b)c) already exists.') === 'a(b)c');
t('형식이 다르면 null', conflictValue('something else') === null);
t('값이 없어도 안내는 나간다', (() => {
  const x = describePgError({ code: '23505', message: '..."editorials_published_slug_uniq"', details: null });
  return x && x.body.code === 'slug_conflict' && x.body.conflict_value === undefined;
})());

console.log('\n=== 다른 표에도 같은 처리가 있다 ===');
for (const name of ['articles_slug_key', 'films_slug_key',
                    'editorials_source_submission_uniq', 'idx_articles_ig_post_id']) {
  const x = describePgError({ code: '23505', message: 'duplicate key ... "' + name + '"', details: null });
  t(name + ' → 안내가 있다', !!x && x.status === 409 && !!x.body.code && /[가-힣]/.test(x.body.error));
}
/* DB 의 실제 유니크 제약 이름과 이 표가 어긋나면 안내가 안 나간다.
   2026-08-07 실측(pg_indexes)으로 확인한 5개다. */
t('알려진 제약 5개를 다룬다', Object.keys(UNIQUE_RULES).length === 5, Object.keys(UNIQUE_RULES));

console.log('\n=== ⑤ 서버가 실제로 물고 있다 ===');
for (const f of ['api/editorials/[id].js', 'api/articles/[id].js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  t(f + ' 가 pgError 를 require 한다', /require\('\.\.\/_lib\/pgError'\)/.test(src));
  t(f + ' 가 describePgError 결과를 응답으로 쓴다',
    /const known = describePgError\(err\);[\s\S]{0,120}res\.status\(known\.status\)\.json\(known\.body\)/.test(src));
  t(f + ' 는 모르는 오류에 500 + code 를 준다',
    /res\.status\(500\)\.json\(\{ error: '[^']*', code: 'update_failed' \}\)/.test(src));
}

console.log('\n=== ⑥ 프론트가 결과를 확인한다 (실패가 성공으로 뜨지 않게) ===');
const admin = fs.readFileSync(path.join(ROOT, 'frontend/pap-admin.js'), 'utf8');
t('assertApiOk 헬퍼가 있다', /function assertApiOk\(resp, fallback\)/.test(admin));
t('헬퍼가 code 를 함께 실어 던진다', /e\.code=resp\.code/.test(admin));
t('에디토리얼 편집 저장이 결과를 확인한다',
  /assertApiOk\(await apiPut\('\/editorials\/'\+editingEditorialId,payload\)/.test(admin));
t('에디토리얼 신규 등록도 확인한다',
  /assertApiOk\(await apiPost\('\/editorials',payload\)/.test(admin));
t('일괄 발행이 결과를 확인한다',
  /assertApiOk\(await apiPut\('\/editorials\/' \+ id, \{ status: 'published' \}\)/.test(admin));
t('발행 버튼은 원래대로 resp.error 를 보여준다',
  /resp && resp\.error[\s\S]{0,80}발행 실패/.test(admin));

/* 캐시버스트 — pap-admin.js 를 고쳤으면 admin.html 의 ?v= 도 올라가야 한다.
   안 올리면 관리자에게 옛 코드가 그대로 서빙된다(저장소 체크리스트). */
console.log('\n=== 캐시버스트 ===');
const html = fs.readFileSync(path.join(ROOT, 'frontend/admin.html'), 'utf8');
const v = (html.match(/pap-admin\.js\?v=(\d+)/) || [])[1];
t('admin.html 의 pap-admin.js 버전이 139 이상', Number(v) >= 139, v);

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ editorial-publish-conflict tests passed');
