/**
 * PAP Magazine — 주간 뉴스 캠페인 자동 생성·자동 발송 크론
 * Route: /api/cron/weekly-news  (vercel.json: 일 21:30 UTC = 월 06:30 KST)
 *
 * 기존에는 Cowork 스케줄 태스크가 뉴스를 큐레이션해 /api/admin/campaigns/seed로
 * 드래프트를 만들고 관리자가 수동 예약했지만, 대표 지시(2026-07)로 검토 단계
 * 없이 전자동 발송으로 전환. 태스크 환경의 네트워크 차단 문제도 있어
 * 파이프라인 전체를 서버(Vercel) 안으로 옮겼다:
 *
 *   1. 패션·아트·뷰티 매체 RSS에서 지난 주 헤드라인 수집 (trend-scout 파서 재사용)
 *   2. Claude가 10건 큐레이션(아트/컬쳐 3 · 패션 3 · 뷰티 2 · 셀럽 2)
 *      + 한국어 마스터(제목·3-4문장 요약·캠페인 필드) 작성
 *   3. Claude 병렬 호출로 8개 로케일(en/it/fr/es/ja/zh/ru/de) 번역
 *      — 일부 로케일 실패는 허용: 템플릿 pickI18nForWeekly()가 en으로 폴백
 *   4. email_campaigns에 status='scheduled'로 INSERT,
 *      scheduled_at = 당일 23:00 UTC (= 월요일 08:00 KST)
 *      → 매시 도는 send-due-campaigns가 그 시각에 전 회원 발송
 *
 * 멱등성: 같은 주(name = news-weekly-<일요일 KST 날짜>)에 이미 캠페인이
 * 있으면 재생성하지 않는다 (크론 재시도/수동 트리거 안전).
 * 수동 트리거: 관리자 토큰 POST 허용.
 */

const papVoice = require('../_lib/papVoice');
const { withCronGuard } = require('../_lib/cronGuard');   // 실행기록·실패알림 (2026-08-07)

const { reportAiResponse } = require('../_lib/aiCreditWatch');   // AI 장애 알림 (2026-07-30)
const { supabaseAdmin } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');

const FEEDS = [
  { source: 'Vogue', url: 'https://www.vogue.com/feed/rss' },
  { source: 'Hypebeast', url: 'https://hypebeast.com/feed' },
  { source: 'Dazed', url: 'https://www.dazeddigital.com/rss' },
  { source: 'WWD', url: 'https://wwd.com/feed/' },
  { source: 'ARTnews', url: 'https://www.artnews.com/feed/' },
  { source: 'Hyperallergic', url: 'https://hyperallergic.com/feed/' },
  { source: 'Allure', url: 'https://www.allure.com/feed/rss' },
];

const LOCALES = ['en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];
const LOCALE_NAMES = {
  en: 'English', it: 'Italian (Italiano)', fr: 'French (Français)',
  es: 'Spanish (Español)', ja: 'Japanese (日本語)', zh: 'Simplified Chinese (简体中文)',
  ru: 'Russian (Русский)', de: 'German (Deutsch)',
};

// trend-scout와 동일한 의존성 없는 최소 RSS 파서
function parseRss(xml, source) {
  const items = [];
  const chunks = String(xml).split(/<item[\s>]/).slice(1, 16);
  for (const c of chunks) {
    const t = c.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const l = c.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
    const d = c.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    const title = t && t[1] ? t[1].replace(/<[^>]+>/g, '').trim() : '';
    const link = l && l[1] ? l[1].trim() : '';
    const desc = d && d[1] ? d[1].replace(/<[^>]+>/g, '').trim().slice(0, 200) : '';
    if (title && link) items.push({ title, link, source, desc });
  }
  return items;
}

async function claude(system, userContent, maxTokens, timeoutMs) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) { await reportAiResponse(resp, 'weekly-news'); throw new Error('Claude ' + resp.status); }
  const j = await resp.json();
  const block = Array.isArray(j.content) ? j.content.find((b) => b && typeof b.text === 'string') : null;
  if (!block) throw new Error('Claude 응답에 텍스트 블록 없음');
  const m = block.text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude 응답에서 JSON을 찾지 못함');
  return JSON.parse(m[0]);
}

const MASTER_SYSTEM = [
  'PAP 매거진(아트 기반 패션·뷰티·컬쳐 디지털 매거진, IG @pap_magazine 38만)의 주간 뉴스레터 에디터.',
  '입력: 지난 주 매체 헤드라인 목록 [{title, link, source, desc}].',
  '임무: 지난 7일 내 소식 중 10건을 골라 한국어 주간 브리핑을 작성한다.',
  '구성: 아트/컬쳐 3건, 패션 3건, 뷰티 2건, 셀럽 2건 안팎의 균형. 오래되거나 시시한 항목, 단순 커머스·실적 뉴스는 제외.',
  '각 항목 summary는 한국어 3-4문장(150-250자): ① 무슨 일이 있었나 ② 어디서/누가/어떻게 ③ PAP 독자(디자이너·아트 감도 높은 20-30대)에게 왜 의미 있는가.',
  '톤: 차분하고 에디토리얼하게. 감탄사·해시태그·과장 금지. 제목/요약에 출처 매체명 금지, 날짜 표기 금지.',
  '',
  papVoice.KO_MICRO,
  '',
  '캠페인 필드: subject("PAP 이주의 뉴스 — <영문 월 일>"), preheader(받은편지함 미리보기 1줄), hero_headline("PAP WEEKLY BRIEFING"), hero_body(1-2문장 에디터 코멘트).',
  'JSON만 출력 (다른 텍스트 절대 금지):',
  '{"subject":"...","preheader":"...","hero_headline":"...","hero_body":"...","newsItems":[{"title":"한국어 12-30자","summary":"한국어 3-4문장","category":"ART|FASHION|BEAUTY|CELEB|CULTURE","url":"원문 링크","image":""}, ...10개]}',
].join('\n');

function translateSystem(locale) {
  return [
    'You are the localization editor of PAP Magazine (art-driven fashion/beauty/culture).',
    `Translate the given Korean weekly-newsletter JSON into ${LOCALE_NAMES[locale]}.`,
    'Rules: keep proper nouns (brands, designers, exhibition titles) canonical — never transliterate Western brands into other scripts.',
    'Editorial magazine tone (Vogue/Monocle register, never tabloid). Each summary stays 3-4 natural sentences.',
    'Keep "category" values in English EXACTLY as given. Keep "url" and "image" EXACTLY as given.',
    'Translate: subject, preheader, hero_body, and each item title + summary. hero_headline stays "PAP WEEKLY BRIEFING".',
    'Output ONLY the translated JSON with the identical structure. No other text.',
  ].join('\n');
}

/* 실행 기록·실패 알림 (2026-08-07 추가).
 *
 * 이게 없어서 뉴스레터가 3주 조용히 멈춰 있었다. 실측:
 *     캠페인 생성일  5/12 · 5/26 · 6/02 · 6/29 · 7/06 · 7/19  → 그 뒤 없음
 *     cron_runs 의 weekly-news 기록  **0건**
 * 7/30 크론 관측성 감사(a4e13c1)가 12개를 훑었는데 이 크론은 감싼 5개에도,
 * 남긴 7개에도 없었다. 그래서 "언제부터 안 돌았는지"조차 알 수 없었다.
 * 매주 일요일에만 도는 크론은 특히 이게 치명적이다 — 한 번 놓치면 일주일이다.
 */
function note(res, msg) {
  res.locals = res.locals || {};
  res.locals.cronNote = msg;
  return msg;
}

/* ─── 시간 예산 (2026-08-10 신설) ─────────────────────────────────────
 *
 * 이 크론은 2026-07-06 등록 이후 **34일간 한 번도 성공한 적이 없다.**
 * cron_runs 기록이 0건이라 아무도 몰랐다. Vercel 런타임 로그의 실제 모습:
 *     GET /api/cron/weekly-news 504
 *     Vercel Runtime Timeout Error: Task timed out after 120 seconds
 *
 * 산수를 해 보면 애초에 들어갈 수가 없었다:
 *     RSS 수집        15초
 *     마스터 큐레이션  최대 90초
 *     8개 로케일 번역  최대 90초 (병렬이라 벽시계로 90초)
 *     ─────────────────────
 *     합계            최대 195초   >   함수 상한 120초
 * 최선의 경우(마스터 60 + 번역 60)라도 135초라 넘는다. 구조적으로 불가능했다.
 *
 * 두 가지를 함께 고친다:
 *   ① vercel.json 에서 이 경로만 maxDuration 300 으로 (Pro 는 허용)
 *   ② 그래도 예산을 둔다 — 상한을 올려도 '넘으면 통째로 죽는' 성질은 그대로다.
 *      남은 시간에 맞춰 각 호출의 타임아웃을 깎고, 모자라면 죽는 대신
 *      이유를 남기고 끝낸다. 다음 주 실행이 다시 시도한다. */
const BUDGET_MS = Number(process.env.WEEKLY_NEWS_BUDGET_MS || 260000);
const SLACK_MS = 20000;   // 응답·DB 쓰기·cronGuard 기록 몫

module.exports = withCronGuard('weekly-news', async function handler(req, res) {
  const started = Date.now();
  const msLeft = () => BUDGET_MS - (Date.now() - started);
  const auth = (req.headers && req.headers['authorization']) || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  if (!cronOk) {
    const user = await requireAdmin(req, res);
    if (!user) return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY 미설정', note: note(res, 'ANTHROPIC_API_KEY 미설정 — 뉴스레터 생성 불가') });
  }

  try {
    // 0) 멱등성 — 이번 주 캠페인이 이미 있으면 종료
    const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const dowKst = kstNow.getUTCDay();
    // 이번 주 브리핑의 기준일 = 직전(또는 당일) 일요일 KST
    const sunday = new Date(kstNow.getTime() - dowKst * 86400000).toISOString().slice(0, 10);
    const name = 'news-weekly-' + sunday;
    const { data: existing } = await supabaseAdmin
      .from('email_campaigns').select('id, status').eq('name', name).maybeSingle();
    if (existing) {
      return res.status(200).json({
        ok: true, campaign: existing,
        note: note(res, '이번 주 캠페인 이미 있음 (' + name + ' · ' + existing.status + ')'
          + (existing.status === 'draft' ? ' ⚠️ draft 라 발송되지 않는다' : '')),
      });
    }

    // 1) RSS 수집 (부분 실패 허용)
    const results = await Promise.allSettled(FEEDS.map(async (f) => {
      const r = await fetch(f.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PAPWeeklyNews/1.0)' },
        signal: AbortSignal.timeout(Math.max(5000, Math.min(15000, msLeft() - SLACK_MS))),
      });
      if (!r.ok) throw new Error(f.source + ' ' + r.status);
      return parseRss(await r.text(), f.source);
    }));
    const headlines = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    if (headlines.length < 10) {
      return res.status(502).json({
        error: 'RSS 수집 부족: ' + headlines.length + '건',
        note: note(res, 'RSS 수집 부족 — ' + headlines.length + '건뿐이라 이번 주 뉴스레터를 못 만든다'),
      });
    }

    // 2) 한국어 마스터 큐레이션
    /* 번역 몫(최소 90초)과 마무리 여유를 남기고 남은 만큼만 쓴다. */
    const masterMs = Math.min(90000, msLeft() - 90000 - SLACK_MS);
    if (masterMs < 20000) {
      return res.status(200).json({
        ok: true, skipped: 'budget',
        note: note(res, '시간 부족으로 마스터 큐레이션 생략 (남은 ' + Math.round(msLeft() / 1000) + '초) — 다음 실행이 재시도'),
      });
    }
    const master = await claude(MASTER_SYSTEM, JSON.stringify(headlines), 6000, masterMs);
    if (!Array.isArray(master.newsItems) || master.newsItems.length < 10 || !master.subject) {
      throw new Error('마스터 큐레이션 검증 실패 (items=' + (master.newsItems || []).length + ')');
    }
    master.newsItems = master.newsItems.slice(0, 10).map((n) => ({
      title: String(n.title || ''), summary: String(n.summary || ''),
      category: String(n.category || 'CULTURE'), url: String(n.url || ''), image: '',
    }));
    // 2026-08-03 — KO_MICRO 가 평서체에서 존댓말로 바뀐 채널이라 회귀가 여기서 먼저 보인다.
    // 로그만 남기고 발행은 막지 않는다. 번역본은 한국어 규격 대상이 아니므로 제외.
    papVoice.auditKoreanBody(
      master.newsItems.map((n) => n.summary).join('\n\n'),
      { style: 'polite', structure: false, where: 'newsletter' });

    // 3) 8개 로케일 병렬 번역 — 실패 로케일은 건너뜀 (템플릿이 en 폴백)
    const masterJson = JSON.stringify(master);
    const transMs = Math.max(20000, Math.min(90000, msLeft() - SLACK_MS));
    const translations = await Promise.allSettled(
      LOCALES.map((loc) => claude(translateSystem(loc), masterJson, 6000, transMs))
    );
    const i18n = { ko: master };
    const failed = [];
    LOCALES.forEach((loc, i) => {
      const t = translations[i];
      if (t.status === 'fulfilled' && Array.isArray(t.value.newsItems) && t.value.newsItems.length === 10) {
        // url/image/category는 마스터 값으로 강제 — 번역 드리프트 방지
        t.value.newsItems = t.value.newsItems.map((n, idx) => ({
          title: String(n.title || ''), summary: String(n.summary || ''),
          category: master.newsItems[idx].category,
          url: master.newsItems[idx].url, image: '',
        }));
        i18n[loc] = t.value;
      } else {
        failed.push(loc);
      }
    });
    // en 실패는 전체 폴백 체계를 무너뜨리므로 치명 처리
    if (!i18n.en) throw new Error('영어 번역 실패 — 발송 중단 (실패 로케일: ' + failed.join(',') + ')');

    // 4) scheduled_at = 당일 23:00 UTC (= 월요일 08:00 KST)
    const sched = new Date();
    sched.setUTCHours(23, 0, 0, 0);
    if (sched.getTime() <= Date.now()) sched.setTime(sched.getTime() + 86400000);
    const headerDate = new Date(Date.now() + 9 * 3600 * 1000).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });

    const row = {
      name,
      type: 'news-weekly',
      subject: master.subject.slice(0, 200),
      preheader: (master.preheader || '').slice(0, 200) || null,
      hero_headline: (master.hero_headline || 'PAP WEEKLY BRIEFING').slice(0, 200),
      hero_body: (master.hero_body || '').slice(0, 2000) || null,
      payload: {
        issueLabel: 'Weekly Briefing',
        headerDate,
        newsItems: master.newsItems,
        i18n,
      },
      status: 'scheduled',          // 대표 지시(2026-07): 검토 없이 자동 발송
      scheduled_at: sched.toISOString(),
      created_by: null,
    };
    const { data, error } = await supabaseAdmin
      .from('email_campaigns').insert(row).select('id, name, status, scheduled_at').single();
    if (error) throw error;

    return res.status(201).json({
      ok: true, campaign: data,
      note: note(res, '주간 뉴스레터 생성: ' + data.name + ' · ' + data.status
        + ' · 발송예정 ' + String(data.scheduled_at || '').slice(0, 16)),
      locales: Object.keys(i18n), failedLocales: failed,
      headlines: master.newsItems.map((n) => n.title),
    });
  } catch (err) {
    console.error('[cron/weekly-news]', err.message || err);
    const m = String(err && err.message || err).slice(0, 200);
    return res.status(500).json({ error: m, note: note(res, '주간 뉴스레터 생성 실패: ' + m) });
  }
});
