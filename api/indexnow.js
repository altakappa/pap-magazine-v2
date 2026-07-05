/**
 * PAP Magazine — IndexNow 재수집 제출 엔드포인트
 * Route: /api/indexnow
 *
 * 네이버·빙·얀덱스 등 IndexNow 참여 검색엔진에 "이 URL이 갱신됐으니 다시
 * 수집해달라"고 프로그램으로 요청한다. (네이버 서치어드바이저 공지: 네이버
 * 검색은 IndexNow 프로토콜을 지원.) 웹마스터 UI 수동 클릭 없이 재크롤을
 * 트리거 → 캐시된 옛 메타(영어 소개 등)를 새 한글 메타로 갱신시킨다.
 *
 * 키 검증 파일: https://www.pap-magazine.com/4005b5b31f9637fbe4b717b287303296.txt
 * (검색엔진이 이 파일을 fetch 해 소유권을 확인한다 — frontend/ 에 정적 배치)
 *
 * 사용:
 *   GET /api/indexnow                    → 기본 세트(홈+주요 페이지+최신 콘텐츠) 제출
 *   GET /api/indexnow?mode=recent        → 홈 + 최근 48시간 발행/갱신 콘텐츠만 제출
 *                                          (매일 크론용 — 같은 URL 반복 제출은 IndexNow
 *                                          가이드라인상 스팸 신호가 될 수 있어 변경분만)
 *   GET /api/indexnow?url=<단일 URL>      → 특정 URL 만 제출
 *   POST /api/indexnow  { urls:[...] }    → 지정 URL 목록 제출
 *
 * Vercel cron 이 호출하면 (user-agent: vercel-cron) 자동으로 recent 모드.
 *
 * 보호: Vercel cron 의 `Authorization: Bearer CRON_SECRET` 또는
 *       ?secret=INDEXNOW_SECRET 둘 중 하나가 맞으면 통과.
 *       (자기 사이트 URL 재수집 요청이라 위험도는 낮음)
 */

const { supabaseAdmin } = require('./_lib/supabase');

const HOST = 'www.pap-magazine.com';
const SITE = 'https://' + HOST;
const KEY = '4005b5b31f9637fbe4b717b287303296';
const KEY_LOCATION = SITE + '/' + KEY + '.txt';

// IndexNow 는 참여 엔드포인트 아무 곳에나 제출하면 서로 공유되지만,
// 네이버 확실한 수집을 위해 네이버 전용 + 공용 엔드포인트에 함께 제출.
const ENDPOINTS = [
  'https://searchadvisor.naver.com/indexnow',
  'https://api.indexnow.org/indexnow',
  'https://www.bing.com/indexnow',
];

const STATIC_URLS = [
  SITE + '/',
  SITE + '/magazine',
  SITE + '/articles',
  SITE + '/films',
  SITE + '/partners',
  SITE + '/about',
  SITE + '/archive',
];

/**
 * 콘텐츠 URL 수집.
 * @param {string|null} sinceIso — 지정 시 그 시각 이후 발행/갱신된 것만 (recent 모드)
 */
async function recentContentUrls(sinceIso) {
  const urls = [];
  try {
    let q = supabaseAdmin
      .from('editorials').select('slug, id')
      .eq('status', 'published')
      .order('published_date', { ascending: false, nullsFirst: false })
      .limit(30);
    if (sinceIso) q = q.gte('published_date', sinceIso);
    const { data: eds } = await q;
    (eds || []).forEach(e => {
      const h = e.slug || e.id; if (h) urls.push(SITE + '/editorial/' + encodeURIComponent(h));
    });
  } catch (_) {}
  try {
    let q = supabaseAdmin
      .from('articles').select('custom_url, id')
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .limit(30);
    if (sinceIso) q = q.gte('published_date', sinceIso);
    const { data: arts } = await q;
    (arts || []).forEach(a => {
      const h = a.custom_url || a.id; if (h) urls.push(SITE + '/article/' + encodeURIComponent(h));
    });
  } catch (_) {}
  try {
    let q = supabaseAdmin
      .from('films').select('title, id')
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .limit(20);
    if (sinceIso) q = q.gte('published_date', sinceIso);
    const { data: films } = await q;
    (films || []).forEach(f => {
      const h = f.title || f.id; if (h) urls.push(SITE + '/film/' + encodeURIComponent(h));
    });
  } catch (_) {}
  return urls;
}

async function submit(urlList) {
  const body = JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList });
  const results = [];
  for (const ep of ENDPOINTS) {
    try {
      const r = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
        signal: AbortSignal.timeout(10000), // 엔드포인트 무응답이 함수 시간 다 먹지 않게
      });
      results.push({ endpoint: ep, status: r.status });
    } catch (err) {
      results.push({ endpoint: ep, error: String(err && err.message || err) });
    }
  }
  return results;
}

module.exports = async function handler(req, res) {
  // 보호: Vercel cron Bearer 또는 ?secret= 둘 중 하나 통과.
  // (기존 버그 수정: INDEXNOW_SECRET 만 검사해서 Vercel cron 의
  //  Bearer CRON_SECRET 호출이 401 로 튕겨 매일 크론이 조용히 실패하는 구조였음)
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (process.env.INDEXNOW_SECRET && !cronOk) {
    const s = (req.query && req.query.secret) || '';
    if (s !== process.env.INDEXNOW_SECRET) return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    let urlList = [];

    // recent 모드: 크론 반복 실행용 — 최근 48h 변경분 + 홈만 제출.
    // (같은 URL 을 매일 전량 재제출하면 IndexNow 쪽에서 스팸 신호로 볼 수 있음)
    const ua = (req.headers && req.headers['user-agent']) || '';
    const isCron = /vercel-cron/i.test(ua);
    const mode = String((req.query && req.query.mode) || (isCron ? 'recent' : ''));

    if (req.method === 'POST') {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      if (Array.isArray(b.urls)) urlList = b.urls.filter(u => typeof u === 'string' && u.startsWith(SITE));
    } else if (req.query && req.query.url) {
      const u = String(req.query.url);
      if (u.startsWith(SITE)) urlList = [u];
    }

    if (!urlList.length && mode === 'recent') {
      const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const recent = await recentContentUrls(since);
      if (!recent.length) {
        return res.status(200).json({ submitted: 0, mode, message: '최근 48시간 변경 콘텐츠 없음 — 제출 생략.' });
      }
      urlList = [SITE + '/'].concat(recent);
    }

    // 기본 세트 (파라미터 없을 때): 정적 주요 페이지 + 최신 콘텐츠
    if (!urlList.length) {
      urlList = STATIC_URLS.concat(await recentContentUrls(null));
    }

    // 중복 제거 + IndexNow 상한(1만) 보호
    urlList = [...new Set(urlList)].slice(0, 10000);

    const results = await submit(urlList);
    return res.status(200).json({
      submitted: urlList.length,
      mode: mode || 'full',
      keyLocation: KEY_LOCATION,
      endpoints: results,
      sample: urlList.slice(0, 5),
    });
  } catch (err) {
    console.error('[indexnow] error:', err);
    return res.status(500).json({ error: 'indexnow failed', detail: String(err && err.message || err) });
  }
};
