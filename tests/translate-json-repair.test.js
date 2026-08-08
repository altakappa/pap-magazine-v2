/**
 * 배치 응답 JSON 복구 (2026-08-08 신설).
 *
 * ── 실제 사고 ────────────────────────────────────────────────────────
 * 08-08 12:10~15:10 KST, 크론 90회 중 **78회(87%)** 가 같은 오류로 배치를
 * 통째로 버렸다:
 *
 *     zh/art:4/남243 ERR 배치 실패: 번역 응답 JSON 파싱 실패(복구 0건): ```json
 *     [{"i":0,"t
 *
 * ── 원인 (재현으로 확인) ────────────────────────────────────────────
 * 코드 펜스는 원인이 **아니다** — 2026-07-31 Patch 3 이 이미 처리한다.
 * 같은 문구가 나오는 경우를 재현해 넷으로 갈랐다:
 *
 *   ② 문자열 안에 이스케이프 안 된 개행     → 고칠 수 있다 (규격상 불법 문자)
 *   ⑤ 문자열 안에 이스케이프 안 된 탭       → 고칠 수 있다
 *   ④ 문자열 안에 이스케이프 안 된 큰따옴표 → 1차에는 "못 고친다" 로 뒀다
 *   ③ 응답이 잘려 첫 객체가 안 닫힘         → **못 고친다** (내용이 없다)
 *
 * ── 2차 (같은 날 저녁): ④ 판단을 뒤집었다 ──────────────────────────
 * 1차 배포 후 note 에 찍힌 실패가 **17종 전부 ④** 였다. 즉 나는 실패의 0%를
 * 고치고 100%를 남겨둔 것이다. "경계를 알 수 없다"고 했지만, 이 응답의
 * 스키마는 평평해서(`{"i":숫자,"title":"…","body":"…"}`) 문자열을 진짜로
 * 끝내는 따옴표 뒤에는 반드시 `,` `:` `}` `]` 가 온다. 경계는 알 수 있었다.
 * 다만 완벽하지 않아(내용이 `"…",` 로 이어지면 끊긴다) **최후의 수단**으로만
 * 쓰고 `__repaired` 로 세어 note 에 남긴다.
 *
 * ── 왜 CJK 만 아팠나 ────────────────────────────────────────────────
 * 아티클 배치는 1건이고 CJK 는 cjkScale 로도 더 안 줄어 그대로 1이다.
 * 20건짜리 배치는 한 건이 깨져도 19건이 salvage 로 살아남지만
 * **1건짜리는 깨지면 남는 게 없다.** 그래서 zh 만 매번 콜을 통째로 버렸다.
 * (진행 자체는 됐다 — 단건 재시도가 구분자 포맷으로 받아냈다. 잃은 건 속도다.)
 *
 * ── 계측 실패도 함께 기록한다 ───────────────────────────────────────
 * 08-07 에 note 로 실패를 끌어올렸는데 ERR 을 **50자로 잘라놨다.** 그 50자가
 * 전부 "```json\n[{"i":0,"t" 라는 정보 없는 앞머리였다. 78회를 보고도 원인을
 * 못 갈랐다 — **계측을 넣고도 못 읽은 것이다.**
 * → 진단명을 오류 문구 **맨 앞**으로 뺐다. 뒤가 잘려도 종류는 남는다.
 *
 * ── 이 테스트가 지키는 것 ───────────────────────────────────────────
 *   ① 고칠 수 있는 것(제어문자)은 고친다
 *   ② 고칠 수 없는 것(따옴표·잘림)은 **고친 척하지 않는다**
 *   ③ 복구가 내용을 바꾸지 않는다 — 살아난 값이 원문과 같아야 한다
 *   ④ 정상 응답 경로는 그대로다 (느려지거나 달라지지 않는다)
 *   ⑤ 실패 문구에 진단명이 앞에 붙는다
 *   ⑥ 크론이 그 진단명이 살아남을 만큼 넓게 싣는다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'api', '_lib', 'seoTranslateBackfill.js');
const SUPABASE = path.join(ROOT, 'api', '_lib', 'supabase.js');
const CRON = path.join(ROOT, 'api', 'cron', 'backfill-translations.js');

const m = new Module(SUPABASE, null);
m.filename = SUPABASE; m.loaded = true;
m.exports = { supabaseAdmin: { from() { throw new Error('no'); }, rpc() { return Promise.resolve({ data: [], error: null }); } } };
require.cache[SUPABASE] = m;

const { parseJsonArray, salvageObjects, escapeRawControls, escapeInnerQuotes, diagnoseJson } = require(HELPER);

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', String(d).slice(0, 200)); }
}
function tryParse(s) { try { return { ok: true, v: parseJsonArray(s) }; } catch (e) { return { ok: false, msg: e.message }; } }

const F = '```json\n';

console.log('\n=== ④ 정상 경로는 그대로 ===');
t('펜스 + 정상 JSON', (() => { const r = tryParse(F + '[{"i":0,"title":"标题","body":"<p>秀场</p>"}]\n```'); return r.ok && r.v.length === 1 && r.v[0].title === '标题'; })());
t('서두 설명문 + 정상 JSON', (() => { const r = tryParse('好的：\n' + F + '[{"i":0,"title":"A","body":"x"}]\n```'); return r.ok && r.v.length === 1; })());
t('펜스 없는 순수 JSON', (() => { const r = tryParse('[{"i":0,"title":"A","body":"x"}]'); return r.ok && r.v.length === 1; })());

console.log('\n=== ① 고칠 수 있는 것: 문자열 안 제어문자 ===');
const rawNl = F + '[{"i":0,"title":"标题","body":"첫줄\n둘째줄"}]\n```';
const r2 = tryParse(rawNl);
t('② 생 개행이 있어도 복구된다', r2.ok && r2.v.length === 1, r2.msg);
t('③ 복구된 값이 원문과 같다 (내용을 바꾸지 않는다)',
  r2.ok && r2.v[0].body === '첫줄\n둘째줄', r2.ok && JSON.stringify(r2.v[0].body));
const rawTab = F + '[{"i":0,"title":"标题","body":"a\tb"}]\n```';
const r5 = tryParse(rawTab);
t('⑤ 생 탭도 복구된다', r5.ok && r5.v.length === 1, r5.msg);
t('탭 값도 그대로 보존된다', r5.ok && r5.v[0].body === 'a\tb');
const rawCr = '[{"i":0,"title":"T","body":"a\rb"}]';
t('생 캐리지리턴도 복구된다', (() => { const r = tryParse(rawCr); return r.ok && r.v[0].body === 'a\rb'; })());

console.log('\n=== ② 고칠 수 없는 것은 고친 척하지 않는다 ===');
/* 2026-08-08 2차 — ④ 는 이제 최후의 수단으로 복구한다(위 머리말 참고).
   여기서는 '복구하되 내용을 바꾸지 않는다' 를 지킨다. */
const rq = tryParse(F + '[{"i":0,"title":"她说"你好"","body":"x"}]\n```');
t('④ 생 큰따옴표는 복구하되 내용을 보존한다',
  rq.ok && rq.v[0].title === '她说"你好"', rq.ok ? JSON.stringify(rq.v[0].title) : rq.msg);
const rt = tryParse(F + '[{"i":0,"title":"标题","body":"<p>秀场秀场');
t('③ 잘린 응답은 실패로 둔다', !rt.ok, rt.ok && JSON.stringify(rt.v));

console.log('\n=== 배치가 클 때: 성한 건은 계속 살아남는다 ===');
const mixed = F + '[{"i":0,"title":"A","body":"x"},{"i":1,"title":"B","body":"y\nz"}]';
const rm = tryParse(mixed);
t('둘 다 살아난다 (전에는 앞 1건만)', rm.ok && rm.v.length === 2, rm.ok && rm.v.length);
const truncTail = '[{"i":0,"title":"A","body":"x"},{"i":1,"title":"B","body":"잘린';
const rtt = tryParse(truncTail);
t('꼬리가 잘려도 앞 건은 건진다 (Patch 4 유지)', rtt.ok && rtt.v.length === 1, rtt.msg);
t('title 없는 조각은 안 건진다', salvageObjects('[{"i":0,"body":"x"}]', 0).length === 0);

console.log('\n=== ⑤ 실패 문구에 진단명이 앞에 붙는다 ===');
t('잘림 → 닫는대괄호없음', /파싱 실패\[닫는대괄호없음\]/.test(rt.msg), rt.msg);
t('진단명이 앞머리(```json)보다 먼저 나온다',
  rt.msg.indexOf('[닫는대괄호없음]') < rt.msg.indexOf('```'), rt.msg);
t('50자로 잘라도 진단명이 남는다', /닫는대괄호없음/.test(rt.msg.slice(0, 50)), rt.msg.slice(0, 50));
t('제어문자 진단이 따로 있다',
  diagnoseJson('[{"a":"x\ny"}]', 0, 12) === '문자열내제어문자', diagnoseJson('[{"a":"x\ny"}]', 0, 12));
t('닫는 대괄호가 없으면 end<=start 로 판정', diagnoseJson('[{"a":1', 0, -1) === '닫는대괄호없음');

console.log('\n=== escapeRawControls 자체 ===');
t('문자열 밖 개행은 건드리지 않는다',
  escapeRawControls('[\n{"a":"b"}\n]') === '[\n{"a":"b"}\n]', JSON.stringify(escapeRawControls('[\n{"a":"b"}\n]')));
t('이미 이스케이프된 \\n 은 두 번 바꾸지 않는다',
  escapeRawControls('{"a":"x\\ny"}') === '{"a":"x\\ny"}');
t('역슬래시 이스케이프를 문자열 종료로 오인하지 않는다',
  (() => { const s = '{"a":"c:\\\\path","b":"y\nz"}'; const o = JSON.parse(escapeRawControls(s)); return o.a === 'c:\\path' && o.b === 'y\nz'; })());
t('희귀 제어문자는 \\u 로 바꾼다',
  escapeRawControls('{"a":"x\u0001y"}').includes('\\u0001'));
t('평범한 문자열은 그대로', escapeRawControls('{"a":"보통"}') === '{"a":"보통"}');

console.log('\n=== ⑥ 크론이 진단명을 실을 만큼 넓다 ===');
const cron = fs.readFileSync(CRON, 'utf8');
const w = (cron.match(/first\.reason \|\| first\.message \|\| first\)\.slice\(0, (\d+)\)/) || [])[1];
t('errors[] 문구를 90자 이상 싣는다', Number(w) >= 90, w);
t('50자로 되돌아가지 않았다', Number(w) !== 50, w);

/* ── 2026-08-08 2차: ④ 도 고친다. 근거는 배포 후 note 에 찍힌 실패 17종 전부. ── */
console.log('\n=== ④ 최후의 수단: 값 안의 생 큰따옴표 (실제 실패 제목) ===');
/* cron_runs note 에서 그대로 뽑은 zh 제목들. 중국어 기사는 컬렉션·협업 이름을
   따옴표로 감싸는 관행이 있어 모델이 프롬프트의 escape 지시를 상습적으로 어긴다. */
const REAL_TITLES = [
  'Off-White 2024度假系列"Homecoming"发布',
  'Marni推出"2023兔年"纪念胶囊系列',
  'Prada社交俱乐部"Prada Mode"首次登陆韩国',
  'A.P.C. X ASICS 推出联名运动鞋"GEL-SONOMA"',
  'PUMA庆祝曼彻斯特城足球俱乐部访韩，开设"PUMA CITY"',
];
for (const title of REAL_TITLES) {
  const r = tryParse(F + '[{"i":0,"title":"' + title + '","body":"<p>正文</p>"}]\n```');
  t('복구: ' + title.slice(0, 22) + '…', r.ok && r.v.length === 1 && r.v[0].title === title,
    r.ok ? r.v[0].title : r.msg);
}
t('본문도 함께 살아난다', (() => {
  const r = tryParse(F + '[{"i":0,"title":"A"B","body":"<p>正文</p>"}]');
  return r.ok && r.v[0].body === '<p>正文</p>';
})());

console.log('\n=== ④ 복구는 조용히 하지 않는다 ===');
const rq2 = tryParse(F + '[{"i":0,"title":"Marni推出"2023兔年"系列","body":"x"}]');
t('복구한 건에 __repaired 표시가 붙는다', rq2.ok && rq2.v[0].__repaired === true);
t('정상 파싱된 건에는 안 붙는다', (() => {
  const r = tryParse('[{"i":0,"title":"보통","body":"x"}]');
  return r.ok && r.v[0].__repaired === undefined;
})());
t('제어문자만으로 살아난 건에도 안 붙는다 (더 약한 복구가 먼저다)', (() => {
  const r = tryParse('[{"i":0,"title":"T","body":"a\nb"}]');
  return r.ok && r.v[0].__repaired === undefined;
})());

console.log('\n=== ④ escapeInnerQuotes 자체 ===');
t('진짜 경계(뒤에 , : } ])는 안 건드린다',
  escapeInnerQuotes('{"a":"x","b":"y"}') === '{"a":"x","b":"y"}');
t('공백이 끼어도 경계로 본다',
  JSON.parse(escapeInnerQuotes('{"a":"x" , "b":"y"}')).b === 'y');
t('이미 이스케이프된 따옴표는 두 번 안 바꾼다',
  escapeInnerQuotes('{"a":"x\\"y"}') === '{"a":"x\\"y"}');
t('경로의 역슬래시를 문자열 종료로 오인하지 않는다',
  JSON.parse(escapeInnerQuotes('{"a":"c:\\\\path","b":"say"hi"here"}')).a === 'c:\\path');
/* 한계는 숨기지 않는다 — 내용이 따옴표+쉼표로 이어지면 거기서 끊긴다.
   그래서 최후의 수단으로만 쓰고 __repaired 로 센다. */
t('한계: 따옴표 바로 뒤 쉼표는 경계로 오인한다 (알고 쓰는 것)', (() => {
  const r = tryParse('[{"i":0,"title":"그는 "안녕",이라 했다","body":"x"}]');
  return !r.ok || r.v[0].title !== '그는 "안녕",이라 했다';
})());

console.log('\n=== ④ 크론이 복구 건수를 note 에 남긴다 ===');
t('json_repaired 를 합산한다', /cur\.repaired \+= r\.json_repaired \|\| 0/.test(cron));
t("note 에 /복구N 으로 남긴다", /'\/복구' \+ v\.repaired/.test(cron));
t('0 이면 안 붙인다', /v\.repaired \? '\/복구'/.test(cron));
t('헬퍼가 json_repaired 를 응답에 담는다',
  /json_repaired: jsonRepaired \|\| undefined/.test(fs.readFileSync(path.join(ROOT,'api/_lib/seoTranslateBackfill.js'),'utf8')));

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) process.exit(1);
console.log('✓ translate-json-repair tests passed');
