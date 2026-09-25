-- 171: 인스타 댓글 → DM 링크 발송 기록 (2026-09-25, api/_lib/igCommentDm.js). 한 댓글에 한 번만 보내기 위한 표.
create table if not exists public.ig_comment_dms (
  comment_id  text primary key,
  media_id    text,
  username    text,
  lang        text,
  url         text,
  status      text not null check (status in ('sent', 'failed')),
  error       text,
  created_at  timestamptz not null default now()
);
alter table public.ig_comment_dms enable row level security;
comment on table public.ig_comment_dms is '인스타 댓글 키워드 → 비공개 답장(DM)으로 웹 링크. 기본 꺼짐(IG_DM_ENABLED=1 + Meta instagram_manage_messages 권한).';
