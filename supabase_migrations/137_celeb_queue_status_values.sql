-- 137 — celeb_brief_queue.status CHECK 를 코드가 실제로 쓰는 값에 맞춘다
--
-- 발견 경위 (2026-08-26) ────────────────────────────────────────────────
-- 셀럽 게이트를 넣으면서 새 상태 'skipped_no_celeb' 을 쓰려다 CHECK 제약을
-- 확인했더니, **코드가 이미 쓰고 있는 값 4개가 제약에 없었다.**
--
--   제약에 있던 값: queued working done failed
--                   publish_queued publishing published publish_failed
--   코드가 쓰는 값 중 빠진 것:
--                   web_queued web_publishing web_published web_publish_failed
--
-- 즉 "웹만" 경로(도메니코의 웹 전용 게시 명령)는 **한 번도 동작한 적이 없다.**
-- webhook 이 status='web_queued' 로 넣으려는 순간 제약에 걸려 실패하고,
-- celeb-brief.js 349 줄의 web_queued 조회는 영원히 0건이었다.
-- 실측: celeb_brief_queue 전체에서 web_ 로 시작하는 상태 행 0건.
--
-- 값 목록을 코드와 한곳에서 맞춘다. 앞으로 상태를 늘리면 이 파일도 같이 고친다
-- (tests/celeb-brief-ratio-gate.test.js 가 코드와 이 파일을 대조한다).
-- 데이터는 건드리지 않는다 — 제약만 교체한다.

ALTER TABLE public.celeb_brief_queue DROP CONSTRAINT IF EXISTS celeb_brief_queue_status_chk;

ALTER TABLE public.celeb_brief_queue ADD CONSTRAINT celeb_brief_queue_status_chk
  CHECK (status = ANY (ARRAY[
    'queued','working','done','failed',
    'skipped_no_celeb',                                   -- 인물 없는 브랜드 캠페인 (137)
    'publish_queued','publishing','published','publish_failed',
    'web_queued','web_publishing','web_published','web_publish_failed'
  ]));
