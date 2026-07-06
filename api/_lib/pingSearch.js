/**
 * PAP Magazine — 신규 콘텐츠 즉시 검색엔진 알림 (수집 훅용 공유 lib)
 *
 * 소비자: api/cron/sync-instagram.js (기사 수집 직후 호출)
 *
 * 두 채널로 "지금 새 글 나왔다"를 알린다:
 *   ① IndexNow — 네이버·빙·얀덱스 등 (일간 크론 api/indexnow.js 와 동일
 *      키/엔드포인트. 크론은 보험용 일괄 재제출, 여기는 발행 즉시 단건 제출)
 *   ② WebSub(PubSubHubbub) — 구글 계열 피드 재수집 트리거. rss.xml 을
 *      허브에 publish 핑하면 구독 크롤러가 즉시 피드를 다시 읽는다.
 *
 * 실패는 조용히 무시 — 검색 핑은 best-effort 이고 일간 크론이 재보장한다.
 */

const HOST = 'www.pap-magazine.com';
const SITE = 'https://' + HOST;
const KEY = '4005b5b31f9637fbe4b717b287303296'; // frontend/<KEY>.txt 로 검증됨
const KEY_LOCATION = SITE + '/' + KEY + '.txt';

const INDEXNOW_ENDPOINTS = [
  'https://searchadvisor.naver.com/indexnow',
  'https://api.indexnow.org/indexnow',
  'https://www.bing.com/indexnow',
];

const WEBSUB_HUBS = [
  'https://pubsubhubbub.appspot.com/',
];

const FEEDS = [
  SITE + '/rss.xml',
  SITE + '/sitemap-news.xml',
];

async function submitIndexNow(urls) {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return { submitted: 0 };
  const body = JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: list.slice(0, 100) });
  const results = await Promise.allSettled(INDEXNOW_ENDPOINTS.map((ep) =>
    fetch(ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(8000),
    })
  ));
  return { submitted: list.length, ok: results.filter((r) => r.status === 'fulfilled').length };
}

async function pingWebSub() {
  const jobs = [];
  for (const hub of WEBSUB_HUBS) {
    for (const feed of FEEDS) {
      jobs.push(fetch(hub, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'hub.mode=publish&hub.url=' + encodeURIComponent(feed),
        signal: AbortSignal.timeout(8000),
      }));
    }
  }
  const results = await Promise.allSettled(jobs);
  return { ok: results.filter((r) => r.status === 'fulfilled').length, total: jobs.length };
}

/**
 * 페퍼릿(pepperitmag.com) 전용 IndexNow — 같은 Vercel 프로젝트가 두 호스트를
 * 서빙하므로 키 파일(<KEY>.txt)은 페퍼릿 도메인에서도 그대로 응답된다.
 * IndexNow 규격상 host 와 keyLocation 호스트가 일치해야 해 별도 함수로 분리.
 */
const PEPPERIT_HOST = 'www.pepperitmag.com';
const PEPPERIT_SITE = 'https://' + PEPPERIT_HOST;

async function submitIndexNowPepperit(urls) {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return { submitted: 0 };
  const body = JSON.stringify({
    host: PEPPERIT_HOST, key: KEY,
    keyLocation: PEPPERIT_SITE + '/' + KEY + '.txt',
    urlList: list.slice(0, 100),
  });
  const results = await Promise.allSettled(INDEXNOW_ENDPOINTS.map((ep) =>
    fetch(ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(8000),
    })
  ));
  return { submitted: list.length, ok: results.filter((r) => r.status === 'fulfilled').length };
}

/**
 * 신규 기사 발행 직후 호출 — IndexNow(개별 URL) + WebSub(피드) 동시 핑.
 * @param {string[]} articleUrls 절대 URL 배열
 */
async function pingNewContent(articleUrls) {
  const out = {};
  try { out.indexnow = await submitIndexNow(articleUrls); } catch (e) { out.indexnow = { error: String(e && e.message || e).slice(0, 100) }; }
  try { out.websub = await pingWebSub(); } catch (e) { out.websub = { error: String(e && e.message || e).slice(0, 100) }; }
  return out;
}

module.exports = { pingNewContent, submitIndexNow, submitIndexNowPepperit, pingWebSub, SITE, PEPPERIT_SITE };
