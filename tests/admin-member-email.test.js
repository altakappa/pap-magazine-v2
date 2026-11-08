/*
 * admin-member-email.test.js — 관리자가 회원에게 메일을 보내고, 그게 기록으로 남는다 (2026-11-09)
 *
 * ■ 왜 만들었나 (실측)
 * 결제 중복 건(€5.49 × 7회)으로 회원에게 사과 메일을 보내야 했는데, 관리자 화면에
 * 그 수단이 **아예 없었다.** 도메니코가 Gmail 을 따로 열어 손으로 보내야 했고,
 * 그래서 어떤 회원에게 뭘 보냈는지 **기록이 한 줄도 남지 않았다.** 문의 응대·사과·
 * 안내는 앞으로도 계속 생긴다. 보내는 자리와 남는 자리를 함께 만든다.
 *
 * ■ 이 테스트가 지키는 계약
 *  1) 관리자 인증·레이트리밋을 거친다.
 *  2) 본문은 **평문**이다 — 템플릿이 이스케이프하고 줄바꿈만 살린다.
 *     관리자가 붙여넣은 꺾쇠로 메일 틀이 깨지거나 링크가 주입되면 안 된다.
 *  3) 발송 성패와 무관하게 **기록한다.** '보냈다고 생각했는데 안 갔다' 가
 *     가장 나쁜 결말이다 — 발송금지·실패도 사유와 함께 남는다.
 *  4) 기록 전용 표는 service_role 만 본다 (마이그레이션 182: RLS + 그랜트 두 겹).
 *  5) 화면은 보내기 전에 한 번 묻고, 모달을 열 때 입력칸을 비운다
 *     (앞 회원에게 쓰던 문장이 남아 엉뚱한 사람에게 가는 사고 방지).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, c, d) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); }
}

const API = R('api/admin/member-email.js');
const MAIL = R('api/_lib/email.js');
const ADMINJS = R('frontend/pap-admin.js');
const ADMINHTML = R('frontend/admin.html');
const MIG = R('supabase_migrations/182_admin_member_emails.sql');

console.log('\n=== 1. 엔드포인트 기본 방어 ===');
t('파일이 있다', fs.existsSync(path.join(ROOT, 'api/admin/member-email.js')));
t('CORS', /handleCors\(req, res\)/.test(API));
t('레이트리밋', /rateLimit\(req, res, RATE_LIMITS\.api\)/.test(API));
t('관리자 인증', /await requireAdmin\(req, res\)/.test(API));
t('POST 외에는 405', /req\.method !== 'POST'/.test(API));
t('제목·본문 길이 상한', /SUBJECT_MAX/.test(API) && /BODY_MAX/.test(API));
t('공용 정제 헬퍼를 쓴다 (상한이 두 벌이 되지 않게)', /cleanText\(/.test(API) && /_lib\/userHtml/.test(API));
t('회원이 없으면 404', /MEMBER_NOT_FOUND/.test(API));
t('이메일 없는 회원은 거부', /MEMBER_NO_EMAIL/.test(API));
t('에러 응답에 code 를 붙인다 (api 규칙)',
  /code: 'member_lookup_failed'/.test(API) && /code: 'SUBJECT_REQUIRED'/.test(API));

console.log('=== 2. 본문은 평문 — 템플릿이 이스케이프한다 ===');
t('adminMessage 템플릿이 있다', /adminMessage\(user, msg, lang\)/.test(MAIL));
const tpl = (MAIL.match(/adminMessage\(user, msg, lang\) \{[\s\S]*?\n  \},/) || [''])[0];
t('본문을 찾았다', tpl.length > 150, String(tpl.length));
t('본문을 escapeHtml 한다', /escapeHtml\(String\(\(msg && msg\.body\)/.test(tpl));
t('이름도 escapeHtml 한다', /escapeHtml\(name\)/.test(tpl));
t('줄바꿈만 <br> 로 살린다', /replace\(\/\\n\/g, '<br>'\)/.test(tpl));
t('공용 메일 틀(wrapHtml)을 쓴다', /wrapHtml\(/.test(tpl));
t('회원 언어로 틀을 맞춘다', /lang\s*\)/.test(tpl) && /resolveEmailLang/.test(API));
t('템플릿이 HTML 본문을 그대로 받지 않는다',
  !/msg\.html/.test(tpl), '관리자가 HTML 을 넣을 수 있으면 틀이 깨지고 링크 주입이 가능해진다');

console.log('=== 3. 발송 성패와 무관하게 기록한다 ===');
t('기록 표에 insert 한다', /from\('admin_member_emails'\)\s*\.insert/.test(API.replace(/\s+/g, ' ').replace(/ \./g, '.')));
t('누가 보냈는지 남긴다', /sent_by: admin\.id/.test(API));
t('상태를 남긴다 (sent·failed·skipped)',
  /status,/.test(API) && /'skipped'/.test(API) && /'failed'/.test(API));
t('사유도 남긴다', /error: errText/.test(API));
t('기록 실패가 발송을 막지 않는다', /기록 실패\(발송은 위 결과대로\)/.test(API));
t('발송금지(suppressed)를 숨기지 않고 돌려준다', /EMAIL_SUPPRESSED/.test(API));
t('문의 응대는 transactional 로 보낸다', /transactional: true/.test(API));

console.log('=== 4. 기록 표는 service_role 전용 (마이그레이션 182) ===');
t('표를 만든다', /CREATE TABLE IF NOT EXISTS public\.admin_member_emails/.test(MIG));
t('RLS 를 켠다', /ALTER TABLE public\.admin_member_emails ENABLE ROW LEVEL SECURITY/.test(MIG));
t('정책을 만들지 않는다 (= 전면 거부)', !/CREATE POLICY/.test(MIG));
t('그랜트도 회수한다 (181 의 교훈 — 두 겹 다 닫는다)',
  /REVOKE ALL ON public\.admin_member_emails FROM anon, authenticated/.test(MIG));
t('트랜잭션으로 묶여 있다', /^BEGIN;/m.test(MIG) && /^COMMIT;/m.test(MIG));
t('멱등하다', /IF NOT EXISTS/.test(MIG));
t('email_log 를 재사용하지 않은 이유가 적혀 있다', /campaign_id 가 NOT NULL/.test(MIG));

console.log('=== 5. 화면 ===');
t('발송 함수가 있다', /async function papSendMemberEmail\(\)/.test(ADMINJS));
t('보내기 전에 한 번 묻는다', /if\(!confirm\(to \+ ' 님에게 메일을 보냅니다/.test(ADMINJS));
t('되돌릴 수 없음을 알린다', /되돌릴 수 없습니다/.test(ADMINJS));
t('제목·본문이 비면 막는다', /제목을 입력하세요/.test(ADMINJS) && /본문을 입력하세요/.test(ADMINJS));
t('중복 클릭을 막는다 (버튼 비활성)', /btn\.disabled = true/.test(ADMINJS));
t('실패 사유를 화면에 보여준다', /r\.message\|\|r\.reason/.test(ADMINJS.replace(/\s/g, '')));
t('모달을 열 때 입력칸을 비운다',
  /_ms\.value=''/.test(ADMINJS) && /_mb\.value=''/.test(ADMINJS),
  '앞 회원에게 쓰던 문장이 남으면 엉뚱한 사람에게 간다');
t('마크업이 있다', /id="memberMailSubject"/.test(ADMINHTML) && /id="memberMailBody"/.test(ADMINHTML));
t('입력칸에 maxlength 가 있다',
  /id="memberMailSubject"[\s\S]{0,200}maxlength="150"/.test(ADMINHTML)
  && /id="memberMailBody"[\s\S]{0,200}maxlength="5000"/.test(ADMINHTML));

console.log('=== 6. 캐시버스트 ===');
const v = (ADMINHTML.match(/pap-admin\.js\?v=(\d+)/) || [])[1];
t('pap-admin.js 캐시버스트가 175 이상', Number(v) >= 175, 'v' + v);

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ admin-member-email tests FAILED'); process.exit(1); }
console.log('✅ admin-member-email tests passed');
