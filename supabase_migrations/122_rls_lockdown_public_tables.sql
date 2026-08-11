-- 122 — 공개 노출된 6개 표에 RLS 를 켠다 (2026-08-11, Supabase 보안 경보)
--
-- ■ 실측한 노출 상태 (조치 전)
--
--   표                    RLS   anon SELECT/INSERT/UPDATE/DELETE   정책수
--   ----------------------------------------------------------------------
--   content_comments      off   전부 true                          0
--   content_reactions     off   전부 true                          0
--   ig_boosts             off   전부 true                          0
--   algo_coach            off   전부 true                          0
--   push_subscriptions    off   전부 true                          0
--   push_broadcasts       off   전부 true                          0
--
-- public 스키마는 PostgREST 로 그대로 노출된다. 즉 **웹사이트에 박혀 있는
-- 공개 anon 키만 있으면 누구나** 위 표를 읽고 고치고 지울 수 있었다.
--
-- 무엇이 걸려 있었나 (심각한 순서):
--   ① push_subscriptions — 회원 브라우저의 푸시 엔드포인트와 암호키(p256dh·auth).
--      가져가면 **우리 회원 기기로 아무 알림이나 보낼 수 있다.** 지우면 푸시가 죽는다.
--   ② content_comments — 회원이 쓴 댓글. 누구나 남의 댓글을 고치거나 지울 수 있었다.
--   ③ content_reactions — 좋아요·별점. 조작으로 지표가 통째로 오염된다.
--   ④ push_broadcasts · ig_boosts · algo_coach — 내부 운영 기록.
--
-- 전부 2026-08-07~08 에 만든 표(112·113·114·115)다. 표를 만들 때 RLS 를 빼먹었다.
--
-- ■ 왜 '정책 없이 RLS 만' 켜는가
-- RLS 를 켜고 정책이 하나도 없으면 anon·authenticated 는 **아무 행도 못 본다**.
-- 그런데 서버는 service_role 로 붙고, service_role 은 RLS 를 우회한다.
-- 실측으로 확인한 접근 경로:
--   content_comments   → api/content/comments.js      (서버)
--   content_reactions  → api/content/react.js         (서버)
--   ig_boosts          → api/_lib/goldenBoost.js      (서버)
--   algo_coach         → api/cron/algo-coach.js       (서버·크론)
--   push_subscriptions → api/_lib/webPush.js · api/push/subscribe.js (서버)
--   push_broadcasts    → api/_lib/webPush.js          (서버)
-- **frontend/ 에서 이 표들을 직접 부르는 곳은 한 곳도 없다** (grep 전수 확인).
-- 이 표들을 참조하는 SQL 함수도 없다(pg_get_functiondef 전수 확인).
-- 그래서 정책 0개로 잠가도 회원 화면은 아무것도 안 바뀐다.
-- 이 저장소의 다른 40여 개 운영 표가 이미 정확히 이 형태다.
--
-- ⚠️ 나중에 프런트가 이 표를 직접 읽어야 할 일이 생기면,
--    RLS 를 끄지 말고 **필요한 만큼만 정책을 추가**할 것.
--    (예: content_comments 는 published 콘텐츠의 댓글만 select 허용)
--
-- ■ 되돌리기
--   alter table public.<이름> disable row level security;
--   — 다만 되돌리는 순간 위 노출이 그대로 재현된다. 정책 추가로 풀 것.

alter table public.content_comments   enable row level security;
alter table public.content_reactions  enable row level security;
alter table public.ig_boosts          enable row level security;
alter table public.algo_coach         enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_broadcasts    enable row level security;
