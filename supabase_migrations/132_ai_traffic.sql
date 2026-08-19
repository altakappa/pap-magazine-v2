-- 132 · AI 검색·챗봇 계측 (2026-08-19)
--
-- 왜 만드나 — 시밀러웹이 "AI 챗봇 유입을 보여준다"고 영업 메일을 보냈다.
-- 그 상품의 값어치는 **경쟁사** 트래픽 추정이고, 우리 사이트 유입은 우리
-- 서버가 원본을 갖고 있다. 추정치를 사기 전에 원본을 읽는다.
--
-- 실측(2026-08-19, social_inclicks): chatgpt 계열 141건이 이미 들어와 있다.
-- 다만 utm_source 가 붙는 챗GPT 만 보인 것이고, Referer 만 보내는
-- 퍼플렉시티·제미나이·클로드·코파일럿은 계측 자체가 없었다. 그 구멍을 연다.
--
-- 두 표를 따로 두는 이유 — 유입(사람)과 크롤(봇)은 다른 신호다.
-- 섞으면 "AI가 우리를 3천 번 봤다" 같은 무의미한 합계가 나온다.
--
--   ai_crawl_daily     봇이 어떤 글을 읽어 갔나 (선행 지표)
--   social_inclicks    사람이 실제로 넘어왔나 (기존 표를 그대로 쓴다)
--
-- 유입을 새 표로 만들지 않는 이유: 이미 social_inclicks 가 그 일을 한다.
-- 표를 두 벌 만들면 규칙도 두 벌이 되고 한쪽만 고쳐진다 (GROWTH-LEDGER 교훈 2).

-- ── ① 크롤 기록 (일자 x 플랫폼 x 목적 x 경로) ────────────────────
-- 행마다 INSERT 하면 봇 한 번에 한 행이라 금방 수백만이 된다.
-- 같은 날 같은 경로는 hits 만 올린다.
--
-- kind 세 값의 뜻:
--   train  학습용 수집        (GPTBot, ClaudeBot, Google-Extended)
--   index  검색 색인용        (OAI-SearchBot, PerplexityBot)
--   live   지금 사람이 물어서 봇이 여는 중 (ChatGPT-User, Perplexity-User)
-- live 가 오늘의 신호이고 train 은 내년의 신호다. 합치면 둘 다 잃는다.
CREATE TABLE IF NOT EXISTS public.ai_crawl_daily (
  day      DATE    NOT NULL,
  platform TEXT    NOT NULL,
  kind     TEXT    NOT NULL,
  path     TEXT    NOT NULL,
  hits     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, platform, kind, path)
);

CREATE INDEX IF NOT EXISTS idx_ai_crawl_daily_day
  ON public.ai_crawl_daily (day DESC);
CREATE INDEX IF NOT EXISTS idx_ai_crawl_daily_plat
  ON public.ai_crawl_daily (platform, kind, day DESC);

ALTER TABLE public.ai_crawl_daily ENABLE ROW LEVEL SECURITY;
-- 정책을 만들지 않는다 = 익명·로그인 키로는 못 읽는다. 서비스 역할만 접근.

-- ── ② 증분 함수 ──────────────────────────────────────────────────
-- PostgREST 의 upsert 로는 "기존값 + 1" 을 못 쓴다. 함수로 만든다.
-- path 는 여기서 자른다. 자르기 전 값으로 키를 만들면 ON CONFLICT 가
-- 한 명령에서 같은 행을 두 번 건드려 터진다 (2026-08-18 GSC 사고와 같은 함정).
CREATE OR REPLACE FUNCTION public.ai_crawl_bump(
  p_day DATE, p_platform TEXT, p_kind TEXT, p_path TEXT
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.ai_crawl_daily (day, platform, kind, path, hits)
  VALUES (p_day, LEFT(p_platform, 24), LEFT(p_kind, 8), LEFT(p_path, 300), 1)
  ON CONFLICT (day, platform, kind, path)
  DO UPDATE SET hits = public.ai_crawl_daily.hits + 1;
$$;

REVOKE ALL ON FUNCTION public.ai_crawl_bump(DATE, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ── ③ 유입 표에 리퍼러 호스트 칸을 연다 ─────────────────────────
-- 기존 referrer_path 는 sanitizeReferrer 가 **호스트를 버리고 경로만** 남긴다.
-- 그래서 "어느 AI 에서 왔는가" 를 저장된 데이터로는 되짚을 수 없었다.
-- 경로가 아니라 호스트가 답이라 칸을 따로 연다. 경로는 개인정보라 계속 버린다.
ALTER TABLE public.social_inclicks
  ADD COLUMN IF NOT EXISTS referrer_host TEXT;

CREATE INDEX IF NOT EXISTS idx_social_inclicks_src_time
  ON public.social_inclicks (src, clicked_at DESC);
