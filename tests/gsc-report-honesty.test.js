/**
 * GSC 보고 정직성 하네스 (2026-08-19 신설)
 *
 * 두 가지 '조용한 거짓말' 을 막는다. 둘 다 실제로 있었던 일이다.
 *
 * ① 크론 노트가 **요청한 창**을 적어서, 없는 날짜의 데이터가 있는 것처럼 보였다.
 *    2026-08-19 05:20 회차 노트: '2026-08-13~2026-08-17'
 *    gsc_page_daily 실제 최대 날짜: 2026-08-16
 *    수집은 정상이었고 GSC 가 08-17 을 안 준 것인데, 노트만 보면 알 수 없다.
 *    → 노트에는 **받아 온 창**을 적고, 요청보다 짧으면 그 사실도 적는다.
 *
 * ② gsc-page-queries 의 shown_in_search 가 언제나 null 이었다.
 *    articles 에 없는 컬럼(seo_description·description)을 조회해서
 *    PostgREST 가 에러를 냈고, 그 에러를 삼키고 null 을 돌려줬다.
 *    → 실제 페이지를 가져와 <title>·meta description 을 읽는다.
 *      실패하면 이유를 낸다. null 만 돌려주지 않는다.
 *
 * 이 하네스는 소스를 정규식으로 훑지 않는다. 두 핸들러를 **실제로 실행**하고
 * 결과 문자열과 객체를 본다.
 */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

/* ── 의존 모듈을 가짜로 갈아 끼운다 ─────────────────────────────── */
const P = (rel) => path.join(ROOT, rel);
const stub = (rel, exports) => {
  const f = P(rel);
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exports };
};

const selects = [];   // supabase 가 실제로 무엇을 조회했는지 기록
let upserted = [];

stub('api/_lib/supabase.js', {
  supabaseAdmin: {
    from(table) {
      const q = {
        _table: table,
        select(cols) { selects.push({ table: table, cols: cols }); return q; },
        eq() { return q; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        upsert(rows) { upserted.push({ table: table, n: rows.length }); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  },
});
stub('api/_lib/auth.js', { requireAdmin: async () => ({ id: 'admin-test' }) });
stub('api/_lib/cronGuard.js', { withCronGuard: (name, fn) => fn });

/* searchConsole 은 테스트마다 응답을 바꾼다 */
const sc = {
  SITE: 'sc-domain:test',
  daysAgo(n) {
    // 고정 기준일 2026-08-19 로 계산 (Date.now 에 의존하지 않게)
    const base = Date.UTC(2026, 7, 19);
    return new Date(base - n * 86400000).toISOString().slice(0, 10);
  },
  _rows: [],
  async queryAll() { return sc._rows; },
  toRows(rows, kind) {
    return (rows || []).map((r) => {
      const o = { date: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position };
      if (kind === 'page') o.page = r.keys[1]; else o.query = r.keys[1];
      return o;
    });
  },
};
stub('api/_lib/searchConsole.js', sc);

function mkRes() {
  const res = {
    _status: 0, _json: null, _headers: {}, locals: {},
    setHeader(k, v) { res._headers[k] = v; },
    status(c) { res._status = c; return res; },
    json(o) { res._json = o; return res; },
    send(o) { res._json = o; return res; },
    end() { return res; },
  };
  return res;
}

const row = (date, page, imp, clk) => ({ keys: [date, page], clicks: clk, impressions: imp, position: 8 });

(async function run() {
  /* ── ① 크론 노트 ─────────────────────────────────────────────── */
  console.log('\n① 크론 노트는 요청한 창이 아니라 받아 온 창을 적는다');
  const syncPath = P('api/cron/gsc-sync.js');
  delete require.cache[syncPath];
  const sync = require(syncPath);

  process.env.CRON_SECRET = 'x';
  const mkReq = () => ({ query: {}, headers: { authorization: 'Bearer x' } });

  // 요청은 08-13~08-17(days=5, lag=2) 인데 GSC 가 08-16 까지만 준 실제 상황
  sc._rows = [row('2026-08-13', '/a', 10, 1), row('2026-08-16', '/b', 20, 2)];
  upserted = [];
  let res = mkRes();
  await sync(mkReq(), res);
  let note = res.locals.cronNote || '';
  t('받아 온 끝날짜(08-16)를 적는다', note.includes('2026-08-13~2026-08-16'), note);
  t('요청 끝날짜(08-17)를 창으로 적지 않는다', !note.includes('~2026-08-17'), note);
  t('짧아진 사실을 노트에 적는다', /GSC 가 2026-08-16 까지만 줬다/.test(note), note);
  t('응답에 covered.short = true', res._json && res._json.covered && res._json.covered.short === true,
    res._json && res._json.covered);
  t('요청 창도 따로 남긴다', res._json && res._json.requested && res._json.requested.endDate === '2026-08-17',
    res._json && res._json.requested);

  // 요청 창을 다 채운 경우 — 경고가 붙으면 안 된다
  sc._rows = [row('2026-08-13', '/a', 10, 1), row('2026-08-17', '/b', 20, 2)];
  res = mkRes();
  await sync(mkReq(), res);
  note = res.locals.cronNote || '';
  t('창을 다 채우면 경고 없음', !/까지만 줬다/.test(note), note);
  t('  창 표기는 08-13~08-17', note.includes('2026-08-13~2026-08-17'), note);
  t('  covered.short = false', res._json.covered.short === false, res._json.covered);

  // 한 행도 못 받은 경우 — 조용히 성공처럼 보이면 안 된다
  sc._rows = [];
  res = mkRes();
  await sync(mkReq(), res);
  note = res.locals.cronNote || '';
  t('빈 수집은 (데이터 없음) 이라고 적는다', note.includes('(데이터 없음)'), note);
  t('  요청 창을 같이 적는다', note.includes('요청 2026-08-13~2026-08-17'), note);

  /* ── ② shown_in_search ──────────────────────────────────────── */
  console.log('\n② shown_in_search 는 실제 페이지를 읽는다');
  const qPath = P('api/admin/gsc-page-queries.js');
  delete require.cache[qPath];
  const pageQueries = require(qPath);

  const origFetch = global.fetch;
  const HTML = '<!doctype html><html><head><title>한소희 &amp; 남주혁 — PAP Magazine</title>'
    + '<meta name="description" content="두 사람이 함께한 화보를 다룬다.">'
    + '</head><body>x</body></html>';

  sc._rows = [{ keys: ['ハンソヒ'], clicks: 3, impressions: 100, position: 12.3, ctr: 0.03 }];
  sc.toRows = () => [];   // 이 엔드포인트는 toRows 를 안 쓴다

  let fetched = null;
  global.fetch = async (url, opts) => {
    fetched = { url: url, ua: opts && opts.headers && opts.headers['user-agent'] };
    return { ok: true, status: 200, url: url, text: async () => HTML };
  };
  selects.length = 0;

  res = mkRes();
  await pageQueries({ query: { page: '/ja/article/han-so-hee-x' }, headers: {} }, res);
  const shown = res._json && res._json.shown_in_search;
  t('제목을 읽는다', shown && shown.title === '한소희 & 남주혁 — PAP Magazine', shown);
  t('설명을 읽는다', shown && shown.description === '두 사람이 함께한 화보를 다룬다.', shown);
  t('HTML 엔티티를 되돌린다(&amp; → &)', shown && shown.title.includes(' & '), shown && shown.title);
  t('출처를 밝힌다(live-page)', shown && shown.source === 'live-page', shown);
  t('언어를 뽑는다(ja)', shown && shown.lang === 'ja', shown);
  t('실제 페이지를 가져왔다', fetched && /\/ja\/article\/han-so-hee-x$/.test(fetched.url), fetched);
  t('봇 UA 를 쓰지 않는다(우리 계측 오염 방지)',
    fetched && !/bot|crawler|spider/i.test(fetched.ua || ''), fetched && fetched.ua);
  t('없는 컬럼(seo_description)을 다시 조회하지 않는다',
    !selects.some((s) => String(s.cols || '').includes('seo_description')), selects);

  // 실패를 삼키지 않는다
  global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  res = mkRes();
  await pageQueries({ query: { page: '/article/x' }, headers: {} }, res);
  const failShown = res._json && res._json.shown_in_search;
  t('가져오기 실패 시 error 를 낸다 (null 로 삼키지 않는다)',
    failShown && typeof failShown.error === 'string' && failShown.error.length > 0, failShown);
  t('  그래도 200 으로 질의 결과는 낸다', res._status === 200, res._status);

  // 404 도 조용히 넘기지 않는다
  global.fetch = async (url) => ({ ok: false, status: 404, url: url, text: async () => '<html></html>' });
  res = mkRes();
  await pageQueries({ query: { page: '/article/gone' }, headers: {} }, res);
  const gone = res._json && res._json.shown_in_search;
  t('404 면 note 로 알린다', gone && /HTTP 404/.test(gone.note || ''), gone);

  global.fetch = origFetch;

  console.log('\n' + (fail === 0 ? '✅' : '❌') + '  통과 ' + pass + ' / 실패 ' + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('하네스 자체가 터졌다:', e); process.exit(1); });
