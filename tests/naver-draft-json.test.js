/**
 * 네이버 초안 — JSON 파싱 실패 회귀 (2026-08-05 신설).
 *
 * 왜 필요했나 — 라이브 실측:
 *   cron_runs 기준 naver-draft-sweep 이 36시간 9회 중 6회 실패했다(66%).
 *   에러는 전부 같았다:
 *     Expected ',' or '}' after property value in JSON at position 509
 *
 *   원인은 모델이 아니라 우리가 요구한 형식이다. HTML 을 JSON 문자열 안에
 *   넣어 달라고 했는데 HTML 은 속성값에 큰따옴표를 쓴다
 *   (`<p style="text-align:center">`). 이스케이프가 하나라도 빠지면 문자열이
 *   거기서 끊기고 JSON 전체가 깨진다. position 509 는 body_html 안쪽이다.
 *   프롬프트로 "이스케이프하라"고 더 세게 말하는 건 확률 조정일 뿐이다.
 *
 * 여기서 지키는 것:
 *   ① 구조화 출력(tool_use)으로 요청할 것 — 문자열 조립을 모델에게 시키지 않는다
 *   ② tool_use 응답은 JSON.parse 없이 그대로 쓸 것
 *   ③ 텍스트로 와도 정상 JSON 이면 읽을 것 (구 동작 보존)
 *   ④ **이스케이프 안 된 따옴표가 든 응답에서도 초안을 건질 것** ← 실제 사고 재현
 *   ⑤ 잘린 응답은 원인을 밝히고 실패할 것 (조용한 성공 금지)
 *   ⑥ 초안 생성 경로가 모두 이 함수를 쓸 것 (한쪽만 고쳐지는 사고 방지)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'api', 'admin', 'naver-blog-draft.js');

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

inject(path.join(ROOT, 'api', '_lib', 'supabase.js'), { supabaseAdmin: { from: () => ({}) } });
inject(path.join(ROOT, 'api', '_lib', 'auth.js'), { requireAdmin: async () => ({ ok: true }) });
inject(path.join(ROOT, 'api', '_lib', 'aiCreditWatch.js'), { reportAiFailure: async () => {} });

process.env.ANTHROPIC_API_KEY = 'test-key';
const mod = require(TARGET);
const { _requestDraft, _salvageDraft, _DRAFT_TOOL } = mod;

let lastBody = null;
function stubClaude(content, stopReason) {
  global.fetch = async (_u, opt) => {
    lastBody = JSON.parse(opt.body);
    return { ok: true, json: async () => ({ content, stop_reason: stopReason || 'end_turn' }) };
  };
}

/* 실제 사고 모양: body_html 안의 style="…" 따옴표가 이스케이프되지 않았다. */
const BROKEN = '{\n  "title": "무너진 따옴표 테스트 제목입니다",\n'
  + '  "body_html": "<p>훅 문장</p><p style="text-align:center">가운데 정렬</p><h3>정리</h3><p>끝</p>",\n'
  + '  "tags": ["PAP매거진", "패션"]\n}';

async function run() {
  console.log('\n=== ① 구조화 출력으로 요청한다 ===');
  stubClaude([{ type: 'tool_use', name: 'emit_draft', input: { title: '제목', body_html: '<p>본문</p>', tags: ['a'] } }]);
  const d1 = await _requestDraft('프롬프트', 2500, 'test');
  t('요청에 tools 가 실린다', !!(lastBody.tools && lastBody.tools[0]), lastBody && Object.keys(lastBody));
  t('도구 사용을 강제한다 (tool_choice)',
    lastBody.tool_choice && lastBody.tool_choice.type === 'tool'
    && lastBody.tool_choice.name === 'emit_draft', lastBody.tool_choice);
  /* 2026-08-14 — '정확히 이 셋' → '적어도 이 셋'.
     홈판 전환에서 title_feed / naver_topic / thumb_caption 이 required 에 추가됐다.
     이 하네스가 지키려던 것은 "JSON 문자열 조립을 안 시키고 구조화 출력으로
     받는다" 이지 "필드가 3개다" 가 아니다. 완전 일치로 잠가 두면 필드가 늘 때마다
     의미 없이 깨진다 — 그래서 핵심 3종이 살아 있는지만 본다.
     새 필드들이 required 인지는 tests/naver-draft-homefeed.test.js 가 따로 지킨다. */
  const _req = _DRAFT_TOOL.input_schema.required;
  t('스키마가 title/body_html/tags 를 요구한다',
    ['title', 'body_html', 'tags'].every((k) => _req.indexOf(k) >= 0), _req);

  console.log('\n=== ② tool_use 응답을 그대로 쓴다 ===');
  t('제목을 읽는다', d1.title === '제목', d1);
  t('본문을 읽는다', d1.body_html === '<p>본문</p>', d1);
  t('태그를 읽는다', Array.isArray(d1.tags) && d1.tags[0] === 'a', d1);

  console.log('\n=== ③ 텍스트 정상 JSON (구 동작 보존) ===');
  stubClaude([{ type: 'text', text: '{"title":"T","body_html":"<p>B</p>","tags":["x"]}' }]);
  const d2 = await _requestDraft('p', 2500, 'test');
  t('정상 JSON 은 그대로 파싱', d2.title === 'T' && d2.body_html === '<p>B</p>');

  console.log('\n=== ④ 이스케이프 안 된 따옴표 — 실제 사고 재현 ===');
  t('예전 코드는 여기서 죽었다 (JSON.parse 실패 확인)',
    (() => { try { JSON.parse(BROKEN); return false; } catch (_) { return true; } })());
  stubClaude([{ type: 'text', text: BROKEN }]);
  const d3 = await _requestDraft('p', 2500, 'test');
  t('이제는 초안을 건진다', !!(d3 && d3.title && d3.body_html), d3);
  t('제목이 온전하다', d3.title === '무너진 따옴표 테스트 제목입니다', d3 && d3.title);
  t('본문의 style 속성이 살아 있다', d3.body_html.includes('style="text-align:center"'), d3 && d3.body_html);
  t('본문 끝이 잘리지 않았다', d3.body_html.endsWith('<p>끝</p>'), d3 && d3.body_html);
  t('태그도 회수한다', Array.isArray(d3.tags) && d3.tags.length === 2, d3 && d3.tags);

  console.log('\n=== ⑤ 진짜 실패는 조용히 넘어가지 않는다 ===');
  stubClaude([{ type: 'text', text: '{"title":"잘린 제목", "body_h' }], 'max_tokens');
  let msg = '';
  try { await _requestDraft('p', 2500, 'test'); } catch (e) { msg = String(e.message); }
  t('max_tokens 잘림을 이름 붙여 던진다', /max_tokens/.test(msg), msg);
  stubClaude([{ type: 'text', text: '죄송합니다. 처리할 수 없습니다.' }]);
  msg = '';
  try { await _requestDraft('p', 2500, 'test'); } catch (e) { msg = String(e.message); }
  t('건질 게 없으면 실패한다 (빈 초안 저장 금지)', /초안을 얻지 못함/.test(msg), msg);
  t('salvageDraft 는 못 건지면 null', _salvageDraft('아무 말') === null);

  console.log('\n=== ⑥ 두 생성 경로가 같은 함수를 쓴다 ===');
  const src = fs.readFileSync(TARGET, 'utf8');
  t('아티클·에디토리얼 모두 requestDraft 경유',
    (src.match(/await requestDraft\(/g) || []).length === 2,
    (src.match(/await requestDraft\(/g) || []).length);
  t('직접 JSON.parse 하는 초안 경로가 남아 있지 않다',
    !/const draft = JSON\.parse\(/.test(src));
  t('messages 직접 호출이 requestDraft 한 곳뿐',
    (src.match(/api\.anthropic\.com\/v1\/messages/g) || []).length === 1);

  console.log('\npassed: ' + pass + '   failed: ' + fail);
  if (fail) process.exit(1);
  console.log('✓ naver-draft-json tests passed');
}

run().catch(e => { console.error(e); process.exit(1); });
