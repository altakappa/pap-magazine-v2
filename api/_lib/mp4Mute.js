/**
 * PAP Magazine — MP4 음소거 (오디오 트랙 무력화)
 *
 * 2026-08-05 도메니코:
 *   "음악의 경우 인스타에서 설정한거기 때문에 음소거해서 올리면 좋겠어"
 *
 * 왜 이렇게 만들었나:
 *   릴스의 음악은 인스타그램 음원 라이브러리에서 붙인 것이다. 인스타 안에서는
 *   라이선스가 있지만 유튜브로 그대로 넘기면 우리 채널이 Content ID 클레임을
 *   받는다(현재 업로드분 28건이 공개 조회 안 되는 것도 이 선일 가능성이 있다).
 *   그래서 업로드 직전에 오디오를 뺀다.
 *
 *   그런데 Vercel 런타임에는 ffmpeg 가 없다(package.json 의존성 5개 전부 확인:
 *   supabase-js / formidable / jsonwebtoken / nodemailer / sharp). 바이너리를
 *   번들하면 함수 크기·콜드스타트가 망가진다. 그래서 순수 JS 박스 변형으로 푼다.
 *
 * 방법 — 오디오 trak 박스의 타입을 'free' 로 바꾼다:
 *   ISO BMFF 에서 'free' 는 "무시해도 되는 여유 공간"이다. 타입 4바이트만
 *   덮어쓰므로 **파일 길이가 1바이트도 변하지 않는다**. 이게 핵심이다 —
 *   stco/co64 의 청크 오프셋은 파일 절대 위치라, 바이트를 빼면 moov 가 앞에
 *   있는 faststart 파일에서 전부 어긋난다. 길이를 보존하면 그 문제가 없다.
 *   오디오 샘플 바이트는 mdat 안에 고아로 남지만 아무도 참조하지 않고,
 *   유튜브는 어차피 재인코딩한다.
 *
 * 안전 장치 (하나라도 걸리면 ok:false → 호출부는 업로드를 보류한다):
 *   · moov 없음 / 파싱 실패 / 잘린 박스
 *   · mvex 존재 = 프래그먼트 MP4 — 샘플 정보가 moof 에 흩어져 있어 이 기법이 안 통함
 *   · 오디오 trak 이 없으면 changed:false (이미 무음이므로 그대로 올린다)
 */
'use strict';

const MAX_BOXES = 20000; // 폭주 방지

/** 박스 헤더 1개를 읽는다. 실패하면 null. */
function readBox(buf, off, limit) {
  const end = Math.min(limit, buf.length);
  if (off + 8 > end) return null;
  let size = buf.readUInt32BE(off);
  const type = buf.toString('latin1', off + 4, off + 8);
  let headerSize = 8;
  if (size === 1) {
    if (off + 16 > end) return null;
    const hi = buf.readUInt32BE(off + 8);
    const lo = buf.readUInt32BE(off + 12);
    // 2^53 넘는 크기는 JS 정수로 다룰 수 없다 — 다루지 않는다.
    if (hi > 0x001fffff) return null;
    size = hi * 4294967296 + lo;
    headerSize = 16;
  } else if (size === 0) {
    size = end - off; // 마지막 박스: 파일 끝까지
  }
  if (size < headerSize || off + size > end) return null;
  return { type, size, headerSize, start: off, payload: off + headerSize, end: off + size };
}

/** [start, end) 구간의 형제 박스들을 모은다. 하나라도 깨지면 null. */
function listBoxes(buf, start, end) {
  const out = [];
  let off = start;
  while (off < end) {
    const b = readBox(buf, off, end);
    if (!b) return null;
    out.push(b);
    if (out.length > MAX_BOXES) return null;
    off = b.end;
  }
  return out;
}

/** 형제들 중 첫 번째 type 박스. */
function findChild(buf, box, type) {
  const kids = listBoxes(buf, box.payload, box.end);
  if (!kids) return null;
  return kids.find((k) => k.type === type) || null;
}

/**
 * 오디오 트랙을 무력화한 새 버퍼를 만든다.
 * @param {Buffer} input
 * @returns {{ok:boolean, changed:boolean, buffer?:Buffer, muted:number, reason:string}}
 */
function muteMp4(input) {
  const fail = (reason) => ({ ok: false, changed: false, muted: 0, reason });
  if (!Buffer.isBuffer(input) || input.length < 16) return fail('버퍼가 비었거나 너무 작음');

  const top = listBoxes(input, 0, input.length);
  if (!top) return fail('MP4 박스 파싱 실패 (손상되었거나 MP4 가 아님)');

  const moov = top.find((b) => b.type === 'moov');
  if (!moov) return fail('moov 박스 없음');

  const moovKids = listBoxes(input, moov.payload, moov.end);
  if (!moovKids) return fail('moov 내부 파싱 실패');
  if (moovKids.some((b) => b.type === 'mvex')) {
    return fail('프래그먼트 MP4(mvex) — 오프셋 보존 음소거 불가');
  }

  const audioTraks = [];
  for (const trak of moovKids) {
    if (trak.type !== 'trak') continue;
    const mdia = findChild(input, trak, 'mdia');
    if (!mdia) return fail('trak 안에 mdia 없음 — 구조를 신뢰할 수 없음');
    const hdlr = findChild(input, mdia, 'hdlr');
    if (!hdlr) return fail('mdia 안에 hdlr 없음 — 구조를 신뢰할 수 없음');
    // hdlr payload: version+flags(4) pre_defined(4) handler_type(4)
    if (hdlr.payload + 12 > hdlr.end) return fail('hdlr 박스가 짧음');
    const handler = input.toString('latin1', hdlr.payload + 8, hdlr.payload + 12);
    if (handler === 'soun') audioTraks.push(trak);
  }

  if (!audioTraks.length) {
    return { ok: true, changed: false, buffer: input, muted: 0, reason: '오디오 트랙 없음 — 이미 무음' };
  }

  const out = Buffer.from(input); // 원본 불변
  for (const trak of audioTraks) {
    out.write('free', trak.start + 4, 4, 'latin1');
  }
  return {
    ok: true, changed: true, buffer: out, muted: audioTraks.length,
    reason: '오디오 트랙 ' + audioTraks.length + '개 무력화 (trak→free, 길이 보존)',
  };
}

module.exports = { muteMp4, readBox, listBoxes, findChild };
