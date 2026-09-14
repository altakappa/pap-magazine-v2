/**
 * 이미 올라간 이미지 축소 백필의 안전 규칙 (2026-09-14 전송량 초과 후속).
 *
 * [무엇을 하는 도구인가] media 버킷에서 1MB 넘는 이미지를 골라
 *   media/<경로> → media/originals/<경로> 로 옮기고(전송량 0),
 *   받아서 긴 변 2000px 로 줄인 뒤 **원래 경로에** 되올린다.
 * URL 이 그대로라 articles·editorials·films 등 스무 개 넘는 열을 안 건드려도 된다.
 *
 * [이 테스트가 지키는 것 — 전부 '되돌릴 수 있는가' 다]
 *  1) 아무것도 지우지 않는다 (remove/delete 호출이 없다)
 *  2) 원본은 originals/ 로 옮겨 보존한다
 *  3) 실패하면 원본을 제자리로 되돌린다
 *  4) 축소본은 원래 경로에 올린다 (URL 이 안 바뀐다)
 *  5) 형식을 바꾸지 않는다 (경로의 확장자와 어긋나면 안 된다)
 *  6) originals/ 를 다시 대상으로 집지 않는다 (무한 축소 방지)
 *  7) 관리자만 부를 수 있다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

const S = R('api/admin/image-shrink-backfill.js');
const M = R('supabase_migrations/156_image_shrink_backfill.sql');

console.log('\n=== 아무것도 지우지 않는다 ===');
t('storage remove 를 부르지 않는다', !/\.remove\s*\(/.test(S));
t('DB delete 를 부르지 않는다', !/\.delete\s*\(\s*\)/.test(S));
t('원본을 지우는 것은 도메니코 몫이라고 적혀 있다', /지우는 것은 도메니코가 직접/.test(S));

console.log('\n=== 원본 보존과 되돌리기 ===');
t('originals/ 로 옮긴다', /const ORIGINALS_PREFIX = 'originals\/'/.test(S));
t('먼저 move 로 피신시킨다', /store\.move\(name, origPath\)/.test(S));
t('download 실패면 제자리로 되돌린다', /if \(dl\.error \|\| !dl\.data\)[\s\S]{0,200}store\.move\(origPath, name\)/.test(S));
t('upload 실패면 제자리로 되돌린다', /if \(up\.error\)[\s\S]{0,160}store\.move\(origPath, name\)/.test(S));
t('안 줄어들면 제자리로 되돌린다', /!sh\.shrunk[\s\S]{0,320}store\.move\(origPath, name\)/.test(S));
t('사람이 부르는 되돌리기가 있다', /q\.revert/.test(S) && /store\.move\(ORIGINALS_PREFIX \+ name, name\)/.test(S));
t('되돌린 것은 reverted 로 기록한다', /status: 'reverted'/.test(S));

console.log('\n=== URL 이 바뀌지 않는다 ===');
t('축소본을 원래 경로(name)에 올린다', /store\.upload\(name, sh\.buf/.test(S));
t('형식을 유지한다 (keepFormat)', /shrinkImageBuffer\(buf, ct, \{ keepFormat: true \}\)/.test(S));
t('왜 URL 을 안 건드리는지 적혀 있다', /갈아끼울 것이 없다/.test(S));

console.log('\n=== 대상 고르기 ===');
t('originals/ 아래는 대상에서 뺀다', /\.not\('name', 'like', ORIGINALS_PREFIX \+ '%'\)/.test(S));
t('1MB 초과만 집는다', /MIN_BYTES/.test(S) && /\.gt\('size_bytes', MIN_BYTES\)/.test(S));
t('DB 쪽에서도 이미지만 고른다 (mp4 8.1GB 가 숫자를 부풀리면 안 된다)', /IMAGE_LIKE/.test(S) && /\.or\(IMAGE_LIKE\)/.test(S));
t('scan 과 run 이 같은 기준을 쓴다 (targetQuery 공용)', /function targetQuery\(\)/.test(S) && (S.match(/targetQuery\(\)/g) || []).length >= 3);
t('개수는 count 로 센다 (select 로 세면 5,000 에서 거짓말한다)', /count: 'exact', head: true \}\)/.test(S) && /행 상한/.test(S));
t('용량은 페이지로 나눠 더한다', /\.range\(from, from \+ 999\)/.test(S));
t('jpg·png 만 집는다 (gif 애니메이션 보호)', /\\\.\(jpe\?g\|png\)\$/.test(S));
t('이미 처리한 것은 progress 표로 거른다', /from\(PROGRESS\)\.select\('name'\)\.in\('name', names\)/.test(S));
t('큰 것부터 집는다', /order\('size_bytes', \{ ascending: false \}\)/.test(S));

console.log('\n=== 한 번에 다 하지 않는다 ===');
t('시간 예산이 있다', /TIME_BUDGET_MS/.test(S) && /Date\.now\(\) - started > TIME_BUDGET_MS/.test(S));
t('한 회차 상한이 있다', /MAX_PER_RUN = 60/.test(S));
t('효과만 재보는 dry 모드가 있다', /opts\.dry/.test(S) && /q\.dry/.test(S));
t('통계만 보는 scan 모드가 있다', /q\.scan/.test(S));

console.log('\n=== 권한 ===');
t('관리자만 부를 수 있다', /const user = await requireAdmin\(req, res\);\s*\n\s*if \(!user\) return;/.test(S));

console.log('\n=== 마이그레이션 156 ===');
t('media_objects 뷰를 만든다', /create or replace view public\.media_objects/.test(M));
t('뷰에 파일 내용이 안 담긴다 (이름·크기만)', !/metadata\s*$/m.test(M) && /size_bytes/.test(M));
t('anon·authenticated 권한을 회수한다', /revoke all on public\.media_objects from anon, authenticated/.test(M));
t('진행 표에 RLS 를 켠다', /alter table public\.image_shrink_progress enable row level security/.test(M));
t('진행 표도 anon 권한을 회수한다', /revoke all on public\.image_shrink_progress from anon, authenticated/.test(M));
t('되돌리기용 original_path 를 남긴다', /original_path text/.test(M));
t('왜 만들었는지 사고 날짜가 있다', M.includes('2026-09-14'));
t('언제 돌려야 하는지 적혀 있다 (사이클 초반)', /사이클 초반에 돌리는 게 안전하다/.test(S));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ image-shrink-backfill tests FAILED'); process.exit(1); }
console.log('✅ image-shrink-backfill tests passed');
