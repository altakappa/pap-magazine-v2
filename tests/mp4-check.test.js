/**
 * mp4Check — 올리기 전 손상 검사 + drive-tiktok-post 포기 규칙 (2026-10-25)
 *
 * 실측: 1022_이동욱… .mp4(2.3MB, moov 없음) 가 틱톡 경로에서 57회 연속 실패.
 * 상자 구조만 보는 가벼운 검사라 합성 버퍼로 실제 실행해 본다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { mp4Readable, topLevelBoxes } = require('../api/_lib/mp4Check');

let pass = 0, fail = 0;
function t(n, c, d){ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗',n); if(d)console.log('     ',d);} }

/* 상자 하나: [size][type][payload] */
function box(type, payloadLen, sizeOverride) {
  const b = Buffer.alloc(8 + payloadLen);
  b.writeUInt32BE(sizeOverride == null ? 8 + payloadLen : sizeOverride, 0);
  b.write(type, 4, 'latin1');
  return b;
}

console.log('\n=== 상자 파싱 ===');
const good = Buffer.concat([box('ftyp', 24), box('moov', 500), box('free', 0), box('mdat', 3000)]);
t('정상 파일: ftyp,moov,free,mdat', JSON.stringify(topLevelBoxes(good).map((b) => b.type)) === '["ftyp","moov","free","mdat"]');
t('정상 파일은 ok', mp4Readable(good).ok === true);

const tailMoov = Buffer.concat([box('ftyp', 24), box('free', 0), box('mdat', 3000), box('moov', 500)]);
t('moov 가 뒤에 있는 파일도 ok', mp4Readable(tailMoov).ok === true);

console.log('=== 손상 ===');
/* 실측 모양 그대로: ftyp, free, 그리고 파일 끝까지 덮는 mdat. moov 없음. */
const realShape = Buffer.concat([box('ftyp', 24), box('free', 0), box('mdat', 2000)]);
const r1 = mp4Readable(realShape);
t('moov 없으면 거부 (실측 1022_이동욱 모양)', r1.ok === false && /moov/.test(r1.reason), r1.reason);
t('사유에 상자 목록과 용량이 들어간다', /ftyp,free,mdat/.test(r1.reason) && /MB/.test(r1.reason), r1.reason);

const cutFast = Buffer.concat([box('ftyp', 24), box('moov', 500), box('mdat', 100, 8 + 3000)]);   // mdat 가 3000 이라 선언, 실제 100
const r2 = mp4Readable(cutFast);
t('마지막 상자가 파일 끝을 넘치면 거부 (앞쪽 moov 파일이 끊긴 경우)', r2.ok === false && /넘침/.test(r2.reason), r2.reason);

const noMdat = Buffer.concat([box('ftyp', 24), box('moov', 500)]);
t('mdat 없으면 거부', mp4Readable(noMdat).ok === false);

t('빈 버퍼·비 mp4 는 거부(예외 없이)', mp4Readable(Buffer.alloc(0)).ok === false && mp4Readable(Buffer.from('hello world!!!!!')).ok === false);

const big = Buffer.concat([box('ftyp', 24), box('moov', 10), (() => { const b = Buffer.alloc(16 + 50); b.writeUInt32BE(1, 0); b.write('mdat', 4, 'latin1'); b.writeUInt32BE(0, 8); b.writeUInt32BE(66, 12); return b; })()]);
t('64비트 크기(size=1) 상자를 읽는다', mp4Readable(big).ok === true, JSON.stringify(topLevelBoxes(big)));

console.log('=== drive-tiktok-post 배선 ===');
const src = fs.readFileSync(path.join(__dirname, '..', 'api/cron/drive-tiktok-post.js'), 'utf8');
t('내려받은 직후, 스토리지 업로드 전에 검사한다',
  src.indexOf('mp4Readable(buf)') > 0 && src.indexOf('mp4Readable(buf)') < src.indexOf('publicUrl = await relayToStorage'));
t('손상이면 rejected — 재시도 대상(failed)이 아니다', /err\.permanent[\s\S]{0,80}status = 'rejected'/.test(src));
t('손상·포기는 5xx 로 다시 알리지 않는다 (사람에겐 텔레그램)', /status === 'rejected' \|\| status === 'given_up'[\s\S]{0,400}res\.status\(200\)/.test(src) && /tellHuman\(/.test(src));
t('그 외 사유도 연속 실패 상한 뒤엔 포기한다 (TIKTOK_DRIVE_GIVE_UP_AFTER)', /GIVE_UP_AFTER/.test(src) && /status = 'given_up'/.test(src) && /ops_alert_state/.test(src));
const claim = fs.readFileSync(path.join(__dirname, '..', 'api/_lib/driveClaim.js'), 'utf8');
t('doneIdsFrom 은 failed 와 살아있는 claiming 만 재후보로 둔다 (rejected/given_up 은 끝난 것)',
  /if \(r\.status === 'failed'\) continue;/.test(claim) && !/rejected|given_up/.test(claim.split('function doneIdsFrom')[1].split('return out')[0].replace(/\/\*[\s\S]*?\*\//g, '')));

console.log(`\npassed: ${pass}   failed: ${fail}`);
if (fail) { console.log('❌ mp4-check tests FAILED'); process.exit(1); }
console.log('✅ mp4-check tests passed');
