-- 176 · threads_posts.text — 올라간 본문 보관 (2026-10-03)
--
-- 왜: 2026-10-03 도메니코 "스레드 말투는 여전히 AI 같다" → 말투를 X 와 같은
-- 뼈대(papVoice.CAPTION_CORE)로 바꿨다. 그런데 스레드는 올라간 본문을 DB 에
-- 남기지 않아 "좋아졌는가"를 읽을 수단이 도메니코 눈뿐이었다. X 는
-- x_posts.text 가 있어서 2026-09-29 말투 1차 수정이 틀린 걸 본문으로 잡았다.
-- 같은 눈금을 스레드에도 둔다.
--
-- ALTER ... ADD COLUMN 이라 새 GRANT 불필요. threads_posts 는 service_role 전용,
-- RLS 정책 변경 없음. 쓰는 쪽: api/_lib/threadsAutopost.js (meta.text).
-- 미적용 환경에서는 threadsAutopost 가 메타를 떼고 기본 필드로 재시도한다(097 과 같은 방어).

ALTER TABLE public.threads_posts
  ADD COLUMN IF NOT EXISTS text text;

COMMENT ON COLUMN public.threads_posts.text IS
  '올라간 본문(최대 2000자). 2026-10-03 부터. 말투 검증용 — threadsAutopost.meta.text';
