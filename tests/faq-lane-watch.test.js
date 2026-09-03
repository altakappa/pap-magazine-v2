/**
 * 영문·다국어 FAQ 백필 감시 — 가드 (2026-09-02 신설)
 *
 * ■ 왜 만들었나
 * pipeline-watch 의 FAQ 감시는 **기사 ko 원본(articles.faq)** 하나만 봤다.
 * 같은 크론이 이어서 도는 두 차선에는 감시가 없었다:
 *
 *   영문FAQ (faq_en)                  잔여 4,381
 *   화보FAQ 언어판 (seo_translations)  잔여 16,000+
 *
 * 그 둘이 8/28~9/2 닷새 동안 생산 0건이었다. 크론은 매번 ok=true 였고
 * 감시도 조용했다 — 원본 FAQ 가 완주 상태라 계속 '정상' 이라고 답했기 때문이다.
 * 드러난 계기는 도메니코의 "너무 느리지 않나" 한마디였다.
 * **사람이 물어봐야 아는 상태는 감시가 아니다.**
 *
 * 여기서 지키는 것:
 *   ① 원본이 완주여도 차선의 0건을 잡는다   ← 닷새를 놓친 바로 그 구멍
 *   ② 라벨 뒤부터 읽는다 (원본의 'FAQ 0' 을 차선 생산량으로 읽지 않는다)
 *   ③ 다른 언어는 도는데 한 언어만 굶는 걸 잡는다 (회전이 죽은 모양)
 *   ④ ':실패' 가 절반을 넘으면 429 를 의심하라고 말한다
 *   ⑤ 완주했으면 절대 울리지 않는다 (30분마다 알림은 재앙)
 *   ⑥ 배포 직후 note 형식이 바뀌는 구간에서 헛알림을 내지 않는다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const h = require(path.join(ROOT, 'api', '_lib', 'faqHealth.js'));
const WATCH = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'pipeline-watch.js'), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

/* 실제 cron_runs.note 다 (2026-09-02 실측) */
const EN_OK   = 'FAQ 0 · 완주 (잔여 26건은 본문 80자 미만) | 영문FAQ 12 · 잔여 4381 · 2회전 · 기사:4 화보:8';
const EN_DEAD = 'FAQ 0 · 완주 (잔여 26건은 본문 80자 미만) | 영문FAQ 0 · 잔여 4404 · 기사:실패 화보:실패';
const I_OK    = '화보FAQ 0 · 완주 | 화보FAQ 언어판 17 · 잔여 550(3/7개 언어, fr부터) · 2회전 · fr:5 es:6 ja:6';
const I_DEAD  = '화보FAQ 0 · 완주 | 화보FAQ 언어판 0 · 잔여 478 · it:실패 fr:실패 es:0';
const I_TWO   = '화보FAQ 0 · 완주 | 화보FAQ 언어판 12 · 잔여 203(2/7개 언어) · it:6 fr:6';

console.log('[1] 노트 읽기 — 라벨 뒤부터 본다');
const en = h.parseFaqEnNote(EN_OK);
t('생산·잔여·회전을 읽는다', en.produced === 12 && en.remaining === 4381 && en.waves === 2, en);
t('표별 결과를 읽는다', en.parts['기사'] === 4 && en.parts['화보'] === 8, en.parts);
/* 원본 요약이 앞에 'FAQ 0 · 완주' 로 붙어 있다. 라벨 앞부터 읽으면 그 0 을
   차선 생산량으로 읽는다 — 그러면 늘 0건으로 보여 헛알림이 쏟아진다. */
t('앞의 원본 FAQ 0 을 차선 생산량으로 읽지 않는다  ← ②', en.produced !== 0);
t('차선 라벨이 없는 줄은 안 읽은 것으로 둔다',
  h.parseFaqEnNote('FAQ 7/10 · 잔여 227').parsed === false);
const i1 = h.parseFaqI18nNote(I_OK);
t('언어판도 같은 방식으로 읽는다',
  i1.produced === 17 && i1.remaining === 550 && i1.parts.fr === 5, i1);
t('"3/7개 언어" 를 파트로 오독하지 않는다', !('개 언어' in i1.parts), i1.parts);
const dead = h.parseFaqI18nNote(I_DEAD);
t('실패한 파트를 센다', dead.fails === 2 && dead.parts.es === 0, dead);

console.log('\n[2] 원본이 완주여도 차선 0건을 잡는다  ← ① 닷새를 놓친 구멍');
const sumDead = h.summarizeLaneRuns(new Array(8).fill(EN_DEAD), '영문FAQ');
t('창 안 생산 합이 0으로 집계된다', sumDead.produced === 0 && sumDead.parsed === 8, sumDead);
const jDead = h.judgeLaneHealth({
  label: '영문FAQ', remaining: 4404, produced: sumDead.produced, windowHours: 3,
  runs: sumDead.total, parsed: sumDead.parsed, fails: sumDead.fails, partRuns: sumDead.partRuns,
});
t('정체로 판정한다', jDead.status === 'stalled' && jDead.healthy === false, jDead);
t('원인을 no-output 으로 적는다', jDead.cause === 'no-output', jDead.cause);
t('사유에 잔량이 들어간다', /4404/.test(jDead.reason), jDead.reason);

console.log('\n[3] 한 언어만 굶는 걸 잡는다  ← ③ 회전이 죽은 모양');
const LANGS = ['it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'];
const sumTwo = h.summarizeLaneRuns(new Array(10).fill(I_TWO), '화보FAQ 언어판');
const silent = h.findSilentParts(sumTwo.byPart, LANGS);
t('it·fr 만 돌면 나머지 다섯을 굶은 것으로 본다',
  silent.length === 5 && !silent.includes('it') && !silent.includes('fr'), silent);
const jStarve = h.judgeLaneHealth({
  label: '화보FAQ 언어판', remaining: 16000, produced: sumTwo.produced, windowHours: 3,
  runs: sumTwo.total, parsed: sumTwo.parsed, partRuns: sumTwo.partRuns, silentParts: silent,
});
t('생산이 있어도 굶은 언어가 있으면 고장이다', jStarve.healthy === false, jStarve.status);
t('원인을 part-starved 로 적는다', jStarve.cause === 'part-starved', jStarve.cause);
t('굶은 언어 이름을 사유에 적는다 (어디를 볼지 알려준다)',
  /de/.test(jStarve.reason) && /ja/.test(jStarve.reason), jStarve.reason);
/* 전부 0 이면 그건 굶은 게 아니라 통째로 멈춘 것이다 — no-output 이 맡는다.
   여기서 part-starved 로 부르면 원인을 엉뚱한 데서 찾게 된다. */
t('전부 0 이면 굶음으로 부르지 않는다',
  h.findSilentParts(new Map([['it', 0], ['fr', 0]]), LANGS).length === 0);

console.log('\n[4] 실패가 절반을 넘으면 429 를 의심하라고 말한다  ← ④');
const jFail = h.judgeLaneHealth({
  label: '영문FAQ', remaining: 4000, produced: 4, windowHours: 3,
  runs: 6, parsed: 6, fails: 9, partRuns: 12,
});
t('degraded 로 판정한다', jFail.status === 'degraded' && jFail.healthy === false, jFail);
t('안내에 429 가 나온다', /429/.test(h.buildLaneAlert(jFail, 'https://x').lines.join('\n')));
const jFewFail = h.judgeLaneHealth({
  label: '영문FAQ', remaining: 4000, produced: 40, windowHours: 3,
  runs: 6, parsed: 6, fails: 1, partRuns: 12,
});
t('실패가 적으면 울리지 않는다 (헛알림 금지)', jFewFail.healthy === true, jFewFail.status);

console.log('\n[5] 울리면 안 되는 자리');
t('완주는 언제나 정상  ← ⑤',
  h.judgeLaneHealth({ label: 'x', remaining: 0, produced: 0, windowHours: 3, runs: 6, parsed: 6 }).healthy === true);
t('요약을 한 줄도 못 읽으면 판정 보류  ← ⑥ (배포 직후 헛알림 금지)',
  h.judgeLaneHealth({ label: 'x', remaining: 100, produced: 0, windowHours: 3, runs: 6, parsed: 0 }).status === 'unknown');
t('표본이 적으면 판정 보류',
  h.judgeLaneHealth({ label: 'x', remaining: 100, produced: 0, windowHours: 3, runs: 2, parsed: 2 }).healthy === true);
t('실행 기록이 아예 없으면 크론 배선을 보라고 한다',
  h.judgeLaneHealth({ label: 'x', remaining: 100, produced: 0, windowHours: 3, runs: 0 }).cause === 'no-runs');
/* 느린 건 장애가 아니다. 매번 울리면 진짜 정체가 묻힌다. */
const jSlow = h.judgeLaneHealth({
  label: '화보FAQ 언어판', remaining: 16000, produced: 12, windowHours: 3,
  runs: 6, parsed: 6, wavesMax: 1,
});
t('느림은 알리지 않는다', jSlow.status === 'slow' && jSlow.healthy === true, jSlow.status);
t('회전이 1에 머물면 그 사실을 사유에 적는다 (예산을 버리고 있다)',
  /회전이 1회에 머문다/.test(jSlow.reason), jSlow.reason);

console.log('\n[7] 라이브 회귀 — 2026-09-02 14시대에 실제로 온 줄');
/* 화보FAQ 언어판 0 · 잔여 0(3/7개 언어, es부터) · 1회전 · es:실패 ja:실패 de:실패
   노트가 '잔여 0' 이라고 말했지만 실제 빈칸은 16,365 였다(콜 타임아웃으로 못 잰 값을
   0 으로 합산). 감시가 노트의 잔여를 믿었다면 '완주, 정상' 이라고 답했을 것이다.
   그래서 감시는 **잔여를 DB 에서 직접 센다.** 노트는 생산량만 읽는다. */
const LIVE_LIE = '화보FAQ 0 · 완주 | 화보FAQ 언어판 0 · 잔여 0(3/7개 언어, es부터) · 1회전 · es:실패 ja:실패 de:실패';
const sumLie = h.summarizeLaneRuns(new Array(9).fill(LIVE_LIE), '화보FAQ 언어판');
const jLie = h.judgeLaneHealth({
  label: '화보FAQ 언어판',
  remaining: 16365,                 // DB 실측 — 노트의 0 이 아니다
  produced: sumLie.produced, windowHours: 3,
  runs: sumLie.total, parsed: sumLie.parsed, fails: sumLie.fails, partRuns: sumLie.partRuns,
  wavesMax: sumLie.wavesMax,
});
t('노트가 잔여 0 이라 해도 완주로 속지 않는다', jLie.status !== 'done', jLie.status);
t('정체로 잡는다 (이 줄이 9번 반복되면 울려야 한다)', jLie.healthy === false, jLie);
t('회전이 1에 머문 것도 집계된다', sumLie.wavesMax === 1, sumLie.wavesMax);
t('실패 파트를 센다', sumLie.fails === 27, sumLie.fails);

console.log('\n[6] pipeline-watch 배선');
t('영문FAQ 차선을 본다', /checkFaqEn\(/.test(WATCH));
t('언어판 차선을 본다', /checkFaqI18n\(/.test(WATCH));
t('차선마다 알림 상태를 따로 둔다 (한쪽 회복이 다른 쪽 고장을 덮지 않게)',
  /faq-en-backfill-health/.test(WATCH) && /faq-i18n-backfill-health/.test(WATCH)
  && !/FAQ_EN_ALERT_KEY = FAQ_ALERT_KEY/.test(WATCH));
t('두 차선이 규칙을 공유한다 (규칙을 두 벌로 만들지 않는다)',
  /function checkLane\(/.test(WATCH));
t('7개 언어를 기대 목록으로 준다 (안 나온 언어는 목록 없이는 안 보인다)',
  /expectedParts: \['it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'\]/.test(WATCH));
t('결과를 응답에 싣는다 (사람이 /api/cron/pipeline-watch 로 바로 볼 수 있게)',
  /faqEn, faqI18n/.test(WATCH));
t('감시가 죽어도 본 크론은 계속 돈다', /catch \(e\) \{[\s\S]{0,200}health 실패/.test(WATCH));


console.log('\n=== 굶은 건가, 실패한 건가 (2026-09-03 de 사고) ===');
{
  /* 알림이 "차례가 안 돌아온다(회전이 죽었다)" 고 단정했는데 실제로는
     회전이 멀쩡하고 de 만 매번 실패하고 있었다. 노트에 'de:실패' 라고
     이미 적혀 있었는데 알림이 다른 이야기를 했다. 그 둘은 고칠 곳이 다르다. */
  const 기대 = ['it', 'fr', 'es', 'ja', 'de', 'zh', 'ru'];

  // ㉮ 차례는 왔는데 매번 실패 (실제 사고 모양)
  const 실패노트 = [
    '화보FAQ 언어판 15 · 잔여 8011(4/7개 언어, de부터) · 2회전 · de:실패 zh:5 ru:5 it:5',
    '화보FAQ 언어판 15 · 잔여 8195(4/7개 언어, ja부터) · 2회전 · ja:5 de:실패 zh:5 ru:5',
    '화보FAQ 언어판 25 · 잔여 12009(6/7개 언어, fr부터) · 3회전 · fr:5 es:5 ja:5 de:실패 zh:5 ru:5',
  ];
  const s1 = h.summarizeLaneRuns(실패노트, '화보FAQ 언어판');
  const d1 = h.judgeLaneHealth({ label: '화보FAQ 언어판', remaining: 8000, produced: s1.produced,
    windowHours: 3, runs: s1.total, parsed: s1.parsed, fails: s1.fails, partRuns: s1.partRuns,
    wavesMax: s1.wavesMax, silentParts: h.findSilentParts(s1.byPart, 기대),
    partSeen: s1.partSeen, partFails: s1.partFails });
  t("실패하는 파트는 'part-failing' 이다", d1.cause === 'part-failing', d1.cause);
  t('몇 번 왔고 몇 번 실패했는지 숫자로 말한다', /3번 왔고 3번/.test(d1.reason), d1.reason);
  t("회전 탓으로 단정하지 않는다", !/차례가 안 돌아온다/.test(d1.reason), d1.reason);
  const a1 = h.buildLaneAlert(d1);
  t('안내가 로그의 콜 시간과 파싱 실패를 가르라고 말한다',
    a1.lines.join('\n').indexOf('파싱 실패') !== -1, a1.lines.join(' | '));

  // ㉯ 진짜로 차례가 안 온 경우 — de 가 노트에 아예 없다
  const 굶은노트 = [
    '화보FAQ 언어판 20 · 잔여 8011(4/7개 언어, it부터) · 2회전 · it:5 fr:5 es:5 ja:5',
    '화보FAQ 언어판 20 · 잔여 8195(4/7개 언어, it부터) · 2회전 · it:5 fr:5 es:5 ja:5',
    '화보FAQ 언어판 20 · 잔여 8300(4/7개 언어, it부터) · 2회전 · it:5 fr:5 es:5 ja:5',
  ];
  const s2 = h.summarizeLaneRuns(굶은노트, '화보FAQ 언어판');
  const d2 = h.judgeLaneHealth({ label: '화보FAQ 언어판', remaining: 8000, produced: s2.produced,
    windowHours: 3, runs: s2.total, parsed: s2.parsed, fails: s2.fails, partRuns: s2.partRuns,
    wavesMax: s2.wavesMax, silentParts: h.findSilentParts(s2.byPart, 기대),
    partSeen: s2.partSeen, partFails: s2.partFails });
  t("한 번도 안 나온 파트는 'part-starved' 다", d2.cause === 'part-starved', d2.cause);
  t('회전 문제라고 말한다', /차례 자체가 안 왔다/.test(d2.reason), d2.reason);
  t('굶은 언어를 이름으로 짚는다', d2.starvedParts.indexOf('de') !== -1, JSON.stringify(d2.starvedParts));

  // 두 경우가 실제로 다르게 판정돼야 한다 — 같으면 가르는 의미가 없다
  t('두 경우의 원인이 다르다', d1.cause !== d2.cause, d1.cause + ' vs ' + d2.cause);
}

console.log('\n' + (fail ? '✗' : '✓') + ' faq-lane-watch: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
