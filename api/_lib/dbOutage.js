/**
 * DB 장애를 404 가 아니라 503 으로 말한다 (2026-09-14 사고).
 *
 * ■ 무슨 일이 있었나
 * 2026-09-14 새벽 Supabase 가 전송량 한도 초과로 프로젝트를 잠갔다
 * (exceed_egress_quota · exceed_cached_egress_quota). 그 순간 SSR 기사 경로가
 * 이렇게 동작했다:
 *
 *     const { data } = await supabaseAdmin.from('articles')...   // error 는 안 본다
 *     if (!data) return res.status(404).send(...)                 // ← 여기
 *
 * supabase-js 는 실패를 throw 하지 않고 `{ data: null, error }` 로 돌려준다.
 * 코드가 error 를 안 보니 **장애와 '그런 기사 없음'이 같은 404** 가 됐다.
 * 라이브 실측: 기사 URL 404 · /api/articles 500 · sitemap-articles.xml 빈 파일.
 *
 * ■ 왜 이게 치명적인가
 * 404 는 구글에게 "이 페이지는 없어졌다" 이다. 기사 URL 이 26,703개인데 장애가
 * 며칠 이어지면 색인이 통째로 빠진다. 503 은 "지금 잠깐 고장, 나중에 다시 와라"
 * 라서 구글이 색인을 유지하고 재방문한다. **같은 장애인데 결과가 정반대다.**
 *
 * ■ 규칙
 * 조회 결과에 error 가 있으면 없음(404/410)으로 넘기지 말고 503 을 준다.
 * 진짜 404 는 **error 가 없는데 행이 없을 때**만이다.
 *
 * ■ 503 에 noindex 를 붙이지 않는다
 * 붙이면 "일시 장애" 라고 말해 놓고 "색인하지 마라" 라고 같이 말하는 셈이다.
 * 503 의 목적은 색인 **보존**이다. Retry-After 로 언제 다시 오라고만 알린다.
 */

'use strict';

/** 재시도 권장 간격(초). 너무 짧으면 장애 중에 크롤이 몰린다. */
const RETRY_AFTER = 600;

/**
 * supabase-js 응답의 error 가 '우리 잘못이 아닌 일시 장애'인가.
 *
 * 보수적으로 본다 — 애매하면 true. 404 로 잘못 말하는 손해(색인 소실)가
 * 503 으로 잘못 말하는 손해(크롤 지연)보다 훨씬 크기 때문이다.
 * 다만 '행이 없다'를 뜻하는 PGRST116 만은 장애가 아니다.
 */
function isOutageError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === 'PGRST116') return false;          // maybeSingle 의 '행 0개'
  return true;
}

/** 여러 조회 결과 중 하나라도 장애면 참. `{data,error}` 또는 error 자체를 받는다. */
function anyOutage(...results) {
  for (const r of results) {
    if (!r) continue;
    const e = (r && typeof r === 'object' && 'error' in r) ? r.error : r;
    if (isOutageError(e)) return true;
  }
  return false;
}

/**
 * 503 을 보낸다. 호출부는 그대로 return 하면 된다.
 * @param {object} res
 * @param {string} [reason]  로그용 짧은 사유 (응답 본문에는 안 넣는다)
 */
function sendOutage(res, reason) {
  if (reason) console.warn('[dbOutage] 503 —', String(reason).slice(0, 200));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  /* 장애 응답은 캐시하지 않는다. 캐시하면 복구된 뒤에도 503 이 남는다. */
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Retry-After', String(RETRY_AFTER));
  return res.status(503).send(
    '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<title>잠시 후 다시 시도해 주세요 | PAP Magazine</title></head>'
    + '<body style="margin:0;background:#000;color:#fff;font-family:system-ui,-apple-system,sans-serif;'
    + 'display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center">'
    + '<div style="padding:24px"><div style="letter-spacing:.3em;font-size:13px;opacity:.6">PAP MAGAZINE</div>'
    + '<h1 style="font-size:18px;font-weight:500;margin:16px 0 8px">잠시 후 다시 시도해 주세요</h1>'
    + '<p style="font-size:13px;opacity:.6;margin:0">일시적인 문제로 내용을 불러오지 못했습니다.</p>'
    + '</div></body></html>'
  );
}

/**
 * 사이트맵용 503. **빈 <urlset> 을 200 으로 주면 안 된다.**
 *
 * 2026-09-14 실측: 장애 중 /sitemap-articles.xml 이 `<urlset></urlset>` 을 200 으로
 * 돌려줬다. 구글에게 이것은 "기사가 0편이다" 라는 **정상 응답**이다. 며칠 이어지면
 * 사이트맵에 있던 URL 을 전부 지워도 된다고 읽는다. 503 이면 "지금은 못 읽는다"라
 * 직전 사이트맵을 그대로 들고 있는다.
 */
function sendOutageXml(res, reason) {
  if (reason) console.warn('[dbOutage] sitemap 503 —', String(reason).slice(0, 200));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Retry-After', String(RETRY_AFTER));
  return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?>\n<!-- temporarily unavailable -->\n');
}

module.exports = { isOutageError, anyOutage, sendOutage, sendOutageXml, RETRY_AFTER };
