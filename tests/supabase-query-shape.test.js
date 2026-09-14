/**
 * supabase-js 쿼리 모양 검사 (2026-09-14, 500 사고 회귀).
 *
 * [무슨 일이 있었나] 2026-09-14, 이미지 축소 백필의 scan 이 배포 직후 500 을 냈다:
 *   "supabaseAdmin.from(...).eq is not a function"
 * 원인은 단순하다. supabase-js 는 `.from(표)` 다음에 **무엇을 할지 먼저 말해야** 한다.
 *   .select(...) / .insert(...) / .update(...) / .upsert(...) / .delete()
 * 그 다음에야 .eq · .gt · .not · .or 같은 조건을 붙일 수 있다.
 * 조건을 먼저 붙이면 문법은 멀쩡해 보이지만 **실행하는 순간 죽는다.**
 *
 * [왜 테스트로 막나] 이런 파일은 env 없이는 require 조차 안 되므로 로컬에서
 * 실행해 볼 수 없다. 그래서 "배포해 봐야 아는" 버그가 된다. 글자로 잡는 게 맞다.
 *
 * 주의: storage 쪽 from('버킷')은 전혀 다른 물건이다(upload·download·move).
 * 여기서는 제외한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); } }

function walk(dir, out) {
  out = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/* .from('표')  바로 뒤에 올 수 있는 것 */
const ALLOWED_NEXT = /^(select|insert|update|upsert|delete)$/;
/* 조건 메서드 — 이게 바로 뒤에 오면 실행 시 죽는다 */
const FILTERS = 'eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|not|or|filter|match|order|limit|range|single|maybeSingle|csv';

const RE = new RegExp(
  "(\\.storage)?" +                       // storage.from 이면 제외
  "\\.from\\(\\s*['\"][^'\"]+['\"]\\s*\\)" +
  "\\s*(?:\\r?\\n\\s*)*" +
  "\\.(" + FILTERS + ")\\s*\\(", 'g');

const files = walk(path.join(ROOT, 'api'));
const bad = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src)) !== null) {
    if (m[1]) continue;                                  // storage.from(...) 은 대상 아님
    const line = src.slice(0, m.index).split('\n').length;
    bad.push(path.relative(ROOT, f) + ':' + line + ' → .from(...).' + m[2] + '(');
  }
}

console.log('\n=== .from(표) 다음에는 select/insert/update/upsert/delete 가 먼저 온다 ===');
t('검사한 파일이 있다 (정규식이 헛돌지 않았다)', files.length > 100, files.length + '개');
t('조건을 먼저 붙인 곳이 없다', bad.length === 0, bad.slice(0, 10).join('\n      '));

console.log('\n=== 사고 지점이 제대로 고쳐져 있다 ===');
{
  const s = fs.readFileSync(path.join(ROOT, 'api', 'admin', 'image-shrink-backfill.js'), 'utf8');
  t('targetQuery 가 select 를 먼저 건다', /function targetQuery\(columns, selectOpts\) \{[\s\S]{0,200}\.select\(columns, selectOpts\)/.test(s));
  void 0;
  t('왜 그런지 주석에 적혀 있다', /반드시 \.select\(\) 가 먼저/.test(s));
}

/* 허용된 모양이 실제로 통과하는지 — 검사기가 너무 느슨하면 의미가 없다 */
console.log('\n=== 검사기 자체 점검 ===');
{
  const probe = (src) => { const r = new RegExp(RE.source, 'g'); const out = []; let m; while ((m = r.exec(src)) !== null) { if (!m[1]) out.push(m[2]); } return out; };
  t('나쁜 모양을 잡는다', probe("db.from('t').eq('a',1)").length === 1);
  t('줄바꿈이 있어도 잡는다', probe("db.from('t')\n  .gt('a',1)").length === 1);
  t('좋은 모양은 통과시킨다', probe("db.from('t').select('*').eq('a',1)").length === 0);
  t('update 뒤 조건은 통과시킨다', probe("db.from('t').update({a:1}).eq('b',2)").length === 0);
  t('storage 는 건드리지 않는다', probe("s.storage.from('media').list('x')").length === 0);
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ supabase-query-shape tests FAILED'); process.exit(1); }
console.log('✅ supabase-query-shape tests passed');
