/**
 * 영문 FAQ 백필 — 응답 계약을 JSONL 로 (2026-09-02 신설)
 *
 * ■ 무엇이 망가져 있었나 (라이브 실측, 2026-09-02 08:33 런타임 로그)
 *
 *   [faq-en] articles   batch=4 stop_reason=end_turn len=3285
 *     tail=...since 2022."}]}}```
 *   [faq-en] editorials batch=8 stop_reason=end_turn len=5922
 *     tail=...beyond the clouds."}]```
 *
 * 4시간 동안 잔여가 4409 → 4404, **5건** 줄었다. 이 속도면 4,404건에 147일이다.
 * 화보는 8회 실행 8회 전부 실패했다.
 *
 * 세 가지가 동시에 참이었고, 그게 진단의 전부다:
 *   ① stop_reason=end_turn — 잘린 게 아니다. 길이도 상한(8000토큰)의 절반 미만.
 *      "배치가 커서 잘렸다"는 종전 진단이 여기서는 **틀렸다.**
 *   ② 응답에 바깥 배열의 닫는 `]` 가 없다 (기사는 그 자리에 `}`, 화보는 아예 없음).
 *   ③ 그게 확실한 근거: findBalancedChunks 는 깊이가 0 으로 돌아오는 구간만 모은다.
 *      바깥 `]` 가 있었다면 넷째 칸(덩어리 고르기)이 살렸을 것이다. 그것도 실패했다
 *      = 균형 잡힌 최상위 배열이 응답에 없다.
 *
 * 여기서 지키는 것:
 *   ① 바깥 `]` 가 없는 응답에서도 원소를 건진다  ← 오늘 실제로 오는 모양
 *   ② 한 줄이 깨져도 그 한 건만 잃는다 (종전엔 전멸)
 *   ③ 구조를 지어내지 않는다 — 온전한 덩어리만 가져간다
 *   ④ 하나도 못 건지면 **던진다.** 0건을 조용히 성공으로 보고하지 않는다
 *   ⑤ 항목 수가 원본과 다르면 저장하지 않는다 (반쪽 FAQ 금지)
 *   ⑥ 요청 대비 저장 건수를 note 에 남긴다 — '일부 유실'이 안 보이면
 *      JSONL 의 장점이 조용한 손실로 바뀐다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}
function inject(p, exports) {
  const m = new Module(p, null);
  m.filename = p; m.loaded = true; m.exports = exports;
  require.cache[p] = m;
}

const { parseJsonLines } = require(path.join(ROOT, 'api', '_lib', 'jsonRepair.js'));

/* ── DB·AI 스텁 ─────────────────────────────────────────────── */
const updates = [];
let pending = [];
function tableStub() {
  const q = {
    _t: null,
    select() { return q; }, eq() { return q; }, not() { return q; }, is() { return q; },
    gte() { return q; }, order() { return q; },
    /* limit 을 **실제로 지킨다.** 종전에는 인자를 무시하고 pending 전체를 돌려줬는데,
       그러면 batch 계산이 틀려도 테스트가 통과한다 — 실제로 그 변이가 안 잡혔다.
       DB 를 흉내 내는 스텁이 DB 의 제약을 안 지키면 그 자리는 검사되지 않는 셈이다. */
    limit(n) { return Promise.resolve({ data: pending.slice(0, n), error: null }); },
    range() { return Promise.resolve({ data: [], error: null }); },
    update(v) { return { eq: (c, id) => { updates.push({ id, v }); return Promise.resolve({ error: null }); } }; },
    /* 개수 질의도 **pending 을 따른다** (2026-09-06). 종전에는 7 로 박아 놔서
       '채울 게 하나도 없다' 는 상태를 이 하네스로 만들 수가 없었다. 그 바람에
       완주 경로가 검사되지 않았고, 라이브에서 헛알림으로 드러났다.
       스텁이 DB 의 제약을 안 지키면 그 자리는 검사 안 되는 셈이다 (limit 과 같은 교훈). */
    then(res) { return Promise.resolve({ count: pending.length, error: null }).then(res); },
  };
  return q;
}
inject(path.join(ROOT, 'api', '_lib', 'supabase.js'), { supabaseAdmin: { from: () => tableStub() } });

let reply = '';           // callClaude 가 돌려줄 원문
let stopReason = 'end_turn';
const REAL_ST = require(path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js'));
inject(path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js'), {
  normalizeFaq: REAL_ST.normalizeFaq,     // 진짜를 쓴다 — 개수 검사가 진짜여야 의미가 있다
  callClaude: async () => ({ text: reply, stopReason: stopReason }),
});

const fe = require(path.join(ROOT, 'api', '_lib', 'faqEnBackfill.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'faqEnBackfill.js'), 'utf8');

const KO = [{ q: '질문1', a: '답1' }, { q: '질문2', a: '답2' }];
function el(i) { return '{"i":' + i + ',"faq":[{"q":"Q1","a":"A1"},{"q":"Q2","a":"A2"}]}'; }

(async () => {
  console.log('[1] parseJsonLines — 오늘 실제로 오는 모양을 건진다');
  /* 기사: 바깥 ] 자리에 } 가 왔다 (실측 tail: ..."}]}}```) */
  const brokenArticles = '```json\n[' + el(0) + ',' + el(1) + '}\n```';
  const a1 = parseJsonLines(brokenArticles, 'articles');
  t('바깥 ] 가 } 로 바뀐 응답에서 2건을 건진다', a1.value.length === 2, a1.value.length);
  t('인덱스가 살아 있다', a1.value.map((v) => v.i).join(',') === '0,1');
  /* 화보: 원소 } 와 바깥 ] 가 둘 다 없다 (실측 tail: ..."}]```) */
  const brokenEds = '```json\n[' + el(0) + ',' + el(1).slice(0, -1) + '\n```';
  const a2 = parseJsonLines(brokenEds, 'editorials');
  t('원소 닫는 } 까지 없는 응답에서도 온전한 1건은 건진다', a2.value.length === 1, a2.value.length);
  t('그 1건이 0번이다 (앞에서부터 온전한 것)', a2.value[0].i === 0);

  console.log('\n[2] parseJsonLines — JSONL 과 부분 손실');
  t('정상 JSONL 3줄', parseJsonLines([el(0), el(1), el(2)].join('\n'), 'x').value.length === 3);
  t('빈 줄·산문이 섞여도 읽는다',
    parseJsonLines('여기 있습니다:\n' + el(0) + '\n\n' + el(1) + '\n끝', 'x').value.length === 2);
  t('마지막 줄이 잘리면 앞의 것만 살린다',
    parseJsonLines(el(0) + '\n' + el(1) + '\n{"i":2,"faq":[{"q":"Q",', 'x').value.length === 2);
  t('배열로 와도 그대로 읽는다 (계약 전환 중에 한쪽이 죽지 않게)',
    parseJsonLines('[' + el(0) + ',' + el(1) + ']', 'x').value.length === 2);

  console.log('\n[3] 삼키지 않는다 — 0건은 성공이 아니다');
  let threw = false;
  try { parseJsonLines('아무 객체도 없는 산문입니다.', 'x'); } catch (e) { threw = /찾지 못함/.test(e.message); }
  t('객체가 없으면 던진다', threw === true);
  threw = false;
  try { parseJsonLines('{이건 JSON 이 아니다}', 'x'); } catch (e) { threw = /전부 파싱 실패/.test(e.message); }
  t('덩어리는 있는데 전부 깨졌으면 던진다', threw === true);
  t('빈 배열을 조용히 돌려주지 않는다 (위 두 케이스가 그 증거)', true);

  console.log('\n[4] 백필이 실제로 저장한다 — 스텁 AI 로 한 바퀴');
  const target = { table: 'articles', label: '기사', batch: 4 };
  pending = [{ id: 'a1', faq: KO }, { id: 'a2', faq: KO }];

  updates.length = 0;
  reply = el(0) + '\n' + el(1);
  let r = await fe.runOneTable(target, 4, 'm', 60000);
  t('JSONL 2건이 저장된다', r.processed === 2 && updates.length === 2, r);
  t('faq_en 칼럼에 넣는다', updates[0].v && Array.isArray(updates[0].v.faq_en));
  t('요청 건수를 함께 돌려준다', r.asked === 2, r.asked);

  updates.length = 0;
  reply = '```json\n[' + el(0) + ',' + el(1) + '}\n```';
  r = await fe.runOneTable(target, 4, 'm', 60000);
  t('오늘의 깨진 배열 응답도 2건 저장된다  ← 이 커밋의 핵심',
    r.processed === 2 && !r.failed, r);

  updates.length = 0;
  reply = el(0) + '\n{"i":1,"faq":[{"q":"Q1",';        // 둘째 줄 손상
  r = await fe.runOneTable(target, 4, 'm', 60000);
  t('한 줄이 깨져도 나머지는 산다 (종전엔 전멸)', r.processed === 1, r);
  t('요청 2건 중 1건임이 드러난다', r.asked === 2 && r.processed === 1);

  updates.length = 0;
  reply = '{"i":0,"faq":[{"q":"Q1","a":"A1"}]}';        // 원본 2항목인데 1항목
  r = await fe.runOneTable(target, 4, 'm', 60000);
  t('항목 수가 다르면 저장하지 않는다 (반쪽 FAQ 금지)',
    r.processed === 0 && updates.length === 0, r);

  updates.length = 0;
  reply = '이번엔 도저히 못 하겠습니다.';
  r = await fe.runOneTable(target, 4, 'm', 60000);
  t('아무것도 못 건지면 failed 로 표시된다', r.failed === true && r.processed === 0, r);

  console.log('\n[5] 프롬프트가 JSONL 을 요구한다');
  const prompt = fe.buildPrompt([{ i: 0, faq: KO }]);
  t('한 줄에 객체 하나를 요구한다', /one JSON object per line \(JSONL\)/.test(prompt));
  t('배열로 감싸지 말라고 못박는다', /Do NOT wrap them in an array/.test(prompt));
  t('입력과 같은 순서·같은 줄 수를 요구한다', /Exactly one line per input item, in the same order/.test(prompt));
  t('코드펜스 금지가 남아 있다', /no code fences/.test(prompt));
  t('옛 "Return ONLY a JSON array" 계약이 사라졌다', !/Return ONLY a JSON array/.test(prompt));

  console.log('\n[6] 배선과 관측');
  t('JSONL 파서를 먼저 쓴다', /parseJsonLines\(rawText, table\)/.test(SRC));
  t('배열 파서를 폴백으로 남긴다 (계약 전환 중 한쪽이 죽지 않게)',
    /catch \(lineErr\)[\s\S]{0,200}parseJsonArray\(rawText, table\)/.test(SRC));
  t('실패 로그에 머리를 남긴다 (꼬리만으로는 원인을 못 가른다)', /\| head=/.test(SRC));
  t('실패 로그에 꼬리도 그대로 남긴다', /\| tail=/.test(SRC));
  t('stop_reason 을 계속 남긴다 (잘림과 실패를 가르는 값)', /stop_reason=/.test(SRC));

  /* note 는 정규식이 아니라 **실제 실행 결과**로 확인한다.
     원문 정규식은 이 저장소가 세 번 데인 함정이다 (§G). */
  pending = [{ id: 'a1', faq: KO }, { id: 'a2', faq: KO }];
  reply = el(0) + '\n{"i":1,"faq":[{"q":"Q1",';        // 2건 요청, 1건만 온전
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
  const batchOut = await fe.runFaqEnBatch({ batch: 4, timeoutMs: 120000, model: 'm' });
  /* 종전에는 이 줄이 /1\/2/ 였다. 오늘 회전(파도)을 넣자 누계가 2/4 가 되면서
     **내가 오늘 쓴 이 단정이 나를 막았다.** 숫자를 박으면 안 된다. 봐야 할 것은
     '요청보다 적게 저장됐다는 사실이 노트에 드러나는가' 뿐이다. (§G 원문 정규식 함정) */
  const ratio = /(\d+)\/(\d+)/.exec(batchOut.note);
  t('note 에 요청 대비 저장 건수가 드러난다 (저장 < 요청)',
    !!ratio && Number(ratio[1]) < Number(ratio[2]), batchOut.note);
  t('note 에 잔여가 함께 찍힌다', /잔여 \d/.test(batchOut.note), batchOut.note);
  t('두 표를 다 돌고 라벨을 남긴다', /기사/.test(batchOut.note) && /화보/.test(batchOut.note), batchOut.note);



  console.log('\n[6-3] 못 끝낼 파도를 시작하지 않는다 (2026-09-06 실측)');
  {
    /* 실측: [faq-en] articles ... The operation was aborted due to timeout 이
       매 회차 찍히고 노트는 '2회전 · 기사:12' 였다. 파도는 두 번 돌았는데
       저장은 한 번치다 — 두 번째 콜이 통째로 버려졌다.
       파도 하나가 약 60초인데 고정 문턱이 35초였기 때문이다. */
    pending = new Array(60).fill(0).map((_, i) => ({ id: 'p' + i, faq: KO }));
    reply = el(0) + '\n' + el(1);

    // 예산이 첫 파도 문턱보다 적으면 아예 시작하지 않는다
    const 없음 = await fe.runFaqEnBatch({ batch: 4, timeoutMs: 10000, model: 'm' });
    t('첫 파도 문턱도 못 넘으면 한 번도 안 돈다', 없음.waves === 0, 없음.waves);

    // 넉넉하면 여러 파도를 돈다
    const 넉넉 = await fe.runFaqEnBatch({ batch: 4, timeoutMs: 270000, model: 'm' });
    t('예산이 넉넉하면 파도를 여러 번 돈다', 넉넉.waves >= 2, 넉넉.waves);
    t('파도 수가 상한을 안 넘는다', 넉넉.waves <= 6, 넉넉.waves);

    /* 규칙이 코드에 실제로 걸려 있는가 — 상수만 있고 안 쓰면 의미가 없다 */
    t('직전 파도 시간을 잰다', /lastWaveMs = Date\.now\(\) - waveStart/.test(SRC));
    t('그 값으로 다음 파도를 정한다', /lastWaveMs \* 1\.15/.test(SRC));
    t('첫 파도는 잴 게 없으니 종전 문턱을 쓴다', /: START_FLOOR_MS/.test(SRC));

    pending = [{ id: 'a1', faq: KO }, { id: 'a2', faq: KO }];   // 원상복구
  }

  console.log('\n[6-2] 할 일이 없는 표를 노트에서 숨기지 않는다 (2026-09-06 헛알림)');
  {
    /* ■ 실제 사고 — 어제 언어판에 넣은 고침을 **이 파일에는 안 넣었다**
         09-05 17:33  … · 기사:12 화보:9    ← 화보가 마지막 9건을 채우고 끝
         09-05 18:03  … · 기사:12          ← 화보가 노트에서 사라졌다
         알림:        "화보 은 차례 자체가 안 왔다(회전)"
       완주인데 굶었다고 읽었다. 실측: editorials 남은칸 0 · articles 352.
       '규칙이 두 벌이면 한쪽만 고쳐진다' 를 하루 만에 내가 재현했다. */
    pending = [];                                   // 채울 것이 하나도 없다
    reply = el(0);
    const 끝 = await fe.runFaqEnBatch({ batch: 4, timeoutMs: 120000, model: 'm' });
    t('할 일이 없어도 표가 노트에 남는다', /완주/.test(끝.note), 끝.note);
    t('두 표가 다 보인다 (숨지 않는다)',
      /기사:완주/.test(끝.note) && /화보:완주/.test(끝.note), 끝.note);
    t('생산은 0 이다', 끝.processed === 0, 끝.processed);

    /* 감시기가 이 노트를 완주로 읽는가 — 두 파일을 잇는 계약이다 */
    const health = require(path.join(ROOT, 'api', '_lib', 'faqHealth.js'));
    const sum = health.summarizeLaneRuns([끝.note], '영문FAQ');
    t('감시기가 완주한 표를 알아본다',
      sum.partDone.has('기사') && sum.partDone.has('화보'), Array.from(sum.partDone).join('·'));
    const silent = health.findSilentParts(sum.byPart, ['기사', '화보'], sum.partDone);
    t('굶은 표로 오해하지 않는다', silent.length === 0, JSON.stringify(silent));

    /* 한쪽만 끝난 실제 모양 — 이게 알림을 울린 상태다 */
    const 실제 = '영문FAQ 12 · 잔여 352 · 2회전 · 기사:12 화보:완주';
    const s2 = health.summarizeLaneRuns([실제, 실제, 실제], '영문FAQ');
    const silent2 = health.findSilentParts(s2.byPart, ['기사', '화보'], s2.partDone);
    t('한 표만 끝나도 헛알림이 안 나간다', silent2.length === 0, JSON.stringify(silent2));

    pending = [{ id: 'a1', faq: KO }, { id: 'a2', faq: KO }];   // 원상복구
  }

  console.log('\n[7] 처리량 — 한 회차에 한 번만 부르고 끝내지 않는다 (2026-09-02)');
  /* 실측: 함수 예산 100초인데 실행이 45~68초였다. 표마다 한 번씩 부르고 끝나서
     30~50초를 매 회차 버렸다. 크론을 더 자주 돌릴 수는 없다 — 호출 예산이
     2,598/2,600 이다. 그래서 남는 시간과 동시성으로 처리량을 올린다. */
  t('예산이 남으면 같은 회차에서 다시 돈다', batchOut.waves >= 2, batchOut.waves);
  t('회전 수가 노트에 찍힌다 (안 찍으면 반복이 도는지 알 수 없다)',
    /회전/.test(batchOut.note), batchOut.note);
  t('표를 동시에 부른다 (순서대로 기다리지 않는다)',
    /Promise\.all\(live\.map\(/.test(SRC));
  t('한 콜이 던져도 나머지를 죽이지 않는다', /\.catch\(\(err\) => \{[\s\S]{0,200}failed: true/.test(SRC));
  t('무한 반복 안전핀이 있다', /MAX_WAVES/.test(SRC));
  t('잔여가 안 줄면 그 표를 이 회차에서 뺀다 (원인 모른 채 반복 금지)',
    /잔여가 안 줄었다/.test(SRC));

  /* 배치 상한 — 4·8 은 "max_tokens 에서 잘렸다" 는 **오늘 뒤집힌 진단**의 잔재였다. */
  const arts = fe.TARGETS.find((x) => x.table === 'articles');
  const edis = fe.TARGETS.find((x) => x.table === 'editorials');
  t('기사 배치가 종전 4보다 크다', arts.batch > 4, arts.batch);
  t('화보 배치가 종전 8보다 크다', edis.batch > 8, edis.batch);
  /* 2026-09-02 실측: 크론이 batch:8 을 넘기는데 Math.min(8, 12) 로 깎여
     표별 설정(기사 12·화보 20)이 **한 번도 적용된 적이 없었다.**
     노트 `2회전 · 기사:8 화보:16` 이 그 증거였다(회당 8·8).
     여기는 값이 아니라 **행동**으로 본다 — 호출부가 작은 값을 줘도 표 크기가 이긴다. */
  updates.length = 0;
  pending = new Array(12).fill(0).map((_, i) => ({ id: 'x' + i, faq: KO }));
  reply = new Array(12).fill(0).map((_, i) => el(i).replace('"i":0', '"i":' + i)).join('\n');
  const bigTarget = { table: 'articles', label: '기사', batch: 12 };
  const rBig = await fe.runOneTable(bigTarget, 4, 'm', 60000);   // 호출부가 4 를 줘도
  t('호출부의 작은 batch 가 표별 크기를 깎지 않는다  ← 처리량을 40%로 묶던 줄',
    rBig.asked === 12, rBig.asked);

  pending = [{ id: 'a1', faq: KO }, { id: 'a2', faq: KO }];      // 원상복구
  reply = el(0) + '\n{"i":1,"faq":[{"q":"Q1",';

  t('출력 토큰 상한이 배치를 다시 묶지 않는다',
    /MAX_TOKENS = (\d+)/.test(SRC) && Number(/MAX_TOKENS = (\d+)/.exec(SRC)[1]) >= 16000,
    /MAX_TOKENS = (\d+)/.exec(SRC)[1]);

  console.log('\n' + (fail ? '✗' : '✓') + ' faq-en-jsonl: ' + pass + ' passed / ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트가 던졌다:', e); process.exit(1); });
