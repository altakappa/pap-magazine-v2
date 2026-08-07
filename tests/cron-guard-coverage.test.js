/*
 * cron-guard-coverage.test.js  (2026-08-07)
 *
 * 왜 있는가 —
 *   파이프라인 실측 진단에서 vercel.json 에 예약돼 있는데 cron_runs 에
 *   기록이 0건인 크론이 5개 나왔다(competitor-watch, trend-scout,
 *   sync-pinterest, ad-candidate-scan, purge-rejected-submissions).
 *   실패한 게 아니라 **도는지 안 도는지 알 수 없는** 상태였다.
 *   가드가 없으면 다음 진단에서도 안 보인다. 그래서 규칙으로 못박는다.
 *
 *   같이 막는 것: celeb-classify 가 10분마다 500 으로 죽던 upsert 함정.
 *   PostgREST 의 upsert 는 INSERT ... ON CONFLICT 라, 행이 이미 있어도
 *   INSERT 를 먼저 시도한다 → 페이로드에 없는 NOT NULL 컬럼에서 터진다.
 *   실측 에러: null value in column "title" ... violates not-null constraint
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

console.log('\n=== 1. 예약된 크론은 전부 cronGuard 로 감싼다 ===');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const scheduled = (vercel.crons || [])
  .map((c) => String(c.path || '').split('?')[0])
  .filter((p) => p.startsWith('/api/cron/'))
  .map((p) => p.replace('/api/cron/', ''));
const uniq = [...new Set(scheduled)].sort();
ok(uniq.length > 20, `vercel.json 에서 예약 크론 ${uniq.length}개를 찾았다`);

const missingFile = [];
const missingGuard = [];
const wrongName = [];
for (const name of uniq) {
  const f = path.join(ROOT, 'api/cron', name + '.js');
  if (!fs.existsSync(f)) { missingFile.push(name); continue; }
  const src = fs.readFileSync(f, 'utf8');
  if (!/withCronGuard\s*\(/.test(src)) { missingGuard.push(name); continue; }
  /* 가드에 넘긴 이름이 파일명(=크론 경로)과 같아야 DB 조회가 맞는다.
     문자열 리터럴뿐 아니라 상수(const CRON_NAME = '...')로 넘기는 파일도 있다. */
  let given = null;
  const lit = src.match(/withCronGuard\(\s*['"]([^'"]+)['"]/);
  if (lit) given = lit[1];
  else {
    const ident = src.match(/withCronGuard\(\s*([A-Za-z_$][\w$]*)/);
    if (ident) {
      const decl = src.match(new RegExp('\\b(?:const|let|var)\\s+' + ident[1] + "\\s*=\\s*['\"]([^'\"]+)['\"]"));
      if (decl) given = decl[1];
    }
  }
  if (given !== name) wrongName.push(name + ' → ' + (given || '(못 읽음)'));
}
ok(missingFile.length === 0,
   missingFile.length ? `vercel.json 이 부르는데 파일이 없다: ${missingFile.join(', ')}` : '예약된 크론 파일이 전부 존재한다');
ok(missingGuard.length === 0,
   missingGuard.length ? `가드 없음 — 조용히 죽어도 아무도 모른다: ${missingGuard.join(', ')}` : '예약 크론 전부 withCronGuard 로 감싸져 있다');
ok(wrongName.length === 0,
   wrongName.length ? `가드 이름이 경로와 다르다(로그 조회가 어긋난다): ${wrongName.join(', ')}` : '가드 이름이 전부 크론 경로와 일치한다');

console.log('\n=== 2. celeb-classify 는 upsert 함정을 다시 밟지 않는다 ===');
const cc = fs.readFileSync(path.join(ROOT, 'api/cron/celeb-classify.js'), 'utf8');
ok(!/\.upsert\(/.test(cc), "articles 에 upsert 를 쓰지 않는다 (NOT NULL title 에서 터진다)");
ok(/\.update\(\s*\{\s*digest_kind/.test(cc), 'UPDATE 로 갈래를 저장한다');
ok(/\.is\('digest_kind',\s*null\)/.test(cc), "저장 시점에도 '아직 미판정' 조건을 걸어 사람 수정(manual)을 안 덮는다");
ok(/applyKind/.test(cc), '저장 경로가 applyKind 하나로 모여 있다');

console.log('\n=== 3. 부분 페이로드 upsert 를 다른 크론에도 퍼뜨리지 않는다 ===');
/* upsert 자체가 죄는 아니다 — NOT NULL 컬럼이 빠진 페이로드가 문제다.
   여기서는 articles 대상 upsert 만 잡는다(title 이 NOT NULL 이라 반드시 터진다). */
const cronDir = path.join(ROOT, 'api/cron');
const offenders = [];
for (const f of fs.readdirSync(cronDir).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(cronDir, f), 'utf8');
  const re = /from\(['"]articles['"]\)\s*\r?\n?\s*\.upsert\(/g;
  if (re.test(src)) offenders.push(f);
}
ok(offenders.length === 0,
   offenders.length ? `articles 에 upsert 하는 크론: ${offenders.join(', ')}` : 'articles 를 upsert 하는 크론이 없다');

console.log(`\npassed: ${pass} failed: ${fail}`);
if (fail) process.exit(1);
console.log('✅ cron-guard-coverage tests passed');
