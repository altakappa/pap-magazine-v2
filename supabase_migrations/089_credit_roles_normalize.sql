-- 089_credit_roles_normalize.sql
-- ═══════════════════════════════════════════════════════════════════
-- 크레딧 역할 표준화 — 기존 에디토리얼 데이터 정리 (2026-07-21)
--
-- 배경: 서브미션 제출 페이지('Photo'/'MUAH')와 관리자 에디토리얼 등록
-- ('Photographer'/'Make Up')의 역할 명칭이 달라 같은 역할이 갈라져 저장됐다.
-- 코드 쪽은 api/_lib/creditRoles.js(SSOT) + review.js 연결로 해결했고,
-- 이 마이그레이션은 그 이전에 쌓인 데이터를 표준값으로 정리한다.
--
-- ⚠ 이 파일의 별칭 목록은 api/_lib/creditRoles.js 의 ALIASES 와 같아야 한다.
--   생성 당시 JS에서 자동 추출해 손으로 옮기다 생기는 오차를 없앴다.
--
-- 실행 전 백업 (실제로 실행함):
--   create table _backup_editorial_credits_20260721 as
--   select id, credits, now() as backed_up_at from editorials
--   where jsonb_typeof(credits)='array';           -- 2,453건 백업됨
--
-- 롤백:
--   update editorials e set credits = b.credits
--   from _backup_editorial_credits_20260721 b where e.id = b.id;
--
-- 실행 결과 (2026-07-21):
--   표준화율 55.0% → 70.8% (표준값 857 / 전체 1,211)
--   대상 33종 약 194건 변환, 잔존 비표준 대상값 0건
--
-- 남은 354건은 의도적으로 보존한다:
--   · 'Fashion by'(201) 'Beauty by'(27) — 사람 크레딧이 아니라 브랜드
--     크레딧. api/_lib/brandExtract.js 가 인스타 캡션의 "Fashion by @brand"
--     줄과 /go/ 제휴 링크를 만드는 데 쓴다. 역할로 흡수하면 둘 다 깨진다.
--   · 'Assistant'(9) 'Assist'(5) 'Designer' — 무엇의 보조인지 알 수 없다.
--   · 'Nails' 'BTS' 'Lighting' 'Fashion PR' 'Showrooms' 등 — 실제로 쓰이는
--     고유 역할. 표준 목록에 없다고 지우거나 뭉뚱그리면 크레딧을 잘못
--     붙이게 되고, 그건 창작자에게 실례다. 자유입력 역할로 남긴다.
-- ═══════════════════════════════════════════════════════════════════

with alias(k, canon) as (values
  ('photo','Photographer'),('photography','Photographer'),('photographer','Photographer'),
  ('photo assist','Photographer assist'),('photo asst','Photographer assist'),
  ('photo assistant','Photographer assist'),('photographer assist','Photographer assist'),
  ('photography assist','Photographer assist'),
  ('styling','Stylist'),('stylist','Stylist'),('fashion stylist','Stylist'),
  ('styling assist','Stylist assist'),('styling asst','Stylist assist'),
  ('styling assistant','Stylist assist'),('stylist assist','Stylist assist'),
  ('stylist assistant','Stylist assist'),
  ('makeup','Make Up'),('make up','Make Up'),('mua','Make Up'),
  ('makeup assist','Make Up assist'),('make up assist','Make Up assist'),
  ('hair','Hair'),('hair stylist','Hair'),('hair assist','Hair assist'),
  ('muah','Make Up & Hair'),('hmua','Make Up & Hair'),('makeup hair','Make Up & Hair'),
  ('make up hair','Make Up & Hair'),('makeup and hair','Make Up & Hair'),('hair makeup','Make Up & Hair'),
  ('set design','Set Design'),('set designer','Set Design'),
  ('set design assist','Set Design assist'),('set assist','Set Design assist'),('set assistance','Set Design assist'),
  ('production','Producer'),('producer','Producer'),
  ('production assist','Production assist'),('producer assist','Production assist'),
  ('art dir','Art Director'),('art director','Art Director'),('art direction','Art Director'),
  ('creative dir','Creative Director'),('creative director','Creative Director'),('creative direction','Creative Director'),
  ('casting','Casting Director'),('casting director','Casting Director'),
  ('retouch','Retouching'),('retoucher','Retouching'),('retouching','Retouching'),
  ('agency','Talent Agency'),('talent agency','Talent Agency'),   -- 도메니코 확인: 모델 에이전시 맞음
  ('dop','DOP / Cinematographer'),('cinematographer','DOP / Cinematographer'),
  ('video dir','Video Director'),('video director','Video Director')
),
rebuilt as (
  -- 크레딧 배열의 순서(ord)를 유지한 채 roles[] 만 표준값으로 치환.
  -- distinct 로 'Makeup'+'Make Up' 같은 중복 병합도 함께 처리된다.
  select e.id,
         jsonb_agg(
           case when jsonb_typeof(c.c->'roles')='array'
                then jsonb_set(c.c, '{roles}', (
                       select coalesce(jsonb_agg(distinct coalesce(a.canon, rl.role)), '[]'::jsonb)
                       from jsonb_array_elements_text(c.c->'roles') as rl(role)
                       left join alias a
                         on a.k = btrim(lower(regexp_replace(regexp_replace(rl.role,'[.&/,]',' ','g'),'\s+',' ','g')))
                     ))
                else c.c end
           order by c.ord
         ) as new_credits
  from editorials e,
       lateral jsonb_array_elements(e.credits) with ordinality as c(c, ord)
  where jsonb_typeof(e.credits)='array'
  group by e.id
)
update editorials e
set credits = r.new_credits
from rebuilt r
where e.id = r.id
  and e.credits is distinct from r.new_credits;   -- 안 바뀐 행은 건드리지 않는다
