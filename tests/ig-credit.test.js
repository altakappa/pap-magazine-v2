/**
 * 캡션 크레딧 게이트 — tests/ig-credit.test.js
 *
 * 2026-08-05 도메니코: "캡션크레딧이 PAP일 경우에만 유튜브에 업로드하자."
 *
 * 여기서 잠그는 것:
 *   ① 실측된 캡션 문자열에 대한 판정이 뒤집히지 않는다
 *      (🎥 PAP → 허용 / 🎥 Youtube / AESPA, 🎥 @egorkondrasov → 차단)
 *   ② 애매하면 무조건 차단 (fail closed) — 크레딧 없음·캡션 없음·조회 실패
 *   ③ 게이트가 지목 경로와 자동 경로 **양쪽**에 걸려 있다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  creditVerdict, isPapOwned, extractCredits, splitParties, normalizeParty, verdictForMedia,
} = require('../api/_lib/igCredit');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); if (detail) console.log('      ' + detail); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

section('실측 캡션 — 2026-08-05 인스타 릴스 7건에서 직접 읽은 크레딧');
const PAP_CAPTIONS = [
  '청하 여름 향수\n\n#papmagazine\n\n🎥 PAP',
  'Ader Error x Birkenstock\n🎥 PAP',
  'Prada scent\n\n🎥 PAP #papmagazine',
  '규진 공항패션\n🎥 pap',
  '규진 베이델리\n🎥 PAP MAGAZINE',
];
PAP_CAPTIONS.forEach((c, i) => {
  ok('PAP 크레딧 통과 #' + (i + 1), isPapOwned(c) === true, JSON.stringify(creditVerdict(c)));
});

const OUTSIDE_CAPTIONS = [
  ['에스파', 'aespa 신곡\n🎥 Youtube / AESPA'],
  ['도시괴담', '도시괴담\n🎥 @egorkondrasov'],
];
OUTSIDE_CAPTIONS.forEach(([label, c]) => {
  ok('외부 크레딧 차단 — ' + label, isPapOwned(c) === false, JSON.stringify(creditVerdict(c)));
});

section('fail closed — 애매하면 올리지 않는다');
ok('크레딧 표기 없음 → 차단', isPapOwned('그냥 본문만 있는 캡션') === false);
ok('빈 캡션 → 차단', isPapOwned('') === false);
ok('null → 차단', isPapOwned(null) === false);
ok('표기자만 있고 값이 없음 → 차단', isPapOwned('본문\n🎥') === false);
ok('PAP + 외부 공동 크레딧 → 차단', isPapOwned('🎥 PAP / AESPA') === false);
ok('유사 계정명(papermagazine) → 차단', isPapOwned('🎥 papermagazine') === false);
ok('PAP TV 같은 미등록 표기 → 차단', isPapOwned('🎥 PAP TV') === false);

section('허용 표기 변형');
ok('@pap_magazine', isPapOwned('🎥 @pap_magazine') === true);
ok('PAP 매거진', isPapOwned('🎥 PAP 매거진') === true);
ok('papfashion_', isPapOwned('🎥 papfashion_') === true);
ok('pap_celeb', isPapOwned('🎥 pap_celeb') === true);
ok('소문자/공백 흔들림', isPapOwned('본문\n  🎥  pap  ') === true);
ok('🎬 표기자도 인식', isPapOwned('🎬 PAP') === true);
ok('📹 표기자도 인식', isPapOwned('📹 PAP') === true);

section('사진 크레딧(📸)은 영상 게이트가 아니다');
ok('📸 만 있으면 영상 크레딧 없음 → 차단', isPapOwned('📸 PAP') === false);

section('파서 단위');
ok('해시태그는 크레딧에서 잘라낸다',
  JSON.stringify(extractCredits('🎥 PAP #papmagazine #fashion')) === JSON.stringify(['PAP']));
ok('여러 줄 크레딧을 모두 뽑는다', extractCredits('🎥 PAP\n본문\n🎥 AESPA').length === 2);
ok('공동 크레딧 분리', JSON.stringify(splitParties('Youtube / AESPA')) === JSON.stringify(['Youtube', 'AESPA']));
ok('정규화는 기호를 버린다', normalizeParty(' @PAP_Magazine ') === 'papmagazine');
ok('outsiders 에 문제 주체가 남는다',
  JSON.stringify(creditVerdict('🎥 Youtube / AESPA').outsiders) === JSON.stringify(['Youtube', 'AESPA']));
ok('reason 에 판정 근거가 남는다', /외부 크레딧/.test(creditVerdict('🎥 @egorkondrasov').reason));

section('Graph 조회 실패도 차단');
(async () => {
  const noId = await verdictForMedia('');
  ok('media id 없으면 차단', noId.owned === false && /source_instagram_post_id/.test(noId.reason));

  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'cron', 'youtube-post.js'), 'utf8');
  section('크론 배선');
  ok('youtube-post 가 게이트를 불러온다', src.includes("require('../_lib/igCredit')"));
  ok('지목 경로에 게이트가 걸린다', src.includes("credit = await verdictForMedia(art.source_instagram_post_id)"));
  ok('자동 경로에 게이트가 걸린다', src.includes("await verdictForMedia(cand.source_instagram_post_id)"));
  ok('크레딧 아니면 업로드하지 않는다', src.includes("'PAP 크레딧이 아님 — 유튜브 업로드 보류'"));
  ok('ART_COLS 에 source_instagram_post_id 포함', /const ART_COLS =[^\n]*source_instagram_post_id/.test(src));
  ok('게이트는 업로드보다 앞선다',
    src.indexOf('verdictForMedia') < src.indexOf('uploadVideo(uploadBuffer'));
  ok('외부 크레딧 후보는 건너뛰고 다음을 본다', /skipped\.push\(/.test(src) && /CREDIT_SCAN_MAX/.test(src));

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) { console.log('❌ ig-credit tests FAILED'); process.exit(1); }
  console.log('✅ ig-credit tests passed');
})();
