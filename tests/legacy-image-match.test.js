/**
 * 레거시 화보 ↔ IG 게시물 제목 매칭 회귀 (2026-07-31 신설).
 *
 * 배경: 2019-02~2023-01 발행 화보 373편의 cover_image 가 실제 사진이 아니라
 * `data:image/svg+xml,...` 플레이스홀더다. 초기 4년치가 '사진 없는 화보' 로
 * 서비스되는 중이라, IG 원본에서 이미지를 되찾아야 한다.
 *
 * 여기서 지키는 것 — 잘못 붙이면 되돌리기 어렵다:
 *   ① 캡션의 문장부호·대소문자 차이를 넘어 같은 제목을 찾아낼 것
 *   ② 짧은 제목으로 우연히 겹치지 않을 것
 *   ③ 후보가 여럿이면 자동으로 고르지 말 것(사람이 보게)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { normalize, titleInCaption, matchOne, extractHandles, MIN_TITLE_LEN, MIN_TITLE_LEN_CJK } =
  require('../api/_lib/legacyImageMatch');

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

/* 라이브에서 실제로 확인한 캡션(2023-01-31 게시). 제목과 문장부호가 다르다 —
   DB 제목은 "TASTED MY REVENGE. IT'S SWEET", 캡션은 스마트 따옴표로 감싼 문장. */
const REAL_CAPTION = "‘Tasted my Revenge. It's sweet.’ exclusive for @pap_magazine published by @kangdm\n"
  + 'Full Story link🔎pap-magazine.com/tasted-my-revenge-it-s-sweet\n'
  + 'Photographer @hamdiatayy Assisted by @elifseyis\nStylist @billge\n'
  + 'Fashion by @marni @versace @coperni @msgm @zara';

console.log('\n=== 실제 캡션으로 매칭 ===');
t('문장부호·대소문자 차이를 넘어 매칭', titleInCaption("TASTED MY REVENGE. IT'S SWEET", REAL_CAPTION));
t('스마트 따옴표를 정규화', normalize('‘Tasted’') === 'tasted');
t('한글 제목도 지원', titleInCaption('가을의 정취', '이번 화보 가을의 정취 를 소개합니다'),
  '한글은 글자당 정보량이 커서 라틴과 같은 6자 기준을 쓰면 정상 제목이 탈락한다');
t('짧은 한글도 우연 겹침은 막는다', titleInCaption('가을', '가을하늘 아래') === false);

console.log('=== 우연한 겹침 방지 ===');
t('짧은 제목은 판정하지 않는다', titleInCaption('MUSE', 'museum of modern art @pap_magazine') === false,
  `${MIN_TITLE_LEN}자 미만은 우연히 겹친다 — "MUSE" 가 "museum" 에 걸린다`);
t('무관한 캡션은 매칭 안 됨', titleInCaption('UTOPIAN RHAPSODY', 'completely different caption') === false);

console.log('=== 후보가 여럿이면 사람이 본다 ===');
(function () {
  const row = { id: 'e1', title: 'ROSETTE FLOWER' };
  const media = [
    { id: 'm1', caption: 'Rosette Flower part 1', permalink: 'p1' },
    { id: 'm2', caption: 'ROSETTE FLOWER — reissue', permalink: 'p2' },
  ];
  const r = matchOne(row, media);
  t('여러 건이면 ambiguous', r.status === 'ambiguous' && r.count === 2,
    '자동으로 고르면 남의 사진이 남의 화보에 실린다');
  t('그래도 첫 후보는 참고용으로 준다', r.media && r.media.id === 'm1');

  const one = matchOne(row, [media[0]]);
  t('정확히 1건이면 matched', one.status === 'matched' && one.count === 1);
  t('없으면 none', matchOne(row, [{ id: 'x', caption: 'nothing' }]).status === 'none');
})();

console.log('=== 캡션에서 크레딧(@핸들) 회수 ===');
(function () {
  const h = extractHandles(REAL_CAPTION);
  t('포토그래퍼 핸들 추출', h.includes('hamdiatayy'));
  t('브랜드 핸들 추출', h.includes('marni') && h.includes('versace') && h.includes('coperni'));
  t('중복 제거', h.filter(x => x === 'pap_magazine').length === 1);
  t('문장 끝 마침표를 핸들에 붙이지 않는다', !h.some(x => /\.$/.test(x)));
})();

console.log('=== 안전 규약 (조사와 적용의 분리) ===');
(function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api/admin/legacy-image-scan.js'), 'utf8');
  t('스캔은 editorials 를 쓰지 않는다',
    !/from\('editorials'\)[\s\S]{0,80}\.(update|upsert|insert|delete)\(/.test(src),
    '잘못 매칭된 사진이 화보에 붙으면 되돌리기 어렵다 — 계획표에만 쓴다');
  t('계획표에만 기록', /from\('legacy_image_recovery'\)\.upsert/.test(src));
  t('관리자·크론 인증', /requireAdmin/.test(src) && /CRON_SECRET/.test(src));
  t('커서로 나눠 훑는다 (미디어 4,300건)', /afterCursor/.test(src) && /nextCursor/.test(src));
  t('시간 예산 가드', /BUDGET_MS/.test(src));

  const lib = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/legacyImageMatch.js'), 'utf8');
  t('판정 규칙은 의존 없는 파일 (DB 없이 검증 가능)', !/require\(/.test(lib));
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ legacy-image-match tests FAILED'); process.exit(1); }
console.log('✅ legacy-image-match tests passed');
