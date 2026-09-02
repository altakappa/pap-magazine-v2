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
    limit() { return Promise.resolve({ data: pending, error: null }); },
    range() { return Promise.resolve({ data: [], error: null }); },
    update(v) { return { eq: (c, id) => { updates.push({ id, v }); return Promise.resolve({ error: null }); } }; },
    then(res) { return Promise.resolve({ count: 7, error: null }).then(res); },
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
  t('note 에 요청 대비 저장 건수가 찍힌다 (1/2)', /1\/2/.test(batchOut.note), batchOut.note);
  t('note 에 잔여가 함께 찍힌다', /잔여 \d/.test(batchOut.note), batchOut.note);
  t('두 표를 다 돌고 라벨을 남긴다', /기사/.test(batchOut.note) && /화보/.test(batchOut.note), batchOut.note);

  console.log('\n' + (fail ? '✗' : '✓') + ' faq-en-jsonl: ' + pass + ' passed / ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트가 던졌다:', e); process.exit(1); });
