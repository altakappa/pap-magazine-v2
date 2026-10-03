-- 176: 인스타그램 아이디 확인 도장 (2026-10-03, 도메니코 "속이면?" → "그렇게 해줘")
-- 왜: 인스타 아이디 등록(9/12)은 그 계정의 주인인지 확인하지 않는다. 10/2 '내 크레딧 가져가기' 버튼이 그 문을
--     넓혔다. 남의 아이디로 등록 + 프리미엄이면 기여자 페이지 연락 버튼(브랜드 제안)이 가짜에게 간다.
-- 무엇: profiles.instagram_verified_at. 관리자가 확인하면 찍힌다. 연락 버튼·프리미엄 배지는 도장 있을 때만.
--     이 마이그레이션 시점에 이미 등록된 65명은 '내 크레딧 가져가기'(미배포) 이전 등록이라 일괄 도장(grandfather).
alter table public.profiles add column if not exists instagram_verified_at timestamptz;
update public.profiles set instagram_verified_at = coalesce(instagram_verified_at, now())
  where instagram is not null and instagram_verified_at is null;
