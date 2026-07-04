-- ============================================================
-- PAP Magazine: 영속 레이트리밋 (보안 강화 2026-07)
--
-- 배경: 기존 api/_lib/rateLimit.js 는 인메모리 Map 이라 Vercel
-- 서버리스 콜드스타트/멀티 인스턴스에서 상태가 리셋됨 → 로그인
-- 브루트포스를 실질적으로 못 막음. 인증 엔드포인트(login, signup,
-- send-code, verify-code)만 이 DB 기반 카운터를 쓴다 (트래픽이
-- 낮아 DB 왕복 1회 비용이 무시 가능한 구간).
--
-- rl_hit(): 원자적 upsert — 윈도가 지났으면 1로 리셋, 아니면 +1.
-- 반환: allowed(허용 여부), remaining(잔여), reset_at(윈도 종료).
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT PRIMARY KEY,          -- 예: 'auth:1.2.3.4'
  count    INT  NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);

-- service role 전용 — 클라이언트(anon) 접근 차단
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION rl_hit(p_key TEXT, p_limit INT, p_window_ms INT)
RETURNS TABLE(allowed BOOLEAN, remaining INT, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec rate_limits%ROWTYPE;
BEGIN
  INSERT INTO rate_limits AS rl (key, count, reset_at)
  VALUES (p_key, 1, now() + make_interval(secs => p_window_ms / 1000.0))
  ON CONFLICT (key) DO UPDATE
    SET count    = CASE WHEN rl.reset_at < now() THEN 1 ELSE rl.count + 1 END,
        reset_at = CASE WHEN rl.reset_at < now()
                        THEN now() + make_interval(secs => p_window_ms / 1000.0)
                        ELSE rl.reset_at END
  RETURNING * INTO rec;

  RETURN QUERY SELECT rec.count <= p_limit,
                      GREATEST(p_limit - rec.count, 0),
                      rec.reset_at;
END;
$$;

-- 만료 행 정리 (선택 — 주기 실행 불필요, 행 수가 IP 수 수준이라 작음.
-- 필요 시 수동: DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day';)

COMMENT ON TABLE rate_limits IS '영속 레이트리밋 카운터 — api/_lib/rateLimit.js rateLimitStrict() 전용';
