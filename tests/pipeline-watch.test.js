// PAP Magazine — 파이프라인 감시 진단 테스트
//
// 지키는 회귀 (2026-07-21):
//   2026-07-15~19 에 IG_QUALITY_GATE 가 켜진 채 인스타 기사가 5일간 draft 로
//   쌓였는데 아무 알림이 없었다. 그 사이 네이버·스레드·틱톡·유튜브가 함께
//   굶었다. 이 감시가 그때 있었다면 3시간 안에 잡혔어야 한다.
//
//   - draft 정체를 잡을 것 (그때의 실제 실패 모드)
//   - 미수집(sync 죽음)을 잡을 것
//   - 방금 올린 게시물은 정상 대기로 볼 것 (오탐 방지 — 오탐은 알림을 무시하게 만든다)
//   - 정상일 때 healthy 로 판정할 것
//
// Run with `node tests/pipeline-watch.test.js` (wired into `npm test`).

'use strict';

const path = require('path');
const Module = require('module');

// DB·인증·알림·IG 를 전부 스텁으로 — 순수 진단 로직만 검증한다.
function stub(rel, exports) {
  const p = path.join(__dirname, '..', 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('auth.js', { requireAdmin: async () => ({ id: 'test' }) });
stub('pushAlert.js', { pushAlert: async () => ({ ok: true }) });
stub('instagramImport.js', { listRecentMedia: async () => [] });
stub('cronGuard.js', { withCronGuard: (_name, fn) => fn });

const { diagnose, buildAlert } = require('../api/cron/pipeline-watch');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

const NOW = Date.parse('2026-07-21T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const opts = { now: NOW, graceHours: 3 };

/* ---------------------------------------------------------------- */
section('draft 정체 — 2026-07-15 사고의 실제 실패 모드');

const d1 = diagnose(
  [
    { id: 'a', timestamp: hoursAgo(10), permalink: 'https://ig/a' },
    { id: 'b', timestamp: hoursAgo(6) },
  ],
  [
    { source_instagram_post_id: 'a', status: 'draft' },
    { source_instagram_post_id: 'b', status: 'draft' },
  ],
  opts
);
ok('draft 2건을 정체로 잡는다', d1.stuck.length === 2);
ok('미수집은 0건', d1.missing.length === 0);
ok('healthy 가 아니다', d1.healthy === false);
ok('경과시간을 함께 보고한다', d1.stuck[0].age_hours === 10);
ok('알림 문구에 게이트 원인 후보가 들어간다',
  buildAlert(d1).lines.join(' ').includes('IG_QUALITY_GATE'));

/* ---------------------------------------------------------------- */
section('미수집 — sync-instagram 이 죽은 경우');

const d2 = diagnose(
  [{ id: 'x', timestamp: hoursAgo(8) }, { id: 'y', timestamp: hoursAgo(5) }],
  [], // DB 에 아무것도 없다
  opts
);
ok('미수집 2건을 잡는다', d2.missing.length === 2);
ok('draft 정체는 0건', d2.stuck.length === 0);
ok('알림 문구에 sync 원인 후보가 들어간다',
  buildAlert(d2).lines.join(' ').includes('sync-instagram'));

/* ---------------------------------------------------------------- */
section('오탐 방지 — 방금 올린 게시물은 정상 대기');

const d3 = diagnose(
  [
    { id: 'fresh1', timestamp: hoursAgo(0.5) },
    { id: 'fresh2', timestamp: hoursAgo(2.9) },
  ],
  [], // 아직 수집 전 — 정상이다
  opts
);
ok('유예 시간 안의 게시물은 점검 대상에서 빠진다', d3.checked === 0);
ok('그래서 healthy', d3.healthy === true);
ok('경계값(3시간 직전)도 유예로 본다', d3.missing.length === 0);

/* ---------------------------------------------------------------- */
section('정상 상태');

const d4 = diagnose(
  [{ id: 'p', timestamp: hoursAgo(9) }, { id: 'q', timestamp: hoursAgo(20) }],
  [
    { source_instagram_post_id: 'p', status: 'published' },
    { source_instagram_post_id: 'q', status: 'published' },
  ],
  opts
);
ok('전부 published 면 healthy', d4.healthy === true);
ok('점검 건수는 2건', d4.checked === 2);

/* ---------------------------------------------------------------- */
section('방어');

ok('빈 입력도 healthy (에러 없이)', diagnose([], [], opts).healthy === true);
ok('null 입력도 죽지 않는다', diagnose(null, null, opts).checked === 0);
ok('timestamp 없는 항목은 건너뛴다',
  diagnose([{ id: 'z' }], [], opts).checked === 0);
ok('id 없는 항목은 건너뛴다',
  diagnose([{ timestamp: hoursAgo(9) }], [], opts).checked === 0);

/* ---------------------------------------------------------------- */
console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.error('❌ pipeline-watch tests failed'); process.exit(1); }
console.log('✅ pipeline-watch tests passed');
