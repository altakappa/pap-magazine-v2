/**
 * 관리자 텍스트 → 텔레그램 라우트 회귀 (2026-10-19)
 * 도메니코 "기사 만들어서 텔레그램으로 보내줘" 를 위한 얇은 통로. 지킬 것:
 * 관리자 전용 · POST 만 · 빈 텍스트 거부 · 4000자 분할은 문단 경계 · 순서 보장(직렬 await).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const src = R('api/admin/telegram-text.js');
// 라우트는 _lib/auth → _lib/supabase 를 끌어온다. 순수 함수만 보려고 스텁을 끼운다.
for (const rel of ['api/_lib/supabase.js']) {
  const abs = path.join(ROOT, rel);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: { supabaseAdmin: { from: () => ({}) }, supabase: {} } };
}
const { splitChunks } = require('../api/admin/telegram-text.js');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

console.log('\n=== 가드 ===');
t('관리자 세션 필수', /requireAdmin\(req, res\)/.test(src));
t('POST 만', /req\.method !== 'POST'/.test(src));
t('빈 텍스트 400', /text 가 비었다/.test(src));
t('개인방·그룹 선택 (personal)', /b\.personal \? sendTextToTelegramPersonalSafe : sendTextToTelegramSafe/.test(src));
t('조각을 직렬로 보낸다 (순서 보장)', /for \(const p of parts\) \{\s*const r = await send\(p\)/.test(src));

console.log('\n=== 분할 ===');
t('짧은 글은 1조각', splitChunks('안녕', 4000).length === 1);
const para = 'A'.repeat(1500) + '\n\n' + 'B'.repeat(1500) + '\n\n' + 'C'.repeat(1500);
const parts = splitChunks(para, 4000);
t('문단 경계에서 자른다', parts.length === 2 && parts[0].endsWith('B'.repeat(10)) && parts[1].startsWith('C'));
t('경계 없으면 size 에서 자른다', splitChunks('x'.repeat(9000), 4000).length === 3);
t('합치면 원문(개행 정리 제외)과 같다', parts.join('\n\n') === para);

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ telegram-text-route tests FAILED'); process.exit(1); }
console.log('✅ telegram-text-route tests passed');
