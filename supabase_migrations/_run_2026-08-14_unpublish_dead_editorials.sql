-- ============================================================
-- 이미지가 전부 죽은 화보 4편 비공개 전환 (2026-08-14)
--   Supabase SQL Editor 에서 **도메니코가 직접 실행**
-- ============================================================
--
-- 왜 ─────────────────────────────────────────────────────────
-- 아래 4편은 갤러리 이미지가 100% 죽은 주소(Wix 403 · 구글드라이브 404)를
-- 가리키고 있다. 라이브 확인 결과 독자에게는 "사진이 깨진 페이지"가 아니라
-- **검은 화면에 제목만 있는 빈 페이지**로 보인다.
-- Max Mara · WOOYOUNGMI · David Catalan 은 브랜드 이름이 걸린 페이지라
-- 레퍼런스로 열어볼 수 있는 사람이 있다.
--
-- 원본을 찾으면 되살린다. 그때까지만 내린다. **삭제가 아니다.**
--
-- ⚠️ 발행 상태 변경은 도메니코 권한이다. 나는 초안까지만.
-- ============================================================

-- STEP 1 — 먼저 눈으로 확인한다 (아무것도 바꾸지 않는다)
select id, title, status, slug,
       coalesce(array_length(gallery,1),0) as 갤러리장수
from public.editorials
where id in (
  '8828f869-1c71-45d2-b437-f9bdd7f0b9d2',  -- Max Mara SS21        갤러리 44장 전부 죽음 + 커버
  'ae481e31-8ca8-4482-82c1-33cdf3c4164b',  -- David Catalan SS21   갤러리 21장 전부 죽음 + 커버
  'ad1d28b1-aa24-4bb0-8661-265f3cb4ad68',  -- WOOYOUNGMI SS2021    갤러리 17장 전부 죽음 + 커버
  '438bdda8-1332-4107-b5fe-77a0dff85666'   -- The Five Elements    갤러리 10장 전부 죽음
);
-- → 4행이 나오고 status 가 전부 'published' 인지 확인할 것.
--   개수가 다르면 여기서 멈추고 알릴 것.


-- STEP 2 — 비공개로 내린다 (STEP 1 확인 후에만)
update public.editorials
   set status = 'draft'
 where id in (
  '8828f869-1c71-45d2-b437-f9bdd7f0b9d2',
  'ae481e31-8ca8-4482-82c1-33cdf3c4164b',
  'ad1d28b1-aa24-4bb0-8661-265f3cb4ad68',
  '438bdda8-1332-4107-b5fe-77a0dff85666'
 )
   and status = 'published';   -- 이미 draft 인 건 건드리지 않는다
-- → "UPDATE 4" 가 나와야 정상.


-- STEP 3 — 결과 확인
select title, status from public.editorials
where id in (
  '8828f869-1c71-45d2-b437-f9bdd7f0b9d2',
  'ae481e31-8ca8-4482-82c1-33cdf3c4164b',
  'ad1d28b1-aa24-4bb0-8661-265f3cb4ad68',
  '438bdda8-1332-4107-b5fe-77a0dff85666'
);
-- → 4편 전부 'draft' 면 완료.


-- ============================================================
-- 되돌리기 (원본을 다시 올린 뒤)
-- ============================================================
-- update public.editorials set status = 'published'
--  where id = '8828f869-1c71-45d2-b437-f9bdd7f0b9d2';   -- 한 편씩, 이미지 확인 후


-- ============================================================
-- 참고 — 내리지 않는 화보들 (일부만 깨짐, 읽을 수는 있다)
-- ============================================================
--   ROOM CARTEL        12/15   ← 가장 심하다. 원본 찾으면 우선 복구
--   ABSOLUTE BEGINERS   5/21 + 커버
--   ANDROMEDA           3/24 · ARMY OF ONE 3/19 · Unity Circle 2/14
--   그 외 24편          각 1~2장
--
-- 이 26편은 사진이 남아 있어 페이지가 성립한다. 판단은 도메니코.
-- 목록 전체:
--   select e.title, e.slug,
--          (select count(*) from unnest(e.gallery) g
--            where g in (select url from image_migration_failures)) as 죽은장수,
--          coalesce(array_length(e.gallery,1),0) as 총장수
--     from editorials e
--    where e.status='published'
--      and exists (select 1 from unnest(e.gallery) g
--                   where g in (select url from image_migration_failures))
--    order by 3 desc;
