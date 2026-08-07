-- 108: 107 의 부분 유니크 인덱스를 전체 유니크로 교체 (2026-08-07 긴급)
--
-- 사고: 107 에서 `where drive_file_id is not null` 부분 인덱스를 만들었는데,
-- PostgREST 의 upsert(onConflict='drive_file_id') 는 **술어 없는** 유니크
-- 인덱스만 ON CONFLICT 대상으로 쓸 수 있다. 그래서 첫 업로드
-- (video BAF_-ulPjUs) 는 유튜브에 올라갔는데 youtube_posts 에 행이 안 남았다.
-- 코드가 upsert 오류를 확인하지 않아 조용히 실패했다.
--
-- 그대로 두면 크론이 2시간마다 같은 영상을 공개 채널에 다시 올린다.
--
-- Postgres 는 유니크 인덱스에서 NULL 을 서로 다른 값으로 본다. 따라서
-- 술어를 빼도 인스타 릴스 경로(drive_file_id IS NULL) 는 아무 제약을 받지 않는다.
-- 적용: 2026-08-07 프로덕션 반영 완료 + 유실 행 1건 수기 복구.

drop index if exists youtube_posts_drive_file_id_key;

create unique index if not exists youtube_posts_drive_file_id_key
  on public.youtube_posts (drive_file_id);
