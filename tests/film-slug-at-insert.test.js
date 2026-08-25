// PAP Magazine — 필름 자동 등록 시 slug 부여 회귀 테스트 (2026-08-25)
//
// [왜] GSC 색인 적체 진단에서 발행 필름 217개 중 68개가 slug 공백으로 확인됐다.
// 전부 youtube-sync 크론 유입분 — slug 없이 insert 하면 프론트의 slug||id 폴백이
// /film/<uuid> 링크를 뿌리고, 그 UUID URL 이 "리디렉션 포함" 색인 버킷(5,812)을
// 다시 채운다. 68건은 8/25 일괄 백필했고(DB), 여기는 재발 지점을 고정한다.
//
// Run with `node tests/film-slug-at-insert.test.js` (wired into `npm test`).

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'youtube-sync.js'), 'utf8');

let passed = 0, failed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('\n=== youtube-sync 가 생성 시점에 slug 를 붙인다 ===');
ok('공용 slug 헬퍼를 쓴다 (규칙 이원화 방지)',
   /require\('\.\.\/_lib\/slug'\)/.test(src)
   && /generateAsciiSlug/.test(src) && /ensureUniqueSlug/.test(src));
ok('insert row 에 slug 가 실린다', /slug: filmSlug,/.test(src));
ok('slug 는 유일화를 거친다 (films 표 기준)',
   /ensureUniqueSlug\(supabaseAdmin, 'films', base\)/.test(src));
ok('slug 생성 실패가 insert 를 막지 않는다 (try/catch)',
   /try \{[\s\S]{0,300}ensureUniqueSlug[\s\S]{0,200}\} catch/.test(src));

console.log('\n=== slug 규칙이 실제로 동작한다 (실행 검증) ===');
{
  const { generateAsciiSlug } = require(path.join(ROOT, 'api', '_lib', 'slug'));
  const s = generateAsciiSlug('[ CELEBRITY ] 나스와 함께한 셀럽들 ㅡ Pap magazine');
  ok('한글 제목이 비어있지 않은 ASCII 슬러그가 된다', /^[a-z0-9-]+$/.test(s) && s.length > 5, s);
  ok('로마자 음역이 들어간다', /naseu|selreop/.test(s), s);
}

console.log('\n=== SUMMARY ===');
console.log(`passed: ${passed}   failed: ${failed}`);
if (failed > 0) process.exit(1);
console.log('✓ film-slug-at-insert tests passed');
process.exit(0);
