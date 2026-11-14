-- 189 — "이 착장 어디 거?" 착장 식별 (2026-11-14)
--
-- 왜: 웹 커뮤니티 기능은 다 있는데 글 0·댓글 0 (11/14 실측). 백지에 "글 써라"는
-- 안 된다. 가장 낮은 문턱의 참여 = 한 번 탭. 패션 독자가 매일 하는 질문
-- "저거 어디 거?"에 답하는 자리를 기사마다 둔다 (디시인사이드 벤치마크:
-- 매일 오는 이유는 콘텐츠가 아니라 참여 거리다).
-- 설계: PAP-Vault/45_Business/2026-11-14-착장식별-참여거리-설계.md
--
-- 흐름: 발행 시 태그 ↔ brands 대조로 '제안됨' 자동 생성 → 독자 '맞아요/아니에요'
-- (로그인 불필요, 1인 1표) → 맞아요 3표 확정 · 아니에요 3표 숨김 → 독자 제안은 로그인.

CREATE TABLE IF NOT EXISTS public.article_outfit_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  brand_id    TEXT,                        -- brands.brand_id (있으면 /brand/<id> 로 연결)
  brand_name  TEXT NOT NULL,               -- 표시용
  product     TEXT,                        -- 제품명 (없을 수 있다)
  url         TEXT,                        -- 공식몰·제품 페이지 (제휴 링크는 나중)
  status      TEXT NOT NULL DEFAULT 'proposed'
              CHECK (status IN ('proposed','confirmed','hidden')),
  source      TEXT NOT NULL DEFAULT 'tag'  -- 'tag'(자동) | 'user' | 'admin'
              CHECK (source IN ('tag','user','admin')),
  created_by  UUID,                        -- 독자 제안이면 profiles.id
  yes_count   INT NOT NULL DEFAULT 0,
  no_count    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outfit_items_article ON public.article_outfit_items (article_id, status);
-- 같은 기사에 같은 브랜드+제품은 하나 (제품 없으면 브랜드 하나)
CREATE UNIQUE INDEX IF NOT EXISTS uq_outfit_items_article_brand_product
  ON public.article_outfit_items (article_id, lower(brand_name), lower(coalesce(product, '')));

CREATE TABLE IF NOT EXISTS public.article_outfit_votes (
  item_id     UUID NOT NULL REFERENCES public.article_outfit_items(id) ON DELETE CASCADE,
  voter_key   TEXT NOT NULL,               -- 'u:<uuid>' | 'ip:<hash>' (content/react 와 같은 규칙)
  vote        SMALLINT NOT NULL CHECK (vote IN (1, -1)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, voter_key)
);

ALTER TABLE public.article_outfit_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_outfit_votes ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = service_role(API) 전용. 읽기도 API 를 거친다 (숨김 항목·투표 키 노출 방지).
REVOKE ALL ON public.article_outfit_items FROM anon, authenticated;
REVOKE ALL ON public.article_outfit_votes FROM anon, authenticated;
