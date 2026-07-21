-- 092: content_audit_log.action 에 'auto_published' 허용
-- ═══════════════════════════════════════════════════════════════════
-- 문제
--   api/cron/release-due-scheduled.js 는 예약 발행 건마다
--   recordContentChange({ action: 'auto_published', ... }) 를 남긴다.
--   그런데 content_audit_log_action_check 는
--     create / update / delete / publish / unpublish
--   만 허용한다. 그래서 이 insert 는 제약 위반으로 100% 거부돼 왔다.
--
--   크론 코드가 insert 실패를 try/catch 로 삼키고 계속 진행하도록 돼 있어
--   (한 건 때문에 배치 전체가 멈추지 않게 하려는 의도) 오류가 조용히 묻혔다.
--   실측 2026-07-21: action='auto_published' 행 0건, 예약 발행된 에디토리얼
--   26편 전부 감사 로그 없음.
--
-- 영향 범위 (중요)
--   실제 "발행"은 이 크론이 하지 않는다. 공개 API 가
--   status='published' AND (scheduled_publish_at IS NULL OR <= now())
--   로 시각 게이팅을 하므로, 예약 콘텐츠는 시각이 되면 크론과 무관하게 공개된다.
--   따라서 발행 지연은 없었고, 누락된 것은 "누가/언제 자동 발행했는지"의
--   감사 기록뿐이다.
--
-- 조치
--   허용값에 'auto_published' 를 추가한다. 사람이 누른 'publish' 와
--   시스템 자동 발행을 구분해 남기기 위한 값이라 기존 값에 합치지 않는다.
--
-- 되돌리기
--   ALTER TABLE content_audit_log DROP CONSTRAINT content_audit_log_action_check;
--   ALTER TABLE content_audit_log ADD CONSTRAINT content_audit_log_action_check
--     CHECK (action = ANY (ARRAY['create','update','delete','publish','unpublish']));
--   (되돌리기 전에 action='auto_published' 행을 먼저 정리해야 한다)

ALTER TABLE content_audit_log
  DROP CONSTRAINT IF EXISTS content_audit_log_action_check;

ALTER TABLE content_audit_log
  ADD CONSTRAINT content_audit_log_action_check
  CHECK (action = ANY (ARRAY[
    'create'::text,
    'update'::text,
    'delete'::text,
    'publish'::text,
    'unpublish'::text,
    'auto_published'::text
  ]));
