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

const { bearerOk, safeEqual } = require('./_lib/secretCompare');
const { supabaseAdmin } = require('./_lib/supabase');
/* 2026-08-07 — 가드 추가. 그전까지 이 경로는 매일 02:00 에 예약돼 있으면서도
   cron_runs 에 아무 기록을 남기지 않았다. 제출이 되는지, 검색엔진이 받았는지,
   아예 안 도는지 구분할 방법이 없었다. */
const { withCronGuard } = require('./_lib/cronGuard');

function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}
/* 로그에 넣을 짧은 이름 — 전체 URL 을 넣으면 note 500자를 금방 넘긴다 */
function epLabel(url) {
  if (/naver/i.test(url)) return '네이버';
  if (/bing/i.test(url)) return '빙';
  if (/api\.indexnow\.org/i.test(url)) return 'indexnow.org';
  return String(url).slice(0, 24);
}
/* IndexNow 규격: 200=수락, 202=수락(키 확인 대기). 그 외는 거절이다. */
function epAccepted(r) { return !!r && (r.status === 200 || r.status === 202); }

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
 *
 * 2026-09-05 — "발행/갱신" 이라고 적혀 있었지만 코드는 published_date 만 봤다.
 * 그래서 발행 뒤에 바뀐 페이지는 검색엔진에 한 번도 다시 알려지지 않았다:
 *   · 제목 수정(2024 레거시 오탈자 등) · FAQ 부착(기사 2,655 · 화보 2,291)
 *   · 영문 FAQ 백필(4,351편 진행 중) · 언어판 번역 갱신(48h 에 12,468행)
 * Ahrefs Site Audit(9/1): "Changed pages not submitted to IndexNow" 9,998 페이지.
 * DB 실측(9/5): 48h 안에 발행일은 옛날인데 updated_at 이 바뀐 기사 1,147편.
 * 네이버·빙은 IndexNow 로만 "다시 읽어 달라" 를 듣는다 — 그 채널이 갱신에는
 * 닫혀 있었다. since 가 있으면 published_date 또는 updated_at 중 하나라도
 * 그 이후인 행을 고르고, 최근 갱신순으로 자른다.
 *
 * 스팸 방지: updated_at 은 실제로 바뀐 행만 움직인다(DB 트리거). 같은 URL 을
 * 매일 되밀지 않는 원칙은 그대로다 — "바뀐 것" 의 정의를 넓혔을 뿐이다.
 */
/* PostgREST or() 값에 밀리초 점(.000Z)이 들어가면 파서가 헷갈릴 여지가 있어
   초 단위로 자른다. published_date 는 date 형이라 시각 부분은 어차피 버려진다. */
const CHANGED_FILTER = (sinceIso) => {
  const t = String(sinceIso).replace(/\.\d{1,3}Z$/, 'Z');
  return 'published_date.gte.' + t + ',updated_at.gte.' + t;
};
let lastRecentStats = null;
/* 2026-08-26 — 언어판 제출 추가. Bing 웹마스터 "Important URLs missing" 이
   전부 /en /ja /zh /es /it /de 기사였다: IndexNow 가 ko URL 만 제출하고
   언어판은 검색엔진이 알아서 발견하길 기다리는 구조였기 때문. en 은 SSR 이
   항상 존재(title_en 기반)하니 무조건, 나머지 언어는 seo_translations 에
   번역이 실재하는 것만 제출한다 — 없는 페이지를 밀어넣지 않기 위해. */
/* 2026-09-05 — sinceIso 를 받는다. recent 모드에서 ko 원본이 바뀌었다고 해서
   8개 언어판이 전부 바뀐 건 아니다(언어판 본문·FAQ 는 seo_translations 에서
   온다). 번역행의 updated_at 이 since 이후인 언어만 낸다 — 안 바뀐 URL 을
   매일 되밀어 넣는 건 IndexNow 가이드라인상 스팸 신호다. en 은 title_en SSR
   이라 원본이 바뀌면 같이 바뀌므로 항상 포함. */
async function langVariantUrls(kind, rows, sinceIso) {
  const out = [];
  const byId = new Map();
  (rows || []).forEach(r => { const h = r.slug || r.custom_url || r.id; if (h) byId.set(r.id, h); });
  if (!byId.size) return out;
  for (const h of byId.values()) out.push(SITE + '/en/' + kind + '/' + encodeURIComponent(h));
  try {
    let tq = supabaseAdmin
      .from('seo_translations').select('content_id, lang')
      .eq('kind', kind)
      .in('content_id', [...byId.keys()]);
    if (sinceIso && tq && typeof tq.gte === 'function') tq = tq.gte('updated_at', sinceIso);
    const { data: trs } = await tq;
    (trs || []).forEach(t => {
      const h = byId.get(t.content_id);
      if (h && t.lang && t.lang !== 'ko' && t.lang !== 'en') {
        out.push(SITE + '/' + t.lang + '/' + kind + '/' + encodeURIComponent(h));
      }
    });
  } catch (_) {}
  return out;
}

async function recentContentUrls(sinceIso, limits, withLangs) {
  const urls = [];
  const L = limits || {};
  try {
    let q = supabaseAdmin
      .from('editorials').select('slug, id')
      .eq('status', 'published')
      .order(sinceIso ? 'updated_at' : 'published_date', { ascending: false, nullsFirst: false })
      .limit(L.editorial || 30);
    if (sinceIso) q = q.or(CHANGED_FILTER(sinceIso));
    const { data: eds } = await q;
    (eds || []).forEach(e => {
      const h = e.slug || e.id; if (h) urls.push(SITE + '/editorial/' + encodeURIComponent(h));
    });
    if (withLangs) urls.push(...await langVariantUrls('editorial', eds, sinceIso));
  } catch (_) {}
  try {
    let q = supabaseAdmin
      .from('articles').select('slug, custom_url, id')
      .eq('status', 'published')
      .order(sinceIso ? 'updated_at' : 'published_date', { ascending: false, nullsFirst: false })
      .limit(L.article || 30);
    if (sinceIso) q = q.or(CHANGED_FILTER(sinceIso));
    const { data: arts } = await q;
    (arts || []).forEach(a => {
      const h = a.slug || a.custom_url || a.id; if (h) urls.push(SITE + '/article/' + encodeURIComponent(h));
    });
    if (withLangs) urls.push(...await langVariantUrls('article', arts, sinceIso));
  } catch (_) {}
  try {
    let q = supabaseAdmin
      .from('films').select('slug, title, id')
      .eq('status', 'published')
      .order(sinceIso ? 'updated_at' : 'published_date', { ascending: false, nullsFirst: false })
      .limit(L.film || 20);
    if (sinceIso) q = q.or(CHANGED_FILTER(sinceIso));
    const { data: films } = await q;
    (films || []).forEach(f => {
      /* 2026-08-26 — 종전엔 title 로 URL 을 만들었다. 프론트 링크는 slug||id 라
         /film/<제목> 제출은 존재하지 않는 URL 을 밀어넣는 낭비였다. */
      const h = f.slug || f.id; if (h) urls.push(SITE + '/film/' + encodeURIComponent(h));
    });
  } catch (_) {}
  /* 원본 행은 안 바뀌고 번역행만 바뀐 경우(언어판 FAQ 백필이 그렇다) — 위 세
     블록은 원본 updated_at 을 보므로 놓친다. 번역행 자체를 since 로 골라 그
     언어판 URL 만 낸다. en 은 seo_translations 에 없으므로 여기서 안 나온다. */
  const before = urls.length;
  if (sinceIso && withLangs) {
    try {
      const { data: trs } = await supabaseAdmin
        .from('seo_translations').select('content_id, kind, lang')
        .gte('updated_at', sinceIso)
        .neq('lang', 'ko')
        .order('updated_at', { ascending: false })
        .limit((L.translation || 600));
      const byKind = {};
      (trs || []).forEach(t => {
        if (!t || !t.content_id || !t.kind || !t.lang || t.lang === 'en') return;
        (byKind[t.kind] = byKind[t.kind] || []).push(t);
      });
      for (const kind of Object.keys(byKind)) {
        const table = kind === 'article' ? 'articles' : kind === 'editorial' ? 'editorials' : kind === 'film' ? 'films' : null;
        if (!table) continue;
        const ids = [...new Set(byKind[kind].map(t => t.content_id))];
        const { data: rows } = await supabaseAdmin
          .from(table).select('id, slug' + (kind === 'article' ? ', custom_url' : ''))
          .eq('status', 'published')
          .in('id', ids);
        const handle = new Map();
        (rows || []).forEach(r => { const h = r.slug || r.custom_url || r.id; if (h) handle.set(r.id, h); });
        byKind[kind].forEach(t => {
          const h = handle.get(t.content_id);
          if (h) urls.push(SITE + '/' + t.lang + '/' + kind + '/' + encodeURIComponent(h));
        });
      }
    } catch (_) {}
  }
  lastRecentStats = { total: urls.length, translationOnly: urls.length - before };
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

module.exports = withCronGuard('indexnow', async function handler(req, res) {
  // 보호: Vercel cron Bearer 또는 ?secret= 둘 중 하나 통과.
  // (기존 버그 수정: INDEXNOW_SECRET 만 검사해서 Vercel cron 의
  //  Bearer CRON_SECRET 호출이 401 로 튕겨 매일 크론이 조용히 실패하는 구조였음)
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = bearerOk(auth, process.env.CRON_SECRET); // 2026-09-04 timing-safe
  /* 2026-09-04 보안감사 — INDEXNOW_SECRET 이 없으면 검사를 건너뛰던 fail-open 이었다.
     크론 시크릿도 아니고 INDEXNOW_SECRET 도 설정돼 있지 않으면 거부한다. */
  if (!cronOk) {
    if (!process.env.INDEXNOW_SECRET) {
      note(res, '인증 거부 — INDEXNOW_SECRET 미설정 (fail-closed)');
      return res.status(503).json({ error: 'INDEXNOW_SECRET not configured' });
    }
    const s = (req.query && req.query.secret) || '';
    if (!safeEqual(s, process.env.INDEXNOW_SECRET)) { // 2026-09-04 timing-safe
      note(res, '인증 거부 — 크론 시크릿도 ?secret= 도 아님');
      return res.status(401).json({ error: 'unauthorized' });
    }
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

    // backfill 모드: 레거시/대량 발행분 catch-up — 최근 N일(기본 30, 최대 90) 발행물의
    // 정식 슬러그 URL 을 대량 재제출(네이버·빙 색인 가속). 수동 트리거용.
    if (!urlList.length && mode === 'backfill') {
      const days = Math.min(parseInt((req.query && req.query.days) || '30', 10) || 30, 90);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      /* 언어판은 ko 만으로도 1만 상한에 닿는 대량 모드라 기본 제외 — ?langs=1 로만 */
      const withLangs = String((req.query && req.query.langs) || '') === '1';
      urlList = await recentContentUrls(since, { editorial: 500, article: 2000, film: 200 }, withLangs);
      if (!urlList.length) {
        note(res, 'backfill: 해당 기간 발행물 없음 — 제출 생략');
        return res.status(200).json({ submitted: 0, mode, message: '해당 기간 발행물 없음.' });
      }
    }

    if (!urlList.length && mode === 'recent') {
      const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      /* 2026-09-05 — 갱신분이 들어오면서 48h 변경분이 200 을 훌쩍 넘는다
         (영문 FAQ 백필 파도 동안 기사 1,147/48h). 표별 상한을 올리고 총량은
         아래에서 INDEXNOW_RECENT_CAP(기본 2,000)으로 자른다 — 하루 1만 건은
         이 규모 사이트엔 과하고, 파도는 며칠이면 빠진다. */
      const recent = await recentContentUrls(since, { editorial: 300, article: 600, film: 50, translation: 600 }, true);
      if (!recent.length) {
        note(res, '최근 48시간 변경 콘텐츠 없음 — 제출 생략 (정상)');
        return res.status(200).json({ submitted: 0, mode, message: '최근 48시간 변경 콘텐츠 없음 — 제출 생략.' });
      }
      const cap = Math.max(100, parseInt(process.env.INDEXNOW_RECENT_CAP || '2000', 10) || 2000);
      urlList = [SITE + '/'].concat(recent).slice(0, cap);
    }

    // 기본 세트 (파라미터 없을 때): 정적 주요 페이지 + 최신 콘텐츠
    if (!urlList.length) {
      urlList = STATIC_URLS.concat(await recentContentUrls(null, null, true));
    }

    // 중복 제거 + IndexNow 상한(1만) 보호
    urlList = [...new Set(urlList)].slice(0, 10000);

    const results = await submit(urlList);

    /* 2026-08-07 — 여기가 조용한 실패의 자리였다. 엔드포인트가 전부 거절해도
       이 함수는 200 과 "submitted: 50" 을 돌려줬다. 숫자는 '보낸 개수' 지
       '받아준 개수' 가 아니다. 수락 여부를 세어 note 에 적고, 하나도 못 받으면
       실패로 올려 알림이 가게 한다. */
    const detail = results.map((r) => epLabel(r.endpoint) + ' ' + (r.error ? ('오류(' + String(r.error).slice(0, 40) + ')') : r.status)).join(' · ');
    const accepted = results.filter(epAccepted).length;
    if (!accepted) {
      note(res, (mode || 'full') + ': ' + urlList.length + '건 제출했으나 수락 0 — ' + detail);
      return res.status(502).json({ submitted: urlList.length, accepted: 0, mode: mode || 'full', endpoints: results });
    }
    const statsTxt = (mode === 'recent' && lastRecentStats) ? ' · 언어판전용 ' + lastRecentStats.translationOnly : '';
    note(res, (mode || 'full') + ': ' + urlList.length + '건 제출' + statsTxt + ' · 수락 ' + accepted + '/' + results.length + ' — ' + detail);
    return res.status(200).json({
      submitted: urlList.length,
      accepted,
      mode: mode || 'full',
      keyLocation: KEY_LOCATION,
      endpoints: results,
      sample: urlList.slice(0, 5),
    });
  } catch (err) {
    console.error('[indexnow] error:', err);
    return res.status(500).json({ error: 'indexnow failed', detail: String(err && err.message || err) });
  }
});

/* 검증용 노출 (tests/indexnow-guard.test.js) */
module.exports.epLabel = epLabel;
module.exports.epAccepted = epAccepted;
module.exports.ENDPOINTS = ENDPOINTS;
module.exports.langVariantUrls = langVariantUrls;
module.exports.recentContentUrls = recentContentUrls;
module.exports.CHANGED_FILTER = CHANGED_FILTER;
