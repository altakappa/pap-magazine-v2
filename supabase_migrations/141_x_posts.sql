-- 141_x_posts.sql — X(트위터) 게시 기록 (2026-09-02)
--
-- 왜: X 는 매 기사 발행마다 나가는데(크론 노트 'X 1/1건') **본문이 어디에도
-- 남지 않는다.** 그래서 "말투가 인스타 캡션 같은가" 를 아무도 판단할 수 없다.
-- 도메니코 2026-09-02: "X 에 올라가는 게시글 말투를 인스타 말투로 입혀줄 수 있어?"
-- → 입히는 건 이미 하고 있다(papVoice.X_VOICE). 없는 건 **고쳤는지 확인할 눈금**이다.
-- 개수만 세는 기록은 "돌았다 ≠ 잘 나갔다" 를 못 가른다.
--
-- 설계 원칙:
--   · 기록 실패가 트윗을 되돌리지 않는다 (코드 쪽에서 try/catch, 여기선 제약을 느슨히)
--   · tweet_id 는 실패 시 없다 → nullable
--   · 같은 트윗을 두 번 적지 않는다 → tweet_id 유니크(부분 인덱스, null 은 제외)

create table if not exists public.x_posts (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  account      text        not null default 'magazine',   -- magazine | pepperit
  kind         text,                                       -- article | digest | reply | parity | test
  tweet_id     text,
  reply_to_id  text,
  article_id   uuid,
  text         text        not null,
  media_count  int         not null default 0,
  ok           boolean     not null default false,
  error        text
);

create unique index if not exists x_posts_tweet_id_key
  on public.x_posts (tweet_id) where tweet_id is not null;

create index if not exists x_posts_created_at_idx on public.x_posts (created_at desc);
create index if not exists x_posts_account_idx    on public.x_posts (account, created_at desc);

comment on table public.x_posts is
  'X 게시 기록. 말투·품질을 사후에 검토하려면 본문이 남아야 한다 (2026-09-02).';

alter table public.x_posts enable row level security;
-- 서비스 롤만 쓴다. 공개 읽기 없음 (rls-public-lockdown 규약).
