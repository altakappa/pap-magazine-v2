'use strict';
/**
 * 하위 계정 독립 게시물도 웹사이트 기사로 (2026-10-15, 도메니코).
 * "거의 대부분 pap_magazine 에서 공동작업자를 걸어서 올라가지만 각 서브계정에서 독립적으로
 *  포스팅하는 경우도 간혹 있으므로 이 경우에는 서브계정의 기사들이 웹사이트로 올라가야 해."
 * 종전: 하위 계정 크론은 fashion 백필 하나뿐이었고 08-02 완주 뒤 '할 일 없음' 만 찍었다
 * (10/15 cron_runs 실측). 즉 하위 계정의 새 게시물은 아무도 안 읽고 있었다.
 * 이제: papfashion_·papbeauty_·pap_trends·pap_object 를 2시간마다 최근 25개 모드로 읽는다
 * (backfill 없음 → 최근-동기화 경로, source_instagram_post_id 로 중복 방지).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, ok, x) { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + String(x).slice(0, 300) : '')); } }
const vj = JSON.parse(R('vercel.json'));
const crons = vj.crons || [];
for (const k of ['fashion', 'beauty', 'trends', 'object']) {
  const c = crons.find((x) => x.path === '/api/cron/sync-instagram?account=' + k);
  t('@pap_' + k + ' 최근-동기화 크론(백필 아님) 2시간마다', !!c && /^\d+ \*\/2 \* \* \*$/.test(c.schedule));
}
const minutes = crons.filter((x) => /sync-instagram\?account=(fashion|beauty|trends|object)$/.test(x.path)).map((x) => x.schedule.split(' ')[0]);
t('4개 크론의 분이 서로 다르고 10분 크론 분(0·5)과 안 겹친다', new Set(minutes).size === 4 && minutes.every((m) => !/[05]$/.test(m)));
const src = R('api/cron/sync-instagram.js');
t('최근-동기화 경로가 계정 자격증명(cred)을 쓴다', /listRecentMedia\(\{ limit: 25, \.\.\.\(cred \|\| \{\}\) \}\)/.test(src));
t('중복 방지는 source_instagram_post_id (공동작업자 게시물이 양쪽에 보여도 한 번만)', /\.in\('source_instagram_post_id', allIds\)/.test(src));
t('ACCOUNT_KEYS 에 네 계정이 있다', /ACCOUNT_KEYS = \['celeb', 'beauty', 'fashion', 'trends', 'object'\]/.test(src));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
