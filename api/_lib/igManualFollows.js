/**
 * PAP Magazine — 릴스 팔로우 수동 기록 (2026-09-07 신설)
 *
 * [왜]
 * 인스타 API 는 릴스에 follows 를 안 준다. 앱 인사이트 "팔로우 기준 인기 콘텐츠"만
 * 준다(9/7 실측: 설윤 +74 · 창빈 +25 · HEY PAP +18 · 변우석 +17, 전부 릴스).
 * 팔로워를 만드는 형식이 릴스인데 장부에는 0 으로 찍혀 편성 판단이 감으로 갔다.
 *
 * [어떻게]
 * 텔레그램 한 줄:  팔로우 <숏코드|링크> <숫자>
 *   예) 팔로우 DcxDxXBPE60 74
 *       팔로우 https://www.instagram.com/reel/DcxDxXBPE60/ 74
 * → ig_manual_follows 에 저장 → 뷰 ig_post_latest.follows 가 API 값이 없을 때 이 값을 쓴다
 *   (마이그레이션 146) → 장부·훅 집계·소재 표가 자동으로 흡수.
 *
 * [원칙] 메시지 본문은 데이터다. 정규식에 맞는 형태만 받고, 숫자는 0~999,999 로 제한,
 * 게시물은 우리 표(ig_post_latest)에 있는 것만 받는다. 없는 숏코드는 거절.
 */
'use strict';

const CMD_RE = /^\/?팔로우\s+(\S+)\s+(\d{1,6})\s*$/;
const CODE_RE = /^[A-Za-z0-9_-]{5,20}$/;

/** 숏코드 추출 — 링크든 맨 코드든. 못 읽으면 null. */
function extractShortcode(token) {
  const s = String(token || '').trim();
  const m = s.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,20})/i);
  if (m) return m[1];
  return CODE_RE.test(s) ? s : null;
}

/** 명령 파싱 — 형태가 아니면 null (다른 메시지 흐름을 건드리지 않는다). */
function parseFollowCommand(text) {
  const m = String(text || '').trim().match(CMD_RE);
  if (!m) return null;
  const shortcode = extractShortcode(m[1]);
  if (!shortcode) return { error: '숏코드나 인스타 링크를 못 읽었습니다: ' + m[1].slice(0, 60) };
  return { shortcode, follows: parseInt(m[2], 10) };
}

/**
 * 저장. 반환 { ok, message } — 호출부가 그대로 텔레그램에 답한다.
 * @param supabaseAdmin
 * @param cmd {shortcode, follows}
 * @param recordedBy 채팅 id(문자열)
 */
async function recordManualFollows(supabaseAdmin, cmd, recordedBy) {
  const { data, error } = await supabaseAdmin
    .from('ig_post_latest')
    .select('post_id, permalink, media_type, follows, reach')
    .ilike('permalink', '%/' + cmd.shortcode + '/%')
    .limit(1);
  if (error) return { ok: false, message: '조회 실패: ' + String(error.message).slice(0, 120) };
  const row = data && data[0];
  if (!row) return { ok: false, message: '우리 표에 없는 게시물입니다: ' + cmd.shortcode + ' (스냅샷은 최근 25개만 잡습니다)' };

  const { error: upErr } = await supabaseAdmin.from('ig_manual_follows').upsert({
    post_id: String(row.post_id),
    permalink: row.permalink,
    follows: cmd.follows,
    source: 'app',
    recorded_by: recordedBy ? String(recordedBy).slice(0, 40) : null,
    recorded_at: new Date().toISOString(),
  }, { onConflict: 'post_id' });
  if (upErr) return { ok: false, message: '저장 실패: ' + String(upErr.message).slice(0, 120) };

  const apiNote = (typeof row.follows === 'number' && row.media_type !== 'VIDEO')
    ? ' (API 값 ' + row.follows + ' 이 있어 장부는 API 값을 씁니다)'
    : '';
  const per1k = row.reach > 0 ? ' · ' + (Math.round(10000 * cmd.follows / row.reach) / 10) + '/1k' : '';
  return { ok: true, message: '기록했습니다: ' + (row.permalink || row.post_id) + '\n팔로우 ' + cmd.follows + per1k + apiNote };
}

module.exports = { parseFollowCommand, extractShortcode, recordManualFollows };
