-- 127_ig_watch_time.sql — 릴스 시청유지 수집 (2026-08-17)
--
-- 왜: 도메니코가 "시청유지·반복재생을 업계 최고치로" 를 요구했는데, 확인해 보니
-- 시청유지를 한 번도 수집한 적이 없었다. 릴스 30편에서 저장·공유·좋아요·댓글
-- 어느 참여율도 도달과 상관이 없다(전부 |r| < 0.12). 릴스 추천의 1차 신호인
-- 시청유지가 데이터에 아예 없으니 설명이 안 되는 게 당연하다.
--
-- 반복재생은 컬럼을 만들지 않는다. clips_replays_count 는 2025-04 에 폐기됐고,
-- 대리지표(조회/도달 = 계정당 평균 재생 횟수)는 기존 두 컬럼으로 계산된다.
-- 없는 값을 담을 빈 컬럼을 만드는 것이 더 나쁘다.
--
-- 단위는 밀리초 그대로 둔다. Instagram 이 ms 로 주고, 초로 바꿔 저장하면
-- 반올림 손실이 생기며 "왜 인스타 화면과 숫자가 다르냐" 를 매번 설명해야 한다.
ALTER TABLE ig_post_metric
  ADD COLUMN IF NOT EXISTS avg_watch_time_ms   INTEGER,
  ADD COLUMN IF NOT EXISTS total_watch_time_ms BIGINT;

COMMENT ON COLUMN ig_post_metric.avg_watch_time_ms   IS '릴스 평균 시청 시간(ms). ig_reels_avg_watch_time. 영상이 아니거나 API 미지원이면 NULL';
COMMENT ON COLUMN ig_post_metric.total_watch_time_ms IS '릴스 총 시청 시간(ms). ig_reels_video_view_total_time. 영상이 아니거나 API 미지원이면 NULL';
