/**
 * PAP Magazine — 성장 데이터 검증 엔드포인트 (주간 성장 리포트의 데이터 소스)
 * Route: GET /api/growth-audit
 *
 * 매거진이 성장하기 위해 관리해야 하는 데이터를 5개 영역 × 20여 개
 * 검증 항목으로 집계한다. 매주 자동 실행되는 멀티에이전트 성장 리포트
 * (Cowork 스케줄 작업 'pap-weekly-growth-council')가 이 JSON을 읽어
 * 서로 다른 관점의 에이전트들이 분석·논쟁한 뒤 생존한 결론을 보고한다.
 *
 * 영역:
 *   content   — 콘텐츠 무결성 (누락 필드는 SEO·깔때기 성능을 갉아먹는다)
 *   cadence   — 발행 페이스 (이번 주 vs 지난주)
 *   engagement— 참여 (조회·댓글·평점·커뮤니티)
 *   pipelines — 자동화 파이프라인 건강 (IG 수입, Pinterest, 예약발행, 임베딩)
 *   audience  — 오디언스 (가입·구독)
 *
 * 각 항목: { id, label, value, compare?, status: ok|warn|fail|error, note }
 * status 기준은 항목별 주석 참조. 집계 수치만 반환 — 개인정보 없음.
 * 공개 읽기 전용 (민감정보 없음), edge 10분 캐시.
 */

const { supabaseAdmin } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

const DAY = 24 * 3600 * 1000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/** head-count 헬퍼 — buildFn 이 쿼리를 조립한다. 실패는 null. */
async function cnt(buildFn) {
  const q = buildFn().select('*', { count: 'exact', head: true });
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

/** 검증 항목 실행기 — 실패해도 리포트 전체가 죽지 않게 격리. */
async function check(id, label, fn) {
  try {
    const r = await fn();
    return { id, label, ...r };
  } catch (err) {
    return { id, label, status: 'error', note: String(err && err.message || err).slice(0, 120) };
  }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); return res.status(405).end(); }

  const db = supabaseAdmin;
  const sections = {};

  // ── A. 콘텐츠 무결성 ──────────────────────────────────────────
  sections.content = await Promise.all([
    check('editorials_published', '발행 에디토리얼 수', async () => {
      const v = await cnt(() => db.from('editorials').select().eq('status', 'published'));
      return { value: v, status: 'ok' };
    }),
    check('editorials_missing_slug', '슬러그 없는 에디토리얼 (클린 URL·SEO 불가)', async () => {
      const v = await cnt(() => db.from('editorials').select().eq('status', 'published').is('slug', null));
      return { value: v, status: v === 0 ? 'ok' : 'warn' };
    }),
    check('editorials_missing_desc', '한글 설명 없는 에디토리얼 (검색 스니펫 손실)', async () => {
      const v = await cnt(() => db.from('editorials').select().eq('status', 'published').is('description', null));
      return { value: v, status: v === 0 ? 'ok' : 'warn' };
    }),
    check('editorials_missing_cover', '커버 이미지 없는 에디토리얼', async () => {
      const v = await cnt(() => db.from('editorials').select().eq('status', 'published').is('cover_image', null));
      return { value: v, status: v === 0 ? 'ok' : 'warn' };
    }),
    check('editorials_missing_ig', '원본 IG 링크 없는 에디토리얼 (좋아요·저장 깔때기 비활성)', async () => {
      const v = await cnt(() => db.from('editorials').select().eq('status', 'published').is('source_instagram_url', null));
      return { value: v, status: v === 0 ? 'ok' : v <= 10 ? 'warn' : 'fail' };
    }),
    check('films_missing_youtube', '유튜브 ID 없는 발행 필름 (재생 불가)', async () => {
      const v = await cnt(() => db.from('films').select().eq('status', 'published').is('youtube_id', null));
      return { value: v, status: v === 0 ? 'ok' : 'fail' };
    }),
  ]);

  // ── B. 발행 페이스 ────────────────────────────────────────────
  const paceCheck = (table, label, weeklyTarget) =>
    check(table + '_pace', label, async () => {
      const last7 = await cnt(() => db.from(table).select().eq('status', 'published').gte('published_date', iso(7 * DAY)));
      const prev7 = await cnt(() => db.from(table).select().eq('status', 'published').gte('published_date', iso(14 * DAY)).lt('published_date', iso(7 * DAY)));
      const status = last7 >= weeklyTarget ? 'ok' : last7 >= Math.ceil(weeklyTarget / 2) ? 'warn' : 'fail';
      return { value: last7, compare: prev7, status, note: `이번 주 ${last7} vs 지난주 ${prev7} (목표 주 ${weeklyTarget})` };
    });
  sections.cadence = await Promise.all([
    paceCheck('editorials', '에디토리얼 주간 발행', 5),
    paceCheck('articles', '기사 주간 발행', 5),
    paceCheck('films', '필름 주간 발행', 1),
  ]);

  // ── C. 참여 ──────────────────────────────────────────────────
  sections.engagement = await Promise.all([
    check('views_last7', '에디토리얼 조회 (7일)', async () => {
      const last7 = await cnt(() => db.from('editorial_views').select().gte('viewed_at', iso(7 * DAY)));
      const prev7 = await cnt(() => db.from('editorial_views').select().gte('viewed_at', iso(14 * DAY)).lt('viewed_at', iso(7 * DAY)));
      return { value: last7, compare: prev7, status: last7 >= prev7 ? 'ok' : 'warn', note: `이번 주 ${last7} vs 지난주 ${prev7}` };
    }),
    check('comments_last7', '댓글 (7일)', async () => {
      const v = await cnt(() => db.from('comments').select().gte('created_at', iso(7 * DAY)));
      return { value: v, status: v > 0 ? 'ok' : 'warn' };
    }),
    check('ratings_last7', '평점 (7일)', async () => {
      const v = await cnt(() => db.from('ratings').select().gte('created_at', iso(7 * DAY)));
      return { value: v, status: v > 0 ? 'ok' : 'warn' };
    }),
    check('scraps_last7', '커뮤니티 스크랩 (7일)', async () => {
      const v = await cnt(() => db.from('community_scraps').select().gte('created_at', iso(7 * DAY)));
      return { value: v, status: v > 0 ? 'ok' : 'warn' };
    }),
    check('avg_views_recent10', '최근 에디토리얼 10편 평균 누적 조회', async () => {
      const { data, error } = await db.from('editorials').select('view_count')
        .eq('status', 'published').order('published_date', { ascending: false }).limit(10);
      if (error) throw error;
      const avg = Math.round((data || []).reduce((s, r) => s + (r.view_count || 0), 0) / Math.max(1, (data || []).length));
      return { value: avg, status: 'ok', note: '추세 판단용 — 절대 기준 없음' };
    }),
  ]);

  // ── D. 파이프라인 건강 ────────────────────────────────────────
  sections.pipelines = await Promise.all([
    check('ig_import_freshness', 'IG 기사 자동수입 최신성 (시간)', async () => {
      // 토큰 만료를 조기 감지하는 카나리아 — 2026-07-05 토큰 만료 사고의 재발 방지.
      const { data, error } = await db.from('articles').select('created_at')
        .not('source_instagram_url', 'is', null).order('created_at', { ascending: false }).limit(1);
      if (error) throw error;
      if (!data || !data.length) return { value: null, status: 'warn', note: 'IG 수입 기사 없음' };
      const hrs = Math.round((Date.now() - new Date(data[0].created_at).getTime()) / 3600000);
      return { value: hrs, status: hrs <= 48 ? 'ok' : hrs <= 96 ? 'warn' : 'fail', note: `마지막 수입 ${hrs}시간 전 — 96h+ 는 IG_ACCESS_TOKEN 만료 의심` };
    }),
    check('pinterest_backlog', 'Pinterest 미발행 잔량', async () => {
      const v = await cnt(() => db.from('editorials').select().eq('status', 'published').is('pinterest_synced_at', null));
      return { value: v, status: 'ok', note: 'PINTEREST_ACCESS_TOKEN 설정 후 자동 소진 예정' };
    }),
    check('pinterest_errors', 'Pinterest 발행 실패 표시', async () => {
      const v = await cnt(() => db.from('editorials').select().not('pinterest_error', 'is', null));
      return { value: v, status: v === 0 ? 'ok' : 'warn' };
    }),
    check('scheduled_overdue', '예약발행 시각 지난 미발행 (release 크론 이상 신호)', async () => {
      const v = await cnt(() => db.from('editorials').select().neq('status', 'published').lt('scheduled_publish_at', new Date().toISOString()));
      return { value: v, status: v === 0 ? 'ok' : 'fail' };
    }),
    check('embeddings_missing', '임베딩 없는 발행 에디토리얼 (추천·테마 제외됨)', async () => {
      const v = await cnt(() => db.from('editorials').select().eq('status', 'published').is('embedding', null));
      return { value: v, status: v === 0 ? 'ok' : 'warn' };
    }),
    check('submissions_pending', '검토 대기 서브미션', async () => {
      const v = await cnt(() => db.from('submissions').select().eq('status', 'pending'));
      return { value: v, status: v <= 10 ? 'ok' : 'warn', note: '크리에이터 응대 속도 = 커뮤니티 성장 신호' };
    }),
  ]);

  // ── E. 오디언스 ──────────────────────────────────────────────
  sections.audience = await Promise.all([
    check('profiles_total', '전체 가입자', async () => {
      const v = await cnt(() => db.from('profiles').select());
      return { value: v, status: 'ok' };
    }),
    check('signups_last7', '신규 가입 (7일)', async () => {
      const last7 = await cnt(() => db.from('profiles').select().gte('created_at', iso(7 * DAY)));
      const prev7 = await cnt(() => db.from('profiles').select().gte('created_at', iso(14 * DAY)).lt('created_at', iso(7 * DAY)));
      return { value: last7, compare: prev7, status: last7 >= prev7 ? 'ok' : 'warn', note: `이번 주 ${last7} vs 지난주 ${prev7}` };
    }),
    check('subscriptions_total', '구독 레코드 수', async () => {
      const v = await cnt(() => db.from('subscriptions').select());
      return { value: v, status: 'ok' };
    }),
  ]);

  // 요약
  const all = Object.values(sections).flat();
  const summary = {
    ok: all.filter((c) => c.status === 'ok').length,
    warn: all.filter((c) => c.status === 'warn').length,
    fail: all.filter((c) => c.status === 'fail').length,
    error: all.filter((c) => c.status === 'error').length,
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
  return res.status(200).json({ generated_at: new Date().toISOString(), summary, sections });
};
