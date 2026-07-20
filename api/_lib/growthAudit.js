/**
 * PAP Magazine — 성장 데이터 정밀 감사 코어
 *
 * 사용처:
 *   • GET /api/growth-audit        — 공개 집계 JSON (주간 성장 위원회 데이터 소스)
 *   • /api/cron/daily-growth-feedback — 매일 아침 이 결과에 Claude 분석을 붙여
 *     growth_reports 테이블에 저장 → /site-analysis 대시보드가 표시
 *
 * 검증 5개 영역 × 20여 항목. 각 항목:
 *   { id, label, value, compare?, status: ok|warn|fail|error, note?, items? }
 * items = 문제가 있는 실제 콘텐츠 제목 목록(최대 5). 개인정보 없음.
 *
 * ⚠️ 쿼리 패턴: supabase-js 는 .select() 를 이중 호출하면 count 옵션이
 * 무시된다 (2026-07-06 '가입자 0' 버그의 원인 — 실제 548명). 반드시
 * .select('*', CSEL) 한 번만 걸고 그 뒤에 필터를 체이닝할 것.
 */

const { supabaseAdmin } = require('./supabase');
const { listRecentMedia } = require('./instagramImport');

const DAY = 24 * 3600 * 1000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const CSEL = { count: 'exact', head: true };

/** count 쿼리 실행 — q 는 이미 .select('*', CSEL) 이 걸린 빌더 */
async function cnt(q) {
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

/** 문제 항목의 제목 샘플 — q 는 이미 .select('title') 이 걸린 빌더 */
async function titles(q, n = 5) {
  const { data, error } = await q.limit(n);
  if (error) return [];
  return (data || []).map((r) => r.title).filter(Boolean);
}

async function check(id, label, fn) {
  try {
    const r = await fn();
    return { id, label, ...r };
  } catch (err) {
    return { id, label, status: 'error', note: String(err && err.message || err).slice(0, 120) };
  }
}

async function runGrowthAudit() {
  const db = supabaseAdmin;
  const sections = {};

  // ── A. 콘텐츠 무결성 ──────────────────────────────────────────
  // 065: legacy(IG 시절 대량 임포트) 에디토리얼은 무결성 검사에서 제외 —
  // 설명·EN 번역이 없는 게 정상이라 경보만 오염시킨다.
  const missing = (col, label, failOver) =>
    check(`editorials_missing_${col}`, label, async () => {
      const v = await cnt(db.from('editorials').select('*', CSEL).eq('status', 'published').eq('legacy', false).is(col, null));
      const items = v > 0
        ? await titles(db.from('editorials').select('title').eq('status', 'published').eq('legacy', false).is(col, null))
        : [];
      const status = v === 0 ? 'ok' : (failOver && v > failOver) ? 'fail' : 'warn';
      return { value: v, status, items };
    });

  sections.content = await Promise.all([
    check('editorials_published', '발행 에디토리얼 수', async () => ({
      value: await cnt(db.from('editorials').select('*', CSEL).eq('status', 'published')), status: 'ok',
    })),
    missing('slug', '슬러그 없는 에디토리얼 (클린 URL·SEO 불가)'),
    missing('description', '한글 설명 없는 에디토리얼 (검색 스니펫 손실)'),
    missing('description_en', '영문 설명 없는 에디토리얼 (글로벌 SEO 손실)'),
    missing('cover_image', '커버 이미지 없는 에디토리얼'),
    missing('source_instagram_url', '원본 IG 링크 없는 에디토리얼 (좋아요·저장 깔때기 비활성)', 10),
    check('films_missing_youtube', '유튜브 ID 없는 발행 필름 (재생 불가)', async () => {
      const v = await cnt(db.from('films').select('*', CSEL).eq('status', 'published').is('youtube_id', null));
      const items = v > 0
        ? await titles(db.from('films').select('title').eq('status', 'published').is('youtube_id', null))
        : [];
      return { value: v, status: v === 0 ? 'ok' : 'fail', items };
    }),
    check('brands_linked', '브랜드 허브 연결 수 (파트너 SEO 표면)', async () => ({
      value: await cnt(db.from('editorial_brands').select('*', CSEL)), status: 'ok',
    })),
  ]);

  // ── B. 발행 페이스 ────────────────────────────────────────────
  const pace = (table, label, weeklyTarget) =>
    check(`${table}_pace`, label, async () => {
      const last7 = await cnt(db.from(table).select('*', CSEL).eq('status', 'published').gte('published_date', iso(7 * DAY)));
      const prev7 = await cnt(db.from(table).select('*', CSEL).eq('status', 'published').gte('published_date', iso(14 * DAY)).lt('published_date', iso(7 * DAY)));
      const status = last7 >= weeklyTarget ? 'ok' : last7 >= Math.ceil(weeklyTarget / 2) ? 'warn' : 'fail';
      return { value: last7, compare: prev7, status, note: `이번 주 ${last7} vs 지난주 ${prev7} (목표 주 ${weeklyTarget})` };
    });
  sections.cadence = await Promise.all([
    pace('editorials', '에디토리얼 주간 발행', 5),
    pace('articles', '기사 주간 발행', 5),
    pace('films', '필름 주간 발행', 1),
  ]);

  // ── C. 참여 ──────────────────────────────────────────────────
  const weekly = (table, tsCol, label, id) =>
    check(id || `${table}_last7`, label, async () => {
      const last7 = await cnt(db.from(table).select('*', CSEL).gte(tsCol, iso(7 * DAY)));
      const prev7 = await cnt(db.from(table).select('*', CSEL).gte(tsCol, iso(14 * DAY)).lt(tsCol, iso(7 * DAY)));
      return { value: last7, compare: prev7, status: last7 >= prev7 ? 'ok' : 'warn', note: `이번 주 ${last7} vs 지난주 ${prev7}` };
    });

  // IG 참여 스냅샷 (Graph API) — 최근 25편의 좋아요·댓글. 게시 48h 미만은
  // 좋아요가 아직 누적 중이라 평균에서 제외한다(2026-07-15 진단의 핵심 교훈:
  // 갓 올린 글을 넣으면 "참여 저조" 오판). 토큰 미설정·API 지연에도 감사 전체가
  // 멈추지 않도록 5초 타임아웃 + 개별 check 단위 에러 격리.
  let _igMedia = null, _igErr = null;
  try {
    _igMedia = await Promise.race([
      listRecentMedia({ limit: 25 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('IG Graph API 타임아웃(5s)')), 5000)),
    ]);
  } catch (e) {
    _igErr = String((e && e.message) || e).slice(0, 120);
  }
  const _IG48 = 48 * 3600 * 1000;
  const _igNow = Date.now();
  const _igMature = (_igMedia || [])
    .map((m) => ({
      t: m.timestamp ? new Date(m.timestamp).getTime() : 0,
      type: m.media_type || 'UNKNOWN',
      likes: typeof m.like_count === 'number' ? m.like_count : 0,
      comments: typeof m.comments_count === 'number' ? m.comments_count : 0,
    }))
    .filter((m) => m.t > 0 && (_igNow - m.t) >= _IG48);   // 48h 이상 경과분만
  const _igAvg = (arr, k) => (arr.length ? Math.round(arr.reduce((s, x) => s + (x[k] || 0), 0) / arr.length) : 0);
  const _igRecent = _igMature.filter((m) => (_igNow - m.t) < 9 * DAY);                          // 48h ~ 9일
  const _igPrior  = _igMature.filter((m) => (_igNow - m.t) >= 9 * DAY && (_igNow - m.t) < 16 * DAY); // 9 ~ 16일

  sections.engagement = await Promise.all([
    weekly('editorial_views', 'viewed_at', '에디토리얼 조회 (7일)', 'views_last7'),
    weekly('comments', 'created_at', '댓글 (7일)'),
    weekly('ratings', 'created_at', '평점 (7일)'),
    weekly('community_scraps', 'created_at', '커뮤니티 스크랩 (7일)'),
    check('ig_outclicks_yesterday', '웹→IG 아웃클릭 (24시간, 소스별)', async () => {
      // B-2 IG 유입 계측 — 모든 인스타 버튼이 /api/ig-out 경유로 기록된다.
      //
      // 원본 ig_outclicks 가 아니라 ig_outclicks_human 뷰(087)를 읽는다.
      // 봇 필터(fbd2c87, 2026-07-20 11:11)가 켜지기 전 'ssr' 기록은 크롤러로
      // 오염돼 있고, 그 허수 때문에 2026-07-21 데일리 체크가 "웹→IG 유입
      // -90.7% 급락"으로 오독해 멀쩡한 SSR 을 뜯을 뻔했다. 실제로는 하루 두
      // IP 가 1,300여 회씩 훑은 것이고 사람 아웃클릭은 30~50 으로 평평했다.
      // 지표는 반드시 이 뷰로만 읽는다 — 45_Business/학습메모/2026-07-20-크롤러-지표오염.md
      const last24 = await cnt(db.from('ig_outclicks_human').select('*', CSEL).gte('clicked_at', iso(DAY)));
      const prev24 = await cnt(db.from('ig_outclicks_human').select('*', CSEL).gte('clicked_at', iso(2 * DAY)).lt('clicked_at', iso(DAY)));
      const { data } = await db.from('ig_outclicks_human').select('src').gte('clicked_at', iso(DAY)).limit(1000);
      const bySrc = {};
      (data || []).forEach((r) => { bySrc[r.src] = (bySrc[r.src] || 0) + 1; });
      const breakdown = Object.entries(bySrc).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · ');
      return {
        value: last24, compare: prev24, status: 'ok',
        note: `어제 ${last24} vs 그제 ${prev24}${breakdown ? ' — ' + breakdown : ''}`,
      };
    }),
    check('top_recent_editorials', '최근 10편 조회 상위/하위 (커버·훅 품질 신호)', async () => {
      const { data, error } = await db.from('editorials').select('title, view_count')
        .eq('status', 'published').order('published_date', { ascending: false }).limit(10);
      if (error) throw error;
      const rows = (data || []).map((r) => ({ t: r.title, v: r.view_count || 0 })).sort((a, b) => b.v - a.v);
      const avg = Math.round(rows.reduce((s, r) => s + r.v, 0) / Math.max(1, rows.length));
      return {
        value: avg, status: 'ok',
        note: rows.length ? `상위: ${rows[0].t}(${rows[0].v}) · 하위: ${rows[rows.length - 1].t}(${rows[rows.length - 1].v})` : '데이터 없음',
        items: rows.map((r) => `${r.t} — ${r.v}회`),
      };
    }),
    check('ig_avg_likes_48h', 'IG 평균 좋아요 (48h+ 경과분)', async () => {
      if (!_igMedia) throw new Error(_igErr || 'IG 데이터 없음');
      const v = _igAvg(_igRecent, 'likes');
      const p = _igAvg(_igPrior, 'likes');
      const status = _igRecent.length === 0 ? 'warn' : v >= p ? 'ok' : 'warn';
      return {
        value: v, compare: p, status,
        note: `최근(48h~9일) ${_igRecent.length}편 평균 ${v} vs 이전(9~16일) ${_igPrior.length}편 평균 ${p} · 게시 48h 미만 제외`,
      };
    }),
    check('ig_avg_comments_48h', 'IG 평균 댓글 (48h+ 경과분)', async () => {
      if (!_igMedia) throw new Error(_igErr || 'IG 데이터 없음');
      const v = _igAvg(_igRecent, 'comments');
      const p = _igAvg(_igPrior, 'comments');
      return {
        value: v, compare: p, status: _igRecent.length === 0 ? 'warn' : v >= p ? 'ok' : 'warn',
        note: `최근 ${_igRecent.length}편 평균 댓글 ${v} vs 이전 ${_igPrior.length}편 ${p}`,
      };
    }),
    check('ig_engagement_by_type', 'IG 유형별 참여 (릴스/캐러셀/단일, 48h+)', async () => {
      if (!_igMedia) throw new Error(_igErr || 'IG 데이터 없음');
      if (!_igMature.length) return { value: 0, status: 'warn', note: '48h 이상 경과한 게시물이 없음' };
      const label = { VIDEO: '릴스', CAROUSEL_ALBUM: '캐러셀', IMAGE: '단일' };
      const groups = {};
      _igMature.forEach((m) => { (groups[m.type] = groups[m.type] || []).push(m); });
      const items = Object.entries(groups)
        .sort((a, b) => _igAvg(b[1], 'likes') - _igAvg(a[1], 'likes'))
        .map(([type, arr]) => `${label[type] || type} ${arr.length}편 — 좋아요 ${_igAvg(arr, 'likes')} · 댓글 ${_igAvg(arr, 'comments')}`);
      const reels = groups.VIDEO || [];
      const carousel = groups.CAROUSEL_ALBUM || [];
      const note = (reels.length && carousel.length)
        ? `릴스 좋아요 ${_igAvg(reels, 'likes')} vs 캐러셀 ${_igAvg(carousel, 'likes')} — 우세: ${_igAvg(reels, 'likes') >= _igAvg(carousel, 'likes') ? '릴스' : '캐러셀'}`
        : `48h+ 경과 ${_igMature.length}편 유형별 집계`;
      return { value: _igMature.length, status: 'ok', note, items };
    }),
  ]);

  // ── D. 파이프라인 건강 ────────────────────────────────────────
  sections.pipelines = await Promise.all([
    check('ig_import_freshness', 'IG 기사 자동수입 최신성 (시간)', async () => {
      const { data, error } = await db.from('articles').select('created_at')
        .not('source_instagram_url', 'is', null).order('created_at', { ascending: false }).limit(1);
      if (error) throw error;
      if (!data || !data.length) return { value: null, status: 'warn', note: 'IG 수입 기사 없음' };
      const hrs = Math.round((Date.now() - new Date(data[0].created_at).getTime()) / 3600000);
      return { value: hrs, status: hrs <= 48 ? 'ok' : hrs <= 96 ? 'warn' : 'fail', note: `마지막 수입 ${hrs}시간 전 — 96h+ 는 IG_ACCESS_TOKEN 만료 의심` };
    }),
    check('pinterest_backlog', 'Pinterest 미발행 잔량', async () => ({
      value: await cnt(db.from('editorials').select('*', CSEL).eq('status', 'published').is('pinterest_synced_at', null)),
      status: 'ok', note: 'PINTEREST_ACCESS_TOKEN 설정 후 자동 소진 예정',
    })),
    check('pinterest_errors', 'Pinterest 발행 실패 표시', async () => {
      const v = await cnt(db.from('editorials').select('*', CSEL).not('pinterest_error', 'is', null));
      return { value: v, status: v === 0 ? 'ok' : 'warn' };
    }),
    check('scheduled_overdue', '예약발행 시각 지난 미발행 (release 크론 이상 신호)', async () => {
      const v = await cnt(db.from('editorials').select('*', CSEL).neq('status', 'published').lt('scheduled_publish_at', new Date().toISOString()));
      const items = v > 0
        ? await titles(db.from('editorials').select('title').neq('status', 'published').lt('scheduled_publish_at', new Date().toISOString()))
        : [];
      return { value: v, status: v === 0 ? 'ok' : 'fail', items };
    }),
    check('embeddings_missing', '임베딩 없는 발행 에디토리얼 (추천·테마 제외)', async () => {
      const v = await cnt(db.from('editorials').select('*', CSEL).eq('status', 'published').is('embedding', null));
      return { value: v, status: v === 0 ? 'ok' : 'warn' };
    }),
    check('submissions_pending', '검토 대기 서브미션', async () => {
      const v = await cnt(db.from('submissions').select('*', CSEL).eq('status', 'pending'));
      return { value: v, status: v <= 10 ? 'ok' : 'warn', note: '크리에이터 응대 속도 = 커뮤니티 성장 신호' };
    }),
    check('email_campaigns_recent', '이메일 캠페인 (30일)', async () => {
      const v = await cnt(db.from('email_campaigns').select('*', CSEL).gte('created_at', iso(30 * DAY)));
      return { value: v, status: v > 0 ? 'ok' : 'warn', note: v === 0 ? '뉴스레터 채널 휴면 상태' : undefined };
    }),
  ]);

  // ── E. 오디언스 ──────────────────────────────────────────────
  sections.audience = await Promise.all([
    check('profiles_total', '전체 가입자', async () => ({
      value: await cnt(db.from('profiles').select('*', CSEL)), status: 'ok',
    })),
    weekly('profiles', 'created_at', '신규 가입 (7일)', 'signups_last7'),
    check('subscriptions_total', '구독 레코드 수', async () => ({
      value: await cnt(db.from('subscriptions').select('*', CSEL)), status: 'ok',
    })),
  ]);

  const all = Object.values(sections).flat();
  const summary = {
    ok: all.filter((c) => c.status === 'ok').length,
    warn: all.filter((c) => c.status === 'warn').length,
    fail: all.filter((c) => c.status === 'fail').length,
    error: all.filter((c) => c.status === 'error').length,
  };

  return { generated_at: new Date().toISOString(), summary, sections };
}

module.exports = { runGrowthAudit };
