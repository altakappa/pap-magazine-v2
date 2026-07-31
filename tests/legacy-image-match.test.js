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

console.log('=== 적용 단계 안전 규약 (2026-07-31 도메니코 승인) ===');
(function () {
  /* 진입점은 둘(관리자 수동 · 크론), 로직은 하나 — 안전 규약은 _lib 에서 본다.
     복붙해두면 한쪽만 고쳐지는 사고가 난다(번역 백필에서 이미 겪은 계열). */
  const src = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/legacyImageApply.js'), 'utf8');

  t('matched 만 적용한다',
    /\.eq\('status',\s*'matched'\)/.test(src),
    'ambiguous 를 자동 적용하면 남의 사진이 남의 화보에 실린다');
  t('ambiguous 를 대상에 넣지 않는다', !/'ambiguous'/.test(src.split('const results')[0] || src));

  t('IG CDN URL 을 그대로 저장하지 않는다 — Storage 로 복사',
    /archiveImagesToStorage/.test(src)
    && /cover_image:\s*urls\[0\]/.test(src)
    && !/cover_image:\s*post\./.test(src),
    'IG CDN URL 은 수일 내 만료된다 — 저장하면 며칠 뒤 다시 깨진 화보가 된다');

  t('이미지 0장이면 화보를 건드리지 않는다',
    /if \(!urls\.length\)[\s\S]{0,600}continue;/.test(src),
    '플레이스홀더를 빈 값으로 바꾸면 더 나빠진다');

  t('레거시는 최근 50개 검색이 아니라 media id 직접 조회',
    /fetchMediaById/.test(src) && !/fetchInstagramPost/.test(src),
    'fetchInstagramPost 는 최근 50개만 훑어 2019~2023 화보를 절대 못 찾는다');

  t('적용 이력을 남긴다', /status:\s*'applied'/.test(src) && /applied_at/.test(src));
  t('시간 예산 가드', /budgetMs/.test(src) && /Date\.now\(\) - started > budgetMs/.test(src));
  t('dry 모드로 먼저 볼 수 있다', /dry/.test(src));

  /* ── 2026-07-31 · 자동화 (도메니코 "자동화해줘") ────────────────────
     사람이 엔드포인트를 반복 호출하는 방식은 그 사람이 자리를 비우면 멈춘다.
     오늘 하루 종일 고친 문제가 정확히 그런 종류였다. */
  const cron = fs.readFileSync(path.join(__dirname, '..', 'api/cron/legacy-image-recover.js'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'api/admin/legacy-image-apply.js'), 'utf8');

  t('크론이 존재하고 실행기록·실패알림에 감싸여 있다',
    /module\.exports\s*=\s*withCronGuard\(/.test(cron));
  t('크론이 CRON_SECRET 로 보호된다', /CRON_SECRET/.test(cron));
  t('크론이 무엇을 했는지 기록에 남긴다', /cronNote/.test(cron),
    "'ok' 는 함수가 안 죽었다는 뜻이지 일을 했다는 뜻이 아니다");

  t('두 진입점이 같은 로직을 쓴다 (복붙 금지)',
    /require\('\.\.\/_lib\/legacyImageApply'\)/.test(cron)
    && /require\('\.\.\/_lib\/legacyImageApply'\)/.test(admin),
    '복붙해두면 한쪽만 고쳐지는 사고가 난다');
  t('진입점에는 적용 로직이 없다',
    !/from\('editorials'\)[\s\S]{0,80}\.update\(/.test(cron)
    && !/from\('editorials'\)[\s\S]{0,80}\.update\(/.test(admin));
  t('관리자 진입점 인증 유지', /requireAdmin/.test(admin) && /CRON_SECRET/.test(admin));
  t('관리자 응답에 원문 에러를 싣지 않는다 (감사 A-3)',
    !/detail:\s*(e|err)\.message/.test(admin) && /code:/.test(admin));

  const ig = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/instagramImport.js'), 'utf8');
  t('fetchMediaById 가 export 되어 있다', /^\s*fetchMediaById,$/m.test(ig));
  t('fetchMediaById 는 캐러셀 자식까지 펼친다',
    /async function fetchMediaById[\s\S]{0,900}hydrateChildren/.test(ig),
    '펼치지 않으면 여러 장 화보가 커버 한 장으로 복구된다');
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ legacy-image-match tests FAILED'); process.exit(1); }
console.log('✅ legacy-image-match tests passed');
