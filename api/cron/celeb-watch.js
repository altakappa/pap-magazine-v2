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
  { source: 'GoogleNews-KPOP-KR', topic: 'kpop',
    url: 'https://news.google.com/rss/search?q=(%EB%B0%A9%ED%83%84%EC%86%8C%EB%85%84%EB%8B%A8+OR+%EB%B8%94%EB%9E%99%ED%95%91%ED%81%AC+OR+%EC%BC%80%EC%9D%B4%ED%8C%9D)+when:1h&hl=ko&gl=KR&ceid=KR:ko' },
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
    const d = c.match(isAtom ? /<updated>([\s\S]*?)<\/updated>/ : /<pubDate>([\s\S]*?)<\/pubDate>/);
    const ts = d && d[1] ? Date.parse(d[1]) : NaN;
    items.push({ title, link, source, topic, ts: isNaN(ts) ? null : ts });
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

const {
  keywords, clusterEvents, clusterCore, sameEvent, hotScore, HOT_MIN,
} = require('../_lib/celebDedup');


/* 영문 헤드라인 → 한국어. 이미 한국어인 제목은 건드리지 않는다.
   반환: { 원문: 번역문 }. 실패·키 없음이면 빈 객체 → 호출부가 원문으로 폴백. */
const HANGUL_RE = /[가-힣]/;
async function translateTitles(titles) {
  const targets = [...new Set(titles.filter(t => t && !HANGUL_RE.test(t)))];
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
    const results = await Promise.allSettled(FEEDS.map(async (f) => {
      const r = await fetch(f.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PAPCelebWatch/1.0)' },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(f.source + ' ' + r.status);
      return parseRss(await r.text(), f.source, f.topic);
    }));
    let items = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
    if (!items.length) return res.status(200).json({ ok: true, note: '수집 0건' });

    /* 2) 최근 3시간 이내 항목만 (5분 폴링에 맞춰 속보성 강화). 날짜 없으면 통과. */
    const CUTOFF = Date.now() - 3 * 3600 * 1000;
    items = items.filter(i => !i.ts || i.ts >= CUTOFF);

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
      .select('signature, title, kw, core, created_at').gte('created_at', since).limit(500);
    const seenRows = seen || [];
    const seenSig = new Set(seenRows.map(s => s.signature));
    const seenCores = seenRows.map(s => {
      if (Array.isArray(s.core) && s.core.length) return s.core;
      if (Array.isArray(s.kw) && s.kw.length) return s.kw;
      return keywords(s.title || '');
    });

    clusters = clusters.filter(c => {
      if (seenSig.has(c.signature)) return false;
      return !seenCores.some(sc => sameEvent(c.core, sc));
    });
    if (!clusters.length) return res.status(200).json({ ok: true, note: '신규 속보 없음 (이미 알림)', scanned: items.length });

    // ③ 같은 실행 안에서의 중복 제거 — 클러스터링이 놓친 같은 사건을 한 번 더 접는다.
    const picked = [];
    for (const c of clusters) {
      if (!picked.some(p => sameEvent(c.core, p.core) || sameEvent(p.core, c.core))) picked.push(c);
      if (picked.length >= MAX_PER_RUN) break;
    }
    if (dry) {
      return res.status(200).json({ ok: true, dry: true, scanned: items.length,
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
          topic: c.topic,
          source_count: c.sourceCount,
          score: c.score,
          alerted: true,
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
    const ko = (t) => {
      const v = koMap[t];
      return v && v !== t ? `${v}\n   (${t})` : t;
    };

    const top = picked[0];
    const more = picked.length > 1 ? ` 외 ${picked.length - 1}건` : '';
    const topKo = koMap[top.headlines[0].title] || top.headlines[0].title;
    const pushResult = await pushAlert({
      title: `🚨 PAP 속보 감지 — ${topKo}${more}`,
      lines: [
        `${top.sourceCount}개 매체 교차 확인 · 화제성 ${top.score}점 · ${top.topic}`,
        ...top.headlines.slice(0, 4).map(h => `· ${h.source}: ${ko(h.title)}`),
        '',
        ...picked.slice(1).map(c => {
          const t = c.headlines[0].title;
          return `▸ ${koMap[t] || t} (${c.sourceCount}개 매체)`;
        }),
        '',
        '기사화할지는 직접 판단하세요.',
      ].filter((l, i, a) => !(l === '' && a[i - 1] === '')),
      url: top.headlines[0].link,
      urlLabel: '원문 보기',
    });
    console.log('[celeb-watch] push:', JSON.stringify(pushResult));

    return res.status(200).json({
      ok: true, scanned: items.length, alerted: picked.length,
      titles: picked.map(c => c.headlines[0].title), push: pushResult,
    });
  } catch (err) {
    console.error('[celeb-watch] error:', err);
    throw err;
  }
});
