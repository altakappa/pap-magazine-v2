/**
 * 드라이브 영상 중복 게시 방지 — tests/drive-claim.test.js (2026-08-07 신설)
 *
 * 무슨 일이 있었나 ────────────────────────────────────────────────────
 * 휴닝카이 영상이 틱톡에 두 번 올라갔다. 크론 주소를 30초 간격으로 두 번
 * 열었고, 한 번 도는 데 50초가 걸린다. 그래서 두 실행이 겹쳤다.
 *
 *   A: done 읽기(없음) → 50초 업로드 → 기록
 *   B:      done 읽기(아직 없음) → 50초 업로드 → 기록(덮어씀)
 *
 * DB 에는 한 줄만 남았다(upsert 가 덮어썼다). 겉으로는 정상이었고 실제로
 * 나간 게시물은 두 개였다. **유니크 인덱스는 upsert 를 막지 못한다.**
 *
 * 여기서 지키는 것:
 *   ① 먼저 찜한 실행만 올린다 — 두 번째 INSERT 는 23505 로 진다
 *   ② 진 실행은 아무것도 올리지 않는다 (조용히 나간다)
 *   ③ 실패한 줄은 다시 가져올 수 있다 (일시 오류로 영구 배제 금지)
 *   ④ 죽은 찜은 시간이 지나면 회수된다 (타임아웃 한 번에 영구 봉인 금지)
 *   ⑤ 살아 있는 찜은 회수되지 않는다 (이게 뚫리면 ①이 무의미)
 *   ⑥ 결과 기록은 upsert 가 아니라 update — 덮어쓰기가 곧 경합 통과다
 *   ⑦ 배선: 두 크론 모두 '올리기 전에' 찜한다
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const C = require(path.join(ROOT, 'api', '_lib', 'driveClaim.js'));

/* 진짜 유니크 인덱스처럼 구는 가짜 DB.
   INSERT 는 같은 drive_file_id 가 있으면 23505 로 거절하고,
   UPDATE 는 걸린 조건을 모두 만족하는 줄만 바꾼다(영향 행 수를 돌려준다). */
function fakeDb(seed = []) {
  const rows = seed.map((r) => ({ ...r }));
  const calls = [];
  const api = {
    rows, calls,
    from(table) {
      const q = { _table: table, _filters: [], _op: null, _vals: null };
      q.insert = (v) => { q._op = 'insert'; q._vals = v; return q.then ? q : run(q); };
      q.update = (v) => { q._op = 'update'; q._vals = v; return q; };
      q.delete = () => { q._op = 'delete'; return q; };
      q.eq = (c, v) => { q._filters.push(['eq', c, v]); return q; };
      q.lt = (c, v) => { q._filters.push(['lt', c, v]); return q; };
      q.select = () => run(q);
      q.then = (res, rej) => Promise.resolve(run(q)).then(res, rej);
      return q;
    },
  };
  function match(row, filters) {
    return filters.every(([op, c, v]) =>
      op === 'eq' ? row[c] === v : op === 'lt' ? String(row[c]) < String(v) : true);
  }
  function run(q) {
    calls.push({ op: q._op, table: q._table, filters: q._filters.slice(), vals: q._vals });
    if (q._op === 'insert') {
      const v = q._vals;
      if (rows.some((r) => r.drive_file_id === v.drive_file_id)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      rows.push({ created_at: new Date().toISOString(), ...v });
      return { data: [v], error: null };
    }
    if (q._op === 'update') {
      const hit = rows.filter((r) => match(r, q._filters));
      hit.forEach((r) => Object.assign(r, q._vals));
      return { data: hit.map((r) => ({ drive_file_id: r.drive_file_id })), error: null };
    }
    if (q._op === 'delete') {
      const keep = rows.filter((r) => !match(r, q._filters));
      const n = rows.length - keep.length;
      rows.length = 0; rows.push(...keep);
      return { data: new Array(n).fill({}), error: null };
    }
    return { data: [], error: null };
  }
  return api;
}

async function main() {
  const NOW = '2026-08-07T16:00:00.000Z';
  const ago = (ms) => new Date(Date.parse(NOW) - ms).toISOString();

  console.log('\n[1] 먼저 찜한 실행만 올린다');
  {
    const db = fakeDb();
    const a = await C.claimDriveFile('tiktok_posts', 'F1', { client: db, now: NOW });
    const b = await C.claimDriveFile('tiktok_posts', 'F1', { client: db, now: NOW });
    t('A 는 찜에 성공한다', a.ok === true && a.took === 'new', JSON.stringify(a));
    t('B 는 찜에 실패한다', b.ok === false, JSON.stringify(b));
    t('B 에게 이유를 말해 준다', /처리 중|완료/.test(b.reason || ''), b.reason);
    t('줄은 하나뿐이다', db.rows.length === 1);
    t('찜은 claiming 상태로 남는다', db.rows[0].status === 'claiming');
    t('찜 단계에서는 article_id 를 안 쓴다 (제약이 섞인다)',
      !('article_id' in db.calls[0].vals), JSON.stringify(db.calls[0].vals));
  }

  console.log('\n[2] 실패한 줄은 다시 가져온다');
  {
    const db = fakeDb([{ drive_file_id: 'F2', status: 'failed', created_at: ago(60000) }]);
    const r = await C.claimDriveFile('tiktok_posts', 'F2', { client: db, now: NOW });
    t('가져온다', r.ok === true && r.took === 'failed', JSON.stringify(r));
    t('claiming 으로 바뀐다', db.rows[0].status === 'claiming');
    t('시각을 새로 찍는다 — 안 찍으면 즉시 죽은 찜이 된다', db.rows[0].created_at === NOW);
  }

  console.log('\n[3] 죽은 찜은 회수되고, 살아 있는 찜은 안 된다');
  {
    const dead = fakeDb([{ drive_file_id: 'F3', status: 'claiming', created_at: ago(30 * 60000) }]);
    const r1 = await C.claimDriveFile('tiktok_posts', 'F3', { client: dead, now: NOW, staleMs: 10 * 60000 });
    t('30분 전 찜은 회수된다', r1.ok === true && r1.took === 'stale', JSON.stringify(r1));

    const alive = fakeDb([{ drive_file_id: 'F4', status: 'claiming', created_at: ago(60000) }]);
    const r2 = await C.claimDriveFile('tiktok_posts', 'F4', { client: alive, now: NOW, staleMs: 10 * 60000 });
    t('1분 전 찜은 회수되지 않는다', r2.ok === false, JSON.stringify(r2));
    t('살아 있는 찜은 건드려지지 않았다', alive.rows[0].created_at === ago(60000));

    const done = fakeDb([{ drive_file_id: 'F5', status: 'submitted', created_at: ago(99 * 60000) }]);
    const r3 = await C.claimDriveFile('tiktok_posts', 'F5', { client: done, now: NOW });
    t('이미 게시된 줄은 아무리 오래돼도 안 가져간다', r3.ok === false, JSON.stringify(r3));
  }

  console.log('\n[4] 후보 제외 규칙');
  {
    const rows = [
      { drive_file_id: 'a', status: 'submitted', created_at: ago(99 * 60000) },
      { drive_file_id: 'b', status: 'failed', created_at: ago(99 * 60000) },
      { drive_file_id: 'c', status: 'claiming', created_at: ago(60000) },
      { drive_file_id: 'd', status: 'claiming', created_at: ago(30 * 60000) },
    ];
    const set = C.doneIdsFrom(rows, { now: NOW, staleMs: 10 * 60000 });
    t('게시된 것은 후보에서 뺀다', set.has('a'));
    t('실패한 것은 후보로 되돌린다', !set.has('b'));
    t('살아 있는 찜은 후보에서 뺀다', set.has('c'));
    t('죽은 찜은 후보로 되돌린다 — 영구 봉인이 더 나쁘다', !set.has('d'));
    t('빈 입력에도 안 죽는다', C.doneIdsFrom(null).size === 0);
    t('drive_file_id 없는 줄은 무시한다', C.doneIdsFrom([{ status: 'submitted' }]).size === 0);
  }

  console.log('\n[5] 결과 기록');
  {
    const db = fakeDb([{ drive_file_id: 'F6', status: 'claiming', created_at: NOW }]);
    const r = await C.finishClaim('tiktok_posts', 'F6', { status: 'submitted', publish_id: 'P1' }, { client: db });
    t('찜한 줄을 갱신한다', r.ok === true, JSON.stringify(r));
    t('줄이 늘지 않는다', db.rows.length === 1);
    t('결과가 들어간다', db.rows[0].status === 'submitted' && db.rows[0].publish_id === 'P1');
    t('갱신이지 삽입이 아니다', db.calls.every((c) => c.op !== 'insert'));

    const gone = fakeDb([]);
    const r2 = await C.finishClaim('tiktok_posts', 'NOPE', { status: 'submitted' }, { client: gone });
    t('내 찜이 사라졌으면 성공이라 말하지 않는다', r2.ok === false, JSON.stringify(r2));
  }

  console.log('\n[6] 유니크 위반 판별');
  {
    t('code 로 잡는다', C.isConflict({ code: '23505' }) === true);
    t('메시지로도 잡는다', C.isConflict({ message: 'duplicate key value violates unique constraint' }) === true);
    t('다른 오류는 아니다', C.isConflict({ code: '42P01', message: 'relation does not exist' }) === false);
    t('null 은 아니다', C.isConflict(null) === false);
  }

  console.log('\n[7] 배선 — 두 크론 모두 올리기 전에 찜한다');
  {
    for (const [f, upload] of [
      ['api/cron/drive-tiktok-post.js', 'createVideoPost'],
      ['api/cron/drive-youtube-post.js', 'uploadVideo'],
    ]) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const iClaim = src.indexOf('claimDriveFile(');
      const iUp = src.indexOf(upload + '(');
      t(f + ' — 찜을 부른다', iClaim > 0);
      t(f + ' — 업로드보다 먼저 찜한다', iClaim > 0 && iUp > 0 && iClaim < iUp, 'claim@' + iClaim + ' upload@' + iUp);
      t(f + ' — 찜 실패면 업로드 경로로 안 간다', /if \(!claim\.ok\)[\s\S]{0,200}return res/.test(src));
      t(f + ' — 결과는 upsert 가 아니라 finishClaim 으로 적는다',
        /finishClaim\(/.test(src) && !/\.upsert\(\{[\s\S]{0,200}drive_file_id/.test(src));
      t(f + ' — done 집합을 공용 규칙으로 만든다', /doneIdsFrom\(/.test(src));
      t(f + ' — created_at 을 같이 읽는다 (죽은 찜 판정에 필요)', /drive_file_id, status, created_at/.test(src));
    }
  }

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ drive-claim tests FAILED'); process.exit(1); }
  console.log('✅ drive-claim tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
