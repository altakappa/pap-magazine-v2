/**
 * 안내 메일 전수 다국어화 + 실발송 보장 (2026-08-26 도메니코 지시)
 *
 * "서브미션뿐만 아니라 모든 안내가 회원이 선택한 언어로 발송되어야 한다."
 *
 * 실측으로 드러난 결함 3종:
 *  ① submissionReceived — 영어 하드코딩이었고, 심지어 어떤 호출부도 발송하지
 *     않았다 (8/25 프리미엄 퍼널 박스가 한 통도 안 나간 원인)
 *  ② welcome — 영어 고정 + fire-and-forget (서버리스 프리즈로 발송 유실:
 *     승인 메일 0/35 실측 전례와 같은 패턴)
 *  ③ 언어 폴백 불일치 — review.js·editorials 는 국가 추정 없이
 *     email_language||language||'en', 발송기는 resolveEmailLang
 *
 * 지키는 것:
 *  1. welcome·submissionReceived·pullletterRevision 이 9개 언어를 갖고
 *     미지원 언어는 en 으로 폴백한다
 *  2. 서브미션 접수 시 접수 메일이 실제로 발송된다 (await + 회원 언어)
 *  3. api 전체에 sendEmail fire-and-forget 이 남아 있지 않다
 *  4. 심사·게재 메일 언어는 resolveEmailLang 단일 규칙을 쓴다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(n, fn) {
  try { fn(); pass++; console.log('  ✓', n); }
  catch (e) { fail++; console.log('  ✗', n, '—', e.message); }
}

console.log('transactional-email-i18n');

const { templates } = require(path.join(ROOT, 'api/_lib/email.js'));
const LANGS = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru', 'de'];

t('welcome·submissionReceived·pullletterRevision — 9개 언어 렌더, 언어별 제목 상이', () => {
  for (const name of ['welcome', 'submissionReceived', 'pullletterRevision']) {
    const subjects = new Set();
    for (const l of LANGS) {
      const out = name === 'welcome' ? templates.welcome({ name: 'T' }, l)
        : name === 'submissionReceived' ? templates.submissionReceived({ name: 'T' }, { title: 'X' }, l)
        : templates.pullletterRevision({ name: 'T' }, 'note', l);
      assert.ok(out.subject && out.html, name + ':' + l + ' 렌더 실패');
      subjects.add(out.subject);
    }
    assert.ok(subjects.size >= 8, name + ': 언어별 제목이 ' + subjects.size + '종뿐 — 번역 누락 의심');
  }
});

t('미지원 언어(pt 등)는 en 으로 폴백한다', () => {
  const pt = templates.submissionReceived({ name: 'T' }, { title: 'X' }, 'pt');
  const en = templates.submissionReceived({ name: 'T' }, { title: 'X' }, 'en');
  assert.strictEqual(pt.subject, en.subject);
});

t('서브미션 접수 메일이 실제로 발송된다 — await + resolveEmailLang', () => {
  const S = R('api/submissions/index.js');
  assert.ok(/await sendEmail\(_prof\.email, templates\.submissionReceived\(/.test(S), '접수 메일 발송이 없다');
  assert.ok(/resolveEmailLang\(_prof\)/.test(S), '회원 언어 해석이 없다');
  assert.ok(/country/.test(S.match(/select\('email, display_name[^)]*\)/)[0]), '국가 폴백용 country 컬럼이 select 에 없다');
});

t('api 전체에 sendEmail fire-and-forget 이 없다 (서버리스 발송 유실 방지)', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
  });
  const offenders = [];
  for (const f of walk(path.join(ROOT, 'api'))) {
    const src = fs.readFileSync(f, 'utf8');
    if (/sendEmail\([^;]*\)\s*\.catch\(\(\) => \{\}\)/.test(src)) offenders.push(path.relative(ROOT, f));
  }
  assert.deepStrictEqual(offenders, [], 'fire-and-forget 잔존: ' + offenders.join(', '));
});

t('심사(review.js)·게재(editorials) 메일 언어가 resolveEmailLang 단일 규칙이다', () => {
  const REV = R('api/submissions/[id]/review.js');
  const ED = R('api/editorials/[id].js');
  assert.ok(/const lang = resolveEmailLang\(profile\)/.test(REV), 'review.js 가 resolveEmailLang 을 안 쓴다');
  assert.ok(/const lang = resolveEmailLang\(profile\)/.test(ED), 'editorials 가 resolveEmailLang 을 안 쓴다');
  assert.ok(!/profile\.email_language \|\| profile\.language \|\| 'en'/.test(REV + ED), '수동 폴백이 남아 있다');
});

t('환영 메일 — 가입 언어 전달 + await (signup.js)', () => {
  const S = R('api/auth/signup.js');
  assert.ok(/await sendEmail\(email, templates\.welcome\(user, _welcomeLang\)\)/.test(S), 'welcome await/언어 전달이 없다');
});

console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
