-- 130 · 본문 보강 초안에 '이미지 속 글자를 읽었는가' 표시 (2026-08-18)
--
-- 왜 필요한가 — 실측:
--   워터밤 초안(노출 6,300, 2위 페이지)이 라인업 포스터를 읽어 날짜별
--   출연진 단락을 만들었다. 린터 경보는 0건이었다. 그런데 사람이 포스터
--   원본과 대조하니 4곳이 틀렸다:
--     NGHTMRE → 엔플라잉 / J.Y.PARK → 박재범 /
--     NOWIMYOUNG → 임영웅 / KC[SIK-K] → 케이시
--   린터는 문체만 본다. 사실은 아무도 안 본다.
--
-- 왜 자동 판별이 아니라 모델 신고인가 — 실제로 시험해 보고 버렸다:
--   초안 31편에 '새로 등장한 토큰' 방식을 돌렸다.
--     영문·숫자만  → 11편 표시. 한국어 이름 오독을 통째로 놓친다
--     한글 3자 이상 → 31편 전부 표시. '장악하고' '잇는다' 같은 어미
--                    변화가 새 단어로 잡혀 쓸모가 없다
--   출력만 보고는 못 가른다. 무엇을 근거로 썼는지는 **모델만 안다.**
--   그래서 추론하지 않고 물어본다.
--
-- 이 표시는 반려 사유가 아니라 **검수 우선순위**다.
--   true  → 사람이 원본 이미지와 대조해야 한다 (이름·날짜·숫자가 걸려 있다)
--   false → 색·실루엣·배경 묘사뿐이다. 틀려도 손해가 작다
ALTER TABLE public.article_body_backfill
  ADD COLUMN IF NOT EXISTS reads_image_text BOOLEAN,
  ADD COLUMN IF NOT EXISTS image_text_note  TEXT;

COMMENT ON COLUMN public.article_body_backfill.reads_image_text IS
  '초안이 이미지 속 글자(이름·날짜·수치·계정명)를 읽어 본문에 옮겼는가. 모델 자가신고. true 면 사람이 원본 대조 필요';
COMMENT ON COLUMN public.article_body_backfill.image_text_note IS
  '이미지에서 읽었다고 신고한 글자 그대로. 대조할 때 이것부터 본다';
