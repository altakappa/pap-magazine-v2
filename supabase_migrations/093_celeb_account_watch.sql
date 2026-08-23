-- 093: 셀럽 계정 자동 감시 (2026-08-23, 도메니코 승인 "자동 감지로 바꿔라")
-- 감시 계정에 새 게시물이 뜨면 celeb_brief_queue 에 자동 적재 → 기존 브리프 흐름.
-- 발행은 여전히 도메니코의 "올려"만. 자동 발행 경로 없음.
-- 적용: 2026-08-23 Supabase MCP 로 프로덕션 적용 완료.

create table if not exists celeb_watch_accounts (
  username      text primary key,
  label         text not null default '',
  enabled       boolean not null default true,
  baseline_done boolean not null default false,  -- 첫 폴링은 기준선만 잡는다 (07-20 스팸 144건 재발 방지)
  last_polled_at timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);

create table if not exists celeb_account_seen (
  username  text not null,
  shortcode text not null,
  seen_at   timestamptz not null default now(),
  primary key (username, shortcode)
);

-- 시드: 최근 120일 기사 태그 빈도 상위 (제니27·블핑23·BTS23·에스파20·GD15·카리나13·ATEEZ16·RIIZE11·스키즈9 + 샤넬22·디올14·프라다10)
insert into celeb_watch_accounts (username, label) values
  ('jennierubyjane','제니'),('blackpinkofficial','블랙핑크'),('bts.bighitofficial','BTS'),
  ('aespa_official','에스파'),('xxxibgdrgn','G-DRAGON'),('katarinabluu','카리나'),
  ('ateez_official_','ATEEZ'),('riize_official','RIIZE'),('realstraykids','스트레이키즈'),
  ('chanelofficial','샤넬'),('dior','디올'),('prada','프라다')
on conflict (username) do nothing;
