/**
 * Search Console 수집 (2026-08-18 신설)
 *
 * ■ 왜 만들었나
 * 2026-08-18, Ahrefs 의 GSC 미러로 개선할 페이지를 고르려다 두 번 틀렸다.
 * 그 표는 실측과 맞지 않았다.
 *
 *   국가별 클릭 합계           약 4,800
 *   페이지별 표 상위 100 합계   약 400        (8%)
 *   일본 클릭 992 중 키워드 표에 잡힌 것 12   (1.2%)
 *
 * 근거가 8% 인 판단은 판단이 아니다. 원본을 우리 DB 로 가져온다.
 *
 * ■ 이 하네스가 지키는 것
 *   ① 인증을 새로 만들지 않았다 (유튜브 앱에 읽기 스코프만 추가)
 *   ② 페이지를 끝까지 넘긴다 (25,000 에서 잘리면 큰 날을 통째로 잃는다)
 *   ③ 실패를 삼키지 않고, 403 이면 무엇을 넣어야 하는지 알려준다
 *   ④ 덮어쓰기 키 = 기본키 (어긋나면 중복이 쌓인다)
 *   ⑤ 최근 며칠을 다시 긁는다 (GSC 는 2~3일 뒤 확정한다)
 *   ⑥ page x query 를 곱하지 않는다 (행 폭발)
 *   ⑦ 크론이 등재돼 있고 무엇을 했는지 노트에 남는다
 *
 * 정규식으로 소스를 훑는 대신, fetch 를 갈아끼워 **실제로 돌린다.**
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

const LIBP = path.join(ROOT, 'api', '_lib', 'searchConsole.js');
const CRONP = path.join(ROOT, 'api', 'cron', 'gsc-sync.js');
const LIB_SRC = fs.readFileSync(LIBP, 'utf8');
const CRON_SRC = fs.readFileSync(CRONP, 'utf8');
const YT_SRC = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'youtube.js'), 'utf8');
const MIG = path.join(ROOT, 'supabase_migrations', '131_gsc_daily.sql');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 300)); }
}
function P(fn) { try { return fn(); } catch (e) { return { __threw: String(e && e.message) }; } }

/* youtube.js 는 로드 시 supabase 를 만든다. 토큰 발급만 스텁으로 갈아끼운다. */
const ytPath = require.resolve(path.join(ROOT, 'api', '_lib', 'youtube.js'));
require.cache[ytPath] = { id: ytPath, filename: ytPath, loaded: true,
  exports: { getAccessToken: async () => 'stub-token' } };
const SC = require(LIBP);

const realFetch = global.fetch;
function withFetch(handler, fn) {
  global.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { global.fetch = realFetch; });
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

(async () => {

console.log('\n=== ① 인증을 새로 만들지 않았다 ===');
{
  t('유튜브 앱 스코프에 webmasters.readonly 를 더했다',
    /auth\/webmasters\.readonly/.test(YT_SRC));
  t('읽기 전용이다 (쓰기 스코프 아님)', !/auth\/webmasters['" ]/.test(YT_SRC));
  t('재인증이 필요하다고 적어 뒀다', /1회 재인증/.test(YT_SRC));
  t('라이브러리가 그 토큰을 그대로 쓴다', /require\('\.\/youtube'\)/.test(LIB_SRC));
  t('토큰 코드를 복사하지 않았다', !/grant_type/.test(LIB_SRC),
    '규칙이 두 벌이면 한쪽만 고쳐진다');
}

console.log('\n=== ② 끝까지 넘긴다 ===');
{
  let calls = 0;
  const rows = (n, from) => Array.from({ length: n }, (_, i) => ({
    keys: ['2026-08-10', 'p' + (from + i)], clicks: 1, impressions: 2, position: 3 }));
  const got = await withFetch(async (url, opt) => {
    calls++;
    const body = JSON.parse(opt.body);
    if (body.startRow === 0) return ok({ rows: rows(25000, 0) });
    if (body.startRow === 25000) return ok({ rows: rows(7, 25000) });
    return ok({ rows: [] });
  }, () => SC.queryAll({ startDate: '2026-08-10', endDate: '2026-08-10', dimensions: ['date', 'page'] }));

  t('가득 찬 페이지면 한 번 더 부른다', calls === 2, 'calls=' + calls);
  t('모든 행을 모은다', Array.isArray(got) && got.length === 25007, got && got.length);
  t('다음 요청이 startRow 를 올린다', /startRow \+= rows\.length/.test(LIB_SRC));
}

console.log('\n=== ③ 실패를 삼키지 않는다 ===');
{
  const err = await withFetch(
    async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }),
    () => SC.queryAll({ startDate: 'a', endDate: 'b', dimensions: ['date', 'page'] }).then(
      () => null, (e) => e.message));
  t('5xx 는 던진다', !!err && /GSC 500/.test(err), err);

  let sitesAsked = false;
  const err403 = await withFetch(async (url) => {
    if (/\/sites$/.test(url)) { sitesAsked = true; return ok({ siteEntry: [{ siteUrl: 'sc-domain:papkorea.com' }] }); }
    return { ok: false, status: 403, json: async () => ({ error: { message: 'no perm' } }) };
  }, () => SC.queryAll({ startDate: 'a', endDate: 'b', dimensions: ['date', 'page'] }).then(
    () => null, (e) => e.message));

  t('403 이면 볼 수 있는 속성을 물어본다', sitesAsked === true);
  t('그 목록을 오류에 실어 준다', /papkorea/.test(String(err403)), err403);
  t('어떤 속성으로 물었는지도 실린다', /sc-domain/.test(String(err403)), err403);
}

console.log('\n=== ④ 덮어쓰기 키 = 기본키 ===');
{
  /* 표 이름과 키가 같은 줄에 붙어 있는지를 본다. 둘이 어긋나면
     (선택 키 != 제약 키) 중복이 조용히 쌓인다 — 이 저장소가 겪은 사고다. */
  t('gsc_page_daily 는 date,page 로 덮어쓴다',
    /saveChunked\('gsc_page_daily', pages, 'date,page'\)/.test(CRON_SRC));
  t('gsc_query_daily 는 date,query 로 덮어쓴다',
    /saveChunked\('gsc_query_daily', queries, 'date,query'\)/.test(CRON_SRC));
  t('upsert 가 그 키를 그대로 쓴다', /upsert\(chunk, \{ onConflict: conflict \}\)/.test(CRON_SRC));
  const sql = fs.existsSync(MIG) ? fs.readFileSync(MIG, 'utf8') : '';
  t('마이그레이션 131 이 있다', !!sql);
  t('기본키가 (date, page)', /PRIMARY KEY \(date, page\)/.test(sql));
  t('기본키가 (date, query)', /PRIMARY KEY \(date, query\)/.test(sql));

  /* 같은 (날짜, 대상) 이 두 번 오면 upsert 가 터진다 */
  const dup = SC.toRows([
    { keys: ['2026-08-10', '/a'], clicks: 1, impressions: 2, position: 3 },
    { keys: ['2026-08-10', '/a'], clicks: 9, impressions: 9, position: 9 },
    { keys: ['2026-08-10', '/b'], clicks: 1, impressions: 1, position: 1 },
  ], 'page');
  t('중복 키를 걷어낸다', dup.length === 2, dup);
  t('앞엣것이 남는다', dup[0].clicks === 1, dup[0]);
  /* ── 2026-08-18 실전에서 터진 자리 ────────────────────────────────
     처음엔 자르기 전 원문으로 중복을 걸렀다. DB 에 들어가는 건 자른 값이라
     앞부분이 같은 긴 질의 두 개가 통과했고 Postgres 가 거부했다.
       ON CONFLICT DO UPDATE command cannot affect row a second time
     중복 판정은 저장할 값으로 해야 한다. */
  const longA = 'ㄱ'.repeat(500) + 'AAAA';
  const longB = 'ㄱ'.repeat(500) + 'BBBB';
  const cut = SC.toRows([
    { keys: ['2026-08-10', longA], clicks: 1, impressions: 1, position: 1 },
    { keys: ['2026-08-10', longB], clicks: 2, impressions: 2, position: 2 },
  ], 'query');
  t('잘린 뒤 같아지는 질의는 하나로 접는다 (실전 사고)', cut.length === 1, cut.length);
  t('저장값이 500자를 안 넘는다', cut.every((r) => r.query.length <= 500));

  const longP = '/' + 'p'.repeat(1000) + 'XYZ';
  const longQ = '/' + 'p'.repeat(1000) + 'ZYX';
  const cutP = SC.toRows([
    { keys: ['2026-08-10', longP], clicks: 1, impressions: 1, position: 1 },
    { keys: ['2026-08-10', longQ], clicks: 1, impressions: 1, position: 1 },
  ], 'page');
  t('페이지도 같은 규칙이다', cutP.length === 1, cutP.length);
  t('저장값이 1000자를 안 넘는다', cutP.every((r) => r.page.length <= 1000));

  t('날짜 없는 행은 버린다', SC.toRows([{ keys: [null, '/a'] }], 'page').length === 0);
  t('대상 없는 행도 버린다', SC.toRows([{ keys: ['2026-08-10'] }], 'page').length === 0);
}

console.log('\n=== ⑤ 최근 며칠을 다시 긁는다 ===');
{
  t('끝을 2일 전으로 둔다 (GSC 지연)', /END_LAG_DAYS = 2/.test(CRON_SRC));
  t('기본 재수집 일수가 1보다 크다', /GSC_SYNC_DAYS \|\| 5/.test(CRON_SRC),
    '하루만 긁으면 확정 전 수치가 영원히 남는다');
  t('소급 수집 인자가 있다', /q\.days/.test(CRON_SRC));
  t('소급 상한이 있다 (무한 요청 방지)', /Math\.min\(480/.test(CRON_SRC));

  const base = Date.UTC(2026, 7, 18);   // 2026-08-18
  t('daysAgo 가 UTC 날짜를 낸다', SC.daysAgo(2, base) === '2026-08-16', SC.daysAgo(2, base));
  t('0일 전은 오늘', SC.daysAgo(0, base) === '2026-08-18');
}

console.log('\n=== ⑥ page x query 를 곱하지 않는다 ===');
{
  t('차원은 date+page 와 date+query 두 벌뿐',
    /dimensions: \['date', 'page'\]/.test(CRON_SRC) && /dimensions: \['date', 'query'\]/.test(CRON_SRC));
  t('셋을 한꺼번에 묶지 않는다', !/'date', 'page', 'query'/.test(CRON_SRC),
    '행이 폭발한다');
  t('왜 안 곱하는지 적어 뒀다', /행이 폭발한다|행 폭발/.test(CRON_SRC));
}

console.log('\n=== ⑦ 크론으로 등재되고 결과를 남긴다 ===');
{
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const c = (vj.crons || []).filter((x) => /gsc-sync/.test(x.path));
  t('vercel.json 에 등재됐다', c.length === 1, c);
  t('하루 1회다 (분·시가 고정)', c.length === 1 && /^\d+ \d+ \* \* \*$/.test(c[0].schedule), c[0] && c[0].schedule);
  t('cronGuard 로 감쌌다', /withCronGuard\('gsc-sync'/.test(CRON_SRC));
  t('무엇을 했는지 노트에 남긴다', /res\.locals\.cronNote =/.test(CRON_SRC));
  t('노출·클릭 합계를 노트에 싣는다', /노출 ' \+ imp/.test(CRON_SRC),
    '얼마나 들어왔는지 로그만 보고 알 수 있어야 한다');
  t('CRON_SECRET 또는 관리자만', /CRON_SECRET/.test(CRON_SRC) && /requireAdmin/.test(CRON_SRC));
}

console.log('\n' + (fail ? '✗' : '✓') + ' gsc-sync: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
