-- 167 (2026-09-24) — 크리에이터 화보 성적표 메일 기록 칸.
--
-- [왜] 도메니코 "세 조각 설정해줘" ②. 게재 2~3주 뒤 크리에이터에게
--   인스타 도달·좋아요·저장·공유·웹 조회를 담은 성적표를 한 번 보낸다.
--   근거: 첫 제출 60일 이상 지난 크리에이터 51명 중 재제출 3명(6%).
--   승인된 크리에이터 85명 중 63명은 승인 뒤 PAP 에서 메일을 한 통도 못 받았다.
--   그런데 그들 화보의 인스타 도달은 2천~2만 4천이다. 이 숫자를 본인이 모른다.
--
-- [칸]
--   report_card_sent_at   보낸 시각. 있으면 다시 안 보낸다 (한 화보에 한 번).
--   report_card_status    sent / skipped_low / no_email / failed:<사유>
--   report_card_attempts  실패 재시도 횟수 (3번 넘으면 포기)
--
-- 발송 스위치는 코드가 아니라 site_settings('creator_report_card').value.send 다.
-- 행이 없으면 꺼짐(미리보기만). 켜는 것은 도메니코 결정.

alter table public.editorials add column if not exists report_card_sent_at timestamptz;
alter table public.editorials add column if not exists report_card_status text;
alter table public.editorials add column if not exists report_card_attempts integer not null default 0;
