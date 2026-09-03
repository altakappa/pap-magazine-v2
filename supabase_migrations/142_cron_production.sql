-- 142_cron_production.sql  (2026-09-03)
-- 크론 생산량 계약 — cron_runs 에 produced / remaining
--
-- 왜 ─────────────────────────────────────────────────────────
-- GROWTH-LEDGER 교훈 1("돌았다 ≠ 했다")이 이 저장소에서 가장 자주 재발한다.
-- 크론은 ok=true 를 남기고 성실히 도는데 생산은 0인 상태가, 짧게는 하루
-- 길게는 2주씩 안 보였다:
--
--   backfill-faq          2주간 0건 (앞 12건이 본문 짧은 사진 기사라 막힘)
--   서술문 백필 · 번역     같은 모양
--   화보 FAQ 언어판        24시간 0건 (callClaude 반환을 문자열로 오해)
--   영문 FAQ              첫 실행 전멸 (배치가 커서 응답이 잘림)
--
-- 그때마다 **그 크론 전용** 건강검사를 하나씩 만들었다 — faqHealth ·
-- backfillHealth · translateHealth · cronDurationHealth · aiCreditWatch.
-- 다섯 개다. 사고당 하나씩 만드는 구조라 **새 크론은 언제나 무방비**다.
-- 2026-08-28 에 내가 새로 만든 faqEnBackfill 이 그 증거다 — 같은 함정을 다 밟았다.
--
-- 그리고 그 검사들은 cron_runs.note **문자열을 정규식으로 파싱**한다.
-- ('FAQ 7/10 · 잔여 227' 같은 문장) note 문구를 바꾸면 감시가 조용히 눈이 먼다.
--
-- 무엇 ───────────────────────────────────────────────────────
-- 사람이 읽는 note 와 별개로, **기계가 읽는 숫자 두 개**를 남긴다.
--
--   produced   이번 실행에서 실제로 만든 건수
--   remaining  아직 남은 건수 (모르면 null)
--
-- 그러면 감시자 하나가 전 크론에 대해 같은 질문을 할 수 있다:
--   "생산 0이 N회 연속인데 잔여가 0이 아니다" = 앞이 막혔다.
--   (잔여도 0이면 완주다 — 정상이고 알리지 않는다.)
--
-- 둘 다 nullable 이다. 신고하지 않는 크론은 종전과 똑같이 동작한다 —
-- 이 마이그레이션만으로는 아무 동작도 바뀌지 않는다.
-- ============================================================

alter table cron_runs add column if not exists produced  integer;
alter table cron_runs add column if not exists remaining integer;

-- 감시자는 "최근 N회" 를 크론별로 훑는다. 그 접근에 맞춘 인덱스.
create index if not exists cron_runs_name_ran_idx on cron_runs (cron_name, ran_at desc);

-- 되돌리기
--   drop index if exists cron_runs_name_ran_idx;
--   alter table cron_runs drop column if exists produced;
--   alter table cron_runs drop column if exists remaining;
