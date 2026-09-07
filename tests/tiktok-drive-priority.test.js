/**
 * 틱톡: 드라이브 우선 · 중복 방지 · 상한 일치 (2026-09-07)
 *
 * ■ 도메니코 신고: "틱톡에는 영상이 가끔 누락되거나 중복으로 올라가더라."
 *
 * ■ 실측한 원인 둘
 *  ① 중복 — 크론 둘이 서로를 못 봤다.
 *       tiktok-reels       기사 기준, 열쇠 article_id
 *       drive-tiktok-post  파일 기준, 열쇠 drive_file_id
 *     DB 에는 중복 행이 없다(둘 다 자기 열쇠로는 유일). 그래서 안 보였다.
 *     같은 기사가 두 번 나간 쌍 12개를 찾았다.
 *  ② 누락 — 숫자 두 개가 서로 다른 말을 했다.
 *       drive-tiktok-post MAX_BYTES 100MB  vs  supabase storage 50MB
 *     그 사이 크기 영상은 통과 후 업로드에서 죽고, 실패 행은 재시도 대상이라
 *     10분마다 영원히 재시도하며 영원히 실패했다 (실측 3건).
 *
 * ■ 도메니코 결정: 드라이브가 이긴다 (사람이 편집한 세로 영상이므로).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const REELS = read('api/cron/tiktok-reels.js');
const DRIVE = read('api/cron/drive-tiktok-post.js');
const LIB = read('api/_lib/tiktokDrive.js');

/* supabase 클라이언트는 스텁한다 — 네트워크·키 없이 로직만 본다
   (저장소 관례: no-eager-npm-deps 가 이 방식을 요구한다) */
const supPath = require.resolve(path.join(ROOT, 'api/_lib/supabase.js'));
require.cache[supPath] = {
  id: supPath, filename: supPath, loaded: true,
  exports: { supabaseAdmin: { from: () => ({ select: () => ({}) }) } },
};
const tkd = require('../api/_lib/tiktokDrive');

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

console.log('틱톡 드라이브 우선');

console.log('=== ① 규칙은 한 벌이다 ===');

t('상한이 한 곳에만 있다', () => {
  assert.ok(/MAX_BYTES = Number\(process\.env\.TIKTOK_DRIVE_MAX_BYTES/.test(LIB), '공유 상한이 없다');
  assert.ok(/MAX_BYTES = tkd\.MAX_BYTES/.test(DRIVE), '드라이브 크론이 자기 상한을 따로 쓴다');
  assert.ok(!/MAX_BYTES = \d+ \* 1024/.test(DRIVE), '크론에 상한 숫자가 다시 적혀 있다');
});

t('상한이 스토리지 실제 상한(50MB)과 같다', () => {
  // 이 숫자를 올리려면 storage.buckets 쪽을 먼저 올려야 한다.
  assert.strictEqual(tkd.MAX_BYTES, 50 * 1024 * 1024,
    '스토리지가 못 받는 크기를 통과시키면 10분마다 영원히 실패한다');
});

t('파일 선별과 기사 조회도 공유한다', () => {
  assert.ok(/tkd\.pickViable\(files, done\)/.test(DRIVE), '파일 선별이 크론에 복사돼 있다');
  assert.ok(/tkd\.recentArticles\(\)/.test(DRIVE), '기사 조회 창이 크론에 복사돼 있다');
});

t('릴스와 드라이브가 같은 매칭 함수를 본다', () => {
  // 각자 매칭하면 판단이 갈리고, 그게 지금 고치는 중복의 원인이다.
  assert.ok(/require\('\.\.\/_lib\/tiktokDrive'\)/.test(REELS), '릴스가 공유 모듈을 안 쓴다');
  assert.ok(/matchArticle/.test(LIB), '공유 모듈이 매칭을 하지 않는다');
  assert.ok(!/matchArticle/.test(REELS), '릴스가 매칭을 따로 한다');
});

console.log('=== ② 상한 초과는 사전에 걸러 보류로 보여준다 ===');

t('상한 초과 파일은 후보에서 빠지고 사유가 남는다', () => {
  const r = tkd.pickViable([
    { id: 'a', name: '0907_정상영상.mp4', bytes: 10 * 1024 * 1024 },
    { id: 'b', name: '0907_큰영상.mp4', bytes: 80 * 1024 * 1024 },
  ], new Set());
  assert.deepStrictEqual(r.candidates.map((f) => f.id), ['a']);
  assert.strictEqual(r.skipped.length, 1);
  assert.ok(/80MB/.test(r.skipped[0].why), '실제 크기를 안 알려준다: ' + r.skipped[0].why);
  assert.ok(/스토리지/.test(r.skipped[0].why), '왜 못 올리는지 안 알려준다: ' + r.skipped[0].why);
});

t('이미 처리한 파일은 후보가 아니다', () => {
  const r = tkd.pickViable([{ id: 'a', name: '0907_영상.mp4', bytes: 1000 }], new Set(['a']));
  assert.strictEqual(r.candidates.length, 0);
  assert.strictEqual(r.skipped.length, 0, '이미 처리한 것을 보류로 보고하면 노이즈가 된다');
});

console.log('=== ③ 드라이브가 이긴다 ===');

t('릴스가 드라이브 대기 기사를 양보한다', () => {
  assert.ok(/articlesWaitingForDrive/.test(REELS), '릴스에 양보 경로가 없다');
  assert.ok(/waiting\.ids\.has\(a\.id\)/.test(REELS), '양보 판단을 안 한다');
  assert.ok(/afterYield\.slice\(0, CREDIT_SCAN_MAX\)/.test(REELS),
    '양보 결과를 안 쓰고 원래 후보를 그대로 돈다');
});

t('양보에는 기한이 있다 (드라이브가 막혀도 영원히 안 나가지 않게)', () => {
  assert.ok(/DRIVE_YIELD_H/.test(REELS), '양보 기한이 없다');
  assert.ok(/at < yieldCut/.test(REELS), '기한을 실제로 비교하지 않는다');
});

t('기한을 재려면 published_date 가 있어야 한다', () => {
  // 없으면 Date.parse(undefined)=NaN → 조건이 항상 거짓 → 영원히 양보한다
  const cols = /const ART_COLS = '([^']+)'/.exec(REELS);
  assert.ok(cols, 'ART_COLS 를 못 찾았다');
  assert.ok(cols[1].includes('published_date'), '릴스가 published_date 를 안 가져온다');
});

t('드라이브를 못 보면 양보하지 않는다', () => {
  // 여기서 멈추면 틱톡이 통째로 죽는다. 최악이 중복 1건이고 그쪽이 낫다.
  assert.ok(/catch \(_\) \{ \/\* 못 보면 양보하지 않는다/.test(REELS), '드라이브 실패가 릴스를 죽인다');
  assert.ok(/드라이브 조회 실패/.test(LIB) && /ids: new Set\(\)/.test(LIB),
    '공유 모듈이 조회 실패 때 빈 집합을 안 준다');
});

console.log('=== ④ 드라이브는 올리기 전에 확인한다 ===');

t('게시 전에 그 기사가 이미 나갔는지 본다', () => {
  const before = DRIVE.indexOf("select('drive_file_id, status').eq('article_id', art.id)");
  const post = DRIVE.indexOf('buffer.createVideoPost');
  assert.ok(before > 0, '게시 전 확인이 없다');
  assert.ok(before < post, '확인이 게시 뒤에 있다 — 이미 나간 뒤에는 되돌릴 수 없다');
});

t('중복이면 올리지 않고 skipped 로 기록한다', () => {
  assert.ok(/status: 'skipped'/.test(DRIVE), '중복 스킵을 기록하지 않는다');
  assert.ok(/skippedDuplicate: true/.test(DRIVE), '중복 스킵을 응답에 안 알린다');
  assert.ok(!/status: 'failed'[\s\S]{0,200}중복 방지/.test(DRIVE),
    'failed 로 남기면 10분마다 영원히 다시 집는다');
});

t('failed 인 줄은 중복으로 치지 않는다 (재시도를 막으면 안 된다)', () => {
  assert.ok(/taken0\.status !== 'failed'/.test(DRIVE), '실패한 줄 때문에 재시도가 막힌다');
});

console.log('=== ⑤ 기존 설계는 그대로다 ===');

t('게시 후 기록 실패를 여전히 삼키지 않는다', () => {
  assert.ok(/DB 기록 실패 — 같은 영상이 반복 게시될 수 있음/.test(DRIVE));
  assert.ok(/게시 후 기록 실패 — 중복 게시 위험/.test(REELS));
});

t('릴스는 여전히 자리를 먼저 찜한다', () => {
  assert.ok(/status: 'claiming'/.test(REELS), '찜 없이 올리면 2026-08-09 사고가 돌아온다');
});

console.log('=== ⑥ 안 올라간 것을 누가 본다 ===');

/* 2026-09-07 도메니코: "오늘부터 앞으로 안 올라가는 건 없게 하자."
 * 그러려면 '안 올라간 것' 을 누군가 보고 있어야 한다. 지금은 아무도 안 봤다.
 * pipeline-watch 의 틱톡 감시는 화보 사진 경로(tiktok-post)만 봤고,
 * 드라이브 영상·릴스 경로는 어떤 감시에도 안 걸려 있었다. 그래서 50MB 초과
 * 영상 3건이 08-21 부터 10분마다 실패하는 동안 알림이 한 번도 안 갔다. */
const WATCH = read('api/cron/pipeline-watch.js');

const now = Date.parse('2026-09-07T12:00:00Z');
const hAgo = (n) => new Date(now - n * 3600000).toISOString();
const FILES = [
  { id: 'a', name: '0907_방금넣은영상.mp4', bytes: 10e6, modifiedAt: hAgo(1) },
  { id: 'b', name: '0906_아홉시간째.mp4', bytes: 10e6, modifiedAt: hAgo(9) },
  { id: 'c', name: '0905_큰영상.mp4', bytes: 80e6, modifiedAt: hAgo(40) },
  { id: 'd', name: '_제외한영상.mp4', bytes: 10e6, modifiedAt: hAgo(50) },
  { id: 'e', name: '0904_이미올림.mp4', bytes: 10e6, modifiedAt: hAgo(60) },
];

t('감시가 드라이브 경로를 본다 (예전엔 화보 사진만 봤다)', () => {
  assert.ok(/checkDriveTikTok/.test(WATCH), 'pipeline-watch 에 드라이브 감시가 없다');
  assert.ok(/tkd\.driveBacklog\(\)/.test(WATCH), '공유 판정을 안 쓴다');
  assert.ok(/tiktokDrive = await checkDriveTikTok/.test(WATCH), '감시를 부르지 않는다');
  assert.ok(/tiktok, tiktokDrive,/.test(WATCH), '결과를 응답에 안 싣는다');
});

t('막 넣은 영상은 적체가 아니다', () => {
  const d = tkd.judgeDriveBacklog([FILES[0]], new Set(), { now });
  assert.strictEqual(d.healthy, true, '1시간 된 영상을 적체로 본다');
});

t('오래 대기한 영상을 잡는다', () => {
  const d = tkd.judgeDriveBacklog([FILES[0], FILES[1]], new Set(), { now });
  assert.strictEqual(d.healthy, false);
  assert.strictEqual(d.cause, 'stuck');
  assert.deepStrictEqual(d.stuck.map((x) => x.name), ['0906_아홉시간째.mp4']);
});

t('상한 초과는 대기 시간과 무관하게 바로 잡는다', () => {
  // 기다린다고 풀리지 않는다. 사람이 파일을 줄여야 한다.
  const d = tkd.judgeDriveBacklog([{ ...FILES[2], modifiedAt: hAgo(0.1) }], new Set(), { now });
  assert.strictEqual(d.healthy, false);
  assert.strictEqual(d.cause, 'oversize');
  assert.strictEqual(d.oversize[0].mb, 76);
});

t('일부러 뺀 파일(_ 접두사)은 적체가 아니다', () => {
  const d = tkd.judgeDriveBacklog([FILES[3]], new Set(), { now });
  assert.strictEqual(d.healthy, true, '사람이 의도적으로 뺀 것을 알린다');
});

t('이미 올린 파일은 적체가 아니다', () => {
  const d = tkd.judgeDriveBacklog([FILES[4]], new Set(['e']), { now });
  assert.strictEqual(d.healthy, true);
});

t('알림이 무엇을 해야 하는지까지 말한다', () => {
  // '뭔가 막혔다' 만 오는 알림은 두 번째부터 안 읽힌다.
  assert.ok(/파일을 줄여서 다시 넣어 주세요/.test(WATCH), '상한 초과에 할 일이 없다');
  assert.ok(/시간째 대기 \(기사 매칭 실패일 수 있음\)/.test(WATCH), '대기 건에 단서가 없다');
  assert.ok(/drive-tiktok-post\?list=1/.test(WATCH), '대기 목록으로 가는 링크가 없다');
});

t('복구되면 한 번 알린다', () => {
  assert.ok(/틱톡 드라이브 영상 적체 해소/.test(WATCH), '복구 알림이 없다');
  assert.ok(/TIKTOK_DRIVE_ALERT_KEY/.test(WATCH), '쿨다운 키가 없다');
});

t('감시 실패가 pipeline-watch 를 죽이지 않는다', () => {
  assert.ok(/tiktok drive backlog 실패/.test(WATCH), 'try/catch 가 없다');
});

console.log(`\n${n}개 테스트 통과`);
