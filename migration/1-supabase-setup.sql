-- ============================================================
-- PAP Magazine: Supabase Storage 'media' 버킷 확인/생성
-- ============================================================
-- 기존 백엔드(api/media/upload.js)가 이미 'media' 버킷을 사용하고
-- 있으므로, 이 버킷이 이미 존재할 가능성이 높습니다.
--
-- 아래 SQL은:
--  - 버킷이 없으면 생성
--  - 버킷이 있으면 public으로 설정
--  - 필요한 RLS 정책 추가
--
-- Supabase 대시보드 → SQL Editor → New query에서 실행
-- ============================================================

-- 1. 'media' 공개 버킷 생성 또는 업데이트
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

-- 2. RLS 정책: 누구나 읽기 가능
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'Public read media'
  ) then
    create policy "Public read media"
    on storage.objects for select
    using ( bucket_id = 'media' );
  end if;
end $$;

-- 3. 업로드는 service_role (백엔드)만 — 기본적으로 가능
-- 이미 기존 API가 service_role로 업로드 중이므로 별도 정책 불필요

-- ============================================================
-- 확인:
-- Supabase 대시보드 → Storage → buckets 에 'media' 가 있고
-- 오른쪽에 "Public" 태그가 붙어있어야 합니다.
-- ============================================================
