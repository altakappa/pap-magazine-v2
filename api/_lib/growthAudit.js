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
  const missing = (col, label, failOver) =>
    check(`editorials_missing_${col}`, label, async () => {
      const v = await cnt(db.from('editorials').select('*', CSEL).eq('status', 'published').is(col, null));
      const items = v > 0
        ? await titles(db.from('editorials').select('title').eq('status', 'published').is(col, null))
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
  sections.engagement = await Promise.all([
    weekly('editorial_views', 'viewed_at', '에디토리얼 조회 (7일)', 'views_last7'),
    weekly('comments', 'created_at', '댓글 (7일)'),
    weekly('ratings', 'created_at', '평점 (7일)'),
    weekly('community_scraps', 'created_at', '커뮤니티 스크랩 (7일)'),
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
