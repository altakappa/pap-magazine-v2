/**
 * 번역 백필 — 큐 선별을 서버로 내린다 (2026-08-05, 마이그레이션 100).
 *
 * 왜 필요했나 — 실측:
 *   runBackfillBatch 는 호출 한 번마다 두 표를 통째로 내려받았다.
 *     articles(published) + 본문        6.26 MB
 *     seo_translations(kind,lang) + body 2.33 MB (it 기준)
 *   알고 싶은 건 길이 두 개뿐이었다(번역이 채워졌나 / 원본이 충분히 기나).
 *   언어마다 따로, 크론 한 번에 3~10회. 그래서 실행 84초에 저장 1~2건이었고
 *   매 실행의 끝이 skip(time-budget) 이었다. 형제 크론 backfill-meta-desc 는
 *   같은 일을 short_desc_editorials RPC 로 하고 0.5초에 끝난다.
 *
 * 이 테스트가 지키는 것:
 *   ① RPC 가 있으면 큰 표(from)를 **아예 건드리지 않을 것**  ← 회귀하면 그대로 8.5MB 로 돌아간다
 *   ② RPC 행이 원래 표 스키마로 정규화돼 번역·저장까지 이어질 것
 *   ③ RPC 가 없으면(마이그레이션 미적용) 조용히 예전 경로로 돌아갈 것 — 배포 순서 무관
 *   ④ 길이 임계값을 앱이 인자로 넘길 것 (앱과 SQL 에 같은 숫자를 두 번 적지 않는다)
 *   ⑤ it 에디토리얼 fast-path 가 한 번에 200건을 유지할 것
 *   ⑥ 마이그레이션 파일이 앱이 부르는 함수 3개를 실제로 정의할 것 (소스 대조)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js');
const SUPABASE = path.join(ROOT, 'api', '_lib', 'supabase.js');
const MIGRATION = path.join(ROOT, 'supabase_migrations', '100_seo_translate_queue.sql');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

function inject(filePath, exports) {
  const m = new Module(filePath, null);
  m.filename = filePath;
  m.loaded = true;
  m.exports = exports;
  require.cache[filePath] = m;
}

/* ── DB 스텁 ────────────────────────────────────────────────────────
   rpcCalls / fromTables 를 기록해 "무엇을 건드렸는가" 를 검증한다.
   rpcMode:
     'ok'      RPC 정상
     'missing' 함수 없음(42883) → 폴백해야 한다                     */
const db = {
  rpcCalls: [], fromTables: [], upserts: [],
  rpcMode: 'ok',
  queueRows: [], counts: { remaining: 0, no_source: 0 },
  fallbackSeoRows: [], fallbackSourceRows: [],
};

inject(SUPABASE, {
  supabaseAdmin: {
    rpc(name, args) {
      db.rpcCalls.push({ name, args });
      if (db.rpcMode === 'missing') {
        return Promise.resolve({
          data: null,
          error: { code: '42883', message: 'function ' + name + ' does not exist' },
        });
      }
      if (name === 'seo_translate_counts') return Promise.resolve({ data: [db.counts], error: null });
      return Promise.resolve({ data: db.queueRows, error: null });
    },
    from(table) {
      db.fromTables.push(table);
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => Promise.resolve({
          data: table === 'seo_translations' ? db.fallbackSeoRows : db.fallbackSourceRows,
          error: null,
        }),
        upsert: (row) => { db.upserts.push(row); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  },
});

const helper = require(HELPER);

/* ── Claude 스텁 ── 배치 프롬프트에 담긴 건 수만큼 그대로 돌려준다. */
let claudeCalls = 0;
global.fetch = async (_url, opt) => {
  claudeCalls++;
  const body = JSON.parse(opt.body);
  const prompt = body.messages[0].content;
  const src = JSON.parse(prompt.slice(prompt.indexOf('Input JSON:') + 'Input JSON:'.length));
  const out = src.map(s => ({ i: s.i, title: 'T-' + s.i, body: 'B-' + s.i, description: 'D-' + s.i }));
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn' }),
  };
};

function reset(mode) {
  db.rpcCalls = []; db.fromTables = []; db.upserts = [];
  db.rpcMode = mode || 'ok';
  claudeCalls = 0;
}

process.env.ANTHROPIC_API_KEY = 'test-key';

async function run() {
  /* ─────────────────────────────────────────────────────────────── */
  console.log('\n=== ① RPC 가 있으면 큰 표를 건드리지 않는다 ===');
  reset('ok');
  db.queueRows = [
    { id: 'a1', title: 'Art 1', title_en: 'Art 1', src: 'x'.repeat(500), extra: null, src_len: 500 },
    { id: 'a2', title: 'Art 2', title_en: 'Art 2', src: 'y'.repeat(500), extra: null, src_len: 500 },
  ];
  db.counts = { remaining: 1950, no_source: 0 };
  const r1 = await helper.runBackfillBatch({ lang: 'zh', kind: 'article', batch: 1 });

  t('articles 표를 통째로 읽지 않는다', !db.fromTables.includes('articles'), db.fromTables);
  t('seo_translations 를 통째로 읽지 않는다 (upsert 만 허용)',
    db.fromTables.filter(x => x === 'seo_translations').length === db.upserts.length,
    { from: db.fromTables, upserts: db.upserts.length });
  t('큐 RPC 를 부른다', db.rpcCalls.some(c => c.name === 'seo_translate_queue_article'));
  t('카운트 RPC 를 부른다', db.rpcCalls.some(c => c.name === 'seo_translate_counts'));
  t('잔여는 카운트 RPC 값을 쓴다 (큐 길이가 아니라)', r1.remaining === 1949, r1);
  t('실제로 저장한다', db.upserts.length === 1 && db.upserts[0].content_id === 'a1', db.upserts);

  console.log('\n=== ② RPC 행이 원래 스키마로 정규화된다 ===');
  t('아티클 본문이 body 로 저장된다', db.upserts[0].body === 'B-0', db.upserts[0]);
  t('kind/lang 이 그대로 실린다',
    db.upserts[0].kind === 'article' && db.upserts[0].lang === 'zh', db.upserts[0]);
  const K = helper.KINDS;
  const edRow = K.editorial.fromQueueRow({ id: 'e1', title: 'T', title_en: 'TE', src: 'DESC', extra: 'IT', src_len: 4 });
  t('에디토리얼 정규화: src → description/description_en',
    edRow.description === 'DESC' && edRow.description_en === 'DESC');
  t('에디토리얼 정규화: extra → description_it (fast-path 유지)', edRow.description_it === 'IT');
  const arRow = K.article.fromQueueRow({ id: 'a', title: 'T', title_en: 'TE', src: 'BODY', extra: null, src_len: 4 });
  t('아티클 정규화: src → content/content_en',
    arRow.content === 'BODY' && arRow.content_en === 'BODY');

  console.log('\n=== ④ 임계값을 앱이 인자로 넘긴다 (SQL 에 중복 상수 금지) ===');
  const qArgs = db.rpcCalls.find(c => c.name === 'seo_translate_queue_article').args;
  const cArgs = db.rpcCalls.find(c => c.name === 'seo_translate_counts').args;
  t('아티클 완료 임계 100 을 넘긴다', qArgs.p_min_done === 100, qArgs);
  t('아티클 원본 임계 80 을 넘긴다', qArgs.p_min_src === 80, qArgs);
  t('카운트도 같은 임계를 쓴다',
    cArgs.p_min_done === qArgs.p_min_done && cArgs.p_min_src === qArgs.p_min_src, { qArgs, cArgs });
  t('배치보다 넉넉히 받는다 (재시도가 다음 건으로 넘어가야 한다)',
    qArgs.p_limit >= 3 && qArgs.p_limit <= 20, qArgs);

  console.log('\n=== ⑤ it 에디토리얼 fast-path 는 200건을 유지 ===');
  reset('ok');
  db.queueRows = [
    { id: 'e1', title: 'Ed 1', title_en: 'Ed 1', src: 'desc one', extra: 'descrizione uno', src_len: 8 },
  ];
  db.counts = { remaining: 1, no_source: 0 };
  const r2 = await helper.runBackfillBatch({ lang: 'it', kind: 'editorial', batch: 2 });
  const edArgs = db.rpcCalls.find(c => c.name === 'seo_translate_queue').args;
  t('it 에디토리얼은 200건을 요청한다', edArgs.p_limit === 200, edArgs);
  t('원본 상한(1200)을 인자로 넘긴다', edArgs.p_src_max === 1200, edArgs);
  t('description_it 는 Claude 없이 저장된다', claudeCalls === 0 && r2.mode === 'fastpath-description_it', r2);
  t('저장된 값이 description_it', db.upserts[0] && db.upserts[0].description === 'descrizione uno', db.upserts[0]);

  console.log('\n=== ③ RPC 가 없으면 예전 경로로 돌아간다 ===');
  /* 래치가 걸리므로 모듈을 새로 로드한다 (구조적 부재는 한 번만 확인하는 설계). */
  delete require.cache[HELPER];
  reset('missing');
  db.fallbackSeoRows = [];
  db.fallbackSourceRows = [
    { id: 'a1', title: 'Art 1', title_en: 'Art 1', content: 'z'.repeat(500), content_en: 'z'.repeat(500) },
  ];
  const helper2 = require(HELPER);
  const r3 = await helper2.runBackfillBatch({ lang: 'de', kind: 'article', batch: 1 });
  t('RPC 를 시도는 한다', db.rpcCalls.length > 0);
  t('실패하면 큰 표를 읽는다 (폴백 동작)', db.fromTables.includes('articles'), db.fromTables);
  t('폴백에서도 저장된다', db.upserts.length === 1 && db.upserts[0].content_id === 'a1', db.upserts);
  t('폴백 잔여 계산도 정상', r3.remaining === 0, r3);

  const beforeLatch = db.rpcCalls.length;
  reset('missing');
  db.fallbackSourceRows = [
    { id: 'a2', title: 'Art 2', title_en: 'Art 2', content: 'z'.repeat(500), content_en: 'z'.repeat(500) },
  ];
  await helper2.runBackfillBatch({ lang: 'de', kind: 'article', batch: 1 });
  t('없다고 확인된 뒤에는 매번 왕복하지 않는다 (래치)', db.rpcCalls.length === 0,
    { beforeLatch, after: db.rpcCalls.length });

  console.log('\n=== ⑥ 마이그레이션이 앱이 부르는 함수를 정의한다 ===');
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const src = fs.readFileSync(HELPER, 'utf8');
  for (const fn of ['seo_translate_queue', 'seo_translate_queue_article', 'seo_translate_counts']) {
    t(fn + ' 정의됨', new RegExp('create or replace function public\\.' + fn + '\\s*\\(', 'i').test(sql));
    t(fn + ' 을 앱이 실제로 부른다', src.includes(fn));
  }
  t('읽기 전용 함수다 (stable, 데이터 변경 없음)',
    (sql.match(/language sql stable/gi) || []).length === 3
    && !/\b(insert|update|delete|drop|alter)\s+(into|table|from|public\.)/i.test(sql));
  t('service_role 에만 실행 권한을 준다',
    /grant execute on function public\.seo_translate/i.test(sql)
    && /to service_role/i.test(sql)
    && !/to\s+(anon|authenticated)/i.test(sql.split('SECTION 3')[1] || ''));

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) process.exit(1);
  console.log('✓ translate-queue-rpc tests passed');
}

run().catch(e => { console.error(e); process.exit(1); });
