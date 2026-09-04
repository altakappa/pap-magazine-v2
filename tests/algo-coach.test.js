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
    (/bearerOk\(auth, process\.env\.CRON_SECRET\)/.test(src) || /auth === 'Bearer ' \+ process\.env\.CRON_SECRET/.test(src)) && !/headers\[['"]x-vercel-cron/.test(src)); // 2026-09-04
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

/* 2026-08-18 — vercel.json 검사는 원문 정규식이 아니라 값으로 본다.
   Vercel 은 빌드 컨테이너의 vercel.json 을 압축해 둔다(콜론 뒤 공백 없음).
   서식에 기대던 검사가 배포 관문에서만 깨져 배포를 막았다.
   설정은 멀쩡했고 검사가 무른 것이었다. */
const vjP = (() => { try { return JSON.parse(vj); } catch (e) { return null; } })();
const schedOf = (p) => {
  const c = ((vjP && vjP.crons) || []).find((x) => x && x.path === p);
  return c ? String(c.schedule || '') : null;
};

console.log('\n[4] 배선');
{
  t('vercel.json 에 매시 :10 스케줄', schedOf('/api/cron/algo-coach') === '10 * * * *',
    String(schedOf('/api/cron/algo-coach')));
  t('마이그레이션 PK + verdict 체크 (부분 인덱스 없음)', /post_id text primary key/.test(mig)
    && /check \(verdict in \('hot','mid','cold'\)\)/.test(mig) && !/unique index[\s\S]{0,80}where/i.test(mig));
}

console.log('\n[5] 1시간령 조기 알림 (2026-08-12) — 개입할 시간이 남은 유일한 시점');
{
  const rows = [
    { post_id: 'a', age_hours: 0.7, like_count: 10 },
    { post_id: 'a', age_hours: 1.05, like_count: 40 },
    { post_id: 'a', age_hours: 3.0, like_count: 300 },
    { post_id: 'b', age_hours: 1.4, like_count: 9 },
  ];
  const picked = mod.pickClosestAge(rows, 1);
  const a = picked.find((r) => r.post_id === 'a');
  t('목표 나이 1시간에 가장 가까운 스냅샷 (1.05h → 40)', a && a.like_count === 40, a && a.like_count);
  t('3시간 picker 는 같은 입력에서 3.0h 를 고른다 (기존 계약 불변)',
    mod.pickClosest3h(rows).find((r) => r.post_id === 'a').like_count === 300);
  t('targetH 가 없거나 깨져도 3시간으로 폴백',
    mod.pickClosestAge(rows, undefined).find((r) => r.post_id === 'a').like_count === 300
    && mod.pickClosestAge(rows, 'x').find((r) => r.post_id === 'a').like_count === 300);
  t('null 입력에 안 죽는다', mod.pickClosestAge(null, 1).length === 0);

  t('선점 키가 3시간 판정과 섞이지 않는다', mod.earlyAlertKey('123') === 'algo_coach_1h:123');
  t('키가 post_id 를 문자열로 강제한다', mod.earlyAlertKey(123) === 'algo_coach_1h:123');

  t('선점 후 알림 — INSERT 를 먼저 하고 23505 로 판단',
    src.indexOf("from('ops_alert_state').insert(") < src.indexOf("claimEarlyErr.code === '23505'"));
  t('스키마를 늘리지 않는다 (algo_coach ALTER·새 컬럼 없음)',
    !/alter table/i.test(src) && !/likes_1h:.*column/i.test(src));
  t('임계 미달은 침묵 — 알림도 기록도 없다', /if \(likes < p75\) continue;/.test(src));
  t('1시간 표본 20 미만이면 보류', /hist\.length < 20[\s\S]{0,120}1시간 표본 부족/.test(src));
  t('조기 패스 실패가 3시간 판정을 막지 않는다',
    /try \{ early = await runEarlyPass\(\); \}[\s\S]{0,160}catch/.test(src));
  t('note 에 1시간 결과가 남는다 (돌았다 ≠ 했다)', /earlyNote/.test(src)
    && (src.match(/earlyNote/g) || []).length >= 4);
  t('알림 문구가 60분 안 액션을 지시한다',
    /앞으로 60분 안에/.test(src) && /스토리로 리샤어/.test(src));

  t('ig-snapshot 이 매시 :01 — 1시간령 관측이 있어야 판정이 산다',
    schedOf('/api/cron/ig-snapshot') === '1 * * * *', String(schedOf('/api/cron/ig-snapshot')));
  /* 순서가 뒤집히면 코치는 최대 59분 묵은 스냅샷으로 판정한다 — 조기 알림의 의미가 사라진다 */
  const minOf = (p) => {
    const sc = schedOf(p);
    const m = sc && /^(\d+)\s/.exec(sc);
    return m ? parseInt(m[1], 10) : null;
  };
  const snapMin = minOf('/api/cron/ig-snapshot');
  const coachMin = minOf('/api/cron/algo-coach');
  t('스냅샷이 코치보다 먼저 돈다 (:' + snapMin + ' < :' + coachMin + ')',
    snapMin !== null && coachMin !== null && snapMin < coachMin);
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ algo-coach tests FAILED'); process.exit(1); }
console.log('✅ algo-coach tests passed');
process.exit(0);
