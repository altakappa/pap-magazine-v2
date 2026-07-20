-- 084 — celeb-watch 알림 중복 방지 테이블 (2026-07-21)
--
-- 배경: celeb-watch 는 원래 감지한 사건마다 articles 에 draft 를 만들었고,
-- 그 draft 제목과 대조해 중복을 걸렀다. 도메니코 결정(2026-07-21)으로
-- celeb-watch 는 DB 기사를 만들지 않고 "화제성 있는 것만 텔레그램 알림"만
-- 보낸다 → 중복 판정 근거가 사라진다. 알림 시그니처를 여기 남긴다.
--
-- (기사 생성이 없어졌으므로 5분 폴링 × 사건당 1알림 이 지켜져야 한다.
--  2026-07-20 에 144건 draft 스팸이 났던 원인이 바로 이 중복 판정 실패였다.)

CREATE TABLE IF NOT EXISTS public.celeb_watch_seen (
  id          BIGSERIAL PRIMARY KEY,
  signature   TEXT NOT NULL,
  title       TEXT,
  topic       TEXT,
  source_count INT,
  score       INT,
  alerted     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_celeb_watch_seen_sig ON public.celeb_watch_seen(signature);
CREATE INDEX IF NOT EXISTS idx_celeb_watch_seen_created ON public.celeb_watch_seen(created_at DESC);

ALTER TABLE public.celeb_watch_seen ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = service_role 만 접근 (서버 크론 전용).
