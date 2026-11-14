-- 188 — 댓글 익명 개방 + '착장 식별' 구조 (2026-11-14, 도메니코 결정 "익명 허용")
--
-- 왜: 112 에서 댓글을 로그인 필수로 뒀다. 실측 3개월: 기사 조회 월 약 17만(봇 제외),
-- 로그인 상태 조회 주 0~6건, 댓글 누적 0건. 벽이 가입 유인이 되려면 벽 앞에 사람이
-- 있어야 하는데 아무도 없었다. 별점(08-12)과 같은 방침으로 쓰기를 연다 — 주인은
-- 서버가 정한다(로그인 uuid / 비로그인 ip 해시), 클라이언트 값은 안 믿는다.
--
-- '착장 식별': 패션 독자가 매일 하는 참여는 "저거 어디 거?" 다. 셀럽 기사마다
-- 브랜드·아이템을 달 수 있게 구조 칸을 둔다. 브랜드가 기사 태그와 맞으면 verified.
-- (45_Business/2026-11-14-디시인사이드-수익구조-벤치마크.md)

ALTER TABLE public.content_comments
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS anon_key   TEXT,                               -- 'ip:<hash>' (서버 생성)
  ADD COLUMN IF NOT EXISTS nickname   TEXT,                               -- 비로그인 표시 이름 (2~20자)
  ADD COLUMN IF NOT EXISTS kind       TEXT NOT NULL DEFAULT 'text',       -- 'text' | 'outfit'
  ADD COLUMN IF NOT EXISTS brand      TEXT,                               -- 착장 식별: 브랜드
  ADD COLUMN IF NOT EXISTS item       TEXT,                               -- 착장 식별: 아이템
  ADD COLUMN IF NOT EXISTS verified   BOOLEAN NOT NULL DEFAULT false;     -- 브랜드가 기사 태그와 일치

ALTER TABLE public.content_comments DROP CONSTRAINT IF EXISTS content_comments_owner_chk;
ALTER TABLE public.content_comments
  ADD CONSTRAINT content_comments_owner_chk CHECK (user_id IS NOT NULL OR anon_key IS NOT NULL);
ALTER TABLE public.content_comments DROP CONSTRAINT IF EXISTS content_comments_kind_chk;
ALTER TABLE public.content_comments
  ADD CONSTRAINT content_comments_kind_chk CHECK (kind IN ('text','outfit'));
ALTER TABLE public.content_comments DROP CONSTRAINT IF EXISTS content_comments_nick_chk;
ALTER TABLE public.content_comments
  ADD CONSTRAINT content_comments_nick_chk CHECK (nickname IS NULL OR char_length(nickname) BETWEEN 1 AND 20);
ALTER TABLE public.content_comments DROP CONSTRAINT IF EXISTS content_comments_brand_chk;
ALTER TABLE public.content_comments
  ADD CONSTRAINT content_comments_brand_chk CHECK (brand IS NULL OR char_length(brand) BETWEEN 1 AND 40);
ALTER TABLE public.content_comments DROP CONSTRAINT IF EXISTS content_comments_item_chk;
ALTER TABLE public.content_comments
  ADD CONSTRAINT content_comments_item_chk CHECK (item IS NULL OR char_length(item) BETWEEN 1 AND 80);

CREATE INDEX IF NOT EXISTS idx_content_comments_anon ON public.content_comments (anon_key, created_at DESC) WHERE anon_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_comments_outfit ON public.content_comments (target_type, target_id) WHERE kind = 'outfit' AND status = 'visible';

COMMENT ON COLUMN public.content_comments.anon_key IS '비로그인 작성자 키 ip:<hash>. 서버가 만든다. 삭제 권한 판정에 쓴다. 2026-11-14';
COMMENT ON COLUMN public.content_comments.kind IS 'text=일반, outfit=착장 식별(brand/item). 2026-11-14';
