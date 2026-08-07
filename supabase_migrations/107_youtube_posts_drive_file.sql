-- 107: youtube_posts 에 드라이브 파일 식별자 추가 (2026-08-07)
--
-- 왜: 인스타 릴스 mp4 회수가 8/3부터 69% 실패한다(라이선스 음원 릴스는
-- Graph 가 media_url 을 아예 안 준다). 대안으로 구글 드라이브 '유튜브'
-- 폴더의 mp4 를 올린다. 그 작업 단위는 '기사'가 아니라 '드라이브 파일'이라
-- 중복 업로드를 막으려면 파일 식별자를 키로 가져야 한다.
--
-- 안전: 추가만 한다. 기존 행·컬럼·인덱스는 건드리지 않는다.
-- 기존 경로(article_id 기준 업서트)는 그대로 동작한다.
-- 적용: 2026-08-07 프로덕션 반영 완료.

alter table public.youtube_posts
  add column if not exists drive_file_id text;

comment on column public.youtube_posts.drive_file_id is
  '구글 드라이브 파일 ID. 드라이브 경유 업로드일 때만 채워진다. NULL = 인스타 릴스 경로.';

-- 같은 드라이브 파일을 두 번 올리지 않는다.
-- NULL 은 유니크 제약에서 서로 충돌하지 않으므로 기존 경로는 영향 없다.
create unique index if not exists youtube_posts_drive_file_id_key
  on public.youtube_posts (drive_file_id)
  where drive_file_id is not null;
