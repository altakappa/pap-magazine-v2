/**
 * IG 일별 장부 — 61% 사각지대의 유일한 계기 (2026-08-22)
 * ═══════════════════════════════════════════════════════════════════
 * 배경 실측:
 *   · 릴스는 인스타가 per-media 전환지표를 안 준다 (1,078건 캡처 → 0건. 확정)
 *   · 30일 팔로워 +5,468 중 게시물 귀속 2,124(38.8%) — 잔차 61.2%
 * 게시물 단위가 막혔으니 하루 단위 잔차가 릴스·스토리·프로필 기여를 보는
 * 유일한 계기다. 이 테스트는 그 계기(computeLedger)를 **실제로 실행**한다.
 *
 * 지키는 것:
 *   1. 귀속·잔차 산수가 맞는다
 *   2. KST 경계 — 도메니코의 하루는 KST 다 (UTC 15:00 = KST 다음날 00:00)
 *   3. 스냅샷 없는 날은 장부에서 빠진다 (delta 를 모르면 잔차도 모른다)
 *   4. 소표본(n<8)이면 상관을 내지 않는다 — 잡음으로 판정하지 않는다
 *   5. 형식별 귀속(캐러셀 비중 리포트)이 계산된다 — 2번 과제
 *   6. 렌더에 정직한 한계(잔차의 뜻·게시일 귀속의 어긋남)가 실린다
 *   7. 주간 브리핑에 배선됐고, 실패해도 브리핑을 막지 않는다
 */

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(n, c, d) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); if (d) console.log('      ', d); } }

/* supabase 를 로드하지 않고 순수 함수만 뽑는다 (스텁 주입 — 다른 테스트와 같은 방식) */
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === './supabase') return { supabaseAdmin: {} };
  return origRequire.apply(this, arguments);
};
const { computeLedger, renderIgLedgerMd, pearson, kstDay } = require(path.join(ROOT, 'api/_lib/igLedger.js'));
Module.prototype.require = origRequire;

console.log('\n=== 1. 귀속·잔차 산수 ===');
{
  const followers = [
    { day: '2026-08-01', followers: 1000 },
    { day: '2026-08-02', followers: 1150 },   // +150
    { day: '2026-08-03', followers: 1250 },   // +100
  ];
  const posts = [
    // 8/2(KST) 캐러셀 2편: follows 40+30, 릴스 1편: follows null
    { post_id: 'c1', media_type: 'CAROUSEL_ALBUM', posted_at: '2026-08-02T03:00:00Z', follows: 40 },
    { post_id: 'c2', media_type: 'CAROUSEL_ALBUM', posted_at: '2026-08-02T06:00:00Z', follows: 30 },
    { post_id: 'v1', media_type: 'VIDEO', posted_at: '2026-08-02T08:00:00Z', follows: null },
    // 8/3(KST) 이미지 1편: follows 5
    { post_id: 'i1', media_type: 'IMAGE', posted_at: '2026-08-03T01:00:00Z', follows: 5 },
  ];
  const { days, summary } = computeLedger(followers, posts);
  t('일 수 = 스냅샷 delta 를 아는 날만 (2일)', days.length === 2, String(days.length));
  const d2 = days.find((r) => r.day === '2026-08-02');
  t('8/2 증가 150', d2 && d2.delta === 150);
  t('8/2 귀속 70 (캐러셀 40+30, 릴스 null 은 0)', d2 && d2.attributed === 70, d2 && String(d2.attributed));
  t('8/2 잔차 80', d2 && d2.residual === 80);
  t('8/2 형식 집계: 캐러셀2 릴스1', d2 && d2.carousels === 2 && d2.videos === 1);
  t('요약 합계가 맞는다 (증가 250 · 귀속 75 · 잔차 175)',
    summary.totalDelta === 250 && summary.totalAttributed === 75 && summary.totalResidual === 175);
  t('설명률 30%', summary.explainedPct === 30, String(summary.explainedPct));
}

console.log('\n=== 2. KST 경계 ===');
{
  t('UTC 15:00 = KST 다음날', kstDay('2026-08-02T15:00:00Z') === '2026-08-03');
  t('UTC 14:59 = KST 같은 날', kstDay('2026-08-02T14:59:00Z') === '2026-08-02');
  const followers = [
    { day: '2026-08-02', followers: 100 }, { day: '2026-08-03', followers: 200 },
  ];
  const posts = [{ post_id: 'p', media_type: 'CAROUSEL_ALBUM', posted_at: '2026-08-02T15:30:00Z', follows: 7 }];
  const { days } = computeLedger(followers, posts);
  const d3 = days.find((r) => r.day === '2026-08-03');
  t('UTC 15:30 게시물이 KST 8/3 에 귀속된다', d3 && d3.attributed === 7, JSON.stringify(days));
}

console.log('\n=== 3. 모르는 날은 모른다고 한다 ===');
{
  const followers = [{ day: '2026-08-01', followers: 100 }, { day: '2026-08-02', followers: 150 }];
  const posts = [{ post_id: 'x', media_type: 'CAROUSEL_ALBUM', posted_at: '2026-08-09T03:00:00Z', follows: 99 }];
  const { days, summary } = computeLedger(followers, posts);
  t('스냅샷 없는 날의 게시물은 장부에 안 들어간다', summary.totalAttributed === 0, JSON.stringify(days));
  t('증가가 0 이면 설명률은 null (0 나눗셈 없음)',
    computeLedger([{ day: 'a', followers: 5 }, { day: 'b', followers: 5 }], []).summary.explainedPct === null);
}

console.log('\n=== 4. 소표본이면 상관을 내지 않는다 ===');
{
  t('n=7 → null', pearson([1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7]) === null);
  t('n=8 완전 상관 → 1', pearson([1, 2, 3, 4, 5, 6, 7, 8], [2, 4, 6, 8, 10, 12, 14, 16]) === 1);
  t('상수열(분산 0) → null', pearson([1, 1, 1, 1, 1, 1, 1, 1], [1, 2, 3, 4, 5, 6, 7, 8]) === null);
  /* 릴스를 올린 날 잔차가 크게 만든 합성 데이터 → 양의 상관이 나와야 한다 */
  const followers = []; const posts = [];
  let f = 1000;
  for (let i = 1; i <= 14; i++) {
    const day = '2026-08-' + String(i).padStart(2, '0');
    const video = i % 2 === 0;             // 짝수날만 릴스
    f += video ? 100 : 20;                 // 릴스 날 잔차 100, 아닌 날 20
    followers.push({ day, followers: f });
    if (video) posts.push({ post_id: 'v' + i, media_type: 'VIDEO', posted_at: day + 'T03:00:00Z', follows: null });
  }
  const { summary } = computeLedger(followers, posts);
  t('릴스 날 잔차가 큰 데이터 → corr > 0.9', summary.corrVideosResidual > 0.9, String(summary.corrVideosResidual));
  t('보조 지표: 릴스 날 잔차 평균 100 vs 안 올린 날 20',
    summary.residualOnVideoDays === 100 && summary.residualOnNoVideoDays === 20,
    summary.residualOnVideoDays + ' / ' + summary.residualOnNoVideoDays);
}

console.log('\n=== 5. 형식별 귀속 (캐러셀 비중 리포트) ===');
{
  const followers = [{ day: '2026-08-01', followers: 0 }, { day: '2026-08-02', followers: 100 }];
  const posts = [
    { post_id: 'c1', media_type: 'CAROUSEL_ALBUM', posted_at: '2026-08-02T01:00:00Z', follows: 16 },
    { post_id: 'c2', media_type: 'CAROUSEL_ALBUM', posted_at: '2026-08-02T02:00:00Z', follows: 8 },
    { post_id: 'i1', media_type: 'IMAGE', posted_at: '2026-08-02T03:00:00Z', follows: 1 },
  ];
  const { summary } = computeLedger(followers, posts);
  const f = summary.followsByFormat;
  t('캐러셀 24 · 이미지 1', f.carousels === 24 && f.images === 1, JSON.stringify(f));
  t('편당 평균 (캐러셀 12 · 이미지 1)', f.perCarousel === 12 && f.perImage === 1, JSON.stringify(f));
}

console.log('\n=== 6. 렌더가 정직하다 ===');
{
  const followers = Array.from({ length: 10 }, (_, i) => ({ day: '2026-08-' + String(i + 1).padStart(2, '0'), followers: 1000 + i * 50 }));
  const md = renderIgLedgerMd(computeLedger(followers, [
    { post_id: 'c', media_type: 'CAROUSEL_ALBUM', posted_at: '2026-08-03T01:00:00Z', follows: 10 },
  ]));
  t('표 헤더가 있다', /날짜\(KST\).*증가.*귀속.*잔차/.test(md));
  t('형식별 귀속 줄이 있다 (2번 과제)', /형식별 귀속 팔로우/.test(md));
  t('릴스는 측정불가라고 명시한다', /릴스 측정불가/.test(md));
  t('한계 고지: 게시일 귀속의 어긋남', /게시일 기준이라 하루 단위는 어긋난다/.test(md));
  t('한계 고지: 상관은 인과가 아니다', /인과가 아니다/.test(md));
  t('빈 장부는 빈 문자열 (브리핑을 더럽히지 않는다)', renderIgLedgerMd({ days: [], summary: {} }) === '');
}

console.log('\n=== 7. 주간 브리핑 배선 ===');
{
  const wb = fs.readFileSync(path.join(ROOT, 'api/cron/weekly-briefing.js'), 'utf8');
  t('igLedger 를 불러온다', /require\('\.\.\/_lib\/igLedger'\)/.test(wb));
  t('best-effort 다 — try/catch 로 감싼다', /try \{ igLedger = await buildIgLedger\(28\); \}/.test(wb));
  t('AI 입력에 요약을 넘긴다', /IG 일별 장부 요약/.test(wb));
  t('브리핑 뒤에 결정론으로 붙인다 (AI 죽어도 나간다)', /renderIgLedgerMd\(igLedger\)/.test(wb));
  t('대시보드 시계열 지표 3종을 저장한다',
    /ig_follower_delta_28d/.test(wb) && /ig_attributed_28d/.test(wb) && /ig_residual_28d/.test(wb));
}

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ ig-daily-ledger tests FAILED'); process.exit(1); }
console.log('✅ ig-daily-ledger tests passed');
