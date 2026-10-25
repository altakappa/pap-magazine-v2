/**
 * mp4 가 '읽을 수 있는 파일' 인지 — 올리기 전에 본다 (2026-10-25 신설)
 *
 * ■ 왜
 *   drive-tiktok-post 가 57회 연속 실패했다. 같은 파일(2.3MB)을 10분마다
 *   스토리지에 올리고 Buffer 에 넘겼고, Buffer 는 매번
 *   "Video could not be read from its URL" 로 거부했다.
 *   파일을 받아 ffprobe 로 보니 **moov atom 이 없었다** — 드라이브 업로드가
 *   중간에 끊긴 잘린 파일이다. 유튜브 경로는 같은 파일을 '제출 성공' 으로
 *   기록했지만 영상(G_7HQplOL34)은 공개 조회가 안 된다. 즉 두 경로 모두
 *   손상 파일을 못 걸러냈고, 한쪽은 조용히 실패, 한쪽은 영원히 재시도했다.
 *
 * ■ 무엇을 보나
 *   mp4 는 [size(4)][type(4)] 상자가 줄줄이 이어진 구조다. 최상위 상자만 훑어
 *   'moov'(재생 정보) 와 'mdat'(실제 데이터) 가 **둘 다** 있는지 본다.
 *   잘린 파일은 보통 mdat 도중에 끊겨 뒤에 올 moov 가 없다.
 *   (앞쪽 moov 로 인코딩된 파일은 mdat 가 잘려도 moov 는 있다 — 그 경우
 *   마지막 상자가 파일 끝을 넘치는지로 잡는다.)
 *
 * ■ 무엇을 안 보나
 *   코덱·해상도·길이는 안 본다. 그건 ffprobe 몫이고 서버리스 함수엔 없다.
 *   여기서 통과해도 플랫폼이 거부할 수는 있다. 여기서 **걸리면** 확실히 손상이다.
 */
'use strict';

const MAX_BOXES = 64;

/** 최상위 상자 목록 [{type, size, offset, truncated}] — 파싱 불가면 빈 배열 */
function topLevelBoxes(buf) {
  const out = [];
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 8) return out;
  let off = 0;
  while (off + 8 <= buf.length && out.length < MAX_BOXES) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (!/^[\x20-\x7e]{4}$/.test(type)) break;                 // 상자 이름이 글자가 아니면 구조가 깨진 것
    if (size === 1) {                                          // 64비트 크기
      if (off + 16 > buf.length) { out.push({ type, size: null, offset: off, truncated: true }); break; }
      const hi = buf.readUInt32BE(off + 8), lo = buf.readUInt32BE(off + 12);
      size = hi * 4294967296 + lo;
    } else if (size === 0) {                                   // 파일 끝까지
      size = buf.length - off;
    }
    if (size < 8) break;
    const truncated = off + size > buf.length;
    out.push({ type, size, offset: off, truncated });
    if (truncated) break;
    off += size;
  }
  return out;
}

/** { ok, reason, boxes } — ok 가 false 면 올리지 말고 사람에게 알린다 */
function mp4Readable(buf) {
  const boxes = topLevelBoxes(buf);
  const types = boxes.map((b) => b.type);
  const mb = buf && buf.length ? (buf.length / 1048576).toFixed(1) + 'MB' : '0MB';
  if (!boxes.length) return { ok: false, reason: 'mp4 상자 구조가 아님 (' + mb + ')', boxes: types };
  if (!types.includes('moov')) {
    return { ok: false, reason: '잘린 파일 — moov(재생 정보) 없음, ' + mb + ' · 상자: ' + types.join(','), boxes: types };
  }
  if (!types.includes('mdat')) {
    return { ok: false, reason: '영상 데이터(mdat) 없음, ' + mb + ' · 상자: ' + types.join(','), boxes: types };
  }
  const last = boxes[boxes.length - 1];
  if (last.truncated) {
    return { ok: false, reason: '마지막 상자(' + last.type + ')가 파일 끝을 넘침 — 업로드 중 끊긴 파일, ' + mb, boxes: types };
  }
  return { ok: true, reason: '', boxes: types };
}

module.exports = { topLevelBoxes, mp4Readable };
