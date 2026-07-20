-- 086 — 운영 알림 쿨다운 상태 (2026-07-21)
--
-- 왜: 파이프라인 감시(IG → 웹사이트 자동발행)가 30분마다 돌면서 문제를
-- 발견할 때마다 알리면, 한 번 막힌 상태에서 하루 48번 같은 알림이 온다.
-- 마지막 알림 시각을 남겨 쿨다운을 건다.
--
-- 배경 사고: 2026-07-15~19 IG_QUALITY_GATE 가 켜진 채 5일간 인スタ 기사가
-- 전부 draft 로 쌓였고 아무도 몰랐다. 그 사이 네이버 초안(하루 1~6건) ·
-- 스레드 · 틱톡 · 유튜브 자동게시가 함께 굶었다. 감시가 없어서 도메니코가
-- 우연히 발견할 때까지 방치됐다.

CREATE TABLE IF NOT EXISTS public.ops_alert_state (
  key           TEXT PRIMARY KEY,
  last_alert_at TIMESTAMPTZ,
  last_payload  JSONB,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.ops_alert_state ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = service_role(서버 크론) 전용.
