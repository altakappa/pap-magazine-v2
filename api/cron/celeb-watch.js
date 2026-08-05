/**
 * PAP Magazine — 셀럽·속보 감시 크론 (2026-07-17 신설)
 * Route: /api/cron/celeb-watch  (vercel.json: 5분마다)
 *
 * 왜: 새벽에 터지는 대형 이벤트(예: 월드컵 결승 하프타임쇼)를 팀이 자느라
 * 놓친다. 기존 sync-instagram 은 "IG 에 이미 올라간 것"만 기사화하므로,
 * IG 게시조차 못 하는 새벽엔 아무것도 나가지 않는다.
 *
 * 무엇: 셀럽·시상식·패션 속보 소스를 5분마다 폴링해
 *   ① 여러 매체가 동시에 다루는 사건 = 속보로 판정 (교차 검증 — 오보·낚시 방지)
 *   ② 화제성 점수(교차 매체 수 + 대형 키워드 + 최신성)가 기준 이상인 것만 선별
 *   ③ 도메니코에게 즉시 텔레그램 알림 — 기사화 여부는 사람이 판단
 *
 * ⚠️ 2026-07-21 정책 변경 (도메니코): "셀럽 기사는 5분마다 검토해서 화제성이
 * 있는 것만 텔레그램으로 보내주면 돼."
 * → 이 크론은 **DB 기사를 만들지 않는다**. 알림 전용.
 *   (이전 버전은 사건마다 draft 를 생성했고, 중복 판정 실패로 2026-07-20 에
 *    144건 draft 스팸이 발생했다. 그 설계를 폐기한 것.)
 * → 웹사이트 기사 자동게시는 sync-instagram(인스타 게시물 → 기사)이 담당한다.
 *
 * 중복 방지: celeb_watch_seen 테이블(migration 084)에 시그니처를 남기고
 * 최근 48시간 기록과 시그니처·키워드 이중 대조.
 * 수동 트리거: 관리자 토큰. `?dry=1` 미리보기, `?min=N` 화제성 임계값 조정.
 */

const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { withCronGuard } = require('../_lib/cronGuard');
const { pushAlert } = require('../_lib/pushAlert');

const SITE = 'https://www.pap-magazine.com';

/* 감시 소스 — 도메니코 선택 3개 영역 (K-pop 셀럽 / 시상식 레드카펫 / 패션 브랜드).
   구글 뉴스 RSS 쿼리는 키워드 기반이라 이벤트성 속보를 빠르게 잡는다. */
// 2026-07-20 속도 개선: 인스타/X 가 RSS 보다 빠르지만 타 계정 API 감시가
// 불가(Graph API 제약)·유료(X)라, 대신 ① 구글뉴스 when:1h 로 최신만 좁혀
// 폴링 주기(5분)와 맞추고 ② 팬덤 커뮤니티(Reddit) RSS 를 추가한다.
// Reddit 은 무료·실시간에 가깝고 팬이 매체보다 먼저 올리는 경우가 많다.
const FEEDS = [
  // K-pop · 셀럽 (매체)
  { source: 'Soompi', url: 'https://www.soompi.com/feed', topic: 'kpop' },
  { source: 'Allkpop', url: 'https://www.allkpop.com/rss', topic: 'kpop' },
  { source: 'Billboard', url: 'https://www.billboard.com/feed/', topic: 'kpop' },
  { source: 'GoogleNews-KPOP', topic: 'kpop',
    url: 'https://news.google.com/rss/search?q=(BTS+OR+blackpink+OR+%22K-pop%22)+when:1h&hl=en-US&gl=US&ceid=US:en' },
  // 2026-07-27 한국 소스 보강 (도메니코: "한국 셀럽은 한국 매체가 더 빠르지 않나").
  // 기존 구조는 한국발 사건을 Soompi/Allkpop 이 영어로 번역해 줄 때까지 기다렸다가
  // 그 영문 헤드라인을 다시 한국어로 번역해 알리는, 가장 느린 경로였다.
  // ① 아티스트명 쿼리 확대 (기존: 방탄·블랙핑크·케이팝 3개 → 12개)
  { source: 'GoogleNews-KPOP-KR', topic: 'kpop',
    url: 'https://news.google.com/rss/search?q=(%EB%B0%A9%ED%83%84%EC%86%8C%EB%85%84%EB%8B%A8+OR+%EB%B8%94%EB%9E%99%ED%95%91%ED%81%AC+OR+%EC%BC%80%EC%9D%B4%ED%8C%9D+OR+%EB%89%B4%EC%A7%84%EC%8A%A4+OR+%EC%97%90%EC%8A%A4%ED%8C%8C+OR+%EC%84%B8%EB%B8%90%ED%8B%B4+OR+%EC%8A%A4%ED%8A%B8%EB%A0%88%EC%9D%B4%ED%82%A4%EC%A6%88+OR+%ED%8A%B8%EC%99%80%EC%9D%B4%EC%8A%A4+OR+%EC%95%84%EC%9D%B4%EB%B8%8C+OR+%EB%A5%B4%EC%84%B8%EB%9D%BC%ED%95%8C+OR+%EC%95%84%EC%9D%B4%EC%9C%A0+OR+%EC%A7%80%EB%93%9C%EB%9E%98%EA%B3%A4)+when:1h&hl=ko&gl=KR&ceid=KR:ko' },
  // ② 사건 키워드 쿼리 — 특정 이름에 안 걸리는 열애·사망·논란급 속보를 잡는다
  { source: 'GoogleNews-KR-연예', topic: 'kpop',
    url: 'https://news.google.com/rss/search?q=(%EC%97%B4%EC%95%A0+OR+%EA%B2%B0%ED%98%BC+OR+%ED%8C%8C%EA%B2%BD+OR+%EC%82%AC%EB%A7%9D+OR+%EC%9E%85%EB%8C%80+OR+%EC%A0%84%EC%97%AD+OR+%EC%9D%80%ED%87%B4+OR+%ED%95%B4%EC%B2%B4+OR+%EC%BB%B4%EB%B0%B1+OR+%EB%8D%B0%EB%B7%94+OR+%EB%85%BC%EB%9E%80+OR+%EC%88%98%EC%83%81)+(%EC%95%84%EC%9D%B4%EB%8F%8C+OR+%EB%B0%B0%EC%9A%B0+OR+%EA%B0%80%EC%88%98+OR+%EA%B1%B8%EA%B7%B8%EB%A3%B9)+when:1h&hl=ko&gl=KR&ceid=KR:ko' },
  // ③ 연합뉴스 연예 — 한국 매체들이 받아쓰는 원천 통신사 (가장 빠른 축)
  { source: '연합뉴스', topic: 'kpop',
    url: 'https://www.yna.co.kr/rss/entertainment.xml' },
  // K-pop · 셀럽 (팬덤 커뮤니티 — 매체보다 먼저 뜨는 경우가 많음)
  { source: 'Reddit-kpop', topic: 'kpop',
    url: 'https://www.reddit.com/r/kpop/new/.rss?limit=25' },
  { source: 'Reddit-bangtan', topic: 'kpop',
    url: 'https://www.reddit.com/r/bangtan/new/.rss?limit=25' },
  // 시상식 · 레드카펫
  { source: 'GoogleNews-RedCarpet', topic: 'redcarpet',
    url: 'https://news.google.com/rss/search?q=(%22red+carpet%22+OR+MetGala+OR+Oscars+OR+Grammys+OR+Cannes)+fashion+when:1h&hl=en-US&gl=US&ceid=US:en' },
  { source: 'Reddit-fauxmoi', topic: 'redcarpet',
    url: 'https://www.reddit.com/r/Fauxmoi/new/.rss?limit=25' },
  // 패션 브랜드 속보 (디렉터 선임·사임 등)
  { source: 'WWD', url: 'https://wwd.com/feed/', topic: 'fashion' },
  { source: 'Hypebeast', url: 'https://hypebeast.com/feed', topic: 'fashion' },
  { source: 'GoogleNews-Fashion', topic: 'fashion',
    url: 'https://news.google.com/rss/search?q=(%22creative+director%22+OR+%22artistic+director%22)+(appointed+OR+named+OR+steps+down)+fashion+when:1h&hl=en-US&gl=US&ceid=US:en' },
  { source: 'Reddit-fashion', topic: 'fashion',
    url: 'https://www.reddit.com/r/fashion/new/.rss?limit=25' },
];

// 남의 기사를 그대로 옮겨 싣는 포털·신디케이터 — 실제 취재 매체가 아니므로
// 교차검증 매체 수를 부풀린다 (예: 데일리안 기사가 네이트에도 그대로 = 2개 매체 아님).
const SYNDICATORS = new Set(['네이트', '다음', 'msn', 'nate', 'daum', 'zum', '줌 뉴스', '야후', 'yahoo']);

// 의존성 없는 최소 피드 파서.
// RSS(<item>/<pubDate>/<link>텍스트) 와 Atom(<entry>/<updated>/<link href=>) 둘 다 처리 —
// Reddit 은 Atom 을 내려주므로 분기가 필요하다.
function parseRss(xml, source, topic) {
  const raw = String(xml);
  const isAtom = /<entry[\s>]/.test(raw) && !/<item[\s>]/.test(raw);
  const items = [];
  const chunks = raw.split(isAtom ? /<entry[\s>]/ : /<item[\s>]/).slice(1, 26);
  for (const c of chunks) {
    const t = c.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const title = t && t[1] ? decodeEntities(t[1].replace(/<[^>]+>/g, '')).trim() : '';
    let link = '';
    if (isAtom) {
      const l = c.match(/<link[^>]*href=["']([^"']+)["']/);
      link = l && l[1] ? l[1].trim() : '';
    } else {
      const l = c.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
      link = l && l[1] ? l[1].trim() : '';
    }
    if (!title || !link) continue;
    // 2026-07-27 — 구글뉴스 항목의 <source> 태그 = 실제 매체명(디스패치·OSEN…).
    // 이걸 안 읽으면 구글뉴스 피드 전체가 "소스 1개"로 취급돼
    // 교차검증(서로 다른 매체 2개 이상)을 영원히 통과하지 못한다.
    let src = source;
    if (/^GoogleNews/.test(source)) {
      const sm = c.match(/<source[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/source>/);
      const pub = sm && sm[1] ? decodeEntities(sm[1].replace(/<[^>]+>/g, '')).trim() : '';
      if (pub && SYNDICATORS.has(pub.toLowerCase())) continue;
      if (pub) src = pub;
    }
    const d = c.match(isAtom ? /<updated>([\s\S]*?)<\/updated>/ : /<pubDate>([\s\S]*?)<\/pubDate>/);
    const ts = d && d[1] ? Date.parse(d[1]) : NaN;
    items.push({ title, link, source: src, topic, ts: isNaN(ts) ? null : ts });
  }
  return items;
}
// Atom 제목에 흔한 HTML 엔티티 복원 (&amp;#39; 등 이중 인코딩 포함)
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/* 네이버 뉴스 검색 API (2026-07-27 — 도메니코: "네이버가 더 빠를 것 같다").
   한국 언론사들은 기사를 네이버에 직접 밀어 넣으므로(퍼블리셔 제휴), 한국 연예
   속보는 네이버 등장 시점이 사실상 원본 발행과 동시다. 구글뉴스는 로봇이
   돌아다니며 주워 오는 방식이라 몇 분 늦는다 — 그 몇 분을 여기서 줄인다.
   키(NAVER_CLIENT_ID/SECRET)가 없으면 조용히 건너뛴다 — 기존 피드만으로 동작.
   비밀값 입력은 도메니코 몫. 무료 한도 25,000회/일, 이 크론은 4쿼리 × 288회/일 = 1,152회. */
const NAVER_QUERIES = ['아이돌', '배우', '가수', '걸그룹'];
// 붙여넣기 사고 방지 — 앞뒤 공백·개행·따옴표 제거 (2026-07-27 실측 401 대응.
// IG 토큰 사고(6420a74 sanitizeCredential)와 동일 패턴: Vercel env 에 저장된 값이
// 눈에 안 보이는 문자 하나로 통째로 거부당하는 일이 실제로 있었다.)
const _cleanCred = (v) => String(v || '').replace(/[\r\n\t]/g, '').trim().replace(/^["']+|["']+$/g, '').trim();
async function fetchNaverNews() {
  const id = _cleanCred(process.env.NAVER_CLIENT_ID), secret = _cleanCred(process.env.NAVER_CLIENT_SECRET);
  if (!id || !secret) return [];
  if (id !== process.env.NAVER_CLIENT_ID || secret !== process.env.NAVER_CLIENT_SECRET) {
    console.warn('[celeb-watch] naver: 키 값에서 공백/개행/따옴표를 제거하고 사용함');
  }
  const dedup = new Set();
  const out = [];
  const results = await Promise.allSettled(NAVER_QUERIES.map(async (q) => {
    const r = await fetch('https://openapi.naver.com/v1/search/news.json?query='
      + encodeURIComponent(q) + '&display=30&sort=date', {
      headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) {
      // 401 = 키 거부. 값 노출 없이 길이만 남겨 재입력 판단을 돕는다.
      if (r.status === 401) console.warn('[celeb-watch] naver 401 — Vercel 키 재확인 필요 (id ' + id.length + '자 / secret ' + secret.length + '자)');
      throw new Error('naver ' + q + ' ' + r.status);
    }
    return (await r.json()).items || [];
  }));
  for (const r of results) {
    if (r.status !== 'fulfilled') { console.warn('[celeb-watch] naver:', (r.reason && r.reason.message) || r.reason); continue; }
    for (const it of r.value) {
      const link = it.originallink || it.link || '';
      if (!link || dedup.has(link)) continue; // 같은 기사가 여러 쿼리에 걸리는 중복 제거
      dedup.add(link);
      // 네이버는 검색어를 <b>태그로 감싼다 — 태그·엔티티 제거
      const title = decodeEntities(String(it.title || '').replace(/<[^>]+>/g, '')).trim();
      if (!title) continue;
      // 매체 구분 = 원문 도메인 (네이버 API 는 매체명 필드를 안 준다).
      // 서로 다른 도메인 = 서로 다른 매체 → 교차검증에 그대로 쓸 수 있다.
      let src = 'Naver';
      try { src = new URL(link).hostname.replace(/^www\./, ''); } catch (_e) { /* 도메인 파싱 실패 시 통칭 */ }
      const ts = Date.parse(it.pubDate || '');
      out.push({ title, link, source: src, topic: 'kpop', ts: isNaN(ts) ? null : ts });
    }
  }
  return out;
}

const {
  keywords, clusterEvents, clusterCore, sameEvent, hotScore, HOT_MIN,
  titleKey, stripSource, isOffTopic, isOnTarget,
  // 2026-08-05 — 같은 앵커 재탕 가드 + 페퍼릿 태깅
  sameEventRecent, RERUN_WINDOW_MS, pepBlocked, pepCategory, pepScore,
} = require('../_lib/celebDedup');


/* 영문 헤드라인 → 한국어.
   2026-07-21 2차 버그픽스 (도메니코: "영어 기사도 여전히 오고 있어"):
   기존엔 제목 전체에 한글이 하나라도 있으면 번역 대상에서 뺐다. 그런데
   구글뉴스는 제목 끝에 " - 조선일보" 처럼 **매체명을 붙인다**. 그래서
   "BLACKPINK's Jennie Releases New Single - 조선일보" 같은 영문 헤드라인이
   "한국어"로 오판돼 번역 없이 그대로 나갔다. 실측 celeb_watch_seen 의
   영문 알림 대부분이 이 경우였다.
   → 매체명 꼬리를 뗀 본문으로 한글 여부를 판정한다.
   반환: { 원문: 번역문 }. 실패·키 없음이면 빈 객체 → 호출부가 원문으로 폴백. */
const HANGUL_RE = /[가-힣]/;
const LATIN_RE = /[A-Za-z]{3}/;
function needsTranslation(title) {
  const body = stripSource(title);           // " - 조선일보" 제거 후 판정
  if (!LATIN_RE.test(body)) return false;    // 라틴 문자가 없으면 번역할 게 없다
  return !HANGUL_RE.test(body);              // 본문이 한글이면 그대로 둔다
}
async function translateTitles(titles) {
  const targets = [...new Set(titles.filter(t => t && needsTranslation(t)))];
  if (!targets.length || !process.env.ANTHROPIC_API_KEY) return {};
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // 제목 몇 줄만 옮기는 작업이라 가장 싼 모델로 충분하다.
        model: process.env.CELEB_TRANSLATE_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: [
          '뉴스 헤드라인을 한국어로 옮긴다. 속보 알림용이므로 간결하게.',
          '- 아티스트·브랜드명은 한국에서 통용되는 표기로 (BTS, 블랙핑크, 샤넬…).',
          '- 의역하지 말고 헤드라인의 사실만 그대로 옮긴다. 추측·수식 금지.',
          '- 입력 배열과 같은 길이·같은 순서의 JSON 문자열 배열만 출력. 다른 텍스트 금지.',
        ].join('\n'),
        messages: [{ role: 'user', content: JSON.stringify(targets) }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error('translate ' + r.status);
    const j = await r.json();
    const block = Array.isArray(j.content) ? j.content.find(b => b && typeof b.text === 'string') : null;
    const raw = block ? block.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim() : '';
    const arr = JSON.parse(raw.startsWith('[') ? raw : (raw.match(/\[[\s\S]*\]/) || ['[]'])[0]);
    if (!Array.isArray(arr) || arr.length !== targets.length) throw new Error('길이 불일치');
    const map = {};
    targets.forEach((t, i) => { if (typeof arr[i] === 'string' && arr[i].trim()) map[t] = arr[i].trim(); });
    return map;
  } catch (e) {
    console.warn('[celeb-watch] 번역 실패, 원문으로 발송:', (e && e.message) || e);
    return {};
  }
}

module.exports = withCronGuard('celeb-watch', async function handler(req, res) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }

  const dry = !!(req.query && req.query.dry === '1');
  const MAX_PER_RUN = Math.max(1, Math.min(3, parseInt((req.query && req.query.max) || '2', 10) || 2));
  const minScore = parseInt((req.query && req.query.min) || '', 10) || HOT_MIN;

  try {
    /* 1) 수집 — 실패 피드는 건너뜀 */
    const results = await Promise.allSettled([
      ...FEEDS.map(async (f) => {
        const r = await fetch(f.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PAPCelebWatch/1.0)' },
          signal: AbortSignal.timeout(12000),
        });
        if (!r.ok) throw new Error(f.source + ' ' + r.status);
        return parseRss(await r.text(), f.source, f.topic);
      }),
      fetchNaverNews(), // 2026-07-27 — 키 없으면 빈 배열 (조용히 스킵)
    ]);
    let items = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
    if (!items.length) return res.status(200).json({ ok: true, note: '수집 0건' });

    /* 2) 최근 3시간 이내 항목만 (5분 폴링에 맞춰 속보성 강화). 날짜 없으면 통과. */
    const CUTOFF = Date.now() - 3 * 3600 * 1000;
    items = items.filter(i => !i.ts || i.ts >= CUTOFF);

    /* 2-1) 주제 이탈 제거 (2026-07-27 — 도메니코: "셀럽 아닌 정치뉴스 등 제외").
       네이버·연합 소스가 정치·시사·재난 기사를 물어온다. 클러스터링 전에 버려
       교차검증·알림 양쪽에서 아예 배제한다. */
    const beforeTopic = items.length;
    items = items.filter(i => !isOffTopic(i.title));
    // 2026-07-27 도메니코 지시 — "메시지가 너무 많이 오니 케이팝 셀럽 혹은
    // 10~20대 타깃 소식으로 축소". 빼는 필터(isOffTopic)만으로는 중년 배우 예능·
    // 기업 협업·백화점 팝업·e스포츠까지 남아 하루 수십 건이 됐다(실측 24h).
    // 들이는 관문을 걸어 타깃 신호가 있는 소식만 남긴다.
    items = items.filter(i => isOnTarget(i.title));
    const droppedOffTopic = beforeTopic - items.length;

    /* 3) 교차 검증 클러스터링 */
    let clusters = clusterEvents(items);
    if (!clusters.length) return res.status(200).json({ ok: true, note: '교차 확인된 속보 없음', scanned: items.length });

    /* 4) 화제성 필터 — 점수 미달은 조용히 버린다 (알림 스팸 방지) */
    clusters = clusters
      .map(c => Object.assign({}, c, { score: hotScore(c) }))
      .filter(c => c.score >= minScore)
      .sort((a, b) => b.score - a.score);
    if (!clusters.length) return res.status(200).json({ ok: true, note: '화제성 기준 미달', scanned: items.length });

    /* 5) 이미 알린 사건 제외 (2026-07-21 강화).
       도메니코 규칙: "단어나 문장만 바꿔가며 BTS가 출연했다는 기사는 중복이므로
       또 알려줄 필요 없어. 다만 '정호연·BTS 출연'은 정호연이 추가됐으므로 다른 기사."
       → 사건의 정체성은 **등장 요소의 집합**. 새 요소가 추가되면 새 알림을 보낸다.
         ① 시그니처(실체 키워드 집합) 완전 일치
         ② 새 요소가 없는 부분집합 = 표현만 바꾼 재탕
         ③ 같은 실행 안에서 서로 중복인 클러스터 병합 */
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: seen } = await supabaseAdmin.from('celeb_watch_seen')
      .select('signature, title, kw, core, titles, created_at').gte('created_at', since).limit(500);
    const seenRows = seen || [];
    const seenSig = new Set(seenRows.map(s => s.signature));
    /* 최근 6시간 기록만 따로 — 재탕 가드는 시간창을 좁게 둔다.
       넓게 두면 같은 아티스트의 다음 날 새 소식까지 묶일 수 있다. */
    const recentCutoff = Date.now() - RERUN_WINDOW_MS;
    const recentCores = seenRows
      .filter(s => s.created_at && new Date(s.created_at).getTime() >= recentCutoff)
      .map(s => (Array.isArray(s.core) && s.core.length ? s.core
        : (Array.isArray(s.kw) && s.kw.length ? s.kw : keywords(s.title || ''))));
    const seenCores = seenRows.map(s => {
      if (Array.isArray(s.core) && s.core.length) return s.core;
      if (Array.isArray(s.kw) && s.kw.length) return s.kw;
      return keywords(s.title || '');
    });
    /* ⓪ 헤드라인 단위 방어선 (2026-07-21 2차 신설).
       실측: 같은 기사("Watch Burna Boy Link Up With Justin Bieber…")가 5분 간격으로
       6번 알림에 실렸다. 클러스터 core 는 어떤 헤드라인들이 함께 묶이느냐에 따라
       실행마다 달라지지만, **헤드라인 자체는 그대로**다. 그래서 이미 보낸 헤드라인을
       기억해 두고, 클러스터에서 그 헤드라인을 빼버린다. 남는 게 없으면 알림 없음. */
    const seenTitleKeys = new Set();
    for (const s of seenRows) {
      if (Array.isArray(s.titles)) for (const k of s.titles) if (k) seenTitleKeys.add(k);
      if (s.title) seenTitleKeys.add(titleKey(s.title));
    }

    clusters = clusters
      .map(c => {
        const fresh = c.headlines.filter(h => !seenTitleKeys.has(titleKey(h.title)));
        return Object.assign({}, c, { headlines: fresh });
      })
      // 새 헤드라인이 하나도 없으면 이미 다 알린 사건이다 — 조용히 버린다.
      .filter(c => c.headlines.length > 0)
      .filter(c => {
        if (seenSig.has(c.signature)) return false;
        if (seenCores.some(sc => sameEvent(c.core, sc))) return false;
        /* 2026-08-05 5차 — 같은 앵커 · 짧은 시간창 재탕 가드.
           실측: 블랙핑크 × 국립중앙박물관 협업 하나가 5시간에 걸쳐 6번 나갔다.
           매체마다 어휘가 달라(굿즈/컬렉션/헤리티지 · 국중박/국립박물관) 겹침이
           2~3개에 그치고 새 단어가 2개 이상 붙어 매번 '사건 확장'으로 빠져나갔다.
           → 최근 6시간 안에 같은 앵커로 알린 사건과 실체어가 2개 이상 겹치면 재탕. */
        return !recentCores.some(sc => sameEventRecent(c.core, sc));
      });
    if (!clusters.length) return res.status(200).json({ ok: true, note: '신규 속보 없음 (이미 알림)', scanned: items.length });

    // ③ 같은 실행 안에서의 중복 제거 — 클러스터링이 놓친 같은 사건을 한 번 더 접는다.
    const picked = [];
    for (const c of clusters) {
      if (!picked.some(p => sameEvent(c.core, p.core) || sameEvent(p.core, c.core))) picked.push(c);
      if (picked.length >= MAX_PER_RUN) break;
    }
    if (dry) {
      return res.status(200).json({ ok: true, dry: true, scanned: items.length, dropped_offtopic: droppedOffTopic,
        picked: picked.map(c => ({ score: c.score, sources: c.sourceCount, topic: c.topic,
          headlines: c.headlines.map(h => h.source + ': ' + h.title) })) });
    }

    /* 6) 중복 방지 기록 먼저 — 알림 실패해도 재시도 폭주를 막는다 */
    for (const c of picked) {
      try {
        await supabaseAdmin.from('celeb_watch_seen').insert({
          signature: c.signature,
          title: c.headlines[0].title,
          kw: c.kw,      // 참고용 전체 키워드
          core: c.core,  // 다음 실행의 중복 판정 근거 (사건의 등장 요소)
          // 이번에 실제로 보낸 헤드라인들의 지문 — 다음 실행에서 같은 기사를 뺀다.
          titles: c.headlines.map(h => titleKey(h.title)),
          topic: c.topic,
          source_count: c.sourceCount,
          score: c.score,
          alerted: true,
          /* 페퍼릿 태깅 (2026-08-05 도메니코 지시).
             PAP 본지는 종전대로 전부 알림받는다 — 여기서는 **빼지 않고 표시만** 한다.
             페퍼릿 예약작업이 `where pep_blocked=false and pep_category is not null
             order by pep_score desc` 로 자기 몫만 골라 간다. */
          pep_blocked: pepBlocked(c.headlines[0].title),
          pep_category: pepCategory(c.headlines[0].title),
          pep_score: pepScore(c.headlines[0].title, c.score),
        });
      } catch (e) { console.warn('[celeb-watch] seen 기록 실패:', (e && e.message) || e); }
    }

    /* 7) 한국어 번역 (도메니코 2026-07-21: "영어 기사는 한글로 번역해서 알려줘야 해").
       감시 소스 대부분이 영문(Soompi·Billboard·WWD·Reddit)이라 새벽에 영문
       헤드라인만 오면 판단이 느려진다. 알림 직전에 제목만 번역한다 —
       본문 생성이 아니라 제목 몇 줄이므로 비용·지연이 작다.
       실패하면 원문 그대로 보낸다 (알림을 놓치는 것이 최악). */
    const toTranslate = [];
    for (const c of picked) for (const h of c.headlines.slice(0, 4)) toTranslate.push(h);
    const koMap = await translateTitles(toTranslate.map(h => h.title));
    // 원문을 보여줄 때도 HTML 엔티티·매체명 꼬리를 정리해서 읽기 좋게.
    const ko = (t) => {
      const v = koMap[t];
      return v && v !== t ? `${v}\n   (${stripSource(t)})` : stripSource(t);
    };

    /* 도메니코 원칙1 (2026-07-27): "한 메시지당 하나의 소식만 전달할 것."
       이전에는 1등 사건 + "외 N건" + 부록 목록을 한 메시지에 묶었다 → 사건별로
       메시지를 분리해 각자 원문 링크를 단다. MAX_PER_RUN(기본 2)이 상한. */
    const pushResults = [];
    for (const c of picked) {
      const t0 = c.headlines[0].title;
      const cKo = koMap[t0] || stripSource(t0);
      const pushResult = await pushAlert({
        title: `🚨 PAP 속보 감지 — ${cKo}`,
        lines: [
          `${c.sourceCount}개 매체 교차 확인 · 화제성 ${c.score}점 · ${c.topic}`,
          ...c.headlines.slice(0, 4).map(h => `· ${h.source}: ${ko(h.title)}`),
          '',
          '기사화할지는 직접 판단하세요.',
        ].filter((l, i, a) => !(l === '' && a[i - 1] === '')),
        url: c.headlines[0].link,
        urlLabel: '원문 보기',
      });
      pushResults.push(pushResult);
      console.log('[celeb-watch] push:', JSON.stringify(pushResult));
    }

    return res.status(200).json({
      ok: true, scanned: items.length, alerted: picked.length,
      titles: picked.map(c => c.headlines[0].title), push: pushResults,
    });
  } catch (err) {
    console.error('[celeb-watch] error:', err);
    throw err;
  }
});
