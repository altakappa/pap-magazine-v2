'use strict';
/**
 * 기사 생성이 캡션 밖 지식을 끌어다 쓰지 못하게 하는 안전핀 (2026-10-30)
 *
 * 사건: 스크림(@skreembeauty) 기사 두 건에 캡션에 없는 "노스 웨스트를 할로윈에
 * 핑크 괴물로 변신시켰다", "도이치의 데이지 체인 필즈 무대 작업" 이 제목·본문·
 * FAQ 까지 들어갔고 당사자가 DM 으로 정정을 요구했다. 둘 다 실재하는 사건이었다 —
 * 모델이 사전지식에서 끌어와 엉뚱한 사람에게 붙인 것이다. 그래서 기존 프롬프트의
 * "Never invent"(= 창작 금지)로는 막히지 않았다. 금지해야 하는 건 창작이 아니라
 * 캡션 밖 지식의 사용이다. 이 테스트는 그 문장이 프롬프트에서 사라지지 않게 지킨다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }

const imp = R('api/_lib/instagramImport.js');

t('출처 한계 규칙이 Article rules 맨 앞에 있다',
  /'Article rules:',[\s\S]{0,1400}SOURCE LIMIT/.test(imp));
t('길이 규칙보다 위라고 못 박는다 (짧은 본문이 지어낸 본문보다 낫다)',
  /outranks every other rule, length included/.test(imp) &&
  /short fully-sourced body always beats a long one/.test(imp));
t('근거는 캡션과 슬라이드 둘뿐이라고 열거한다',
  /exactly two places:[\s\S]{0,200}original caption/.test(imp) &&
  /text or imagery visible in the slides/.test(imp));
t('핵심: 모델의 사전지식은 근거가 아니다',
  /prior knowledge of the person, brand or event is NOT a source/.test(imp));
t('스크림 건의 두 실패 유형을 각각 막는다 (남의 작업 귀속 · 없는 행사에 붙이기)',
  /Never credit this subject with work by another person/.test(imp) &&
  /at an event, holiday or occasion that the caption does not name/.test(imp));
t('인접해서 그럴듯한 사실일수록 위험하다고 명시한다',
  /adjacent and harmless/.test(imp) && /past collaboration/.test(imp));
t('제목·SEO 줄도 같은 규칙을 받는다 (당사자가 가장 먼저 보는 줄)',
  /제목도 같은 규칙을 받는다 \(title_ko · title_en · seo_title · seo_description\)/.test(imp) &&
  /캡션·슬라이드에서 확인되지 않는 행위·사건·대상을 제목에 쓰지 않는다/.test(imp));
t('"번역만 하지 말고 확장하라" 가 사실 추가 허가로 읽히지 않게 묶여 있다',
  /DO NOT just translate the caption[\s\S]{0,260}never by adding facts the caption and slides do not carry/.test(imp));
t('기존 안전핀도 그대로 남아 있다 (슬라이드가 비면 짧은 본문이 맞다)',
  /If the slides genuinely add nothing, a shorter body is still correct\. Never invent\./.test(imp));

const bf = R('api/admin/article-body-backfill.js');
t('본문 보강 백필의 지어내기 금지 규칙도 유지된다',
  /없는 사실을 지어내지 마라/.test(bf) && /지어내는 것보다 짧은 게 낫다/.test(bf));

t('테스트 스크립트 등록', /article-source-limit\.test\.js/.test(R('package.json')));

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
