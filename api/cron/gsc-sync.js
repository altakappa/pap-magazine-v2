/**
 * PAP Magazine — Search Console 수집 크론 (2026-08-18 신설)
 * Route: /api/cron/gsc-sync   (vercel.json: 하루 1회)
 *
 * ■ 왜
 * 2026-08-18, Ahrefs 의 GSC 미러로 개선할 페이지를 고르려다 두 번 틀렸다.
 * 그 표는 국가별 클릭 4,800 중 400(8%)만, 일본 클릭 992 중 12(1.2%)만
 * 설명했다. 근거가 8% 인 판단은 판단이 아니다. 원본을 우리 DB 로 가져온다.
 *
 * ■ 무엇을 가져오나
 *   date × page   어느 페이지가 노출·클릭을 만드나
 *   date × query  무엇을 검색해서 오나
 * 둘을 곱하지 않는다(page × query 는 행이 폭발한다). 곱이 필요해지면
 * 그때 따로 만든다 — 지금 없는 필요를 위해 비용을 내지 않는다.
 *
 * ■ 지연
 * GSC 는 최근 2~3일을 나중에 확정한다. 매 회차 최근 GSC_SYNC_DAYS(기본 5)일을
 * 다시 긁어 덮어쓴다. 한 번 긁고 끝내면 마지막 며칠이 영원히 과소 집계로 남는다.
 * ?days=N 으로 소급 수집도 된다(최초 1회는 90 정도로 한 번 돌리면 된다).
 */

const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { supabaseAdmin } = require('../_lib/supabase');
const { queryAll, toRows, daysAgo, SITE } = require('../_lib/searchConsole');

/* GSC 는 오늘·어제 데이터를 거의 안 준다. 끝을 2일 전으로 둔다. */
const END_LAG_DAYS = 2;

async function saveChunked(table, rows, conflict) {
  let saved = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict: conflict });
    if (error) throw new Error(table + ' 저장 실패: ' + error.message);
    saved += chunk.length;
  }
  return saved;
}

module.exports = withCronGuard('gsc-sync', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const q = req.query || {};
  const days = Math.max(1, Math.min(480, Number(q.days || process.env.GSC_SYNC_DAYS || 5)));
  const endDate = daysAgo(END_LAG_DAYS);
  const startDate = daysAgo(END_LAG_DAYS + days - 1);

  const pageRaw = await queryAll({ startDate, endDate, dimensions: ['date', 'page'] });
  const queryRaw = await queryAll({ startDate, endDate, dimensions: ['date', 'query'] });

  const pages = toRows(pageRaw, 'page');
  const queries = toRows(queryRaw, 'query');

  const savedPages = await saveChunked('gsc_page_daily', pages, 'date,page');
  const savedQueries = await saveChunked('gsc_query_daily', queries, 'date,query');

  /* 노출 합계를 같이 남긴다. Ahrefs 미러와 어긋나던 그 숫자를 이제 우리가
     직접 갖는다. 다음 사람이 '얼마나 들어왔나' 를 로그만 보고 알 수 있다. */
  const imp = pages.reduce((a, r) => a + r.impressions, 0);
  const clk = pages.reduce((a, r) => a + r.clicks, 0);

  res.locals = res.locals || {};
  res.locals.cronNote = '페이지 ' + savedPages + '행 · 질의 ' + savedQueries + '행 · '
    + startDate + '~' + endDate + ' 노출 ' + imp.toLocaleString('ko-KR')
    + ' 클릭 ' + clk.toLocaleString('ko-KR');

  return res.status(200).json({
    ok: true, site: SITE, startDate, endDate, days,
    pages: savedPages, queries: savedQueries, impressions: imp, clicks: clk,
  });
});
