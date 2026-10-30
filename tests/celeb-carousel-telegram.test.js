/**
 * 캐러셀 → 텔레그램 관리자 라우트 회귀 (2026-10-20)
 * 도메니코 "인스타그램 캐러셀용으로 만들어서 텔레그램으로 보내줘". 지킬 것:
 * 관리자 전용 · 게시 경로와 같은 자르기(slideCrop) · 커버 먼저 · 10장 상한(igPublish 와 동일) ·
 * 문서(document)로 전송(사진으로 보내면 1280px 재압축) · 제목을 주면 게시용 제목도 갱신 · 폰트 에셋 번들 포함.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const src = R('api/admin/celeb-carousel-telegram.js');
const SUPA = path.join(ROOT, 'api', '_lib', 'supabase.js');
require.cache[SUPA] = { id: SUPA, filename: SUPA, loaded: true, exports: { supabaseAdmin: { from: () => ({}) }, supabase: {} } };
const mod = require('../api/admin/celeb-carousel-telegram.js');
const vercel = JSON.parse(R('vercel.json'));
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

t('관리자 세션 필수 · POST 만', /requireAdmin\(req, res\)/.test(src) && /req\.method !== 'POST'/.test(src));
t('게시 경로와 같은 자르기(cropSlideToVariant)·같은 drop 규칙', /cropSlideToVariant\(/.test(src) && /if \(cropped\.drop\) continue;/.test(src));
t('커버가 1번, 첫 장이 사진이면 원본은 다시 넣지 않는다', /01-cover\.jpg/.test(src) && /items\[0\]\.type === 'image' \? items\.slice\(1\) : items/.test(src));
t('10장 상한 = igPublish 와 같다', mod.IG_CAROUSEL_MAX === 10 && /slice\(0, 10\)/.test(R('api/_lib/igPublish.js')));
t('문서로 보낸다 (바이트 보존)', /sendDocumentsToTelegram\(files, caption, outChat\)/.test(src));
// 2026-10-30 — 셀럽속보 방이 먼저, 설정이 없으면 브리프 받은 방 (도메니코 "기사 관련된 내용은 전부 pap 셀럽속보 방으로")
t('셀럽속보 방, 없으면 브리프를 받은 방(row.chat_id)', /celebOr\(row\.chat_id\)/.test(src));
t('제목을 주면 게시용 제목(publish.titleKo/En)도 갱신', /publish: \{ \.\.\.pub, titleKo, titleEn \}/.test(src));
t('인스타 게시는 하지 않는다 (igPublish 를 require 하지 않는다)', !/require\(['"][^'"]*igPublish['"]\)/.test(src));
const fn = vercel.functions['api/admin/celeb-carousel-telegram.js'];
t('폰트·에셋 번들 + 시간 상한', !!fn && fn.includeFiles === 'api/_assets/celeb/**' && fn.maxDuration >= 120);

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ celeb-carousel-telegram tests FAILED'); process.exit(1); }
console.log('✅ celeb-carousel-telegram tests passed');
