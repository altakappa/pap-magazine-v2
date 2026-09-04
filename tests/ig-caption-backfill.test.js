/**
 * 인스타 캡션 소급 백필 (2026-08-17 신설)
 *
 * 왜 필요했나 — instagram_caption 은 2026-08-14(마이그레이션 124)부터만 채워진다.
 * 그 전 수집분 약 2,300편이 비어 있고, 그래서 두 가지가 막혀 있었다.
 *   ① 자체 취재 판별(🎥 PAP) — 네이버 초안 선정이 캡션을 본다
 *   ② 본문 보강 — 근거가 없으면 형용사로 채우게 된다.
 *      실측: 캡션 없이 워터밤 기사를 보강하니 521자 → 589자에 그쳤다(목표 800자).
 *
 * 지키는 것 — 이 크론은 무인으로 도는 쓰기 작업이라 범위가 좁아야 한다:
 *   ① instagram_caption 말고 아무것도 안 건드린다 (발행 판단과 무관해야 한다)
 *   ② 삭제된 게시물을 매 회차 다시 두드리지 않는다 (NULL 과 '' 를 구분)
 *   ③ 시간 예산이 있고, 다음 한 건의 최악을 미리 뺀다
 *   ④ 상위 노출 대상을 먼저 채운다
 *   ⑤ 크론 시크릿 없이는 안 돈다 / 끌 수 있다
 *   ⑥ 한 건 실패가 회차 전체를 죽이지 않는다
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('cronGuard.js', { withCronGuard: (_n, fn) => fn });
stub('instagramImport.js', { fetchCaptionById: async () => ({ id: 'x', caption: '' }) });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const P = path.join(ROOT, 'api', 'cron', 'backfill-ig-captions.js');
const mod = require(P);
const src = fs.readFileSync(P, 'utf8');
const impSrc = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'instagramImport.js'), 'utf8');

console.log('\n=== ① 범위가 좁다 ===');
{
  const updates = src.match(/\.update\(\{[^}]*\}\)/g) || [];
  t('update 는 한 종류뿐', updates.length === 1, updates);
  t('instagram_caption 만 쓴다', /\.update\(\{ instagram_caption: caption \}\)/.test(src), updates);
  t('content 를 건드리지 않는다', !/content:/.test(src));
  t('status 를 건드리지 않는다', !/status: '/.test(src));
  t('articles 외 테이블에 쓰지 않는다',
    !/from\('(?!articles|article_body_backfill)[a-z_]+'\)[\s\S]{0,80}\.update\(/.test(src));
}

console.log('\n=== ② 삭제된 게시물을 반복해서 두드리지 않는다 ===');
{
  t("없으면 '' 를 넣는다", /const caption = m && m\.caption \? m\.caption : '';/.test(src));
  t('NULL 인 것만 대상으로 고른다', (src.match(/\.is\('instagram_caption', null\)/g) || []).length >= 2);
  t('구분 이유가 주석에 남아 있다', /NULL\(아직 안 해봄\)과 ''\(해봤는데 없음\)/.test(src));
  // 404/400 은 조회 단계에서 null 로 떨어져야 한다
  t('조회가 404·400 을 null 로 돌려준다',
    /res\.status === 400 \|\| res\.status === 404[\s\S]{0,60}return null;/.test(impSrc));
}

console.log('\n=== ③ 시간 예산 ===');
{
  t('예산 상수가 있다', typeof mod._BUDGET_MS === 'number' && mod._BUDGET_MS > 0);
  t('예산이 Vercel 120s 상한보다 작다', mod._BUDGET_MS < 120000, mod._BUDGET_MS);
  t('다음 한 건의 최악을 미리 뺀다', /BUDGET_MS - PER_CALL_RESERVE_MS/.test(src));
  t('예약분이 조회 타임아웃(15s) 이상', mod._PER_CALL_RESERVE_MS >= 15000, mod._PER_CALL_RESERVE_MS);
  t('첫 건은 예산으로 건너뛰지 않는다', /if \(i > 0 && Date\.now\(\) - started/.test(src));
  t('이월 건수를 보고한다', /시간 예산으로 .* 이월/.test(src));
  t('회차 상한이 있다', mod._PER_RUN_MAX >= 1 && mod._PER_RUN_MAX <= 200, mod._PER_RUN_MAX);
}

console.log('\n=== ④ 상위 노출 먼저 ===');
{
  t('article_body_backfill 을 먼저 본다',
    src.indexOf("article_body_backfill") < src.indexOf("published_date"), '순서가 뒤집혔다');
  t('노출 순으로 정렬한다', /order\('impressions', \{ ascending: false \}\)/.test(src));
  t('중복을 거른다', /seen\.has\(r\.id\)/.test(src));
}

console.log('\n=== ⑤ 접근 통제 ===');
{
  t('CRON_SECRET 없이는 401', (/bearerOk\(auth, process\.env\.CRON_SECRET\)/.test(src) || /CRON_SECRET && auth === 'Bearer '/.test(src)) && /401/.test(src)); // 2026-09-04 timing-safe 형태 인정
  t('환경변수로 끌 수 있다', /IG_CAPTION_BACKFILL_ENABLED/.test(src));
  t('cronGuard 로 감싼다', /withCronGuard\('backfill-ig-captions'/.test(src));
  t('_lib 경로가 ../_lib (api/cron 규칙)', /require\('\.\.\/_lib\//.test(src));
}

console.log('\n=== ⑥ 한 건 실패가 회차를 죽이지 않는다 ===');
{
  t('건별 try/catch 가 있다', /try \{[\s\S]{0,400}\} catch \(e\) \{[\s\S]{0,120}failed\+\+/.test(src));
  t('실패 건수를 보고한다', /실패 ' \+ failed/.test(src));
  t('상세는 console.error 로만', /console\.error\('\[backfill-ig-captions\]'/.test(src));
}

console.log('\n=== ⑦ 배선 ===');
{
  t('가벼운 캡션 조회를 쓴다 (hydrateChildren 안 탐)', /fetchCaptionById/.test(src));
  t('fetchCaptionById 가 caption 만 요청한다', /fields=id,caption/.test(impSrc));
  t('fetchCaptionById 가 export 돼 있다', /^  fetchCaptionById,$/m.test(impSrc));

  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const cron = (vercel.crons || []).find((c) => c.path === '/api/cron/backfill-ig-captions');
  t('vercel.json 에 크론이 등록돼 있다', !!cron, (vercel.crons || []).map((c) => c.path).slice(0, 3));
  if (cron) t('시간당 1회로 돈다', /^\d+ \* \* \* \*$/.test(cron.schedule), cron.schedule);
}

console.log('\n' + (fail ? '✗' : '✓') + ' ig-caption-backfill: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
