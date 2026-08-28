-- 140_ai_sov_probes.sql  (2026-08-28)
-- AI 답변 점유율(Share of Voice) 프로브 기록
--
-- 왜 ─────────────────────────────────────────────────────────
-- AEO/GEO 교육자료 8장("측정과 KPI — 클릭이 아니라 점유율")이 통째로 비어
-- 있었다. 우리가 재고 있던 것은 둘 뿐이다:
--
--   ai_crawl_daily    AI 봇이 우리 글을 읽어 갔나        (선행 지표)
--   social_inclicks   사람이 AI 답변 링크를 눌렀나       (결과)
--
-- 둘 다 **결과**다. "브랜드명 없는 카테고리 질문에 AI 가 우리를 답하는가",
-- "우리 대신 누구를 답하는가", "우리를 어떻게 서술하는가" 는 못 잰다.
-- 교재의 표현대로 순위를 대체하는 핵심 지표가 없었다.
--
-- 두 레이어를 나눠 적는 이유 ────────────────────────────────
-- 교재 3장: LLM 답변은 두 소스에서 나온다.
--   pretrain  모델에 각인된 브랜드 인식 — 장기 자산, 웹검색 끈 상태로 잰다
--   search    질문 시점에 웹을 검색해 요약 — 즉시 공략 가능, 웹검색 켠 상태
--
-- 이 구분이 이 표의 핵심이다. **합치면 둘 다 의미를 잃는다**
-- (ai_crawl_daily 에서 크롤과 유입을 안 더하는 것과 같은 이유).
--
-- 그리고 pretrain 열은 2026-08-22 GPTBot·ClaudeBot 학습 크롤러 차단의
-- 장기 비용을 재는 **유일한 계기**다. 차단은 train 크롤을 0으로 만들었고
-- live·index 는 전혀 줄지 않았다(실측). 남은 위험은 "다음 모델이 우리를
-- 모르게 되는 것" 하나인데, 그건 이 열이 내려가는 것으로만 보인다.
-- 내려가면 robots.txt 의 그 블록을 지우면 된다 — 되돌리기 쉬운 결정이다.
--
-- 무엇을 적나 ───────────────────────────────────────────────
-- 프로브 1회 = (질문 × 엔진 × 모드) 한 행. 원문 답변은 저장하지 않는다
-- (길고, 개인정보는 없지만 쓸모 대비 부피가 크다). 판정과 근거 문장만 남긴다.
-- ============================================================

create table if not exists public.ai_sov_probes (
  id            uuid primary key default gen_random_uuid(),
  probed_at     timestamptz not null default now(),
  day           date not null default (now() at time zone 'utc')::date,

  question_key  text not null,   -- 코드의 PROBES[].key (질문 문구가 바뀌어도 추이가 이어지게)
  question      text not null,   -- 그날 실제로 던진 문장
  lang          text not null,   -- ko | en
  engine        text not null,   -- chatgpt | claude
  mode          text not null,   -- pretrain (웹검색 끔) | search (웹검색 켬)

  present       boolean,         -- 답변에 PAP 가 등장했나. null = 호출 실패로 판정 불가
  described     text,            -- PAP 가 등장한 문장 (서술 정확도를 사람이 읽고 판단할 근거)
  desc_ok       boolean,         -- 그 문장이 '한국 디지털 패션 매거진' 범주를 맞게 말하나
  rivals        text[],          -- 우리 대신/함께 언급된 매체
  citations     text[],          -- search 모드에서 인용된 URL (pretrain 은 항상 빈 배열)
  error         text             -- 호출 실패 사유. 있으면 present 는 null
);

create index if not exists ai_sov_probes_day_idx on public.ai_sov_probes (day desc);
create index if not exists ai_sov_probes_key_idx on public.ai_sov_probes (question_key, engine, mode, day desc);

-- 서버(service_role)만 쓴다. 공개 노출 금지 — 경쟁 매체 이름이 들어간다.
alter table public.ai_sov_probes enable row level security;

-- 되돌리기
--   drop table if exists public.ai_sov_probes;
