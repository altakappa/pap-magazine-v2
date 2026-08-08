/**
 * 알고리즘 조기경보 코치 — tests/algo-coach.test.js (2026-08-09 신설)
 *
 * 근거: 캐러셀 첫 3시간 좋아요 ↔ 최종 도달 corr 0.94 (148개 실측).
 * 3시간이면 뜰 게시물을 안다 → 그 순간 사람 액션(스토리 리샤어·공동게시)을
 * 텔레그램으로 지시. 여기서 지키는 것:
 *   ① 게시물당 판정 1회 (claim-first)  ② hot 만 푸시 (cold 는 조용히 기록)
 *   ③ 표본 부족 시 판정 보류  ④ Bearer CRON_SECRET (x-vercel-cron 금지)
 *   ⑤ 모든 종료점 note (돌았다 ≠ 했다)
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('cronGuard.js', { withCronGuard: (_n, fn) => fn });
stub('auth.js', { requireAdmin: async () => ({ id: 't' }) });
stub('telegram.js', { sendTextToTelegramPersonalSafe: async () => ({ ok: true }) });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const mod = require(path.join(ROOT, 'api', 'cron', 'algo-coach.js'));
const src = R('api/cron/algo-coach.js');
const vj = R('vercel.json');
const mig = R('supabase_migrations/114_algo_coach.sql');

console.log('\n[1] 3시간령 스냅샷 선택');
{
  const rows = [
    { post_id: 'a', age_hours: 2.1, like_count: 10 },
    { post_id: 'a', age_hours: 3.05, like_count: 50 },
    { post_id: 'a', age_hours: 3.9, like_count: 90 },
    { post_id: 'b', age_hours: 2.5, like_count: 7 },
  ];
  const picked = mod.pickClosest3h(rows);
  const a = picked.find((r) => r.post_id === 'a');
  t('게시물당 하나만 남는다', picked.length === 2);
  t('3시간에 가장 가까운 스냅샷 (3.05h → 50)', a && a.like_count === 50, a && a.like_count);
  t('null·빈 입력에 안 죽는다', mod.pickClosest3h(null).length === 0);
}

console.log('\n[2] 분위값');
{
  const arr = Array.from({ length: 101 }, (_, i) => i); // 0..100
  t('P50 = 50', mod.percentileOf(arr, 0.5) === 50);
  t('P75 = 75', mod.percentileOf(arr, 0.75) === 75);
  t('빈 배열은 null', mod.percentileOf([], 0.5) === null);
}

console.log('\n[3] 계약 — 소스 검사');
{
  t('Bearer CRON_SECRET (x-vercel-cron 헤더 읽기 금지)',
    /auth === 'Bearer ' \+ process\.env\.CRON_SECRET/.test(src) && !/headers\[['"]x-vercel-cron/.test(src));
  t('cronGuard 로 감싼다', /withCronGuard\('algo-coach', handler\)/.test(src));
  t('claim-first — INSERT 후 23505 판단', src.indexOf('.insert({ post_id') < src.indexOf("claimErr.code === '23505'"));
  t('hot 만 텔레그램 (cold 는 조용히)', /verdict === 'hot'/.test(src)
    && /sendTextToTelegramPersonalSafe/.test(src)
    && !/cold[\s\S]{0,200}sendTextToTelegram/.test(src));
  t('표본 20 미만이면 판정 보류', /hist\.length < 20/.test(src));
  t('알림 실패는 판정 기록을 못 막는다', /알림 실패는 삼킨다/.test(src));
  t('모든 종료점에 note', (src.match(/note\(/g) || []).length >= 5);
  t('액션 3종이 구체적이다 (스토리·공동게시·답글)', /스토리로 리샤어/.test(src) && /공동 게시/.test(src) && /답글/.test(src));
}

console.log('\n[4] 배선');
{
  t('vercel.json 에 매시 :10 스케줄', /"path": "\/api\/cron\/algo-coach",\s*\n\s*"schedule": "10 \* \* \* \*"/.test(vj));
  t('마이그레이션 PK + verdict 체크 (부분 인덱스 없음)', /post_id text primary key/.test(mig)
    && /check \(verdict in \('hot','mid','cold'\)\)/.test(mig) && !/unique index[\s\S]{0,80}where/i.test(mig));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ algo-coach tests FAILED'); process.exit(1); }
console.log('✅ algo-coach tests passed');
process.exit(0);
