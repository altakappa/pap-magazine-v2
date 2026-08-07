-- 109: tiktok_posts 에 드라이브 파일 식별자 추가 (2026-08-07)
--
-- 유튜브(107/108)와 같은 구조. 드라이브 mp4 를 틱톡에도 올리므로
-- 작업 단위인 '드라이브 파일'을 중복 판정 키로 갖는다.
--
-- ⚠️ 107 의 실수를 반복하지 않는다: 부분 인덱스(where … is not null)를 쓰면
-- PostgREST 의 upsert(onConflict) 가 ON CONFLICT 대상으로 쓰지 못해
-- 조용히 실패하고 같은 영상이 반복 게시된다(2026-08-07 실제 사고).
-- Postgres 는 유니크에서 NULL 을 서로 다르게 보므로 술어 없이도
-- 기존 경로(에디토리얼·기사 포토 게시, drive_file_id IS NULL)는 무영향이다.
-- 적용: 2026-08-07 프로덕션 반영 완료.

alter table public.tiktok_posts
  add column if not exists drive_file_id text;

comment on column public.tiktok_posts.drive_file_id is
  '구글 드라이브 파일 ID. 드라이브 영상 경유 게시일 때만 채워진다. NULL = 포토 게시 경로.';

create unique index if not exists tiktok_posts_drive_file_id_key
  on public.tiktok_posts (drive_file_id);
