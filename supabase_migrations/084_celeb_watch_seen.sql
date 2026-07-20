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

-- 2026-07-21 추가 — 중복 판정 강화 (도메니코: "중복된 기사가 너무 많이 온다")
-- kw: 클러스터 대표 키워드. 다음 실행에서 Jaccard 유사도로 같은 사건인지 판정.
-- entity: 사건의 "주인공"(BTS·월드컵·샤넬 등). 같은 주인공은 6시간 쿨다운.
ALTER TABLE public.celeb_watch_seen ADD COLUMN IF NOT EXISTS kw     TEXT[];
ALTER TABLE public.celeb_watch_seen ADD COLUMN IF NOT EXISTS entity TEXT;  -- (미사용, 아래 core 로 대체)
CREATE INDEX IF NOT EXISTS idx_celeb_watch_seen_entity
  ON public.celeb_watch_seen(entity, created_at DESC);

-- 2026-07-21 2차 — 도메니코 규칙 반영.
--   "단어나 문장만 바꿔가며 BTS가 출연했다는 기사는 중복이므로 또 알려줄 필요 없어.
--    다만 '정호연 BTS와 출연'은 정호연이 추가됐으므로 다른 기사야."
-- → 사건의 정체성을 "등장 요소의 집합"(core)으로 잡는다. 새 요소가 추가되면 새 알림.
-- entity(단일 주인공) 기반 쿨다운은 폐기 — 그 방식이면 정호연 건까지 막혔다.
ALTER TABLE public.celeb_watch_seen ADD COLUMN IF NOT EXISTS core TEXT[];
