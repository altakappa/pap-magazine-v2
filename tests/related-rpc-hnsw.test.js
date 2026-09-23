/*
 * related-rpc-hnsw.test.js  (2026-09-23)
 *
 * 추천 RPC(related_articles · related_editorials)가 벡터 인덱스를 타는 모양을 지킨다.
 *
 * 왜: 기준 벡터를 (select embedding ...) base 로 '조인' 해서 정렬하면
 * HNSW 인덱스를 못 쓰고 발행 기사 전부와 거리를 계산한다.
 * related_articles 하나가 DB 전체 실행 시간의 33%(87,631초)를 썼고,
 * Ahrefs 9/22 크롤에서 번역 기사 99쪽이 8~15초 걸렸다.
 * 기준 벡터를 정렬식 안의 스칼라 서브쿼리로 두면 Index Scan 이 된다
 * (버퍼 34,417 → 약 1,700). 누가 옛 모양으로 되돌리면 이 테스트가 막는다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

const file = path.join(ROOT, 'supabase_migrations/166_related_rpc_use_hnsw.sql');
ok(fs.existsSync(file), '166 마이그레이션 파일이 있다');
const sql = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const body = sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');   // 주석 제외

function fn(name) {
  const m = body.match(new RegExp('create or replace function public\\.' + name + '[\\s\\S]*?\\$function\\$;', 'i'));
  return m ? m[0] : '';
}

for (const [name, tbl, alias] of [['related_articles', 'articles', 'a'], ['related_editorials', 'editorials', 'e']]) {
  console.log('\n=== ' + name + ' ===');
  const f = fn(name);
  ok(!!f, name + ' 정의가 있다');
  ok(!/\)\s*base\b/i.test(f), '기준 벡터를 조인(base)으로 두지 않는다 (인덱스를 못 타는 옛 모양)');
  ok(new RegExp('order by ' + alias + '\\.embedding <=> \\(select b\\.embedding from ' + tbl + ' b where b\\.id = target_id\\)', 'i').test(f),
     '정렬식 안에 스칼라 서브쿼리 (HNSW Index Scan 조건)');
  ok(/match_count integer default 4/i.test(f), 'match_count 기본값 4 유지 (기본값을 빼면 CREATE OR REPLACE 가 실패한다)');
  ok(/returns table\(id uuid, title character varying, slug character varying/i.test(f), '반환형 앞부분 그대로 (DROP 불필요)');
  ok(/is not null\s*\n\s*order by/i.test(f) && /\(select b\.embedding[^)]*\) is not null/i.test(f),
     '기준 기사에 임베딩이 없으면 0행 (종전 동작)');
  ok(/limit match_count;/i.test(f), 'limit match_count');
  ok(/set search_path to 'public', 'pg_temp'/i.test(f), 'search_path 고정 유지 (보안 경고 재발 방지)');
}

console.log('\n=== custom_url 인덱스 ===');
ok(/create index if not exists idx_articles_custom_url on public\.articles using btree \(custom_url\)/i.test(body),
   '기사 SSR 첫 조회(custom_url = $1)용 인덱스');

console.log('\n=== 호출부는 그대로 ===');
const ma = fs.readFileSync(path.join(ROOT, 'api/_lib/moreArticles.js'), 'utf8');
ok(/rpc\('related_articles', \{ target_id: data\.id, match_count: 4 \}\)/.test(ma), 'moreArticles 는 같은 인자로 부른다');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
