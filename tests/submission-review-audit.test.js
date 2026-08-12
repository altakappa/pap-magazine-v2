// PAP Magazine — 서브미션 심사 감사기록 · 거절 기본문구 · 검토기간 안내 회귀 테스트
//
// 2026-08-03 포탈(PORTAL) 진단에서 실측으로 확인한 결함들을 잠근다.
//
//   ① 심사 감사기록 공백 — submissions 100건 전부 reviewed_at / reviewed_by /
//      updated_at 이 NULL 이었다. api/submissions/[id]/review.js 의 reviewPatch 가
//      status·admin_notes·rejected_at 만 쓰고 있었고, submissions 에는 updated_at
//      트리거도 없다(pg_trigger 0행). 풀레터 핸들러는 같은 자리에서 정상적으로
//      찍고 있었다(api/pullletters/[id]/review.js).
//
//   ② 거절 사유 공백 — rejected 32건 중 30건이 admin_notes 공란. 작가는
//      MY SUBMISSIONS 에서 아무 설명을 못 받았다. 도메니코 지시로 고정 영문
//      안내 편지를 admin_notes 기본값으로 자동 전달한다.
//      노출은 웹(MY SUBMISSIONS) 한 곳뿐 — 메일에는 싣지 않는다(QA #165 유지,
//      2026-08-03 도메니코 결정). 아래 [2] 가 그 경계를 고정한다.
//
//   ③ 검토 소요기간 미고지 — 풀레터는 웹·메일 어디에도 기간 안내가 없었고,
//      서브미션 안내 문단은 data-i18n 이 없어 9개 언어 전부 영어로만 떴다.
//
//   ④ 원문 오류 유출 — api/submissions/index.js 가 Supabase/Postgres 오류 원문을
//      500 응답 body 에 그대로 붙여 보냈다.
//
// Run with `node tests/submission-review-audit.test.js` (wired into `npm test`).

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const email = require(path.resolve(ROOT, 'api', '_lib', 'email'));
const { templates, DEFAULT_REJECTION_NOTE, REJECTION_LETTER_BODY } = email;

const LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];

let passed = 0;
let failed = 0;

function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

function read(rel) {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf8');
}

// ─────────────────────────────────────────────────────────────
// ① 거절 기본 문구 — 도메니코 원문 그대로여야 한다
// ─────────────────────────────────────────────────────────────
console.log('\n[1] 거절 기본 문구 (DEFAULT_REJECTION_NOTE)');

const EXPECTED_NOTE = [
  'Dear,',
  '',
  'Thank you for your email and for sharing your materials with us. Unfortunately, It does not quite align with our aesthetic standard.',
  'Please rest assured that any images not selected for publication will remain private and will be promptly deleted.',
  '',
  'We truly appreciate your kind offer and hope for the opportunity to collaborate again in the future.',
  'All the best,',
  '',
  'PAP Magazine Editorial Team,',
].join('\n');

ok('원문과 한 글자도 다르지 않다', DEFAULT_REJECTION_NOTE === EXPECTED_NOTE,
  JSON.stringify(DEFAULT_REJECTION_NOTE));
ok('본문 5줄이 단일 소스(REJECTION_LETTER_BODY)에서 나온다',
  Array.isArray(REJECTION_LETTER_BODY) && REJECTION_LETTER_BODY.length === 5);
ok('본문 배열이 편지 전문에 그대로 포함된다',
  REJECTION_LETTER_BODY.every((line) => DEFAULT_REJECTION_NOTE.includes(line)));

// ─────────────────────────────────────────────────────────────
// ② 거절 편지는 메일에 절대 실리지 않는다 (웹 전용 — QA #165 유지)
//    2026-08-03 도메니코 결정: 심사 결과를 수신함에 드러내지 않는다.
//    편지는 MY SUBMISSIONS(admin_notes)에서만 보인다.
// ─────────────────────────────────────────────────────────────
console.log('\n[2] 심사결과 메일 — 편지 비노출 (웹 전용)');

const MARKERS = [
  'aesthetic standard',
  'promptly deleted',
  'PAP Magazine Editorial Team,',
];

for (const lang of LANGS) {
  const rejected = templates.submissionReviewComplete({ name: 'A' }, { title: 'T' }, lang, 'rejected', {});
  ok(`${lang} — 거절 메일에 편지 3요소가 하나도 없다`,
    MARKERS.every((m) => !rejected.html.includes(m)));
}

for (const status of ['approved', 'revision', 'pending']) {
  const mail = templates.submissionReviewComplete({ name: 'A' }, { title: 'T' }, 'en', status, {});
  ok(`${status} 메일에도 편지가 없다`,
    MARKERS.every((m) => !mail.html.includes(m)));
}

ok('legacy alias submissionRejected 도 메일에 편지를 싣지 않는다',
  !templates.submissionRejected({ name: 'A' }, { title: 'T' }, null, 'ko', {}).html.includes('aesthetic standard'));
ok('legacy alias submissionApproved 에도 편지가 없다',
  !templates.submissionApproved({ name: 'A' }, { title: 'T' }, null, 'ko', {}).html.includes('aesthetic standard'));
ok('편지 상수는 계속 export 된다 (admin_notes 조립용 단일 소스)',
  typeof DEFAULT_REJECTION_NOTE === 'string' && DEFAULT_REJECTION_NOTE.length > 0);

// 유료 승인 안내 블록이 이번 변경으로 깨지지 않았는지
ok('유료 승인(€345) 금액 블록은 그대로 동작',
  templates.submissionReviewComplete({ name: 'A' }, { title: 'T' }, 'en', 'approved', { feeCents: 34500 })
    .html.includes('€345'));

// ─────────────────────────────────────────────────────────────
// ③ 심사 감사기록 — reviewPatch 가 실제로 3개 컬럼을 채운다
// ─────────────────────────────────────────────────────────────
console.log('\n[3] 심사 감사기록 (reviewPatch)');

const reviewSrc = read('api/submissions/[id]/review.js');

// 핸들러를 통째로 부팅하지 않고, reviewPatch 를 만드는 구간만 그대로 떼어
// 실제로 실행한다 — 주석·형식이 바뀌어도 동작만 맞으면 통과한다.
const patchStart = reviewSrc.indexOf('const nowIso = new Date().toISOString();');
ok('reviewPatch 구간을 소스에서 찾을 수 있다', patchStart !== -1);

// 2026-08-12 — 경계를 소스의 명시적 표식으로 옮겼다. 예전에는 update 호출을
// 기준으로 잘랐는데, 그 사이에 코드가 한 줄이라도 들어오면(결제 기록 보존 로직)
// eval 이 못 보는 변수를 만나 테스트가 죽는다. 표식은 review.js 안에 있다.
const PATCH_END_MARK = '\n    // \u2b07\ufe0e reviewPatch \ub05d';
let patchEnd = reviewSrc.indexOf(PATCH_END_MARK, patchStart);
if (patchEnd === -1) patchEnd = reviewSrc.indexOf('\n\n    const { data: submission, error }', patchStart);
ok('reviewPatch 끝 표식을 찾았다 (review.js 의 \u2b07\ufe0e 주석)', patchEnd !== -1);
const patchCode = reviewSrc.slice(patchStart, patchEnd);

function buildPatch(status, reviewNote) {
  const fn = new Function('status', 'reviewNote', 'admin', 'DEFAULT_REJECTION_NOTE',
    patchCode + '\n return reviewPatch;');
  return fn(status, reviewNote, { id: 'admin-uuid-1' }, DEFAULT_REJECTION_NOTE);
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

for (const status of ['approved', 'rejected', 'revision', 'pending']) {
  const patch = buildPatch(status, '');
  ok(`${status} — reviewed_at ISO 로 찍힌다`, ISO.test(String(patch.reviewed_at)));
  ok(`${status} — reviewed_by 에 심사자 id 가 들어간다`, patch.reviewed_by === 'admin-uuid-1');
  ok(`${status} — updated_at 이 찍힌다 (테이블에 트리거가 없다)`, ISO.test(String(patch.updated_at)));
  ok(`${status} — reviewed_at 과 updated_at 이 동일 시각`, patch.reviewed_at === patch.updated_at);
}

const rejPatch = buildPatch('rejected', '');
ok('거절 + 메모 공란 → 기본 편지가 admin_notes 에 들어간다',
  rejPatch.admin_notes === DEFAULT_REJECTION_NOTE);
ok('거절 시 rejected_at 이 찍힌다 (30일 purge 크론용)', ISO.test(String(rejPatch.rejected_at)));

ok('심사자가 직접 쓴 메모가 있으면 그쪽이 우선한다',
  buildPatch('rejected', '룩 구성이 부족합니다').admin_notes === '룩 구성이 부족합니다');

for (const status of ['approved', 'revision', 'pending']) {
  ok(`${status} — 메모 공란이면 기본 편지가 들어가지 않는다`,
    buildPatch(status, '').admin_notes === '');
  ok(`${status} — rejected_at 은 NULL 로 되돌린다`,
    buildPatch(status, '').rejected_at === null);
}

// 풀레터 핸들러(정상 동작하던 대조군)가 계속 찍고 있는지
const plReviewSrc = read('api/pullletters/[id]/review.js');
ok('대조군: 풀레터 핸들러도 여전히 reviewed_at/reviewed_by 를 찍는다',
  plReviewSrc.includes('reviewed_by: admin.id') && plReviewSrc.includes('reviewed_at:'));

// ─────────────────────────────────────────────────────────────
// ④ 풀레터 검토기간 — 영업일 7일 (웹 + 메일, 9개 언어)
// ─────────────────────────────────────────────────────────────
console.log('\n[4] 풀레터 검토기간 — 영업일 7일');

for (const lang of LANGS) {
  const mail = templates.pullletterReceived({ name: 'A' }, lang);
  ok(`${lang} — 접수 메일에 7(영업일) 안내가 있다`, /7/.test(mail.html));
}

const plHtml = read('frontend/pullletter.html');
const plStart = plHtml.indexOf('var L = {');
const plMergeAt = plHtml.indexOf('Object.keys(_PAP_PULLLETTER_I18N_EXT)');
const plEnd = plHtml.indexOf('\n});', plMergeAt) + 4;
const plDict = new Function(plHtml.slice(plStart, plEnd) + '; return L;')();

for (const lang of LANGS) {
  const v = plDict[lang] && plDict[lang].reviewEta;
  ok(`${lang} — pullletter.html reviewEta 채워짐`, typeof v === 'string' && v.length > 0);
  ok(`${lang} — reviewEta 에 7 이 들어있다`, /7/.test(String(v)));
}
ok('영어 원문이 7 business days 로 되어 있다',
  /7 business days/.test(String(plDict.en.reviewEta)));
ok('페이지 마크업 2곳에 reviewEta 가 배선돼 있다',
  (plHtml.match(/data-i18n="reviewEta"/g) || []).length === 2);

// ─────────────────────────────────────────────────────────────
// ⑤ 서브미션 안내 문단 i18n + 죽은 키 제거
// ─────────────────────────────────────────────────────────────
console.log('\n[5] 서브미션 안내 문단 i18n');

const subHtml = read('frontend/submission.html');
const sStart = subHtml.indexOf('var L={');
const sEnd = subHtml.indexOf('\n};', sStart) + 3;
const subDict = new Function(subHtml.slice(sStart, sEnd) + '; return L;')();

for (const lang of LANGS) {
  const v = subDict[lang] && subDict[lang].reviewNoteBlock;
  ok(`${lang} — reviewNoteBlock 존재`, typeof v === 'string' && v.length > 0);
  ok(`${lang} — MY SUBMISSIONS 안내 포함`, /MY SUBMISSIONS/.test(String(v)));
  ok(`${lang} — 줄바꿈 토큰(\\n) 3줄 구성`, String(v).split('\\n').length === 3);
  ok(`${lang} — successMsg 에 검토기간이 명시돼 있다`,
    /1[-–~ ]?3|1 à 3|1〜3/.test(String(subDict[lang].successMsg)));
  ok(`${lang} — 죽은 키 toastMinImages 가 제거됐다`,
    !('toastMinImages' in subDict[lang]));
}

ok('안내 문단이 data-i18n-html 로 배선됐다',
  subHtml.includes('data-i18n-html="reviewNoteBlock"'));
ok('하드코딩 영어 스팬(reviewTimeNote)이 사라졌다',
  !subHtml.includes('reviewTimeNote'));
ok('실제 이미지 하한(1장)과 모순되던 "최소 4장" 문구가 남아있지 않다',
  !subHtml.includes('toastMinImages'));

// ─────────────────────────────────────────────────────────────
// ⑥ 원문 오류 유출 차단
// ─────────────────────────────────────────────────────────────
console.log('\n[6] 서브미션 목록 API — 원문 오류 유출 차단');

const listSrc = read('api/submissions/index.js');
const listFail = listSrc.slice(listSrc.indexOf("console.error('List submissions error:'"));
ok('500 응답에 Supabase 원문 message 를 붙이지 않는다',
  !/message: 'Failed to fetch submissions' \+/.test(listFail));
ok("500 응답은 고정 메시지다",
  /message: 'Failed to fetch submissions',/.test(listFail));
ok('진단 정보는 서버 로그(console.error)에는 그대로 남는다',
  listSrc.includes("console.error('List submissions error:'"));

// ─────────────────────────────────────────────────────────────
// ⑦ 9개 언어 사전 자체의 결함 (2026-08-03 추가)
//    ㄱ. pullletter.html 의 var L 에 ru 키가 두 번 있었다. 앞 블록은 내용이
//        절반이 영어였고 뒤엣것이 이겨서, 앞을 고치면 아무 일도 안 일어났다.
//    ㄴ. submission.html 의 gateDesc 가 it/fr/es/ja/zh 에서 "회원 전용입니다"
//        한 문장으로 끝났다. "로그인하거나 가입하세요"라는 다음 행동 안내가
//        ko/en/de/ru 에만 있었다 — 5개 언어 방문자는 뭘 해야 하는지 못 들었다.
// ─────────────────────────────────────────────────────────────
console.log('\n[7] 9개 언어 사전 정합');

const pullHtml = read('frontend/pullletter.html');

// var L 을 실제로 평가해서(정규식 눈대중 금지) 중복 키·값 언어를 본다.
const lStart = pullHtml.indexOf('var L = {');
const lEnd = pullHtml.indexOf('\n};', lStart);
// eslint-disable-next-line no-eval
const PL = eval('(' + pullHtml.slice(lStart + 'var L = '.length, lEnd + 2) + ')');

const ruBlockCount = (pullHtml.slice(lStart, lEnd).match(/(?:^|,)ru:\{/gm) || []).length;
ok('pullletter var L 에 ru 블록이 하나뿐이다 (중복 제거)', ruBlockCount === 1, `발견 ${ruBlockCount}개`);
ok('살아있는 ru 가 실제 러시아어다 (영어 잔재가 이기지 않는다)',
  PL.ru.business === 'БИЗНЕС' && PL.ru.gateLogin === 'ВОЙТИ');
ok('ru 키 수가 줄지 않았다 (57개 유지)', Object.keys(PL.ru).length === 57,
  `실제 ${Object.keys(PL.ru).length}`);

// subDict 는 [5] 절에서 이미 var L={...} 을 평가해 둔 것이다. 다시 파싱하지 않는다.
for (const lang of LANGS) {
  const v = subDict[lang] && subDict[lang].gateDesc;
  ok(`${lang} — gateDesc 에 로그인 안내 줄이 있다`,
    typeof v === 'string' && v.split('\\n').length === 2, JSON.stringify(v));
}

// ─────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? '✅' : '❌'} submission-review-audit: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
