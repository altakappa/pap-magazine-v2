/**
 * 틱톡 기사 중복 게시 (2026-08-09 사고).
 *
 * ── 무슨 일이 있었나 ────────────────────────────────────────────────
 * 같은 기사가 2시간마다 틱톡에 다시 올라갔다. 실측: 기사 6편이 17번 게시.
 * 최다는 「신인이 가장 신인답게 등장한 이유」 5회.
 * 그런데 tiktok_posts 의 기사 모드 행은 **0건**이었다 — 한 번도 기록되지 않았다.
 *
 * ── 원인 ────────────────────────────────────────────────────────────
 * article_id 의 유니크 인덱스가 **부분 인덱스**였다:
 *     ... ON tiktok_posts (article_id) WHERE (article_id IS NOT NULL)
 * Postgres 의 ON CONFLICT 는 부분 인덱스를 술어 없이는 고르지 못한다.
 * PostgREST 의 on_conflict=article_id 에는 술어를 붙일 방법이 없다.
 * → upsert 가 매번 42P10 으로 실패. 그리고 **코드가 그 오류를 안 읽었다.**
 * → '게시는 됐는데 기록이 없다' → 다음 실행이 같은 기사를 또 고른다.
 *
 * nullable 컬럼의 **전체** 유니크 인덱스도 NULL 은 서로 다르게 보므로
 * (NULLS DISTINCT 기본값), editorial·drive 행이 NULL 로 공존하는 데 문제가 없다.
 * 실제로 editorial_id·drive_file_id 는 처음부터 전체 유니크였고 중복이 없었다.
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① 마이그레이션이 전체 유니크로 만들 것 (부분으로 되돌리지 말 것)
 *   ② 코드가 upsert 오류를 **읽고** 실패로 처리할 것 (조용히 넘기지 말 것)
 *   ③ 두 모드(기사·에디토리얼) 모두에 그 검사가 있을 것
 *   ④ 오류 시 cronNote 를 남길 것 — 기록에 안 남으면 또 못 본다
 *   ⑤ 중복의 방벽인 '기게시 제외' 로직이 살아 있을 것
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'api/cron/tiktok-post.js'), 'utf8');
const MIG = path.join(ROOT, 'supabase_migrations/116_tiktok_article_unique_full.sql');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 220)); }
}

console.log('\n=== ① 마이그레이션 — 전체 유니크 ===');
t('116 마이그레이션이 있다', fs.existsSync(MIG));
if (fs.existsSync(MIG)) {
  const sql = fs.readFileSync(MIG, 'utf8');
  /* 주석에는 되돌리기 예시로 WHERE 절이 적혀 있다. 실행문만 골라 본다. */
  const stmts = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  t('uq_tiktok_posts_article_id 를 다시 만든다',
    /create unique index\s+uq_tiktok_posts_article_id/i.test(stmts), stmts.slice(0, 200));
  t('실행문에 WHERE(부분 인덱스)가 없다',
    !/create unique index[\s\S]*?where/i.test(stmts), '부분 인덱스로 되돌아갔다');
  t('옛 인덱스를 먼저 지운다', /drop index if exists[\s\S]*uq_tiktok_posts_article_id/i.test(stmts));
}

console.log('\n=== ②③ 코드가 upsert 오류를 읽는다 ===');
t('기사 모드가 error 를 구조분해로 받는다',
  /const \{ error: writeErr \} = await supabaseAdmin\.from\('tiktok_posts'\)\.upsert/.test(SRC));
t('에디토리얼 모드가 error 를 구조분해로 받는다',
  /const \{ error: edWriteErr \} = await supabaseAdmin\.from\('tiktok_posts'\)\.upsert/.test(SRC));
t('오류를 무시하고 넘어가는 upsert 가 남아 있지 않다',
  !/^\s*await supabaseAdmin\.from\('tiktok_posts'\)\.upsert/m.test(SRC),
  '오류를 안 읽는 upsert 잔존');
t('기사 모드가 기록 실패 시 실패로 끝낸다', /if \(writeErr\) \{/.test(SRC));
t('에디토리얼 모드가 기록 실패 시 실패로 끝낸다', /if \(edWriteErr\) \{/.test(SRC));
t('기록 실패는 500 으로 나간다 (2xx 로 삼키지 않는다)',
  (SRC.match(/recorded failed/g) || []).length >= 2 && /status\(500\)[\s\S]{0,120}recorded failed/.test(SRC));

console.log('\n=== ④ 기록에 남는다 ===');
t('기록 실패가 cronNote 에 남는다',
  (SRC.match(/note\(res, '\\u26a0\\ufe0f 게시됐으나 기록 실패/g) || []).length >= 2
  || (SRC.match(/게시됐으나 기록 실패/g) || []).length >= 2);
t('중복게시 위험이라고 말한다', /중복게시 위험/.test(SRC));

console.log('\n=== ⑤ 기게시 제외가 살아 있다 ===');
t('tiktok_posts 로 done 집합을 만든다', /const done = new Set\(/.test(SRC));
t('failed 기록은 재시도 허용으로 제외한다', /p\.status !== 'failed'/.test(SRC));
t('기사 모드가 done 으로 거른다', /!done\.has\(a\.id\)/.test(SRC));
t('에디토리얼 모드가 done 으로 거른다', /!done\.has\(e\.id\)/.test(SRC));
t('onConflict 대상이 기사=article_id · 에디토리얼=editorial_id',
  /onConflict: 'article_id'/.test(SRC) && /onConflict: 'editorial_id'/.test(SRC));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ tiktok-article-dedup tests passed');
