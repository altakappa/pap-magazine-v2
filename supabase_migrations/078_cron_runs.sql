-- ============================================================================
-- PAP Magazine: cron_runs — 크론 실행 이력
-- ============================================================================
--
-- 각 크론(sync-instagram, youtube-post, threads-post, tiktok-post 등)의
-- 매 실행 결과를 기록. 실패가 조용히 누적되지 않도록:
--   1) api/_lib/cronGuard.js 가 매 실행마다 INSERT
--   2) 실패 시 관리자 이메일 즉시 발송
--   3) admin 대시보드에서 최근 24시간 상태 조회 가능
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.cron_runs (
  id           BIGSERIAL PRIMARY KEY,
  cron_name    TEXT NOT NULL,
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ok           BOOLEAN NOT NULL,
  duration_ms  INTEGER,
  note         TEXT,     -- 성공 시 요약 (예: "게시할 릴스 기사 없음", "1건 임포트: xxx")
  error        TEXT      -- 실패 시 에러 메시지 (앞 800자)
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_name_time
  ON public.cron_runs(cron_name, ran_at DESC);

CREATE INDEX IF NOT EXISTS idx_cron_runs_recent_failures
  ON public.cron_runs(ran_at DESC)
  WHERE ok = FALSE;

COMMENT ON TABLE public.cron_runs IS
  '크론 실행 이력. cronGuard wrapper가 매 실행마다 기록. 조용한 실패 감지·admin 대시보드용.';

-- 오래된 이력 자동 삭제 (30일 이상 된 성공 이력만 삭제, 실패는 보존)
-- Supabase pg_cron 확장을 별도 활성화하지 않는 이상 스케줄은 못 걸지만,
-- 필요 시 sync-instagram 크론 안에서 랜덤 확률로 정리해도 됨.
--
--   DELETE FROM public.cron_runs
--    WHERE ok = TRUE AND ran_at < NOW() - INTERVAL '30 days';
