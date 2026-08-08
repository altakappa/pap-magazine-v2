/**
 * 긴 글 번역 화면 (2026-08-08 신설).
 *
 * ── 왜 만들었나 ─────────────────────────────────────────────────────
 * 번역 크론은 원문 6,000자 초과 기사를 자동 번역에서 뺀다(2026-08-05 신설).
 * 큐가 published_date 내림차순 고정이라, 호출 시간 안에 못 끝내는 긴 글
 * 한 건이 맨 앞에 박히면 그 언어 전체가 영원히 멈추기 때문이다 —
 * 당시 zh 181건이 9,052자·12,963자 두 건에 막혀 있었다.
 *
 * 상한은 그 poison pill 을 막는 장치라 푸는 게 답이 아니다. 대신 제외분은
 * "관리자 수동 경로로 처리한다"고 코드 주석이 약속했는데, **그 화면이
 * 없었다.** 2026-08-08 전량 완주 시점에 남은 게 정확히 그 6건(번역 25개)이라
 * 약속을 지킨다.
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① 관리자 경로에 마감이 있을 것 — 없으면 함수 상한 120초를 넘겨 죽는다
 *   ② 길이 상한을 명시적으로 0(제한 없음)으로 넘길 것 — 이 경로의 존재 이유다
 *   ③ 크론의 6,000자 상한은 **그대로** 둘 것 (여기 고치면서 저기 풀지 말 것)
 *   ④ 화면이 한 번에 한 건씩만 부를 것 (429 회피)
 *   ⑤ 진행이 없으면 접을 것 — 화면에서 poison pill 을 재현하지 말 것
 *   ⑥ 캐시버스트가 올라가 있을 것
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'api/admin/backfill-translations.js'), 'utf8');
const CRON = fs.readFileSync(path.join(ROOT, 'api/cron/backfill-translations.js'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'frontend/pap-admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend/admin.html'), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 220)); }
}

console.log('\n=== ① 관리자 경로에 마감이 있다 ===');
t('deadlineAt 을 넘긴다', /deadlineAt: Date\.now\(\) \+ ADMIN_BUDGET_MS/.test(ADMIN));
const budget = (ADMIN.match(/ADMIN_BUDGET_MS = (\d+)/) || [])[1];
t('예산이 100초 이하다 (함수 상한 120초)', Number(budget) > 0 && Number(budget) <= 100000, budget);
t('호출 타임아웃을 90초로 묶는다',
  /Math\.max\(10000, Math\.min\(90000, n\)\)/.test(ADMIN) && /: 90000;/.test(ADMIN));
t('timeout 쿼리로 조절할 수 있다', /req\.query\.timeout/.test(ADMIN));
t('마감을 안 준 옛 호출이 남아 있지 않다',
  !/runBackfillBatch\(\{ lang, kind, batch \}\)/.test(ADMIN), 'deadlineAt 없는 호출 잔존');

console.log('\n=== ② 길이 상한 없음을 명시한다 ===');
t('maxSrcChars: 0 을 명시적으로 넘긴다', /maxSrcChars: 0/.test(ADMIN));

console.log('\n=== ③ 크론의 상한은 그대로다 (여기 고치며 저기 풀지 않는다) ===');
t('크론 기본 상한 6000 이 유지된다', /SEO_TRANSLATE_MAX_SRC_CHARS/.test(CRON) && /6000/.test(CRON));
t('크론이 maxSrcChars 를 계속 넘긴다', /maxSrcChars: MAX_SRC_CHARS/.test(CRON));

console.log('\n=== ④ 화면이 한 건씩만 부른다 ===');
t('batch=1 로 고정해 부른다',
  (JS.match(/backfill-translations\?kind=article&batch=1&lang=/g) || []).length >= 2,
  (JS.match(/backfill-translations\?kind=article&batch=1&lang=/g) || []).length);
t('batch 를 키우는 경로가 없다', !/backfill-translations\?kind=article&batch=([2-9]|\d\d)/.test(JS));
t('언어를 URL 에 넣을 때 인코딩한다', /encodeURIComponent\(lang\)/.test(JS));
t('언어별로 순차 실행한다 (동시 호출 없음)',
  !/Promise\.all[\s\S]{0,80}backfill-translations/.test(JS));

console.log('\n=== ⑤ 진행이 없으면 접는다 (화면에서 poison pill 금지) ===');
t('idle 카운터가 있다', /var idle = 0;/.test(JS));
t('2회 연속 진행 0이면 그 언어를 넘긴다', /idle < 2/.test(JS) && /idle\+\+/.test(JS));
t('처리되면 idle 을 되돌린다', /idle = 0;/.test(JS));
t('잔량 0이면 즉시 끝낸다', /if\(left === 0\)/.test(JS));
t('중지 버튼이 루프를 실제로 끊는다',
  /!_ltState\.stop/.test(JS) && /function longTransStop\(\)/.test(JS));
t('오류가 나도 다음 언어로 넘어간다 (한 언어가 전체를 막지 않는다)',
  /_ltState\.fail\+\+/.test(JS) && /break;\s*\/\/ 네트워크 문제는 다음 언어로/.test(JS));
t('끝나면 버튼이 반드시 되살아난다 (finally)',
  /\} finally \{[\s\S]{0,400}runBtn\.disabled = false/.test(JS));

console.log('\n=== 7개 언어를 모두 다룬다 ===');
const langs = (JS.match(/var LT_LANGS = \[([^\]]+)\]/) || [])[1] || '';
for (const l of ['zh', 'de', 'ja', 'ru', 'fr', 'es', 'it']) {
  t(l + ' 포함', langs.includes("'" + l + "'"), langs);
}

console.log('\n=== 화면 배선 ===');
t('사이드바에 진입 링크가 있다', /go\('longtrans',this\)/.test(HTML));
t('탭 컨테이너가 있다', /id="t-longtrans"/.test(HTML));
for (const id of ['ltRunBtn', 'ltStopBtn', 'ltRefreshBtn', 'ltLog', 'ltLangGrid',
                  'ltStatRemain', 'ltStatDone', 'ltStatFail', 'ltStatElapsed']) {
  t(id + ' 가 있다', HTML.includes('id="' + id + '"'));
}
for (const fn of ['longTransRun', 'longTransStop', 'longTransScan']) {
  t(fn + ' 가 정의돼 있다', new RegExp('function ' + fn + '\\(').test(JS));
  t(fn + ' 를 화면이 부른다', HTML.includes(fn + '()'));
}
/* 창을 닫으면 멈춘다는 사실을 화면이 말해야 한다 — 서버가 아니라 브라우저가
   도는 구조라, 안 적어두면 "왜 안 끝나 있지?" 가 된다. */
t('탭을 열어 두라고 안내한다', /탭을 열어 두세요|탭을 닫지 마세요/.test(HTML));
t('왜 크론이 안 하는지 화면이 설명한다', /6,000자/.test(HTML) && /멈추기 때문/.test(HTML));

console.log('\n=== ⑥ 캐시버스트 ===');
const v = (HTML.match(/pap-admin\.js\?v=(\d+)/) || [])[1];
t('admin.html 의 pap-admin.js 버전이 140 이상', Number(v) >= 140, v);

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ admin-long-translate tests passed');
