/**
 * 부스트 실패 가시성 — tests/boost-failure-visibility.test.js (2026-09-10 신설)
 *
 * 왜 ────────────────────────────────────────────────────────────────
 * 실측(2026-09-10): ig_boosts 14건 중 스레드 성공 6건(43%) · X 13건(93%).
 * 스레드가 절반 넘게 죽는데 **사유가 어디에도 없었다** — goldenBoost 가
 * console.warn 으로 흘리고 끝냈고, DB 에는 threads_ok=false 한 칸뿐이었다.
 * 8/18 에 cronGuard 로 고친 구멍("실패는 보이는데 사유가 안 보인다")이
 * 부스트 경로에 그대로 남아 있었다.
 *
 * 이 테스트가 지키는 것:
 *   1. maybeBoostPost 가 실패 사유를 반환값으로 돌려준다 (threadsErr/xErr)
 *   2. 호출부 3곳이 전부 공용 recordBoost 를 쓴다 (규칙 세 벌 방지 — 교훈 2)
 *   3. note 에 부스트 결과와 사유가 실린다
 *   4. 스레드 실패 사유가 X 와 같은 모양으로 실린다 (여태 세고 버렸다)
 *   5. 경계값: 부스트 0건이면 note 에 아무것도 안 붙는다 / 사유가 비어도
 *      '사유 없음' 으로 자리를 남긴다 / 160자에서 자른다
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ ' + name); }
}
const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const gb = R('api/_lib/goldenBoost.js');
const sync = R('api/cron/sync-instagram.js');

/* 1. 사유를 반환값으로 돌려준다 */
t('goldenBoost: threadsErr 를 잡는다',
  /catch \(e\) \{\s*threadsErr = String\(/.test(gb));
t('goldenBoost: xErr 를 잡는다',
  /catch \(e\) \{\s*xErr = String\(/.test(gb));
t('goldenBoost: 반환값에 threadsErr·xErr 가 실린다',
  /return \{ boosted: true,[^}]*threadsErr[^}]*xErr[^}]*\}/.test(gb));
t('goldenBoost: 사유는 160자에서 자른다 (로그 폭발 방지)',
  (gb.match(/\.slice\(0, 160\)/g) || []).length >= 2);
t('goldenBoost: 미설정 X 도 사유를 남긴다 (조용한 무시 금지)',
  /xErr = '미설정'/.test(gb));
t('goldenBoost: 부스트 실패가 수집을 막지 않는다 (전체 try/catch 유지)',
  /catch \(e\) \{\s*return \{ boosted: false, reason:/.test(gb));

/* 2. 호출부 3곳이 전부 공용 부품을 쓴다 */
const calls = (sync.match(/await maybeBoostPost\(/g) || []).length;
/* 정의(`function recordBoost(...)`)는 빼고 호출만 센다 */
const records = (sync.match(/(?<!function )recordBoost\(results, b\)/g) || []).length;
t('sync-instagram: 부스트 호출부는 3곳', calls === 3);
t('sync-instagram: 호출부 전부 recordBoost 를 쓴다 (세 벌 금지)',
  records === calls && records === 3);
t('sync-instagram: 옛 방식(직접 카운트)이 남아 있지 않다',
  !/if \(b\.boosted\) results\.boosted = \(results\.boosted\|\|0\)\+1/.test(sync));
t('sync-instagram: recordBoost 가 정의돼 있다',
  /function recordBoost\(results, b\)\{/.test(sync));

/* 3·4. note 배선 */
t('note: 부스트 블록이 있다', /부스트 ' \+ T\.length \+ '건'/.test(sync));
t('note: 스레드 실패 사유가 실린다 (여태 세고 버렸다)',
  /스레드 ' \+ \(thArr\.length - thFail\.length\)[\s\S]{0,200}?thFail\.join\('; '\)/.test(sync));
t('note: X 실패 사유도 그대로 유지', /twFail\.join\('; '\)/.test(sync));

/* 5. 경계값 — recordBoost 동작을 실제로 돌려 본다 */
const ms = sync.match(/function scrubSecret\(s\)\{[\s\S]*?\n\}/);
const m = sync.match(/function recordBoost\(results, b\)\{[\s\S]*?\n\}/);
t('scrubSecret 본문을 추출할 수 있다', !!ms);
t('recordBoost 본문을 추출할 수 있다', !!m);
if (m && ms) {
  // eslint-disable-next-line no-new-func
  const recordBoost = new Function(ms[0] + '\nreturn (' + m[0] + ')')();
  // eslint-disable-next-line no-new-func
  const scrubSecret = new Function(ms[0] + '\nreturn scrubSecret;')();

  /* 보안 경계 — 사유는 API 응답 본문이라 토큰이 섞여 올 수 있다 */
  t('보안: access_token 값이 가려진다',
    !/EAAG[A-Za-z0-9]{10,}/.test(scrubSecret('오류 {"access_token":"EAAGabcdef1234567890"}')));
  t('보안: bearer 토큰이 가려진다',
    /\[가림\]/.test(scrubSecret('401 Bearer abcdef1234567890xyz')));
  t('보안: 평범한 사유는 그대로 통과한다',
    scrubSecret('컨테이너 처리 대기 초과 (status=IN_PROGRESS)') === '컨테이너 처리 대기 초과 (status=IN_PROGRESS)');
  t('보안: 사유는 160자에서 잘린다', scrubSecret('가'.repeat(500)).length === 160);

  const r1 = {};
  recordBoost(r1, { boosted: false, reason: 'window' });
  t('경계: 부스트 안 됨(window) → 아무것도 안 센다',
    r1.boosted === undefined && r1.boost_threads === undefined);

  const r2 = {};
  recordBoost(r2, null);
  recordBoost(r2, undefined);
  t('경계: null/undefined 를 줘도 안 터진다', r2.boosted === undefined);

  const r3 = {};
  recordBoost(r3, { boosted: true, threadsOk: true, xOk: true });
  t('성공 2채널 → boosted 1, ok 기록',
    r3.boosted === 1 && r3.boost_threads[0] === 'ok' && r3.boost_x[0] === 'ok');

  const r4 = {};
  recordBoost(r4, { boosted: true, threadsOk: false, threadsErr: '컨테이너 처리 대기 초과 (status=IN_PROGRESS)', xOk: true });
  t('스레드 실패 → 사유가 그대로 담긴다',
    /컨테이너 처리 대기 초과/.test(r4.boost_threads[0]));

  const r5 = {};
  recordBoost(r5, { boosted: true, threadsOk: false, xOk: false });
  t('경계: 실패인데 사유가 비면 "사유 없음" 으로 자리를 남긴다 (조용한 실패 금지)',
    r5.boost_threads[0] === '실패: 사유 없음' && r5.boost_x[0] === '실패: 사유 없음');

  const r6 = {};
  for (let i = 0; i < 3; i++) recordBoost(r6, { boosted: true, threadsOk: i === 0, xOk: true });
  t('경계: 여러 건 누적 — 건수와 배열 길이가 맞는다',
    r6.boosted === 3 && r6.boost_threads.length === 3 && r6.boost_x.length === 3);
  t('경계: 누적 시 성공/실패가 섞여도 각각 보존',
    r6.boost_threads.filter((v) => v === 'ok').length === 1);
}

if (fail) { console.error('boost-failure-visibility: ' + pass + ' pass, ' + fail + ' FAIL'); process.exit(1); }
console.log('boost-failure-visibility: ' + pass + '검사 통과');
