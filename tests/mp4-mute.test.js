/**
 * MP4 음소거 — tests/mp4-mute.test.js
 *
 * 2026-08-05 도메니코: "음악은 인스타에서 설정한거기 때문에 음소거해서 올리면 좋겠어"
 *
 * 여기서 잠그는 것:
 *   ① 오디오 trak 만 'free' 로 바뀐다 — 영상 trak·mdat 는 한 바이트도 안 건드린다
 *   ② **파일 길이가 변하지 않는다** (stco/co64 절대 오프셋 보존. 길이가 변하면
 *      moov 가 앞에 있는 faststart 파일에서 모든 청크 오프셋이 어긋난다)
 *   ③ 못 다루는 형태(mvex/moov 없음/손상)는 조용히 통과시키지 않고 ok:false
 *   ④ 크론이 실패 시 업로드를 보류한다 (fail closed)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { muteMp4, listBoxes } = require('../api/_lib/mp4Mute');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); if (detail) console.log('      ' + detail); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* ---- 합성 MP4 빌더 (실제 IG 릴스 구조의 최소 골격) ---- */
function box(type, payload) {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + payload.length, 0);
  h.write(type, 4, 4, 'latin1');
  return Buffer.concat([h, payload]);
}
function box64(type, payload) {
  const h = Buffer.alloc(16);
  h.writeUInt32BE(1, 0);                 // size == 1 → 64비트 largesize
  h.write(type, 4, 4, 'latin1');
  h.writeUInt32BE(0, 8);
  h.writeUInt32BE(16 + payload.length, 12);
  return Buffer.concat([h, payload]);
}
function hdlr(handler) {
  const p = Buffer.alloc(24);            // version+flags(4) pre_defined(4) handler_type(4) reserved(12)
  p.write(handler, 8, 4, 'latin1');
  return box('hdlr', p);
}
function trak(handler, mk) {
  const mdia = (mk || box)('mdia', Buffer.concat([hdlr(handler), box('minf', Buffer.alloc(8))]));
  return (mk || box)('trak', Buffer.concat([box('tkhd', Buffer.alloc(84)), mdia]));
}
function mp4(opt) {
  const o = opt || {};
  const kids = [box('mvhd', Buffer.alloc(100)), trak('vide', o.mk)];
  if (o.audio !== false) kids.push(trak('soun', o.mk));
  if (o.mvex) kids.push(box('mvex', Buffer.alloc(8)));
  const parts = [box('ftyp', Buffer.from('isom0000', 'latin1'))];
  const moov = (o.mk || box)('moov', Buffer.concat(kids));
  const mdat = box('mdat', Buffer.alloc(256, 0x5a));
  parts.push(o.moovLast ? mdat : moov, o.moovLast ? moov : mdat);
  return Buffer.concat(parts);
}
function typeCounts(buf) {
  const out = {};
  (function walk(start, end, depth) {
    const kids = listBoxes(buf, start, end);
    if (!kids || depth > 6) return;
    for (const k of kids) {
      out[k.type] = (out[k.type] || 0) + 1;
      if (['moov', 'trak', 'mdia'].includes(k.type)) walk(k.payload, k.end, depth + 1);
    }
  })(0, buf.length, 0);
  return out;
}

section('정상 파일 — 오디오만 무력화');
{
  const input = mp4();
  const before = Buffer.from(input);
  const r = muteMp4(input);
  ok('ok', r.ok === true, r.reason);
  ok('changed', r.changed === true);
  ok('오디오 트랙 1개 처리', r.muted === 1);
  ok('길이가 그대로다 (오프셋 보존의 핵심)', r.buffer.length === input.length);
  ok('원본 버퍼는 변형되지 않는다 (복사본 반환)', input.equals(before));

  const diff = [];
  for (let i = 0; i < r.buffer.length; i++) if (r.buffer[i] !== before[i]) diff.push(i);
  /* 'trak' → 'free' 는 2번째 글자 r 이 겹쳐서 실제 차이는 3바이트다.
     중요한 건 개수가 아니라 '타입 4바이트 창 안에서만 바뀌었다'는 것. */
  ok('바뀐 바이트가 4바이트 창 안에만 있다',
    diff.length > 0 && diff.length <= 4 && diff[diff.length - 1] - diff[0] <= 3, 'diff=' + JSON.stringify(diff));
  const boxStart = diff[0] - 4; // 타입 필드는 박스 시작 +4
  ok('바뀐 값이 free', r.buffer.toString('latin1', boxStart + 4, boxStart + 8) === 'free');
  ok('박스 size 필드는 건드리지 않는다', before.readUInt32BE(boxStart) === r.buffer.readUInt32BE(boxStart));
  ok('박스 size 필드(앞 4바이트)는 건드리지 않는다', diff[0] % 1 === 0 && before.readUInt32BE(diff[0] - (diff[0] - 4 >= 0 ? 4 : 0)) === r.buffer.readUInt32BE(diff[0] - 4));

  const c0 = typeCounts(before); const c1 = typeCounts(r.buffer);
  ok('trak 2개 → 1개', c0.trak === 2 && c1.trak === 1);
  ok('free 박스가 생겼다', !c0.free && c1.free === 1);
  ok('mdat 은 그대로', c1.mdat === 1);
  ok('영상 trak 은 살아 있다', c1.trak === 1);
}

section('moov 위치와 상관없이 동작 (faststart / 비-faststart)');
{
  const r = muteMp4(mp4({ moovLast: true }));
  ok('moov 가 뒤에 있어도 처리', r.ok === true && r.changed === true, r.reason);
}

section('64비트 largesize 박스');
{
  const r = muteMp4(mp4({ mk: box64 }));
  ok('size==1 형식을 파싱한다', r.ok === true && r.changed === true, r.reason);
  ok('길이 보존', r.ok && r.buffer.length === mp4({ mk: box64 }).length);
}

section('이미 무음이면 그대로 올린다');
{
  const r = muteMp4(mp4({ audio: false }));
  ok('ok 이지만 changed=false', r.ok === true && r.changed === false, r.reason);
  ok('버퍼를 그대로 돌려준다', r.buffer.length === mp4({ audio: false }).length);
  ok('이유가 남는다', /오디오 트랙 없음/.test(r.reason));
}

section('다룰 수 없는 형태는 ok:false — 조용히 통과시키지 않는다');
{
  ok('mvex(프래그먼트 MP4) 거부', muteMp4(mp4({ mvex: true })).ok === false);
  ok('mvex 이유 명시', /mvex/.test(muteMp4(mp4({ mvex: true })).reason));

  const noMoov = Buffer.concat([box('ftyp', Buffer.from('isom')), box('mdat', Buffer.alloc(32))]);
  ok('moov 없음 거부', muteMp4(noMoov).ok === false);

  ok('빈 버퍼 거부', muteMp4(Buffer.alloc(0)).ok === false);
  ok('버퍼가 아니면 거부', muteMp4('not a buffer').ok === false);
  ok('랜덤 바이트 거부(예외 없이)', muteMp4(Buffer.alloc(4096, 0xab)).ok === false);

  const truncated = mp4().subarray(0, 40);
  ok('잘린 파일 거부', muteMp4(truncated).ok === false);

  const bad = Buffer.from(mp4());
  bad.writeUInt32BE(0xfffffff0, 0); // ftyp 크기를 파일보다 크게
  ok('박스 크기가 파일을 넘으면 거부', muteMp4(bad).ok === false);
}

section('크론 배선 — 실패하면 업로드하지 않는다');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'cron', 'youtube-post.js'), 'utf8');
  ok('youtube-post 가 mp4Mute 를 불러온다', src.includes("require('../_lib/mp4Mute')"));
  ok('다운로드 직후 음소거한다', src.includes('const mute = muteMp4(buffer);'));
  ok('음소거 실패 시 업로드 보류', src.includes("'음소거 실패 — 업로드 보류'"));
  ok('업로드는 음소거된 버퍼를 쓴다', src.includes('uploadVideo(uploadBuffer'));
  ok('원본 buffer 로는 업로드하지 않는다', !/uploadVideo\(buffer\b/.test(src));
  ok('음소거가 업로드보다 앞선다',
    src.indexOf('const mute = muteMp4(buffer);') < src.indexOf('uploadVideo(uploadBuffer'));
}

console.log('\npassed: ' + pass + '   failed: ' + fail);
if (fail) { console.log('❌ mp4-mute tests FAILED'); process.exit(1); }
console.log('✅ mp4-mute tests passed');
