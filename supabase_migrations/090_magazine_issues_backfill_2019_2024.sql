-- 090_magazine_issues_backfill_2019_2024.sql
-- 매거진 발행호 2019~2024 백필 (QA: "매거진 발행호 2019~2024 관리자 미등록")
-- ═══════════════════════════════════════════════════════════════════
-- 문제: 웹사이트 magazine.html 은 2019~2024 발행호를 "하드코딩된 정적
--       HTML 카드"로 보여주고 있었고, DB(magazine_issues)에는 VOL.25~31
--       (2025~2026)만 존재했다. 그래서 관리자에서 과거 발행호를 열람·수정·
--       비활성화할 수단이 아예 없었다. 표시 상한 문제가 아니라 "데이터가
--       존재한 적 없음"이 원인 — 에디토리얼 이관 건과는 성격이 다르다.
--
-- 무엇을 넣나: frontend/magazine.html 의 정적 카드 71개(2019-02 ~ 2024-12)를
--       기존 스키마와 같은 분기 볼륨 구조(VOL.1~VOL.24)로 재구성한다.
--
-- 번호 규칙 검증 (추측이 아니라 기존 데이터와 교차검증함):
--   · 월간 호수 = 2019-02 를 1호로 하는 연속 번호.
--     이 규칙으로 계산한 2025-01 = 72호가 DB 의 months[0].issue_number(72)
--     와 정확히 일치한다. 2026-03 = 86호도 DB(86)와 일치.
--   · 정적 HTML 과 DB 가 겹치는 15건(2025-01~2026-03)에서 호수·편집물 수·
--     link_url 이 전부 일치함을 확인했다 — 파서가 옳다는 근거.
--   · 볼륨 번호: VOL.25 = 2025 Q1 기준 역산 → 2019 Q1 이 VOL.1 로 정확히
--     떨어진다(24개 볼륨). 2019 는 2월 창간이라 VOL.1 만 2개월이며,
--     라벨도 실제 수록 월에 맞춰 'FEB–MAR 2019' 로 둔다(JAN 호는 없다).
--   · 볼륨 cover_image 는 기존 행과 같게 "마지막 달의 커버"를 쓴다
--     (VOL.25~30 전부 그 규칙, 확인 완료).
--
-- is_active = true 로 넣는다: 이 발행호들은 지금도 사이트에 공개 노출 중이므로
--       현재 상태를 그대로 반영하는 것이 맞다. 비공개로 두고 검수하려면
--       아래 롤백 대신 `update magazine_issues set is_active=false where issue_number<=24;`
--
-- ⚠ 이 백필만으로는 magazine.html 화면이 바뀌지 않는다. 그 페이지는 아직
--   정적 카드를 그린다. 관리자에서 수정한 내용이 화면에 반영되게 하려면
--   magazine.html 을 API 기반 렌더링으로 전환하는 후속 작업이 필요하다.
--
-- 롤백:
--   delete from magazine_issues where issue_number between 1 and 24;

begin;

-- 안전장치: 1~24 가 이미 있으면 중단(중복 삽입 방지)
do $$
begin
  if exists (select 1 from magazine_issues where issue_number between 1 and 24) then
    raise exception '이미 VOL.1~24 가 존재합니다 — 중복 삽입 중단';
  end if;
end $$;

insert into magazine_issues
  (issue_number, title, issue_year, issue_month, month_label, cover_image,
   editorial_count, link_url, is_latest, is_active, sort_order, months)
values
  (1, 'Vol. 1', 2019, 2, 'FEB–MAR 2019', 'https://drive.google.com/thumbnail?id=1CkHaes2FJG5AD9oiuBVVEQGMcrm9aZ9H&sz=w1600', 52, NULL, false, true, 1,
   '[{"label": "FEB 2019", "month": 2, "link_url": "PAP_Magazine_February_2019.html", "cover_image": "https://drive.google.com/thumbnail?id=1NKDNBwPaGn1AZeoc0aq2J2-OADEVnrmt&sz=w1600", "issue_number": 1, "editorial_count": 21}, {"label": "MAR 2019", "month": 3, "link_url": "PAP_Magazine_March_2019.html", "cover_image": "https://drive.google.com/thumbnail?id=1CkHaes2FJG5AD9oiuBVVEQGMcrm9aZ9H&sz=w1600", "issue_number": 2, "editorial_count": 31}]'::jsonb),
  (2, 'Vol. 2', 2019, 4, 'APR–JUN 2019', 'https://drive.google.com/thumbnail?id=1Xi5is7CrxJyC2C8r2aGRr3NWhOu99haN&sz=w1600', 85, NULL, false, true, 2,
   '[{"label": "APR 2019", "month": 4, "link_url": "PAP_Magazine_April_2019.html", "cover_image": "https://drive.google.com/thumbnail?id=1O600ShrvX0HG2tjtnsEEQyby9i1z73eH&sz=w1600", "issue_number": 3, "editorial_count": 30}, {"label": "MAY 2019", "month": 5, "link_url": "PAP_Magazine_May_2019.html", "cover_image": "https://drive.google.com/thumbnail?id=18Ky2GeG6sCarxN4tEN81HrhOHZbPMjM9&sz=w1600", "issue_number": 4, "editorial_count": 26}, {"label": "JUN 2019", "month": 6, "link_url": "PAP_Magazine_June_2019.html", "cover_image": "https://drive.google.com/thumbnail?id=1Xi5is7CrxJyC2C8r2aGRr3NWhOu99haN&sz=w1600", "issue_number": 5, "editorial_count": 29}]'::jsonb),
  (3, 'Vol. 3', 2019, 7, 'JUL–SEP 2019', 'https://drive.google.com/thumbnail?id=1OztnKUF0lktNa5z3FLnQEGlOhg43Zo00&sz=w1600', 91, NULL, false, true, 3,
   '[{"label": "JUL 2019", "month": 7, "link_url": "PAP_Magazine_July_2019.html", "cover_image": "https://drive.google.com/thumbnail?id=1BbcGGDUnnV3XXSU4xADPiZgbzJgDFeLr&sz=w1600", "issue_number": 6, "editorial_count": 32}, {"label": "AUG 2019", "month": 8, "link_url": "PAP_Magazine_August_2019.html", "cover_image": "https://drive.google.com/thumbnail?id=1RAeIvVTXCsTMdIn9fH4fCtXPTW4q3dfR&sz=w1600", "issue_number": 7, "editorial_count": 29}, {"label": "SEP 2019", "month": 9, "link_url": "PAP_Magazine_September_2019.html", "cover_image": "https://drive.google.com/thumbnail?id=1OztnKUF0lktNa5z3FLnQEGlOhg43Zo00&sz=w1600", "issue_number": 8, "editorial_count": 30}]'::jsonb),
  (4, 'Vol. 4', 2019, 10, 'OCT–DEC 2019', 'https://drive.google.com/thumbnail?id=1UQhojFszH7GWYNsRc-qombRjRQrRlkko&sz=w1600', 88, NULL, false, true, 4,
   '[{"label": "OCT 2019", "month": 10, "link_url": "PAP_Magazine_October_2019.html", "cover_image": "https://drive.google.com/thumbnail?id=1qK76QqEXrYsU3WXjbgEUGcyUQMeoMBDv&sz=w1600", "issue_number": 9, "editorial_count": 27}, {"label": "NOV 2019", "month": 11, "link_url": "PAP_Magazine_November_2019.html", "cover_image": "https://drive.google.com/thumbnail?id=1EHlnrIQHjZQj2bfd616W72H8vuin4u6b&sz=w1600", "issue_number": 10, "editorial_count": 30}, {"label": "DEC 2019", "month": 12, "link_url": "PAP_Magazine_December_2019.html", "cover_image": "https://drive.google.com/thumbnail?id=1UQhojFszH7GWYNsRc-qombRjRQrRlkko&sz=w1600", "issue_number": 11, "editorial_count": 31}]'::jsonb),
  (5, 'Vol. 5', 2020, 1, 'JAN–MAR 2020', 'https://drive.google.com/thumbnail?id=1jsx7FqmiL0PyT3denqtASR3E4kDniJ1t&sz=w1600', 89, NULL, false, true, 5,
   '[{"label": "JAN 2020", "month": 1, "link_url": "PAP_Magazine_January_2020.html", "cover_image": "https://drive.google.com/thumbnail?id=1AktORC_2Oqx7zp3gB6w8Qk2XetnNCUDm&sz=w1600", "issue_number": 12, "editorial_count": 32}, {"label": "FEB 2020", "month": 2, "link_url": "PAP_Magazine_February_2020.html", "cover_image": "https://drive.google.com/thumbnail?id=1rtFmphC8kHHKODZQDov8nV3GVC5x1lch&sz=w1600", "issue_number": 13, "editorial_count": 28}, {"label": "MAR 2020", "month": 3, "link_url": "PAP_Magazine_March_2020.html", "cover_image": "https://drive.google.com/thumbnail?id=1jsx7FqmiL0PyT3denqtASR3E4kDniJ1t&sz=w1600", "issue_number": 14, "editorial_count": 29}]'::jsonb),
  (6, 'Vol. 6', 2020, 4, 'APR–JUN 2020', 'https://drive.google.com/thumbnail?id=1jQ2r2ntXOAIO7z1tFSVe9DPLQCJjcuzu&sz=w1600', 87, NULL, false, true, 6,
   '[{"label": "APR 2020", "month": 4, "link_url": "PAP_Magazine_April_2020.html", "cover_image": "https://drive.google.com/thumbnail?id=1jR1mnS1gIG4XCeSf7ehP-sWVDSvPS549&sz=w1600", "issue_number": 15, "editorial_count": 31}, {"label": "MAY 2020", "month": 5, "link_url": "PAP_Magazine_May_2020.html", "cover_image": "https://drive.google.com/thumbnail?id=1osSElRgNKImRqibwyvWen5ogcUwwjh-5&sz=w1600", "issue_number": 16, "editorial_count": 28}, {"label": "JUN 2020", "month": 6, "link_url": "PAP_Magazine_June_2020.html", "cover_image": "https://drive.google.com/thumbnail?id=1jQ2r2ntXOAIO7z1tFSVe9DPLQCJjcuzu&sz=w1600", "issue_number": 17, "editorial_count": 28}]'::jsonb),
  (7, 'Vol. 7', 2020, 7, 'JUL–SEP 2020', 'https://drive.google.com/thumbnail?id=1Aj1wmHYBjWsLigmoPs3UdsQW4AqKM2Ad&sz=w1600', 51, NULL, false, true, 7,
   '[{"label": "JUL 2020", "month": 7, "link_url": "PAP_Magazine_July_2020.html", "cover_image": "https://drive.google.com/thumbnail?id=14p_UKqqhPDi7kPg-54TJq-6JiyGG1FU-&sz=w1600", "issue_number": 18, "editorial_count": 5}, {"label": "AUG 2020", "month": 8, "link_url": "PAP_Magazine_August_2020.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/KOREAN_GYMNAS_Ti_CS_d3ff607095.jpg", "issue_number": 19, "editorial_count": 23}, {"label": "SEP 2020", "month": 9, "link_url": "PAP_Magazine_September_2020.html", "cover_image": "https://drive.google.com/thumbnail?id=1Aj1wmHYBjWsLigmoPs3UdsQW4AqKM2Ad&sz=w1600", "issue_number": 20, "editorial_count": 23}]'::jsonb),
  (8, 'Vol. 8', 2020, 10, 'OCT–DEC 2020', 'https://drive.google.com/thumbnail?id=1_k-k_9PG0OHvTSWd8eZHvVh3CKUtNZqc&sz=w1600', 79, NULL, false, true, 8,
   '[{"label": "OCT 2020", "month": 10, "link_url": "PAP_Magazine_October_2020.html", "cover_image": "https://drive.google.com/thumbnail?id=10V01vLouKPvl_lIfhyuTQqNZaToG6dC6&sz=w1600", "issue_number": 21, "editorial_count": 22}, {"label": "NOV 2020", "month": 11, "link_url": "PAP_Magazine_November_2020.html", "cover_image": "https://drive.google.com/thumbnail?id=1Jf0Hgvzz_yxTiGQyKBjZ2iyH3qdHQw-K&sz=w1600", "issue_number": 22, "editorial_count": 31}, {"label": "DEC 2020", "month": 12, "link_url": "PAP_Magazine_December_2020.html", "cover_image": "https://drive.google.com/thumbnail?id=1_k-k_9PG0OHvTSWd8eZHvVh3CKUtNZqc&sz=w1600", "issue_number": 23, "editorial_count": 26}]'::jsonb),
  (9, 'Vol. 9', 2021, 1, 'JAN–MAR 2021', 'https://drive.google.com/thumbnail?id=1gBwbBFUQafdutDMTXu9msaQ8rDT_AZMg&sz=w1600', 74, NULL, false, true, 9,
   '[{"label": "JAN 2021", "month": 1, "link_url": "PAP_Magazine_January_2021.html", "cover_image": "https://drive.google.com/thumbnail?id=1AbDfKf_c0OieC_R66R99xvnOmw9puM4s&sz=w1600", "issue_number": 24, "editorial_count": 22}, {"label": "FEB 2021", "month": 2, "link_url": "PAP_Magazine_February_2021.html", "cover_image": "https://drive.google.com/thumbnail?id=1Rua-h5q_JT2GfU1hkV5PMsTk9tHkgvPd&sz=w1600", "issue_number": 25, "editorial_count": 26}, {"label": "MAR 2021", "month": 3, "link_url": "PAP_Magazine_March_2021.html", "cover_image": "https://drive.google.com/thumbnail?id=1gBwbBFUQafdutDMTXu9msaQ8rDT_AZMg&sz=w1600", "issue_number": 26, "editorial_count": 26}]'::jsonb),
  (10, 'Vol. 10', 2021, 4, 'APR–JUN 2021', 'https://drive.google.com/thumbnail?id=1Exw2S6KJwkAchw2KbtnKuP1N42VelaMB&sz=w1600', 77, NULL, false, true, 10,
   '[{"label": "APR 2021", "month": 4, "link_url": "PAP_Magazine_April_2021.html", "cover_image": "https://drive.google.com/thumbnail?id=1sbeMUsaYLcfDdwppJC5AbP5BW0vf_xM3&sz=w1600", "issue_number": 27, "editorial_count": 21}, {"label": "MAY 2021", "month": 5, "link_url": "PAP_Magazine_May_2021.html", "cover_image": "https://drive.google.com/thumbnail?id=1b2BBUUqfC8fzf73Xmn9hFUwCZq-IPs2h&sz=w1600", "issue_number": 28, "editorial_count": 30}, {"label": "JUN 2021", "month": 6, "link_url": "PAP_Magazine_June_2021.html", "cover_image": "https://drive.google.com/thumbnail?id=1Exw2S6KJwkAchw2KbtnKuP1N42VelaMB&sz=w1600", "issue_number": 29, "editorial_count": 26}]'::jsonb),
  (11, 'Vol. 11', 2021, 7, 'JUL–SEP 2021', 'https://drive.google.com/thumbnail?id=1EA86TBuTzuH_-TM5_GYVQ0j3pRYOnVC4&sz=w1600', 83, NULL, false, true, 11,
   '[{"label": "JUL 2021", "month": 7, "link_url": "PAP_Magazine_July_2021.html", "cover_image": "https://drive.google.com/thumbnail?id=1Eh43wwiJ-f6LSuozfVMHGkSZMaFSZuHk&sz=w1600", "issue_number": 30, "editorial_count": 24}, {"label": "AUG 2021", "month": 8, "link_url": "PAP_Magazine_August_2021.html", "cover_image": "https://drive.google.com/thumbnail?id=1BL4og4R_CBjCliZVX-uLyN73CfBAmpl8&sz=w1600", "issue_number": 31, "editorial_count": 30}, {"label": "SEP 2021", "month": 9, "link_url": "PAP_Magazine_September_2021.html", "cover_image": "https://drive.google.com/thumbnail?id=1EA86TBuTzuH_-TM5_GYVQ0j3pRYOnVC4&sz=w1600", "issue_number": 32, "editorial_count": 29}]'::jsonb),
  (12, 'Vol. 12', 2021, 10, 'OCT–DEC 2021', 'https://drive.google.com/thumbnail?id=1ahZiKkn-1cmqGZF-u3zyADGabf7mEwD0&sz=w1600', 78, NULL, false, true, 12,
   '[{"label": "OCT 2021", "month": 10, "link_url": "PAP_Magazine_October_2021.html", "cover_image": "https://drive.google.com/thumbnail?id=1lgC5CYmoAoFqfNZHxa-ovwC4pIvwN_tj&sz=w1600", "issue_number": 33, "editorial_count": 29}, {"label": "NOV 2021", "month": 11, "link_url": "PAP_Magazine_November_2021.html", "cover_image": "https://drive.google.com/thumbnail?id=1iXOnItkuEZJXkI1VMXvk-qUsiVUo86OE&sz=w1600", "issue_number": 34, "editorial_count": 26}, {"label": "DEC 2021", "month": 12, "link_url": "PAP_Magazine_December_2021.html", "cover_image": "https://drive.google.com/thumbnail?id=1ahZiKkn-1cmqGZF-u3zyADGabf7mEwD0&sz=w1600", "issue_number": 35, "editorial_count": 23}]'::jsonb),
  (13, 'Vol. 13', 2022, 1, 'JAN–MAR 2022', 'https://drive.google.com/thumbnail?id=1On3kN9fkiluUI4_czdpXlnQISGIZ8mt1&sz=w1600', 77, NULL, false, true, 13,
   '[{"label": "JAN 2022", "month": 1, "link_url": "PAP_Magazine_January_2022.html", "cover_image": "https://drive.google.com/thumbnail?id=1KZGjnmn4Z7kUJz3q19YD-eU_flGchB3p&sz=w1600", "issue_number": 36, "editorial_count": 26}, {"label": "FEB 2022", "month": 2, "link_url": "PAP_Magazine_February_2022.html", "cover_image": "https://drive.google.com/thumbnail?id=1OA39d6PIAk98zzpPd9MlrpKgHG65g-6g&sz=w1600", "issue_number": 37, "editorial_count": 26}, {"label": "MAR 2022", "month": 3, "link_url": "PAP_Magazine_March_2022.html", "cover_image": "https://drive.google.com/thumbnail?id=1On3kN9fkiluUI4_czdpXlnQISGIZ8mt1&sz=w1600", "issue_number": 38, "editorial_count": 25}]'::jsonb),
  (14, 'Vol. 14', 2022, 4, 'APR–JUN 2022', 'https://drive.google.com/thumbnail?id=1tdQPHtJZeF1Z9EGSxz-4R3FUbgW_8jKf&sz=w1600', 80, NULL, false, true, 14,
   '[{"label": "APR 2022", "month": 4, "link_url": "PAP_Magazine_April_2022.html", "cover_image": "https://drive.google.com/thumbnail?id=1PzWZ_nfHqr6-BxNocDmG6foRe6BCLV_x&sz=w1600", "issue_number": 39, "editorial_count": 25}, {"label": "MAY 2022", "month": 5, "link_url": "PAP_Magazine_May_2022.html", "cover_image": "https://drive.google.com/thumbnail?id=1kYmvOkZwehnNdjyoIpQXee616rcXr88S&sz=w1600", "issue_number": 40, "editorial_count": 27}, {"label": "JUN 2022", "month": 6, "link_url": "PAP_Magazine_June_2022.html", "cover_image": "https://drive.google.com/thumbnail?id=1tdQPHtJZeF1Z9EGSxz-4R3FUbgW_8jKf&sz=w1600", "issue_number": 41, "editorial_count": 28}]'::jsonb),
  (15, 'Vol. 15', 2022, 7, 'JUL–SEP 2022', 'https://drive.google.com/thumbnail?id=1ym-ZYuJ21S-x6juR-m_91yOptX5Acef3&sz=w1600', 74, NULL, false, true, 15,
   '[{"label": "JUL 2022", "month": 7, "link_url": "PAP_Magazine_July_2022.html", "cover_image": "https://drive.google.com/thumbnail?id=15izP8un4SzU0ibNZQK5n6F9TmSAgBAix&sz=w1600", "issue_number": 42, "editorial_count": 21}, {"label": "AUG 2022", "month": 8, "link_url": "PAP_Magazine_August_2022.html", "cover_image": "https://drive.google.com/thumbnail?id=1fMrLD8O5Wecdwh9qDvKzWs52s8LNDLQv&sz=w1600", "issue_number": 43, "editorial_count": 28}, {"label": "SEP 2022", "month": 9, "link_url": "PAP_Magazine_September_2022.html", "cover_image": "https://drive.google.com/thumbnail?id=1ym-ZYuJ21S-x6juR-m_91yOptX5Acef3&sz=w1600", "issue_number": 44, "editorial_count": 25}]'::jsonb),
  (16, 'Vol. 16', 2022, 10, 'OCT–DEC 2022', 'https://drive.google.com/thumbnail?id=1zgnc1-oCTfsEU-JRPnPwHGsQOegU9J6u&sz=w1600', 72, NULL, false, true, 16,
   '[{"label": "OCT 2022", "month": 10, "link_url": "PAP_Magazine_October_2022.html", "cover_image": "https://drive.google.com/thumbnail?id=1dG2gOPXM5IwpSKIYb4C6vwGp6ICpOqxS&sz=w1600", "issue_number": 45, "editorial_count": 21}, {"label": "NOV 2022", "month": 11, "link_url": "PAP_Magazine_November_2022.html", "cover_image": "https://drive.google.com/thumbnail?id=1RYLQ39OCRPhfJ-UucDq931EwE6jNKD7g&sz=w1600", "issue_number": 46, "editorial_count": 22}, {"label": "DEC 2022", "month": 12, "link_url": "PAP_Magazine_December_2022.html", "cover_image": "https://drive.google.com/thumbnail?id=1zgnc1-oCTfsEU-JRPnPwHGsQOegU9J6u&sz=w1600", "issue_number": 47, "editorial_count": 29}]'::jsonb),
  (17, 'Vol. 17', 2023, 1, 'JAN–MAR 2023', 'https://drive.google.com/thumbnail?id=1FwAqPW8jHvhyfEAvb_6g9w9SFMJYa_2A&sz=w1600', 93, NULL, false, true, 17,
   '[{"label": "JAN 2023", "month": 1, "link_url": "PAP_Magazine_January_2023.html", "cover_image": "https://drive.google.com/thumbnail?id=1FsBDyeQnUyHuIyaInED-H5Kh4IEkM-Ik&sz=w1600", "issue_number": 48, "editorial_count": 42}, {"label": "FEB 2023", "month": 2, "link_url": "PAP_Magazine_February_2023.html", "cover_image": "https://drive.google.com/thumbnail?id=1W8TSM4hF2kM6Yo9a5SLCJCXMmXycequ3&sz=w1600", "issue_number": 49, "editorial_count": 24}, {"label": "MAR 2023", "month": 3, "link_url": "PAP_Magazine_March_2023.html", "cover_image": "https://drive.google.com/thumbnail?id=1FwAqPW8jHvhyfEAvb_6g9w9SFMJYa_2A&sz=w1600", "issue_number": 50, "editorial_count": 27}]'::jsonb),
  (18, 'Vol. 18', 2023, 4, 'APR–JUN 2023', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_e2b9cde336.jpg', 82, NULL, false, true, 18,
   '[{"label": "APR 2023", "month": 4, "link_url": "PAP_Magazine_April_2023.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover_19c6439f20.png", "issue_number": 51, "editorial_count": 26}, {"label": "MAY 2023", "month": 5, "link_url": "PAP_Magazine_May_2023.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover4_e8f2329e0b.jpg", "issue_number": 52, "editorial_count": 26}, {"label": "JUN 2023", "month": 6, "link_url": "PAP_Magazine_June_2023.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_e2b9cde336.jpg", "issue_number": 53, "editorial_count": 30}]'::jsonb),
  (19, 'Vol. 19', 2023, 7, 'JUL–SEP 2023', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover_f218f7f478.jpg', 81, NULL, false, true, 19,
   '[{"label": "JUL 2023", "month": 7, "link_url": "PAP_Magazine_July_2023.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_82e14b8386.jpg", "issue_number": 54, "editorial_count": 27}, {"label": "AUG 2023", "month": 8, "link_url": "PAP_Magazine_August_2023.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_bde5512d85.jpg", "issue_number": 55, "editorial_count": 24}, {"label": "SEP 2023", "month": 9, "link_url": "PAP_Magazine_September_2023.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover_f218f7f478.jpg", "issue_number": 56, "editorial_count": 30}]'::jsonb),
  (20, 'Vol. 20', 2023, 10, 'OCT–DEC 2023', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_ae60e0c125.jpg', 69, NULL, false, true, 20,
   '[{"label": "OCT 2023", "month": 10, "link_url": "PAP_Magazine_October_2023.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_72e7b7fd02.jpg", "issue_number": 57, "editorial_count": 20}, {"label": "NOV 2023", "month": 11, "link_url": "PAP_Magazine_November_2023.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_92322326c7.jpg", "issue_number": 58, "editorial_count": 25}, {"label": "DEC 2023", "month": 12, "link_url": "PAP_Magazine_December_2023.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_ae60e0c125.jpg", "issue_number": 59, "editorial_count": 24}]'::jsonb),
  (21, 'Vol. 21', 2024, 1, 'JAN–MAR 2024', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover2_099a56af1b.jpg', 63, NULL, false, true, 21,
   '[{"label": "JAN 2024", "month": 1, "link_url": "PAP_Magazine_January_2024.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover3_879d20482b.jpg", "issue_number": 60, "editorial_count": 23}, {"label": "FEB 2024", "month": 2, "link_url": "PAP_Magazine_February_2024.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_886cfcd885.jpg", "issue_number": 61, "editorial_count": 19}, {"label": "MAR 2024", "month": 3, "link_url": "PAP_Magazine_March_2024.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover2_099a56af1b.jpg", "issue_number": 62, "editorial_count": 21}]'::jsonb),
  (22, 'Vol. 22', 2024, 4, 'APR–JUN 2024', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_f17f49f387.jpg', 65, NULL, false, true, 22,
   '[{"label": "APR 2024", "month": 4, "link_url": "PAP_Magazine_April_2024.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_f59a892d6b.jpg", "issue_number": 63, "editorial_count": 23}, {"label": "MAY 2024", "month": 5, "link_url": "PAP_Magazine_May_2024.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_6955d3ff32.jpg", "issue_number": 64, "editorial_count": 28}, {"label": "JUN 2024", "month": 6, "link_url": "PAP_Magazine_June_2024.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_f17f49f387.jpg", "issue_number": 65, "editorial_count": 14}]'::jsonb),
  (23, 'Vol. 23', 2024, 7, 'JUL–SEP 2024', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_ce249419c8.jpg', 63, NULL, false, true, 23,
   '[{"label": "JUL 2024", "month": 7, "link_url": "PAP_Magazine_July_2024.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_21e4b56624.jpg", "issue_number": 66, "editorial_count": 23}, {"label": "AUG 2024", "month": 8, "link_url": "PAP_Magazine_August_2024.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_dbd583d9ff.jpg", "issue_number": 67, "editorial_count": 22}, {"label": "SEP 2024", "month": 9, "link_url": "PAP_Magazine_September_2024.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_ce249419c8.jpg", "issue_number": 68, "editorial_count": 18}]'::jsonb),
  (24, 'Vol. 24', 2024, 10, 'OCT–DEC 2024', 'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_1ee4cfc7e0.jpg', 61, NULL, false, true, 24,
   '[{"label": "OCT 2024", "month": 10, "link_url": "PAP_Magazine_October_2024.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_e389083cff.jpg", "issue_number": 69, "editorial_count": 21}, {"label": "NOV 2024", "month": 11, "link_url": "PAP_Magazine_November_2024.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_8c7ba13b86.jpg", "issue_number": 70, "editorial_count": 20}, {"label": "DEC 2024", "month": 12, "link_url": "PAP_Magazine_December_2024.html", "cover_image": "https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/cover1_1ee4cfc7e0.jpg", "issue_number": 71, "editorial_count": 20}]'::jsonb);

-- 검증: 24개 볼륨 / 71개 월간호 / 최신 플래그는 VOL.31 하나뿐
do $$
declare v_cnt int; m_cnt int; l_cnt int;
begin
  select count(*) into v_cnt from magazine_issues where issue_number between 1 and 24;
  select coalesce(sum(jsonb_array_length(months)),0) into m_cnt
    from magazine_issues where issue_number between 1 and 24;
  select count(*) into l_cnt from magazine_issues where is_latest;
  if v_cnt <> 24 then raise exception '볼륨 수 이상: %', v_cnt; end if;
  if m_cnt <> 71 then raise exception '월간호 수 이상: %', m_cnt; end if;
  if l_cnt <> 1  then raise exception 'is_latest 가 1개가 아님: %', l_cnt; end if;
end $$;

commit;
