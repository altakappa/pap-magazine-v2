// PAP Magazine — youtube-organize: 영영 안 되는 행·할당량 소진 (2026-10-20 화요일 견고화)
// 실측: 10/14~10/20 매 회차 '실패 17건' (videoNotFound 13 · quotaExceeded 4) — 실패는 budget 을 안 깎아 전부 재시도됐다.
'use strict';
const fs = require('fs');
const path = require('path');
const { isDeadVideoRow, isQuotaError, DEAD_VIDEO_GRACE_MS } = require('../api/_lib/ytPlaylist');
let passed = 0, failed = 0;
function ok(l, c) { if (c) { console.log('  ✓ ' + l); passed++; } else { console.log('  ✗ ' + l); failed++; } }
const NOW = Date.parse('2026-10-20T01:00:00Z');
const nf = 'playlistItems.insert 실패 404 (videoNotFound): {';

console.log('\n[1] 지워진 영상 판정 (경계값 포함)');
ok('3주 전 + videoNotFound → 죽은 행', isDeadVideoRow({ organize_error: nf, created_at: '2026-09-24T15:59:47Z' }, NOW));
ok('방금 올린 영상의 videoNotFound 는 기다려 준다', !isDeadVideoRow({ organize_error: nf, created_at: new Date(NOW - 3600e3).toISOString() }, NOW));
ok('정확히 24시간은 아직 기다림(경계)', !isDeadVideoRow({ organize_error: nf, created_at: new Date(NOW - DEAD_VIDEO_GRACE_MS).toISOString() }, NOW));
ok('24시간 + 1초는 죽은 행', isDeadVideoRow({ organize_error: nf, created_at: new Date(NOW - DEAD_VIDEO_GRACE_MS - 1000).toISOString() }, NOW));
ok('quotaExceeded 로 실패한 행은 죽은 행이 아니다(내일 되살아남)', !isDeadVideoRow({ organize_error: 'playlistItems.insert 실패 403 (quotaExceeded)', created_at: '2026-09-23T00:00:00Z' }, NOW));
ok('오류 기록 없는 행은 대상', !isDeadVideoRow({ organize_error: null, created_at: '2026-09-23T00:00:00Z' }, NOW));
ok('created_at 이상하면 건드리지 않는다', !isDeadVideoRow({ organize_error: nf, created_at: 'x' }, NOW));
ok('null 안전', !isDeadVideoRow(null, NOW));

console.log('\n[2] 할당량 판정');
ok('403 + quotaExceeded', isQuotaError({ status: 403, reason: 'quotaExceeded' }));
ok('403 + insufficientPermissions 는 할당량 아님', !isQuotaError({ status: 403, reason: 'insufficientPermissions' }));
ok('404 는 할당량 아님', !isQuotaError({ status: 404, reason: 'videoNotFound' }));
ok('null 안전', !isQuotaError(null));

console.log('\n[3] 핸들러 연결 (소스)');
const src = fs.readFileSync(path.join(__dirname, '../api/cron/youtube-organize.js'), 'utf8');
ok('죽은 행을 건너뛴다', /isDeadVideoRow\(row\)\) \{ dead\.push/.test(src));
ok('할당량 소진이면 두 루프 모두 멈춘다', (src.match(/isQuotaError\(err\)\) \{ quotaHit = true; break; \}/g) || []).length === 2 && /budget <= 0 \|\| quotaHit/.test(src));
ok('건너뜀·중단이 note 에 남는다', /영상 삭제됨 건너뜀/.test(src) && /할당량 소진/.test(src));
ok('첫 단계 조회가 할당량 때문에 실패하면 실패가 아니라 대기로 기록', /isQuotaError\(err\)\) \{\s*note\(res, '⏸ 할당량 소진 대기/.test(src) && /quotaWait: true/.test(src));
ok('삭제·재생목록 생성은 없다', !/\.delete\(/.test(src) && !/createPlaylist/.test(src));

console.log('\n[4] 판정에 필요한 열을 실제로 조회한다 (10/27 정정: 열 누락으로 [1]이 통과해도 운영에선 헛돌았다)');
const colsMatch = src.match(/const cols = '([^']+)'/);
const colList = colsMatch ? colsMatch[1].split(',').map((c) => c.trim()) : [];
ok('cols 에 organize_error 포함', colList.includes('organize_error'));
ok('cols 에 created_at 포함', colList.includes('created_at'));
ok('todo·resync 조회가 같은 cols 를 쓴다', (src.match(/\.select\(cols\)/g) || []).length === 2);
const fnSrc = require('../api/_lib/ytPlaylist').isDeadVideoRow.toString();
const needed = ['organize_error', 'created_at'].filter((k) => fnSrc.includes('row.' + k));
ok('isDeadVideoRow 가 읽는 모든 열이 cols 에 있다', needed.length === 2 && needed.every((k) => colList.includes(k)));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
