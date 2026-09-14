-- 156 — 이미 올라간 큰 이미지를 줄이기 위한 목록과 진행 기록
--        (2026-09-14, Supabase 전송량 초과 후속)
--
-- [왜] 9/14 새벽 전송량 초과로 사이트가 3시간 40분 멈췄다. 알림에는 두 가지가
-- 같이 떴다: exceed_egress_quota(DB 쪽)와 exceed_cached_egress_quota(Storage 쪽).
-- DB 쪽은 embedding 열을 빼서 고쳤고(12d2fff), Storage 쪽은 이미지다.
--
-- 실측 2026-09-14 — media 버킷:
--   48,904개 · 35GB · 평균 758KB
--   jpg 38,689개 21GB(562KB) · png 8,212개 6.7GB(839KB) · mp4 1,993개 8.1GB
--   1MB 넘는 6,818개가 전체 용량의 54.9% (19GB)
--   Vercel 24시간 최다 경로 = /_vercel/image 16,000회
--
-- 독자가 받는 건 이미 작다(기사 한 장 54KB). 문제는 그 54KB 를 만들려고 Vercel 이
-- 원본 758KB 를 Supabase 에서 통째로 끌어간다는 것이다. 하루 약 12GB.
--
-- 신규 이미지는 3e71ee8 이 저장 전에 줄이도록 고쳤다. 이 마이그레이션은 **이미
-- 올라간 것**을 줄이기 위한 준비다.
--
-- [왜 뷰가 필요한가]
-- storage.objects 는 storage 스키마에 있어 PostgREST 로 못 읽는다. 서버 코드가
-- "1MB 넘는 파일이 어느 것인지" 를 알려면 public 스키마에 창구가 있어야 한다.
-- 이 뷰는 **이름과 크기만** 보여준다. 파일 내용은 담지 않는다.
--
-- [안전 — 원본을 지우지 않는다]
-- 백필 절차는 이렇게 돈다 (api/admin/image-shrink-backfill.js):
--   1) media/<경로> 를 originals/<경로> 로 **옮긴다** (Storage 내부 이동, 전송량 0)
--   2) originals/<경로> 를 받아 줄인 뒤 media/<경로> 에 올린다 (URL 이 그대로다)
--   3) 진행을 이 표에 기록한다
-- 원본은 originals/ 에 그대로 남는다. 되돌리려면 반대로 옮기면 된다.
-- **지우는 것은 도메니코가 직접 한다.** 이 절차는 아무것도 지우지 않는다.
--
-- [왜 URL 을 안 건드리나]
-- 축소본을 새 경로에 만들면 articles·editorials·films·shorts·banners·creators 등
-- 열 스무 개의 URL 을 전부 갈아끼워야 한다. 그 중 하나만 놓쳐도 이미지가 깨진다.
-- 같은 경로에 올리면 갈아끼울 것이 없다. 원본은 originals/ 로 피신시켜 보존한다.

-- ── 1) 크기 목록 창구 ────────────────────────────────────────────────
-- security_invoker=off (기본): 뷰를 만든 사람(postgres) 권한으로 읽는다.
-- 아래에서 anon·authenticated 의 권한을 회수하므로 service_role 만 읽는다.
create or replace view public.media_objects as
select
  o.name                                   as name,
  o.bucket_id                              as bucket_id,
  ((o.metadata ->> 'size')::bigint)        as size_bytes,
  (o.metadata ->> 'mimetype')              as mimetype,
  o.created_at                             as created_at,
  o.updated_at                             as updated_at
from storage.objects o;

comment on view public.media_objects is
  '156 (2026-09-14) — Storage 파일의 이름·크기만 보는 창구. 서버(service_role) 전용. 전송량 백필용.';

revoke all on public.media_objects from anon, authenticated;
grant select on public.media_objects to service_role;

-- ── 2) 진행 기록 ─────────────────────────────────────────────────────
create table if not exists public.image_shrink_progress (
  name          text primary key,             -- media 버킷 안의 경로
  size_from     bigint,                       -- 줄이기 전 바이트
  size_to       bigint,                       -- 줄인 뒤 바이트
  original_path text,                         -- originals/<경로> — 되돌릴 때 쓴다
  status        text not null default 'done', -- done | skipped | failed | reverted
  reason        text,                         -- 건너뛰거나 실패한 이유
  done_at       timestamptz not null default now()
);

comment on table public.image_shrink_progress is
  '156 (2026-09-14) — 이미 올라간 이미지를 줄인 기록. 한 번 줄인 것을 다시 줄이지 않기 위한 표이자, 되돌리기 위한 장부.';

create index if not exists image_shrink_progress_status_idx
  on public.image_shrink_progress (status, done_at desc);

-- 서버만 만진다. 프런트가 anon 키로 부를 일이 없다.
alter table public.image_shrink_progress enable row level security;
revoke all on public.image_shrink_progress from anon, authenticated;
grant all on public.image_shrink_progress to service_role;
