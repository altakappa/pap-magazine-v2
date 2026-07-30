/**
 * 비전 이미지 전달 방식 회귀 (2026-07-30 근본원인 수정).
 *
 * 배경: GEO 파이프라인(에디토리얼 서술문 생성)의 성공률이 시간당 24시도 중
 * 2~6건, 즉 ~20% 였다. 크레딧 충전 후에도 그대로여서 원인을 파봤더니
 * 이미지 전달 방식이었다.
 *
 *   Claude 의 `source:{type:'url'}` 은 "바로 이미지 바이트를 주는 URL" 만 받는다.
 *   그런데 발행분 상당수의 cover_image 는 `drive.google.com/thumbnail?id=…` —
 *   googleusercontent 로 리다이렉트되는 링크라 Claude 쪽에서 가져오지 못하고
 *   호출 전체가 죽는다.
 *
 *   실측(최근 12시간): 실패 293건 중 269건(92%)이 드라이브 URL.
 *                      성공 21건은 전부 S3·wixstatic 직링크.
 *   이미지 자체는 공개다 — 브라우저에서 1600×2071 로 정상 로드된다.
 *   문제는 "누가 가져오는가" 였다.
 *
 * 수정: 서버(Vercel)가 직접 받아 base64 로 인라인 전달. 서버는 CORS·리다이렉트
 * 제약이 없으므로 드라이브 링크도 통과한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
function t(n, cond, d) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('     ', d); } }

const src = R('api/_lib/editorialAi.js');
/* 주석에는 "왜 URL 방식을 버렸는지" 설명이 남아 있어야 한다(다음 사람이 되돌리지
   않도록). 그래서 코드 영역만 떼어내 검사한다 — 주석까지 훑으면 오탐이 난다. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('\n=== 전달 방식 ===');
t('URL 전달을 쓰지 않는다', !/type:\s*'url'/.test(code),
  "source:{type:'url'} 은 리다이렉트 링크(드라이브)를 못 가져와 호출 전체가 죽는다");
t('base64 인라인으로 전달', /type:\s*'base64'/.test(src) && /media_type/.test(src));
t('서버가 직접 fetch (리다이렉트 추적)', /redirect:\s*'follow'/.test(src));

console.log('=== 안전장치 ===');
t('지원 포맷 화이트리스트', /_VISION_TYPES/.test(src) && /image\/webp/.test(src));
t('image\\/jpg 비표준 별칭 정규화', /'image\/jpg'/.test(src));
t('용량 상한', /_MAX_IMAGE_BYTES/.test(src));
t('타임아웃(AbortController)', /AbortController/.test(src) && /abort\(\)/.test(src));
t('개별 실패는 건너뛴다', /blocks\.filter\(Boolean\)/.test(src));
t('드라이브 썸네일 폭 축소로 payload 절감', /sz=w1024/.test(src));

console.log('=== 동작 실측 (가짜 fetch) ===');
(async function () {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG 시그니처 조각
  const calls = [];
  let captured = null;

  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    // Claude API 호출 가로채기
    if (u.includes('api.anthropic.com')) {
      captured = JSON.parse(opts.body);
      return { ok: true, json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ kr: '한'.repeat(320), en: 'e'.repeat(360), it: 'i'.repeat(300), hook: '훅', moodTag: '무드' }) }],
      }) };
    }
    calls.push(u);
    if (u.includes('drive.google.com')) {
      return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => PNG };
    }
    if (u.includes('broken')) return { ok: false, headers: { get: () => 'text/html' }, arrayBuffer: async () => Buffer.alloc(0) };
    if (u.includes('nothtml')) return { ok: true, headers: { get: () => 'text/html; charset=utf-8' }, arrayBuffer: async () => Buffer.alloc(10) };
    return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => PNG };
  };
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';

  delete require.cache[require.resolve('../api/_lib/editorialAi.js')];
  const { generateEditorialDescriptions } = require('../api/_lib/editorialAi.js');

  const out = await generateEditorialDescriptions({
    title: 'Liminal Tides',
    artistStatement: '',
    imageUrls: [
      'https://drive.google.com/thumbnail?id=ABC&sz=w1600',
      'https://pap-korea-bucket.s3.ap-northeast-2.amazonaws.com/x.jpg',
      'https://example.com/broken.jpg',
    ],
    longForm: true,
    credits: { brands: [{ name: 'ZARA' }], tags: ['fashion'] },
  });

  t('드라이브 URL 도 폭 축소해 요청', calls.some(u => u.includes('drive.google.com') && u.includes('sz=w1024')));
  const imgs = (captured.messages[0].content || []).filter(b => b.type === 'image');
  t('가져온 2장만 전달 (깨진 1장 제외)', imgs.length === 2, '실제=' + imgs.length);
  t('전부 base64 소스', imgs.every(b => b.source.type === 'base64' && b.source.data.length > 0));
  t('media_type 이 실제 응답 타입', imgs.map(b => b.source.media_type).sort().join(',') === 'image/jpeg,image/png');
  t('서술문 3개 언어 생성', out.kr.length >= 300 && out.en.length >= 350 && out.it.length > 0);

  // 이미지를 하나도 못 받으면 API 호출 자체를 하지 않는다 (시도 횟수만 소진하는 낭비 방지)
  captured = null;
  const out2 = await generateEditorialDescriptions({
    title: 'No Images', artistStatement: '',
    imageUrls: ['https://example.com/nothtml.jpg'], longForm: true,
  });
  t('전부 실패하면 API 호출 안 함', captured === null);
  t('그 경우 빈 결과 반환', out2.kr === '' && out2.en === '');

  global.fetch = origFetch;
  console.log(`\npassed: ${pass}   failed: ${fail}`);
  if (fail) { console.log('❌ editorial-ai-vision-source tests FAILED'); process.exit(1); }
  console.log('✅ editorial-ai-vision-source tests passed');
})();
