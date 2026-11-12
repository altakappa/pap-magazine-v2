-- ──────────────────────────────────────────────────────────────────────
-- 186 — 제보 미디어 버킷 (2026-11-12)
--
-- 도메니코 2026-11-11: "제보는 특별히 1기가 용량까지 허락해주자 하지만
--   일주일뒤 보관하지않고 삭제하는걸로해줘"
--
-- ■ 비공개다
-- 제보 영상은 확인되기 전에 아무도 봐선 안 된다. 공개 버킷에 두면 경로를
-- 아는 사람은 누구나 볼 수 있다 — 초상권이 걸린 영상에서는 그 자체가 사고다.
-- 관리자 화면은 service_role 로 서명 URL 을 만들어 본다.
--
-- ■ 1GB · MIME 는 앱 화이트리스트와 **정확히 같아야 한다**
-- 어긋나면 앱은 통과시켰는데 스토리지가 거부하는 '조용한 실패' 가 된다
-- (.claude/rules/api.md 업로드 검증 규칙). 2단계 직접 업로드는 바이트가
-- 서버를 거치지 않으므로 버킷 MIME 강제가 **유일한 관문**이다.
--   앱 쪽 목록: api/news-tips/upload-url.js 의 ALLOWED_MIME
--
-- HEIC/HEIF 를 받는 이유: 아이폰으로 찍은 사진이 그 포맷으로 올라온다.
-- 브라우저가 미리보기를 못 그리는 포맷이지만(submissions 에서 TIFF 를 뺀 것과
-- 같은 문제), 제보는 증거가 우선이다. 받아 두고 관리자 화면에서는 미리보기
-- 대신 내려받기 링크를 준다. 거부하면 증거 자체를 잃는다.
--
-- ■ 채택분 영구 보관
-- 새 버킷을 또 만들지 않고 기존 공개 버킷 `media` 의 news-tips/ 아래로 복사한다.
-- 발행된 기사에 실리려면 공개로 읽혀야 하고, `media` 는 이미 공개이며 제한이
-- 없다. 버킷을 늘릴수록 MIME·크기 설정이 어긋날 자리가 늘어난다.
--
-- 실행: Supabase SQL Editor
--   https://supabase.com/dashboard/project/igcazquhkwxtqsaqpznx/sql/new
-- ──────────────────────────────────────────────────────────────────────

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'news-tips', 'news-tips', FALSE,
  1073741824,                            -- 1 GiB
  ARRAY[
    'video/mp4', 'video/quicktime',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = 1073741824,
  allowed_mime_types = ARRAY[
    'video/mp4', 'video/quicktime',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
  ];

COMMIT;

-- 확인: public=false · 1073741824 · MIME 7종
-- SELECT id, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets WHERE id = 'news-tips';
