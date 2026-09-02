/**
 * 화보 FAQ 언어판 — 응답 계약을 JSONL 로 (2026-09-02 신설)
 *
 * ■ 무엇이 망가져 있었나 (라이브 실측, `[faq-i18n]` 런타임 로그 5회 × it·fr·es)
 *
 *   it 08:24  end_turn len=3599  tail=..."}]}                  ← 바깥 ] 없음
 *   it 08:34  end_turn len=3676  tail=..."}]},{"i":6,"faq":[]}
 *   it 08:44  end_turn len=3657  tail=..."}]}}                 ← ] 자리에 }
 *   fr 전부         len=4176~4458 tail=..."}]                  ← } 와 ] 둘 다 없음
 *   es 08:24  end_turn len=3674  tail=..."}]
 *
 * 전부 stop_reason=end_turn, 길이는 상한(8000토큰)의 절반. **잘린 게 아니다.**
 * 프롬프트는 기사 영문판(faqEnBackfill)과 **글자 그대로 같은 문장**이었고,
 * 그쪽에서 먼저 같은 모양을 확인했다. 관측 12건 · 코드 경로 2개 · 언어 4개.
 *
 * 실측에 {"i":6,"faq":[]} 도 있었다 — 모델이 한 항목을 포기한 것이다.
 * 배열 계약에서는 그것 하나 때문에 6건이 통째로 죽는다.
 *
 * ■ 노트가 거짓말을 하고 있었다
 * '잔여 215' ↔ '잔여 478' 이 번갈아 찍혔다. 버그가 아니라 remaining 이
 * **이번 회차에 시간 예산 안에서 본 언어들의 합**이기 때문이다
 * (it fr = 215, it fr es = 478). 전체 잔여처럼 읽히게 적어 둔 게 문제다.
 *
 * 여기서 지키는 것:
 *   ① 바깥 ] 가 없는 응답에서도 원소를 건진다  ← 오늘 실제로 오는 모양
 *   ② 한 줄이 깨져도 그 한 건만 잃는다
 *   ③ 항목 수가 원본과 다르면 저장하지 않는다 (반쪽 FAQ 금지)
 *   ④ '실패' 와 '일부만 저장' 을 노트에서 가른다
 *   ⑤ 잔여 옆에 확인한 언어 수를 적는다 — 안 적으면 진동이 원인 불명이 된다
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

const KO = [{ q: '질문1', a: '답1' }, { q: '질문2', a: '답2' }];
const updates = [];
let trRows = [];          // seo_translations 조회 결과

function stub() {
  const q = {
    select() { return q; }, eq() { return q; }, not() { return q; }, order() { return q; },
    in() { return Promise.resolve({ data: trRows, error: null }); },
    limit() { return Promise.resolve({ data: [{ id: 'e1', faq: KO }, { id: 'e2', faq: KO }], error: null }); },
    update(v) {
      const chain = { eq() { return chain; }, then(res) { updates.push(v); return Promise.resolve({ error: null }).then(res); } };
      return chain;
    },
  };
  return q;
}
inject(path.join(ROOT, 'api', '_lib', 'supabase.js'), { supabaseAdmin: { from: () => stub() } });

let reply = '';
const REAL = require(path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js'));
inject(path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js'), {
  normalizeFaq: REAL.normalizeFaq,          // 진짜 — 개수 검사가 진짜여야 의미가 있다
  callClaude: async () => ({ text: reply, stopReason: 'end_turn' }),
  LANG_NAMES: REAL.LANG_NAMES,
});

const i18n = require(path.join(ROOT, 'api', '_lib', 'editorialFaqI18nBackfill.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'editorialFaqI18nBackfill.js'), 'utf8');

function el(i) { return '{"i":' + i + ',"faq":[{"q":"Q1","a":"A1"},{"q":"Q2","a":"A2"}]}'; }
const srcMap = new Map([['e1', KO], ['e2', KO]]);

(async () => {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
  trRows = [{ content_id: 'e1', faq: null }, { content_id: 'e2', faq: null }];

  console.log('[1] 오늘 실제로 오는 깨진 응답을 건진다');
  updates.length = 0;
  reply = '```json\n[' + el(0) + ',' + el(1) + '\n```';        // 바깥 ] 없음 (fr/it 모양)
  let r = await i18n.runOneLang('it', srcMap, 6, 'm', 60000);
  t('바깥 ] 가 없는 응답에서 2건 저장  ← 이 커밋의 핵심', r.processed === 2, r);
  t('failed 로 찍히지 않는다', !r.failed);

  updates.length = 0;
  reply = '```json\n[' + el(0) + ',' + el(1) + '}\n```';       // ] 자리에 } (it 08:44 모양)
  r = await i18n.runOneLang('fr', srcMap, 6, 'm', 60000);
  t('] 자리에 } 가 온 응답도 2건 저장', r.processed === 2, r);

  console.log('\n[2] 모델이 한 항목을 포기해도 나머지는 산다');
  updates.length = 0;
  reply = el(0) + '\n{"i":1,"faq":[]}';                        // 실측 {"i":6,"faq":[]}
  r = await i18n.runOneLang('es', srcMap, 6, 'm', 60000);
  t('빈 faq 는 버리고 온전한 1건만 저장 (배열 계약이면 전멸이었다)',
    r.processed === 1 && updates.length === 1, r);
  t('요청 건수가 남는다', r.asked === 2, r.asked);

  updates.length = 0;
  reply = el(0) + '\n{"i":1,"faq":[{"q":"Q1",';                // 둘째 줄 손상
  r = await i18n.runOneLang('ja', srcMap, 6, 'm', 60000);
  t('한 줄이 깨져도 나머지는 산다', r.processed === 1, r);

  console.log('\n[3] 반쪽 FAQ 는 저장하지 않는다');
  updates.length = 0;
  reply = '{"i":0,"faq":[{"q":"Q1","a":"A1"}]}';               // 원본 2항목인데 1항목
  r = await i18n.runOneLang('de', srcMap, 6, 'm', 60000);
  t('항목 수가 다르면 버린다', r.processed === 0 && updates.length === 0, r);

  console.log('\n[4] 아무것도 못 건지면 실패로 드러난다 (조용한 0건 금지)');
  updates.length = 0;
  reply = '죄송합니다, 번역할 수 없습니다.';
  r = await i18n.runOneLang('zh', srcMap, 6, 'm', 60000);
  t('failed 플래그가 선다', r.failed === true && r.processed === 0, r);
  t('잔여를 그대로 돌려준다 (0으로 지우지 않는다)', r.remaining === 2, r.remaining);

  console.log('\n[5] 노트가 거짓말하지 않는다');
  reply = el(0) + '\n{"i":1,"faq":[{"q":"Q1",';                // 2건 요청 · 1건 저장
  const out = await i18n.runEditorialFaqI18nBatch({ batch: 6, timeoutMs: 200000, model: 'm' });
  t('요청 대비 저장이 보인다 (1/2)', /1\/2/.test(out.note), out.note);
  t('잔여 옆에 확인한 언어 수가 붙는다  ← 215↔478 진동의 정체',
    /잔여 \d+\(\d+\/\d+개 언어\)/.test(out.note), out.note);
  t('확인한 언어 수를 값으로도 돌려준다', typeof out.visited === 'number' && out.visited > 0, out.visited);
  t('전체 언어 수가 7개다', i18n.TARGET_LANGS.length === 7, i18n.TARGET_LANGS);
  t('en 은 대상이 아니다 (faq_en 칼럼이 담당)', !i18n.TARGET_LANGS.includes('en'));

  /* '실패' 와 '0건' 은 고치는 방법이 다르다. 종전에는 둘 다 'it:0' 으로 보여
     파싱이 죽은 것과 대상이 없는 것을 노트만으로 구분할 수 없었다. */
  reply = '죄송합니다, 번역할 수 없습니다.';
  const failOut = await i18n.runEditorialFaqI18nBatch({ batch: 6, timeoutMs: 200000, model: 'm' });
  t('전부 실패하면 노트에 "실패" 라고 찍힌다 (0 이 아니다)',
    /:실패/.test(failOut.note), failOut.note);
  t('그때 저장은 0 이다', failOut.processed === 0, failOut.processed);
  t('잔여는 그대로 남는다 (실패를 완주로 위장하지 않는다)',
    failOut.remaining > 0, failOut.remaining);

  console.log('\n[6] 프롬프트와 배선');
  t('JSONL 을 요구한다', /one JSON object per line \(JSONL\)/.test(SRC));
  t('배열로 감싸지 말라고 못박는다', /Do NOT wrap them in an array/.test(SRC));
  t('옛 "Return ONLY a JSON array" 계약이 사라졌다', !/Return ONLY a JSON array/.test(SRC));
  t('JSONL 파서를 먼저 쓴다', /parseJsonLines\(text, 'faq-i18n\/' \+ lang\)/.test(SRC));
  t('배열 파서를 폴백으로 남긴다', /catch \(lineErr\)[\s\S]{0,300}parseJsonArray\(text/.test(SRC));
  t('실패 로그에 머리를 남긴다', /\| head=/.test(SRC));
  t('꼬리도 그대로 남긴다 (2026-08-08 교훈)', /\| tail=/.test(SRC));
  t('stop_reason 을 계속 남긴다', /stop_reason=/.test(SRC));

  console.log('\n' + (fail ? '✗' : '✓') + ' faq-i18n-jsonl: ' + pass + ' passed / ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트가 던졌다:', e); process.exit(1); });
