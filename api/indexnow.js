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
 *   GET /api/indexnow?url=<단일 URL>      → 특정 URL 만 제출
 *   POST /api/indexnow  { urls:[...] }    → 지정 URL 목록 제출
 *
 * 선택 보호: INDEXNOW_SECRET 환경변수가 설정돼 있으면 ?secret= 로 일치 요구.
 * (자기 사이트 URL 재수집 요청이라 위험도는 낮음)
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

async function recentContentUrls() {
  const urls = [];
  try {
    const { data: eds } = await supabaseAdmin
      .from('editorials').select('slug, id')
      .eq('status', 'published')
      .order('published_date', { ascending: false, nullsFirst: false })
      .limit(30);
    (eds || []).forEach(e => {
      const h = e.slug || e.id; if (h) urls.push(SITE + '/editorial/' + encodeURIComponent(h));
    });
  } catch (_) {}
  try {
    const { data: arts } = await supabaseAdmin
      .from('articles').select('custom_url, id')
      .eq('status', 'published')
      .order('published_date', { ascending: false })
      .limit(30);
    (arts || []).forEach(a => {
      const h = a.custom_url || a.id; if (h) urls.push(SITE + '/article/' + encodeURIComponent(h));
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
      });
      results.push({ endpoint: ep, status: r.status });
    } catch (err) {
      results.push({ endpoint: ep, error: String(err && err.message || err) });
    }
  }
  return results;
}

module.exports = async function handler(req, res) {
  // 선택 보호
  if (process.env.INDEXNOW_SECRET) {
    const s = (req.query && req.query.secret) || '';
    if (s !== process.env.INDEXNOW_SECRET) return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    let urlList = [];

    if (req.method === 'POST') {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      if (Array.isArray(b.urls)) urlList = b.urls.filter(u => typeof u === 'string' && u.startsWith(SITE));
    } else if (req.query && req.query.url) {
      const u = String(req.query.url);
      if (u.startsWith(SITE)) urlList = [u];
    }

    // 기본 세트 (파라미터 없을 때): 정적 주요 페이지 + 최신 콘텐츠
    if (!urlList.length) {
      urlList = STATIC_URLS.concat(await recentContentUrls());
    }

    // 중복 제거 + IndexNow 상한(1만) 보호
    urlList = [...new Set(urlList)].slice(0, 10000);

    const results = await submit(urlList);
    return res.status(200).json({
      submitted: urlList.length,
      keyLocation: KEY_LOCATION,
      endpoints: results,
      sample: urlList.slice(0, 5),
    });
  } catch (err) {
    console.error('[indexnow] error:', err);
    return res.status(500).json({ error: 'indexnow failed', detail: String(err && err.message || err) });
  }
};
