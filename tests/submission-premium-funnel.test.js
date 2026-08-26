/**
 * 서브미션 → 프리미엄 동선 (2026-08-25 신설 — 유료 구독자 늘리기 1탄)
 *
 * [근거 실측] 유료 활성 9명 전원이 크리에이터였다(포토그래퍼·스타일리스트·
 * 서브미션 제출자). 독자 페이월 전환은 확인되는 바 0. 30일 서브미션 76건.
 * 제출 직후가 가장 고관여 순간이므로 성공 화면과 접수 메일에서 프리미엄의
 * **실제 혜택만**(풀레터 월 1건 · 전체 아카이브) 보여준다.
 *
 * 지키는 것:
 *  ① 성공 화면·접수 메일에 동선이 존재한다
 *  ② utm 이 붙어 있다 — 재지 않으면 이 동선이 실제로 전환을 만드는지 모른다
 *  ③ 없는 혜택을 약속하지 않는다 (풀레터는 '월 1건' — subscribe 페이지와 일치)
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

const SUB = R('frontend/submission.html');
const EMAIL = R('api/_lib/email.js');
const SUBSCRIBE = R('frontend/subscribe.html');

t('성공 화면에 프리미엄 동선이 있다 (utm 포함)', () => {
  assert.ok(/subscribe\?utm_source=submission_done/.test(SUB), '동선 또는 utm 이 없다');
  assert.ok(/successPremDesc/.test(SUB) && /successPremCta/.test(SUB), 'i18n 키가 없다');
});
t('접수 메일에 프리미엄 단락이 있다 (utm 포함)', () => {
  assert.ok(/utm_source=submission_received_email/.test(EMAIL), '메일 동선 또는 utm 이 없다');
  assert.ok(/Pull-Letter per month/.test(EMAIL), '풀레터 혜택 언급이 없다');
});
t('약속이 subscribe 페이지와 일치한다 — 풀레터는 월 1건', () => {
  assert.ok(/월 1건|per month/.test(SUB.match(/successPremDesc[^']*'[^']*'/g).join('')) || /월 1건/.test(SUB), '성공 화면 약속 확인 불가');
  assert.ok(/Pull-Letter 요청 \(월 1건\)/.test(SUBSCRIBE), 'subscribe 페이지의 월 1건 기준이 사라졌다 — 동선 문구와 어긋나면 같이 고칠 것');
});
t('ko·en 두 언어 모두 키가 있다 (나머지는 en 폴백)', () => {
  assert.ok((SUB.match(/successPremCta:/g) || []).length >= 2, 'ko/en 중 한쪽에 키가 없다');
});

console.log('\n서브미션→프리미엄 동선: ' + pass + '건 통과' + (fail ? ' · ' + fail + '건 실패' : ''));
if (fail) process.exit(1);
