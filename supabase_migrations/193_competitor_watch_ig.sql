-- 193: 경쟁사 광고주 알림 (2026-11-26)
-- competitor-watch 크론이 7개 계정(아이즈·패스트페이퍼·데패뉴·hip·뉴소스·셀패진·하입잭)의
-- 게시물을 쌓고, #광고·#제작지원 을 표시한다. 하루 한 번 안 알린 광고를 텔레그램으로 묶어 보낸다.
-- pepperit_watch_ig 와 섞지 않는다 (그 표는 페퍼릿 예약작업이 소재로 읽는다).
CREATE TABLE IF NOT EXISTS public.competitor_watch_ig (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handle       TEXT NOT NULL,
  permalink    TEXT NOT NULL UNIQUE,
  caption_head TEXT,
  likes        INTEGER,
  comments     INTEGER,
  followers    INTEGER,
  posted_at    TIMESTAMPTZ NOT NULL,
  ad_tag       TEXT,          -- '#광고' '#제작지원' '#협찬' '#유료광고' '#sponsored' '#AD' / 광고 아니면 NULL
  ad_where     TEXT,          -- 'head'(캡션 앞 150자, 확실) / 'tail'(그 뒤, 확인 필요)
  brand        TEXT,          -- Claude 가 뽑은 광고주 이름 (못 뽑으면 NULL)
  ad_category  TEXT,          -- 업종
  alerted_at   TIMESTAMPTZ,   -- 텔레그램으로 알린 시각
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS competitor_watch_ig_posted_idx ON public.competitor_watch_ig (posted_at DESC);
CREATE INDEX IF NOT EXISTS competitor_watch_ig_pending_idx ON public.competitor_watch_ig (posted_at DESC)
  WHERE ad_tag IS NOT NULL AND alerted_at IS NULL;
CREATE INDEX IF NOT EXISTS competitor_watch_ig_handle_idx ON public.competitor_watch_ig (handle, posted_at DESC);

-- 서버(service role)만 읽고 쓴다. 정책을 만들지 않으면 anon·authenticated 는 접근 불가.
ALTER TABLE public.competitor_watch_ig ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competitor_watch_ig FROM anon, authenticated;
