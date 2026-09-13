/**
 * 풀레터 후속 절차 (도메니코 2026-09-13)
 *   "풀레터를 받아간 사람은 웹사이트 내에서 완성된 에디토리얼 제출하기를 통해 서브미션처럼 똑같은
 *    제출 과정을 거쳐 최종 제출이 되어야 해."
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function ok(l, c, d) { if (c) { passed++; console.log('  ✓ ' + l); } else { failed++; console.log('  ✗ ' + l + (d ? ' — ' + d : '')); } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const P = require(path.join(ROOT, 'api', '_lib', 'pullLetterLink'));

function db(row, cap) {
  return { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    update: (u) => ({ eq: (c, v) => ({ is: async () => { if (cap) cap.push({ u, v }); return { error: null }; } }) }),
  }) };
}
(async () => {
  console.log('\n=== checkPullLetterForSubmission ===');
  const issued = { id: 'pl1', user_id: 'u1', status: 'issued', pull_letter_url: 'x.pdf', submission_id: null, title: 'T' };
  let r = await P.checkPullLetterForSubmission(db(issued), 'u1', 'pl1');
  ok('본인 + 발급됨 + 미연결 → ok', r.ok === true && r.pullLetter.id === 'pl1');
  r = await P.checkPullLetterForSubmission(db(issued), 'u2', 'pl1');
  ok('남의 풀레터 → PULL_LETTER_NOT_YOURS', r.ok === false && r.code === 'PULL_LETTER_NOT_YOURS');
  r = await P.checkPullLetterForSubmission(db(Object.assign({}, issued, { status: 'pending', pull_letter_url: null })), 'u1', 'pl1');
  ok('발급 전 → PULL_LETTER_NOT_ISSUED', r.code === 'PULL_LETTER_NOT_ISSUED');
  r = await P.checkPullLetterForSubmission(db(Object.assign({}, issued, { submission_id: 's9' })), 'u1', 'pl1');
  ok('이미 연결 → PULL_LETTER_ALREADY_SUBMITTED + submissionId', r.code === 'PULL_LETTER_ALREADY_SUBMITTED' && r.submissionId === 's9');
  r = await P.checkPullLetterForSubmission(db(null), 'u1', 'nope');
  ok('없는 id → PULL_LETTER_NOT_FOUND', r.code === 'PULL_LETTER_NOT_FOUND');
  r = await P.checkPullLetterForSubmission(db(issued), 'u1', '');
  ok('빈 id → PULL_LETTER_INVALID', r.code === 'PULL_LETTER_INVALID');
  const cap = [];
  await P.linkPullLetterToSubmission(db(issued, cap), 'pl1', 's1');
  ok('linkPullLetterToSubmission: submission_id + editorial_submitted_at 를 쓰고 미연결 조건(is null)', cap.length === 1 && cap[0].u.submission_id === 's1' && !!cap[0].u.editorial_submitted_at);

  console.log('\n=== 서버 배선 (POST /api/submissions) ===');
  const idx = read('api/submissions/index.js');
  ok('data.pullLetterId 가 있으면 insert 전에 검증하고 거부 코드를 그대로 낸다', /if \(data\.pullLetterId\) \{[\s\S]{0,300}checkPullLetterForSubmission\(supabaseAdmin, user\.id, data\.pullLetterId\)[\s\S]{0,200}_reject400\(res, user, _plc\.code/.test(idx));
  ok('submissions.pullletter_id 컬럼 + description.pullLetterId 둘 다 저장', /pullletter_id: _pullLetter \? _pullLetter\.id : null/.test(idx) && /pullLetterId: _pullLetter \? _pullLetter\.id : null/.test(idx));
  ok('접수 후 풀레터에 연결(await) + 텔레그램 알림(await)', /await linkPullLetterToSubmission\(supabaseAdmin, _pullLetter\.id, submission\.id\)/.test(idx) && /await sendTextToTelegramSafe\('📩 풀레터 후속 에디토리얼 제출/.test(idx));
  ok('검증은 분류(classifySubmissionType)보다 앞', idx.indexOf('checkPullLetterForSubmission(supabaseAdmin') < idx.indexOf('classifySubmissionType(looks'));
  const mig = read('supabase_migrations/152_pullletter_editorial_submission.sql');
  ok('마이그레이션 152: pullletters.submission_id/editorial_submitted_at + submissions.pullletter_id', /pullletters[\s\S]*submission_id uuid references public\.submissions/.test(mig) && /editorial_submitted_at timestamptz/.test(mig) && /submissions[\s\S]*pullletter_id uuid references public\.pullletters/.test(mig));

  console.log('\n=== 서브미션 폼 ===');
  const sub = read('frontend/submission.html');
  ok('?pullletter=<id> → 본인 풀레터 확인(mine) 후 PULL_LETTER_ID 설정·제목·포토그래퍼·스타일리스트 채움', /p\.get\('pullletter'\)/.test(sub) && /\/api\/pullletters\/mine/.test(sub) && /PULL_LETTER_ID = pl\.id;/.test(sub) && /_setTeamRowByRole\('Photographer'/.test(sub) && /_setTeamRowByRole\('Stylist'/.test(sub));
  ok('자격 안 되면(미발급·이미 제출·남의 것) 토스트 + 일반 서브미션으로', /if\(!pl \|\| !okStatus \|\| pl\.submission_id\)\{[\s\S]{0,200}_errT\('pullLetterIneligible'\)/.test(sub));
  ok('payload 에 data.pullLetterId, 서버 PULL_LETTER_* 오류를 언어별 문구로', /if\(PULL_LETTER_ID\) data\.pullLetterId=PULL_LETTER_ID;/.test(sub) && /code==='PULL_LETTER_ALREADY_SUBMITTED'/.test(sub));
  ok('로그인 후 초기화에서 호출', /_prefillFromPullLetter\(\);/.test(sub));
  ok('문구 pullLetterPrefill·pullLetterIneligible 9개 언어', ['pullLetterPrefill', 'pullLetterIneligible'].every((k) => new RegExp(k + ":\\{ko:'[^']+',en:'[^']+',de:'[^']+',it:'(?:[^'\\\\]|\\\\.)+',fr:'(?:[^'\\\\]|\\\\.)+',es:'[^']+',ja:'[^']+',zh:'[^']+',ru:'[^']+'\\}").test(sub)));

  console.log('\n=== 마이페이지 · 메일 · 관리자 ===');
  const mp = read('frontend/mypage.html');
  ok('발급된 풀레터 카드에 "완성된 에디토리얼 제출하기" → /submission?pullletter=<id>', /\/submission\?pullletter=' \+ encodeURIComponent\(r\.id/.test(mp) && /_papUIL\('완성된 에디토리얼 제출하기'/.test(mp));
  ok('연결된 풀레터는 "제출 완료 · 심사 중" + 제출 현황 링크', /if\(r\.submission_id\)\{[\s\S]{0,300}#mp-submissions/.test(mp));
  ok('마이페이지 사전 v9 + 8개 언어 키', /content="mypage" data-v="9"/.test(mp) && ['en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'].every((l) => { const d = JSON.parse(read('frontend/i18n/ui/mypage.' + l + '.json')); return d['완성된 에디토리얼 제출하기'] && d['완성 에디토리얼 제출 완료 · 심사 중입니다.']; }));
  const em = require(path.join(ROOT, 'api', '_lib', 'email'));
  ok('발급 메일 9개 언어에 후속 절차 한 줄', ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'].every((l) => /PULL-LETTERS/.test(em.templates.pullletterIssued({ name: 'A' }, '', l).html)));
  ok('관리자: 풀레터 목록 배지 + 검토 모달 Pull-Letter 줄', /발급 완료 · 에디토리얼 제출됨/.test(read('frontend/pap-admin.js')) && /id="reviewModalPullLetter"/.test(read('frontend/admin.html')) && /pap-admin\.js\?v=(15[7-9]|1[6-9]\d)/.test(read('frontend/admin.html')));

  console.log('\n=== 4주 독촉 크론 + 미제출 시 새 요청 불가 (도메니코 2026-09-13) ===');
  // supabase 클라이언트만 가짜로 — 순수 함수(isDue)와 배선만 본다.
  const Module = require('module'); const _origLoad = Module._load;
  Module._load = function (req) {
    if (req === './supabase' || req === '../_lib/supabase') return { supabaseAdmin: {} };
    if (req === '@supabase/supabase-js') return { createClient: () => ({}) };
    return _origLoad.apply(this, arguments);
  };
  let cron; try { cron = require(path.join(ROOT, 'api', 'cron', 'pullletter-editorial-reminder')); } finally { Module._load = _origLoad; }
  const D = 86400000; const now = Date.now();
  const base = { status: 'issued', pull_letter_url: 'x.pdf', submission_id: null, editorial_reminder_sent_at: null, issued_at: new Date(now - 29 * D).toISOString() };
  ok('REMIND_AFTER_DAYS = 28 (4주)', cron.REMIND_AFTER_DAYS === 28);
  ok('발급 29일 · 미제출 · 미독촉 → 대상', cron.isDue(base, now) === true);
  ok('발급 27일 → 아직 아님', cron.isDue(Object.assign({}, base, { issued_at: new Date(now - 27 * D).toISOString() }), now) === false);
  ok('제출 연결됨 → 아님', cron.isDue(Object.assign({}, base, { submission_id: 's1' }), now) === false);
  ok('이미 독촉함 → 아님 (한 풀레터에 한 번)', cron.isDue(Object.assign({}, base, { editorial_reminder_sent_at: '2026-09-01' }), now) === false);
  ok('발급 전(pending, PDF 없음) → 아님', cron.isDue(Object.assign({}, base, { status: 'pending', pull_letter_url: null }), now) === false);
  ok('issued_at 없으면 reviewed_at → created_at 순으로 판정', cron.isDue(Object.assign({}, base, { issued_at: null, reviewed_at: null, created_at: new Date(now - 40 * D).toISOString() }), now) === true);
  const csrc = read('api/cron/pullletter-editorial-reminder.js');
  ok('크론: CRON_SECRET 게이트 + withCronGuard + 회원 메일 await + 독촉 시각 기록 + 텔레그램 await', /safeEqual\(got, expected\)/.test(csrc) && /withCronGuard\(CRON_NAME/.test(csrc) && /await sendEmail\(profile\.email, templates\.pullletterEditorialReminder/.test(csrc) && /update\(\{ editorial_reminder_sent_at: new Date\(\)\.toISOString\(\) \}\)/.test(csrc) && /await sendTextToTelegramSafe\('⏰ 풀레터 발급 4주 경과/.test(csrc));
  const vj = JSON.parse(read('vercel.json'));
  ok('vercel.json 에 매일 1회 예약', (vj.crons || []).some((c) => c.path === '/api/cron/pullletter-editorial-reminder' && /^\d+ \d+ \* \* \*$/.test(c.schedule)));
  ok('마이그레이션 153: editorial_reminder_sent_at', /editorial_reminder_sent_at timestamptz/.test(read('supabase_migrations/153_pullletter_editorial_reminder.sql')));
  ok('독촉 메일 템플릿 9개 언어에 PULL-LETTERS 경로 + "새 요청 불가" 안내', ['ko', 'en', 'de', 'it', 'fr', 'es', 'ja', 'zh', 'ru'].every((l) => { const h = em.templates.pullletterEditorialReminder({ name: 'A' }, l).html; return /PULL-LETTERS/.test(h) && /(새 Pull-Letter|new Pull-Letter|nuova Pull-Letter|nouvelle Pull-Letter|nueva Pull-Letter|新しい Pull-Letter|新的 Pull-Letter|Новый Pull-Letter|neue Pull-Letter)/.test(h); }));
  const plIdx = read('api/pullletters/index.js');
  ok('POST /api/pullletters: 미제출 발급 건이 있으면 409 pending_editorial (월 상한 검사보다 앞)', /code: 'pending_editorial'/.test(plIdx) && plIdx.indexOf("code: 'pending_editorial'") < plIdx.indexOf('── 월 1건 상한') && /\.is\('submission_id', null\)[\s\S]{0,80}\.not\('pull_letter_url', 'is', null\)/.test(plIdx));
  const plHtml = read('frontend/pullletter.html');
  ok('요청 페이지: pending_editorial 을 9개 언어 문구로', /_code === 'pending_editorial'/.test(plHtml) && /pendingEditorial:\{ko:'[^']+',en:'[^']+',it:'(?:[^'\\]|\\.)+',fr:'(?:[^'\\]|\\.)+',es:'[^']+',ja:'[^']+',zh:'[^']+',ru:'[^']+',de:'[^']+'\}/.test(plHtml));

  console.log('\npassed: ' + passed + '   failed: ' + failed);
  if (failed) { console.log('❌ pullletter-editorial-submission FAILED'); process.exit(1); }
  console.log('✅ pullletter-editorial-submission passed');
})();
