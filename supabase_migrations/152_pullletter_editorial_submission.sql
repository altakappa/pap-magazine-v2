-- ──────────────────────────────────────────────────────────────────────
-- 152 — 풀레터 후속 절차: 발급된 풀레터 → 완성 에디토리얼 서브미션 연결 (2026-09-13, 도메니코)
--
-- "풀레터를 받아간 사람은 웹사이트 내에서 '완성된 에디토리얼 제출하기'를 통해 서브미션처럼 똑같은
--  제출 과정을 거쳐 최종 제출이 되어야 해." 지금까지는 발급(issued)에서 끝났고 그 뒤를 잇는 칸이 없었다
-- (실측 2026-09-13: issued 3건, 후속 제출 0건 — 어디에도 연결이 없어 셀 수도 없었다).
--
-- pullletters.submission_id      ← 그 풀레터로 만든 에디토리얼 서브미션 (한 풀레터에 한 건)
-- pullletters.editorial_submitted_at
-- submissions.pullletter_id      ← 반대 방향. 관리자 목록·통계에서 "풀레터 기반" 을 바로 거른다.
-- 되돌리기: alter table pullletters drop column submission_id, drop column editorial_submitted_at;
--          alter table submissions drop column pullletter_id;
-- ──────────────────────────────────────────────────────────────────────
alter table public.pullletters
  add column if not exists submission_id uuid references public.submissions(id) on delete set null,
  add column if not exists editorial_submitted_at timestamptz;

alter table public.submissions
  add column if not exists pullletter_id uuid references public.pullletters(id) on delete set null;

create index if not exists submissions_pullletter_id_idx on public.submissions (pullletter_id) where pullletter_id is not null;

comment on column public.pullletters.submission_id is '이 풀레터로 촬영한 완성 에디토리얼의 서브미션 id (2026-09-13 후속 절차)';
comment on column public.submissions.pullletter_id is '이 서브미션이 어느 풀레터의 후속 제출인지 (null 이면 일반 서브미션)';
