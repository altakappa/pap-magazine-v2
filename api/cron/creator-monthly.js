/**
 * GET /api/cron/creator-monthly
 *
 * 2026-09-24 도메니코 "세 조각 설정해줘" ③ — 월간 크리에이터 소식 **초안**을 만든다.
 *
 * [왜] 승인된 크리에이터 85명 중 63명이 승인 뒤 PAP 메일을 한 통도 못 받았다.
 *   주간 뉴스는 독자용 외부 뉴스라 크리에이터가 다음 촬영을 떠올릴 이유가 없다.
 *   미용실의 "이번 달 신메뉴" 자리: 지난달 실린 크리에이터 화보 + 인스타 도달 합계 +
 *   이달의 테마(도메니코가 한 줄) + 다음 화보·풀레터 동선.
 *
 * [무엇을 하나] 매월 1일 01:00 UTC 에 지난달 크리에이터 화보(editorials.source_submission_id)를
 *   모아 email_campaigns 에 type='creator-monthly', status='draft' 로 넣는다.
 *   **보내지 않는다.** 메일 전송은 도메니코 결정이다(볼트 작업 규칙). 관리자 > 캠페인에서
 *   헤드라인·본문 칸에 '이달의 테마'를 쓰고(비우면 테마 블록이 빠진다) 예약하면
 *   send-due-campaigns 가 payload.audience='creators'(승인 크리에이터 ∩ 수신 동의)에게 보낸다.
 *
 * [테마 후보] 도메니코 2026-09-24 "우리 키워드로 항상 추천해 줘, 고르는 건 나" +
 *   "기본 키워드는 항상 드리미·서리얼리즘·스토리텔링·크리에이티비티, 최신 트렌드와 맞춰서, 포괄적으로".
 *   초안을 만들 때 _lib/creatorTheme.js 가 기본 키워드 4개 + 트렌드 신호로
 *   테마 후보 3개를 9개 언어로 만들어 payload.theme_candidates 에 넣고 텔레그램에도 보낸다.
 *   관리자 편집기에서 하나를 누르면 payload.theme 이 된다. AI 가 실패해도 고정 후보 3개.
 * [멱등] name = creator-monthly-YYYY-MM 이 이미 있으면 새로 만들지 않는다.
 * [수동] 관리자 토큰으로 ?month=YYYY-MM 을 주면 그 달 초안을 만든다(이미 있으면 그대로).
 */
'use strict';
const { safeEqual } = require('../_lib/secretCompare');
const { supabaseAdmin } = require('../_lib/supabase');
const { handleCors } = require('../_lib/cors');
const { withCronGuard, reportProduction } = require('../_lib/cronGuard');
const { sendTextToTelegramSafe } = require('../_lib/telegram');
const { requireAdmin } = require('../_lib/auth');
const R = require('../_lib/creatorReport');
const T = require('../_lib/creatorTheme');   // 2026-09-24 이달의 테마 후보 3개 (브랜드 키워드 기반)

const CRON_NAME = 'creator-monthly';

module.exports = withCronGuard(CRON_NAME, async function handler(req, res) {
  if (handleCors(req, res)) return;
  res.locals = res.locals || {};

  let range = null;
  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (req.query && req.query.month) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    range = R.monthRange(String(req.query.month));
    if (!range) return res.status(400).json({ message: 'month must be YYYY-MM' });
  } else {
    if (!expected) return res.status(500).json({ message: 'CRON_SECRET not configured' });
    if (!safeEqual(got, expected)) return res.status(401).json({ message: 'Unauthorized' });
    range = R.previousMonth(Date.now());
  }

  const name = 'creator-monthly-' + range.key;
  try {
    const { data: existing } = await supabaseAdmin.from('email_campaigns').select('id, status').eq('name', name).maybeSingle();
    if (existing) {
      res.locals.cronNote = '이미 있음 · ' + name + ' (' + existing.status + ')';
      return res.status(200).json({ ok: true, existing: true, id: existing.id, status: existing.status });
    }

    const { data: eds, error } = await supabaseAdmin.from('editorials')
      .select('id, slug, title, title_en, cover_image, thumbnail, published_date, tags')
      .eq('status', 'published').not('source_submission_id', 'is', null)
      .gte('published_date', range.start).lt('published_date', range.end)
      .order('published_date', { ascending: true }).limit(200);
    if (error) throw error;
    const ids = (eds || []).map((e) => e.id);
    const igById = {};
    if (ids.length) {
      const { data: igRows } = await supabaseAdmin.from('ig_post_latest')
        .select('editorial_id, reach, like_count, saved, shares, captured_at').in('editorial_id', ids);
      const grouped = {};
      for (const r of (igRows || [])) (grouped[r.editorial_id] = grouped[r.editorial_id] || []).push(r);
      for (const id of Object.keys(grouped)) igById[id] = R.pickIgMetrics(grouped[id]);
    }
    const payload = R.buildMonthlyPayload(range.key, (eds || []).map((e) => Object.assign({}, e, { ig: igById[e.id] || null })));

    /* 이달의 테마 후보 3개 (도메니코 2026-09-24: 기본 키워드 DREAMY·SURREALISM·STORYTELLING·
       CREATIVITY 고정 + 최신 트렌드, 후보는 포괄적으로, 고르는 건 도메니코).
       테마는 소식이 나가는 달(지난달의 다음 달)의 촬영용이다. 트렌드 신호는 매체 RSS 헤드라인과
       trend_reports 30일 키워드. AI 가 실패해도 고정 후보 3개. 고르지 않으면 테마 블록 없이 나간다. */
    const themeMonth = T.nextMonthKey(range.key);
    const context = (eds || []).slice(0, 40).map((e) => e.title + (Array.isArray(e.tags) && e.tags.length ? ' [' + e.tags.slice(0, 5).join(', ') + ']' : '')).join(' / ');
    const trends = await T.gatherTrendSignals({ supabase: supabaseAdmin });
    const theme = await T.generateThemeCandidates(themeMonth, context, { trends });
    payload.theme_month = themeMonth;
    payload.theme_keywords = T.keywordsForMonth(themeMonth);
    payload.theme_trend_counts = { headlines: trends.headlines.length, keywords: trends.keywords.length };
    payload.theme_candidates = theme.candidates;
    payload.theme_note = theme.note;

    const { data: row, error: insErr } = await supabaseAdmin.from('email_campaigns').insert({
      name,
      type: 'creator-monthly',
      subject: 'PAP 크리에이터 소식 · ' + range.key,   // 관리 라벨. 실제 제목은 수신자 언어로 템플릿이 만든다.
      preheader: '',
      hero_headline: '',
      hero_body: '',
      payload,
      status: 'draft',
    }).select('id').single();
    if (insErr) throw insErr;

    await sendTextToTelegramSafe('📰 월간 크리에이터 소식 초안 준비 (' + range.key + ')\n'
      + '화보 ' + payload.totals.n + '편 · 인스타 도달 합계 ' + R.fmtNum(payload.totals.reach) + ' · 카드 ' + payload.items.length + '개\n'
      + '이달의 테마 후보 (' + payload.theme_keywords.join(' · ') + ', ' + theme.note + ')\n'
      + theme.candidates.map((c, i) => (i + 1) + '. ' + c.i18n.ko.title + ' : ' + c.i18n.ko.body + (c.trend ? '\n   (읽은 흐름: ' + c.trend + ')' : '')).join('\n') + '\n'
      + '관리자 > 캠페인 > 편집에서 후보 버튼을 누르거나 직접 쓰고 예약하세요. 고르지 않으면 테마 블록 없이 나갑니다.\n'
      + '받는 사람: 승인된 크리에이터 중 이메일 수신 동의자.');
    const note = '초안 ' + name + ' · 화보 ' + payload.totals.n + ' · 도달 ' + payload.totals.reach + ' · 테마 ' + theme.note;
    res.locals.cronNote = note;
    reportProduction(res, { produced: 1, remaining: 0, note });
    return res.status(200).json({ ok: true, id: row.id, name, totals: payload.totals, items: payload.items.length });
  } catch (err) {
    console.error('[cron/' + CRON_NAME + '] failed:', err && err.message);
    return res.status(500).json({ message: 'creator monthly draft failed', error: err && err.message });
  }
});
