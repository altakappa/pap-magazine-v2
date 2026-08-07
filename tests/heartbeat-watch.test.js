/**
 * 죽은사람 스위치 — 서버 밖 작업 침묵 감지 (2026-08-07 신설)
 *
 * 왜 필요했나 — 맥미니 영상 압축기는 우리 서버 밖에서 돈다. 맥이 꺼지거나
 * macOS 권한이 풀리거나 드라이브 동기화가 끊기면 cron_runs 에 아무 흔적이
 * 안 남는다. 대시보드는 평화롭고 유튜브만 조용히 마른다. 오늘 하루에만
 * 같은 모양의 침묵을 네 번 봤다(틱톡 21일·네이버 이틀·번역 열흘·FAQ).
 *
 * 앞의 감시들은 '우리가 남긴 기록'을 읽는다. 이건 반대다 —
 * 기록이 안 오는 것 자체를 신호로 읽는다.
 *
 * 여기서 지키는 것:
 *   ① 신호가 있으면 조용하다
 *   ② 허용 시간을 넘겨 끊기면 운다 (cause=silent)
 *   ③ 마지막 신호가 '실패'면 운다 (cause=failing)
 *   ④ 한 번도 신호가 없으면 **울지 않는다** — 미설치이지 고장이 아니다
 *   ⑤ 하룻밤 맥을 꺼도 울지 않는다 (창 30시간)
 *   ⑥ 압축기가 성공/실패 양쪽에서 신호를 보낸다
 *   ⑦ 수집 엔드포인트가 아는 이름만 받는다
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

function stub(rel, exports) {
  const p = path.join(ROOT, 'api', '_lib', rel);
  require.cache[p] = new Module(p);
  require.cache[p].exports = exports;
  require.cache[p].loaded = true;
}
stub('supabase.js', { supabaseAdmin: {} });
stub('auth.js', { requireAdmin: async () => ({ id: 'test' }) });
stub('pushAlert.js', { pushAlert: async () => ({ ok: true }) });
stub('instagramImport.js', {
  listRecentMedia: async () => [], isLikelyEditorialCaption: () => false, _extractShortcode: () => null,
});
stub('cronGuard.js', { withCronGuard: (_n, fn) => fn });
stub('backfillHealth.js', { diagnoseBackfill: () => ({}), buildBackfillAlert: () => ({}) });
stub('translateHealth.js', { judgeTranslateHealth: () => ({}), buildTranslateAlert: () => ({}) });
stub('faqHealth.js', { judgeFaqHealth: () => ({}), buildFaqAlert: () => ({}), summarizeFaqRuns: () => ({}) });
stub('cronDurationHealth.js', { summarizeDurations: () => ({}), judgeCronDuration: () => ({}), buildCronDurationAlert: () => ({}) });

let pass = 0, fail = 0;
function t(n, cond, d) {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n); if (d !== undefined) console.log('     ', d); }
}

const watch = require(path.join(ROOT, 'api', 'cron', 'pipeline-watch.js'));
const hb = require(path.join(ROOT, 'api', 'ops', 'heartbeat.js'));
const J = watch.judgeHeartbeats;

const NOW = 1786000000000;
const H = 3600000;
const one = (over) => [{ source: 'video-compress', label: '맥미니 영상 압축기', maxSilentH: 30, ok: true, note: '', failed: 0, ...over }];

console.log('\n[1] 정상');
t('방금 신호 → 정상', J(one({ lastAt: NOW - 5 * 60000 }), NOW).healthy === true);
t('29시간 전 신호 → 정상 (하룻밤 꺼도 안 운다)',
  J(one({ lastAt: NOW - 29 * H }), NOW).healthy === true);
t('정상일 때 문구에 마지막 신호 시각이 담긴다',
  /시간 전 신호 정상|방금 신호 정상/.test(J(one({ lastAt: NOW - 3 * H }), NOW).rows[0].reason),
  J(one({ lastAt: NOW - 3 * H }), NOW).rows[0].reason);

console.log('\n[2] 침묵 — 이게 본론');
const silent = J(one({ lastAt: NOW - 40 * H }), NOW);
t('40시간 침묵 → 고장', silent.healthy === false);
t('state=silent', silent.broken[0].state === 'silent');
t('몇 시간 끊겼는지 문구에 담긴다', /40시간째 신호 없음/.test(silent.broken[0].reason), silent.broken[0].reason);
t('경계값 30시간 직전은 정상', J(one({ lastAt: NOW - 29.9 * H }), NOW).healthy === true);
t('경계값 30시간 직후는 고장', J(one({ lastAt: NOW - 30.1 * H }), NOW).healthy === false);

console.log('\n[3] 미설치는 고장이 아니다 (오경보 방지의 핵심)');
const never = J(one({ lastAt: null }), NOW);
t('신호가 한 번도 없으면 울지 않는다', never.healthy === true, never);
t('대신 pending 에 남겨 눈으로 확인 가능', never.pending.includes('video-compress'), never.pending);

console.log('\n[4] 신호는 왔는데 내용이 실패');
t('ok=false → 고장', J(one({ lastAt: NOW - H, ok: false, note: 'ffmpeg 없음' }), NOW).broken[0].state === 'failing');
t('사유가 문구에 담긴다',
  /ffmpeg 없음/.test(J(one({ lastAt: NOW - H, ok: false, note: 'ffmpeg 없음' }), NOW).broken[0].reason));
t('failed>0 이면 ok=true 여도 고장',
  J(one({ lastAt: NOW - H, ok: true, failed: 2 }), NOW).broken[0].state === 'failing');
t('침묵이 실패보다 먼저 (더 근본 원인)',
  J(one({ lastAt: NOW - 40 * H, ok: false }), NOW).broken[0].state === 'silent');

console.log('\n[5] 알림 문구');
const a = watch.buildHeartbeatAlert(silent, 'https://x.test');
t('제목이 침묵을 말한다', /신호 끊김/.test(a.title), a.title);
t('맥미니 확인 항목이 들어간다', /맥미니가 켜져 있는지/.test(a.lines.join(' ')), a.lines);
const failAlert = watch.buildHeartbeatAlert(J(one({ lastAt: NOW - H, ok: false, note: 'x' }), NOW), 'https://x.test');
t('실패일 땐 로그 보는 법을 알려준다', /pap-video-compress\.log/.test(failAlert.lines.join(' ')), failAlert.lines);

console.log('\n[6] 수집 엔드포인트');
t('아는 이름만 받는다', hb.parseBeat({ source: 'video-compress' }) !== null);
t('모르는 이름은 거부', hb.parseBeat({ source: '아무거나' }) === null);
t('이름 없으면 거부', hb.parseBeat({}) === null);
t('대소문자 무시', hb.parseBeat({ source: 'Video-Compress' }) !== null);
t('ok 를 안 보내면 성공으로 본다 (셸 실수로 경보 울리면 안 됨)',
  hb.parseBeat({ source: 'video-compress' }).ok === true);
t("ok=0 은 실패", hb.parseBeat({ source: 'video-compress', ok: '0' }).ok === false);
t("ok=false 도 실패", hb.parseBeat({ source: 'video-compress', ok: 'false' }).ok === false);
t('note 는 300자로 자른다', hb.parseBeat({ source: 'video-compress', note: 'x'.repeat(999) }).note.length === 300);
t('숫자가 아닌 done 은 0', hb.parseBeat({ source: 'video-compress', done: '수십건' }).done === 0);
t('음수 done 은 0', hb.parseBeat({ source: 'video-compress', done: '-5' }).done === 0);
t('터무니없는 done 은 상한', hb.parseBeat({ source: 'video-compress', done: '99999999' }).done === 100000);

console.log('\n[7] 배선');
const wsrc = fs.readFileSync(path.join(ROOT, 'api', 'cron', 'pipeline-watch.js'), 'utf8');
t('핸들러가 checkHeartbeats 를 호출한다', /const heartbeat = await checkHeartbeats\(/.test(wsrc));
t('응답에 heartbeat 가 실린다', /res\.status\(200\)\.json\(\{ ok: true[^}]*\bheartbeat\b/.test(wsrc));
t('알림 키가 분리돼 있다', /HEARTBEAT_ALERT_KEY = 'heartbeat-health'/.test(wsrc));
t('감시 실패가 본 크론을 죽이지 않는다', /heartbeat 감시 실패/.test(wsrc));
t('새 테이블 없이 ops_alert_state 를 재사용한다',
  /'hb:' \+ beat\.source/.test(fs.readFileSync(path.join(ROOT, 'api', 'ops', 'heartbeat.js'), 'utf8')));

console.log('\n[8] 맥미니 스크립트가 신호를 보내는가');
// 스크립트는 저장소 밖(사용자 맥)에 있으므로, 저장소 사본이 있으면 검사한다.
const shPath = path.join(ROOT, 'tools', 'pap-video-compress.sh');
if (fs.existsSync(shPath)) {
  const sh = fs.readFileSync(shPath, 'utf8');
  t('성공 경로에서 신호를 보낸다', /beat 1 /.test(sh));
  t('실패 경로에서도 신호를 보낸다', /beat 0 /.test(sh));
  t('폴더를 못 찾아도 사유를 실어 보낸다', /beat 0 "드라이브 유튜브 폴더 못 찾음"/.test(sh));
  t('신호 실패가 스크립트를 죽이지 않는다', /\|\| true/.test(sh));
  t('소리를 살린다 (음소거 아님)', /-c:a aac/.test(sh) && !/-an\b(?!.*pass 1)/.test(sh.replace(/-an -f mp4/g, '')));
} else {
  t('tools/pap-video-compress.sh 사본이 저장소에 있다', false, '없음 — 스크립트가 저장소 밖에만 있으면 변경 추적이 안 된다');
}

console.log('\n' + (fail ? '❌' : '✅') + ` ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
