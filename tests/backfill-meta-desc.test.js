/**
 * 메타 설명 AI 백필 크론 회귀 (2026-07-23, Ahrefs too short 격상).
 * 검증된 비전 생성기로 짧은 에디토리얼의 설명·seo_description 을 채운다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const c = R('api/cron/backfill-meta-desc.js');
const vj = JSON.parse(R('vercel.json'));

let pass = 0, fail = 0;
function t(n, cond, d){ if(cond){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

console.log('\n=== 메타 설명 백필 크론 ===');
t('크론 인증 규약(CRON_SECRET + admin 폴백)',
  /CRON_SECRET && auth === 'Bearer ' \+ process\.env\.CRON_SECRET/.test(c) && /requireAdmin/.test(c));
t('ANTHROPIC_API_KEY 없으면 무해 대기', /ANTHROPIC_API_KEY/.test(c) && /비전 백필 대기/.test(c));
t('선별 SQL 함수 short_desc_editorials 사용', /rpc\('short_desc_editorials'/.test(c));
t('검증된 비전 생성기 재사용', /generateEditorialDescriptions/.test(c) && /artistStatement: ''/.test(c));
t('기존 텍스트 보존 — 빈 칸만 채움',
  /!String\(row\.description \|\| ''\)\.trim\(\)/.test(c));
t('seo_description 155자 컷 저장', /seo_description = _clip\(seoBase, 155\)/.test(c) || /patch\.seo_description = _clip\(seoBase, 155\)/.test(c));
t('성공·실패 무관 attempted_at 스탬프(무한 재시도 방지)', /meta_desc_attempted_at: new Date/.test(c));
/* 2026-07-30 — 상수 값을 박아두던 검사를 '관계' 검사로 바꿨다.
   처리량을 올릴 때마다 테스트를 따라 고치는 건 테스트가 아니라 받아쓰기다.
   지켜야 하는 건 특정 숫자가 아니라 이것들이다:
     · 예산 + 건당 최악 소요 < maxDuration (안 그러면 Vercel 이 중간에 끊는다)
     · 배치가 동시성보다 충분히 크다 (워커가 놀면 상향 효과가 사라진다) */
(function () {
  const budget = Number((c.match(/TIME_BUDGET_MS = (\d+)/) || [])[1] || 0);
  const WORST_ITEM_MS = 28000;   // longForm 비전 호출 건당 실측
  const MAX_DURATION_MS = Number((vj.functions && vj.functions['api/**/*.js']
    && vj.functions['api/**/*.js'].maxDuration) || 120) * 1000;
  t('시간 예산이 maxDuration 안에서 끝난다',
    budget > 0 && budget + WORST_ITEM_MS <= MAX_DURATION_MS,
    `예산 ${budget}ms + 건당 최악 ${WORST_ITEM_MS}ms > ${MAX_DURATION_MS}ms — 강제 종료로 저장이 날아간다`);
  t('예산 가드를 매 건 확인', /Date\.now\(\) - started > TIME_BUDGET_MS/.test(c));
})();
t('vercel.json 10분 주기 등록', vj.crons.some(x => x.path === '/api/cron/backfill-meta-desc' && /\/10 \* \* \*/.test(x.schedule)));

t('완주 시 개인 텔레그램 통보(중복 방지)', /remaining === 0/.test(c) && /sendTextToTelegramPersonalSafe/.test(c));

/* ── 2026-07-28 GEO 감사: '가짜 완주' 재발 방지 ────────────────────────────
 * 선별 함수에 seo_description<110 이 AND 로 걸려 있어, meta 태그만 채워진 행이
 * 본문 description 은 빈 채로 대상에서 빠졌다. 크론은 '남은 것 없음'을 보고했지만
 * 실제로는 본문 텍스트 없는 발행 에디토리얼이 2,224/2,490건 남아 있었다.
 * AI 검색엔진은 meta 가 아니라 본문을 인용하므로 GEO 성과가 통째로 막혀 있었다.
 * (실측 Ahrefs 2026-07-28 — PAP 16건 vs W Korea 303 / Dazed 7,303)
 * 선별 조건은 DB 함수라 여기서 직접 못 보므로, 코드 쪽 계약을 고정한다. */
console.log('=== 본문 분량 확보 (GEO) ===');
const ai = R('api/_lib/editorialAi.js');
t('크론이 longForm 으로 본문 분량을 요청', /longForm: true/.test(c));
t('생성기가 longForm 시 300자+ 를 명시', /longForm/.test(ai) && /300\+ characters/.test(ai));
t('longForm 은 max_tokens 상향 (잘림 → JSON 파싱 실패 방지)',
  /maxTokens: longForm \? 4000 : 2400/.test(ai),
  '2026-08-03 — 호출이 _askClaudeJson 로 합쳐지며 인자명 maxTokens, 여유 3000/1800 → 4000/2400');
t('기본(짧은) 프롬프트는 그대로 — 기존 호출부 무변경',
  /: 'Write a short, evocative 3-4 sentence description for the editorial in THREE languages\.'/.test(ai)
  && /const _lengthRule = longForm/.test(ai));
t('근거 없는 고유명사 생성 금지를 프롬프트에 명시',
  /NEVER invent facts/.test(ai) && /no shoot location/.test(ai));
t('크레딧(브랜드·태그)을 프롬프트에 주입 — 실제 검색어가 본문에 들어가게',
  /credits: \{ brands:/.test(c) && /Brands featured \(use these exact names\)/.test(ai));
t('재시도는 3회로 제한 (무한 재시도 금지 유지)',
  /meta_desc_attempts: \(row\.meta_desc_attempts \|\| 0\) \+ 1/.test(c));

/* 2026-07-29 라이브 실측 후속 — longForm 전환으로 건당 ~28초가 되어 직렬 처리는
 * 90초 예산에 3건이 한계였다(실측). 1,851건이면 4일을 넘긴다. */
(function () {
  t('동시 워커풀로 처리 (직렬이면 실행당 3건이 한계였다)',
    /const CONCURRENCY = /.test(c) && /Promise\.all\(Array\.from\(/.test(c) && /_worker\(\)/.test(c));
  t('워커도 시간 예산을 존중 (강제종료 전 종료)',
    /Date\.now\(\) - started > TIME_BUDGET_MS/.test(c));

  /* 배치는 '동시성 × 실행당 라운드' 보다 커야 워커가 놀지 않는다.
     2026-07-30 상향(동시 3→6, 배치 12→24) 때 이 관계를 고정했다. */
  const conc = Number((c.match(/BACKFILL_CONCURRENCY \|\| (\d+)/) || [])[1] || 0);
  const batch = Number((c.match(/\|\| '(\d+)', 10\)/) || [])[1] || 0);
  t('배치가 동시성보다 충분히 크다 (워커 유휴 방지)', conc > 0 && batch >= conc * 2,
    `동시성 ${conc} · 배치 ${batch} — 배치가 작으면 워커를 늘려도 처리량이 안 는다`);
  t('동시성은 상한을 둔다 (레이트리밋 폭주 방지)', /Math\.min\(10,/.test(c));
  t('동시성을 배포 없이 되돌릴 수 있다 (429 대응)', /process\.env\.BACKFILL_CONCURRENCY/.test(c),
    '429 가 나면 env 로 즉시 낮출 수 있어야 한다 — 롤백 배포를 기다릴 수 없다');
})();

console.log(`\npassed: ${pass}   failed: ${fail}`);
if(fail){ console.log('❌ backfill-meta-desc tests FAILED'); process.exit(1); }
console.log('✅ backfill-meta-desc tests passed');
