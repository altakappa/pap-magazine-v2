/**
 * 관리자 지정 업로드(?article=) 회귀 잠금 — tests/youtube-target-upload.test.js
 *
 * 2026-08-04 도메니코가 특정 기사 5건만 올려달라고 했다. 크론 선택기는
 * "최근 3일 + 미게시 1건"이라 07-31 기사를 집을 수 없어서 지목 경로를 열었다.
 * 여기서 잠그는 건 그 경로가 **사람 전용**이라는 것 — 크론이 임의 기사를
 * 집을 수 있게 되면 발행 통제가 무너진다.
 *
 * 소스 문자열 검사다(런타임 DB 없이 도는 저장소 관례, youtube-ig-link 와 동일).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'cron', 'youtube-post.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

section('지목 업로드는 사람만');
ok('?article= 를 읽는다', src.includes("req.query.article"));
ok('cronOk 이면 지목 불가 (!cronOk 게이트)',
  /const rawTarget\s*=\s*!cronOk\s*&&/.test(src));

section('파라미터 검증 — PostgREST 필터 주입 방지');
ok('영숫자·하이픈·밑줄 화이트리스트', src.includes("/^[A-Za-z0-9_-]{1,120}$/"));
ok('형식 오류는 400', /article 파라미터 형식 오류[\s\S]{0,80}?400|400[\s\S]{0,120}?article 파라미터 형식 오류/.test(src));
ok('검증이 .or() 조회보다 먼저 온다',
  src.indexOf("/^[A-Za-z0-9_-]{1,120}$/") < src.indexOf(".or(isUuid"));

section('지목 경로가 우회하는 것 / 지키는 것');
/* freshCutoff 는 선언 1 + 사용 1 = 2회, 그리고 둘 다 else(자동 선택) 안쪽이어야
   한다. 지목 경로가 3일 창에 걸리면 07-31 기사를 영영 못 올린다. */
ok('신선도 창은 자동 선택 경로에만 남는다',
  (src.match(/freshCutoff/g) || []).length === 2
  && src.indexOf('freshCutoff') > src.indexOf('} else {'));
ok('중복 업로드는 막는다 (done 검사 유지)', src.includes('if (done.has(art.id))'));
ok('중복은 409', /done\.has\(art\.id\)[\s\S]{0,120}?409/.test(src));

section('videos 비었을 때 다음 행동을 알려준다');
ok('videos 비면 업로드하지 않는다', src.includes("'videos 가 비어 있음"));
ok('백필 엔드포인트를 응답에 담는다',
  src.includes("backfill: '/api/admin/articles/backfill-video?slug='"));

section('컬럼 목록 단일화 (지목/자동 두 경로가 갈라지지 않게)');
ok('ART_COLS 상수 정의', /const ART_COLS =/.test(src));
ok('두 조회 모두 ART_COLS 사용', (src.match(/\.select\(ART_COLS\)/g) || []).length === 2);
ok('tags 가 포함된다 (해시태그 소스)', /const ART_COLS =[^\n]*tags/.test(src));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ youtube-target-upload tests FAILED'); process.exit(1); }
console.log('✅ youtube-target-upload tests passed');
