-- 154 — 부계정 피드 참조 표 (2026-09-13, 드라이브 영상 매칭 적체 후속)
--
-- [왜] 272528b 가 캡션 첫 줄 매칭을 넣어 적체 16건 중 6건을 풀었다. 남은 7건은
-- **웹 기사 자체가 없다**: 포핸즈 · 엠포리오 아르마니 · 베를린 쇼룸 · 세인트제임스
-- 서울숲 · 헬리녹스 웨어 · 상쾌한 더 무비 Talk · 김해김 10주년.
--
-- 도메니코 2026-09-13: "pap_magazine 의 스토리에만 올라간 영상이 부계정에서
-- 피드로 올라가기 때문에 그 피드들을 참고해도 돼."
--   papfashion_ · papbeauty_ · pap_celeb · pap_object
--
-- [이 표가 하는 일과 안 하는 일]
-- 하는 일: 영상 파일명이 어느 부계정의 어느 게시물인지 **알려준다.**
-- 안 하는 일: 기사를 만들지 않는다. articles 를 건드리지 않는다.
--
-- 이 구분이 설계의 핵심이다. 부계정 게시물을 articles 로 수입하면 본지 기사 수가
-- 오염되고 발행 판단이 섞인다(도메니코 몫인 판단이다). 목적은 '기사를 늘리는 것'이
-- 아니라 '이 영상이 무엇인지 아는 것'이므로 참조 표로 족하다.
--
-- [그래서 영상이 바로 올라가나 — 아니다]
-- 유튜브·틱톡 업로드는 붙일 웹 기사가 있어야 성립한다. 부계정에만 있는 소재는
-- 웹 기사가 없으므로 **여전히 못 올린다.** 이 표가 바꾸는 것은 알림의 내용이다:
--   종전: "0828_엠포리오 아르마니.mp4 — 기사 없음"       (무엇인지 모름)
--   이후: "0828_엠포리오 아르마니.mp4 — @papfashion_ 8/28 게시물. 웹 기사 없음"
-- 도메니코가 '기사를 낼지 / 영상을 뺄지' 를 판단할 재료가 생긴다.
--
-- [비용] 새 크론을 만들지 않는다. 크론 호출 예산이 2,599/2,600 으로 여유가 1회뿐이라
-- 새 크론 하나가 상한을 건드린다. celeb-account-watch(하루 72회·평균 94ms)에 얹되
-- **2시간에 한 번만** 실제 수집한다 → 하루 12회 × 4계정 = Graph API 48회.
-- 부계정 피드는 분 단위로 바뀌지 않으므로 2시간이면 충분하다.
--
-- [보안] service_role 전용. 공개 계정의 공개 게시물이지만 운영 데이터이므로
-- anon/authenticated 는 읽지 않는다.
--
-- 실행: Supabase SQL Editor. Idempotent.

create table if not exists public.ig_sub_posts (
  account       text not null,
  shortcode     text not null,
  permalink     text,
  media_type    text,
  caption_line1 text,                 -- 매칭에 쓰는 값 (캡션 첫 줄)
  caption_head  text,                 -- 앞 200자 원문 (사람이 확인용)
  posted_at     timestamptz,
  captured_at   timestamptz not null default now(),
  primary key (account, shortcode)
);

comment on table public.ig_sub_posts is
  '부계정(papfashion_·papbeauty_·pap_celeb·pap_object) 피드 참조 표 (154). '
  '드라이브 영상 파일명이 어느 게시물인지 알려주는 용도. 기사로 만들지 않는다.';
comment on column public.ig_sub_posts.caption_line1 is
  '캡션 첫 줄. 에디터가 영상 파일명을 지을 때 쓰는 원본이라 매칭 키가 된다(272528b 참고).';

-- 파일명 → 게시물 조회용. 첫 줄로 찾는다.
create index if not exists idx_ig_sub_posts_line1
  on public.ig_sub_posts (caption_line1);
-- 오래된 행 정리·최신 확인용.
create index if not exists idx_ig_sub_posts_posted
  on public.ig_sub_posts (posted_at desc);

alter table public.ig_sub_posts enable row level security;
revoke all on public.ig_sub_posts from anon;
revoke all on public.ig_sub_posts from authenticated;
grant select, insert, update, delete on public.ig_sub_posts to service_role;
