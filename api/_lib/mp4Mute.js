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


/* ── 영상 해상도 읽기 (2026-08-23) ───────────────────────────────
 * 도메니코가 릴스 크롭(9:16)을 요청했다. 그런데 크롭은 재인코딩이고
 * Vercel 에는 ffmpeg 가 없다(이 파일 머리말 참조).
 * 그래서 **크롭이 정말 필요한지부터** 잰다 — 릴스 원본이 이미 9:16 이면
 * 할 일이 없다. 판단을 코드가 아니라 숫자로 하기 위한 함수다.
 *
 * tkhd 의 width/height 는 16.16 고정소수점 '표시 크기' 다(픽셀 크기가 아니라
 * 화면에 그려질 크기라, 세로 영상의 회전까지 반영돼 있다 — 우리가 알고 싶은
 * 비율에는 이쪽이 맞다). 비디오 trak 을 찾아 그 값을 읽는다.
 * 못 읽으면 null — 호출부는 '모른다' 로 다루고 진행한다.
 */
function mp4Dimensions(buf) {
  try {
    const top = listBoxes(buf, 0, buf.length);
    if (!top) return null;
    const moov = top.find((b) => b.type === 'moov');
    if (!moov) return null;
    const inMoov = listBoxes(buf, moov.payload, moov.end);
    if (!inMoov) return null;
    for (const trak of inMoov.filter((b) => b.type === 'trak')) {
      const inTrak = listBoxes(buf, trak.payload, trak.end);
      if (!inTrak) continue;
      const mdia = inTrak.find((b) => b.type === 'mdia');
      const hdlr = mdia && findChild(buf, mdia, 'hdlr');
      // hdlr: version/flags(4) + pre_defined(4) + handler_type(4)
      if (!hdlr || hdlr.end - hdlr.payload < 12) continue;
      if (buf.toString('latin1', hdlr.payload + 8, hdlr.payload + 12) !== 'vide') continue;
      const tkhd = inTrak.find((b) => b.type === 'tkhd');
      if (!tkhd) continue;
      const version = buf[tkhd.payload];
      // v0: ...(4) creation(4) modification(4) trackID(4) reserved(4) duration(4)
      // v1: ...(4) creation(8) modification(8) trackID(4) reserved(4) duration(8)
      const off = tkhd.payload + (version === 1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 4);
      // reserved(8) layer(2) altGroup(2) volume(2) reserved(2) matrix(36) width(4) height(4)
      const wOff = off + 8 + 2 + 2 + 2 + 2 + 36;
      if (wOff + 8 > tkhd.end) continue;
      const w = buf.readUInt32BE(wOff) / 65536;
      const h = buf.readUInt32BE(wOff + 4) / 65536;
      if (!(w > 0 && h > 0)) continue;
      return { width: Math.round(w), height: Math.round(h), ratio: +(w / h).toFixed(4) };
    }
    return null;
  } catch (_e) {
    return null;
  }
}

module.exports = { muteMp4, mp4Dimensions, readBox, listBoxes, findChild };
